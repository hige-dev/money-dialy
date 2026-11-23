package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"

	"money-diary/internal/s3db"
)

const benchUser = "bench@example.invalid"

// runBench は proto/money.db（読み取り）と proto/bench.db（書き込み）で時間を測る。
func runBench(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("bench", flag.ExitOnError)
	bucket, dir := commonFlags(fs)
	n := fs.Int("n", 20, "各計測の回数")
	keep := fs.Bool("keep", false, "proto/bench.db を消さずに残す")
	fs.Parse(args)

	e, err := newEnv(ctx, *bucket, *dir)
	if err != nil {
		return err
	}
	objects := &timedObjects{ObjectStore: &s3db.S3Objects{Client: e.s3, Bucket: e.bucket}}
	size, err := e.headSize(ctx, moneyKey)
	if err != nil {
		return fmt.Errorf("%s が無い（先に export）: %w", moneyKey, err)
	}
	fmt.Printf("対象: s3://%s/%s  サイズ=%s\n", e.bucket, moneyKey, kib(size))

	countExpenses := func(db *sql.DB) error {
		var c int
		return db.QueryRow(`SELECT count(*) FROM expenses`).Scan(&c)
	}

	// 最初の 1 回は接続の確立（TLS 等）を含むので捨てる
	warm, err := s3db.New(objects, moneyKey, filepath.Join(e.dir, "bench-warm"), s3db.Options{})
	if err != nil {
		return err
	}
	if err := warm.Read(ctx, countExpenses); err != nil {
		return err
	}
	warm.Drop()
	warm.Close()

	// (a) 手元なしからの全ダウンロード（Read 全体: GET 200 + 一時ファイル + rename + 開いて count(*)）
	reader, err := s3db.New(objects, moneyKey, filepath.Join(e.dir, "bench-read"), s3db.Options{})
	if err != nil {
		return err
	}
	defer reader.Close()
	objects.reset()
	var a samples
	for range *n {
		reader.Drop()
		t := time.Now()
		if err := reader.Read(ctx, countExpenses); err != nil {
			return err
		}
		a = append(a, time.Since(t))
	}
	st := reader.Stats()
	fmt.Printf("(a) 全ダウンロード Read: %s  ダウンロード %d 回 / 1 回あたり %s\n    うち GET 200（本体読み切りまで）: %s\n", a, st.Downloads, kib(st.DownloadBytes/max(st.Downloads, 1)), objects.gets)
	objects.reset()

	// (b) 手元ありの条件付き GET（304）+ count(*)
	var b samples
	for range *n {
		t := time.Now()
		if err := reader.Read(ctx, countExpenses); err != nil {
			return err
		}
		b = append(b, time.Since(t))
	}
	st2 := reader.Stats()
	fmt.Printf("(b) 304 Read: %s  304 の回数=%d\n    うち GET 304: %s\n", b, st2.NotModified-st.NotModified, objects.gets)

	// (c) 13 か月分の月別・カテゴリ別集計を SQL 1 本で
	endYM := time.Now().In(time.FixedZone("JST", 9*3600))
	from := endYM.AddDate(0, -12, 0).Format("2006-01")
	to := endYM.Format("2006-01")
	var cRead, cQuery samples
	rows := 0
	for range *n {
		t := time.Now()
		var q time.Duration
		if err := reader.Read(ctx, func(db *sql.DB) error {
			tq := time.Now()
			rs, err := db.QueryContext(ctx, monthlyCategorySQL, from, to, benchUser)
			if err != nil {
				return err
			}
			defer rs.Close()
			rows = 0
			for rs.Next() {
				var ym, cat string
				var amount int64
				if err := rs.Scan(&ym, &cat, &amount); err != nil {
					return err
				}
				rows++
			}
			q = time.Since(tq)
			return rs.Err()
		}); err != nil {
			return err
		}
		cRead = append(cRead, time.Since(t))
		cQuery = append(cQuery, q)
	}
	fmt.Printf("(c) 13か月集計 %s..%s: 結果 %d 行\n    SQL のみ:      %s\n    Read 全体(304込): %s\n", from, to, rows, cQuery, cRead)
	var plan []string
	if err := reader.Read(ctx, func(db *sql.DB) error {
		rs, err := db.QueryContext(ctx, `EXPLAIN QUERY PLAN `+monthlyCategorySQL, from, to, benchUser)
		if err != nil {
			return err
		}
		defer rs.Close()
		for rs.Next() {
			var id, parent, notused int
			var detail string
			if err := rs.Scan(&id, &parent, &notused, &detail); err != nil {
				return err
			}
			plan = append(plan, detail)
		}
		return rs.Err()
	}); err != nil {
		return err
	}
	fmt.Printf("    実行計画: %q\n", plan)

	// (d) 1 行 insert して書き戻す Update 全体（proto/bench.db = money.db のコピー）
	if err := e.copyObject(ctx, moneyKey, benchKey); err != nil {
		return err
	}
	writer, err := s3db.New(objects, benchKey, filepath.Join(e.dir, "bench-write"), s3db.Options{})
	if err != nil {
		return err
	}
	defer writer.Close()
	// 最初の取得（全ダウンロード）は計測に含めない
	if err := writer.Read(ctx, countExpenses); err != nil {
		return err
	}
	today := endYM.Format("2006-01-02")
	objects.reset()
	var d samples
	for range *n {
		id := "bench-" + uuid.NewString()
		t := time.Now()
		err := writer.Update(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec(`INSERT INTO expenses (id, date, payer, category_id, amount, created_by, created_at, updated_at)
				VALUES (?, ?, 'bench', 'bench', 1, ?, ?, ?)`, id, today, benchUser, t.UTC().Format(time.RFC3339), t.UTC().Format(time.RFC3339))
			return err
		})
		if err != nil {
			return err
		}
		d = append(d, time.Since(t))
	}
	ws := writer.Stats()
	dGets, dPuts := objects.gets, objects.puts
	var added int
	if err := writer.Read(ctx, func(db *sql.DB) error {
		return db.QueryRow(`SELECT count(*) FROM expenses WHERE id LIKE 'bench-%'`).Scan(&added)
	}); err != nil {
		return err
	}
	fi, _ := os.Stat(writer.LocalPath())
	fmt.Printf("(d) 1 行 insert の Update 全体: %s\n    追加行=%d PUT=%d GET=%d(304=%d) やり直し=%d 412=%d 409=%d  書き戻しサイズ=%s\n",
		d, added, ws.Puts, ws.Gets, ws.NotModified, ws.Retries, ws.Conflicts412, ws.Conflicts409, kib(fi.Size()))
	fmt.Printf("    内訳 GET(304): %s\n    内訳 PUT:      %s\n", dGets, dPuts)

	if *keep {
		fmt.Printf("%s を残した\n", benchKey)
		return nil
	}
	nv, err := e.purgeKey(ctx, benchKey)
	if err != nil {
		return fmt.Errorf("%s の削除に失敗: %w", benchKey, err)
	}
	fmt.Printf("後片付け: %s の全バージョンを削除 (%d)\n", benchKey, nv)
	return nil
}
