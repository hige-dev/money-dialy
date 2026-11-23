package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"money-diary/internal/s3db"
)

// runRace は K 個の独立した Store（= 別 Lambda インスタンス相当）を同時に動かし、
// それぞれ M 回ずつ一意な行を insert して、取りこぼしが無いかを確かめる。
func runRace(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("race", flag.ExitOnError)
	bucket, dir := commonFlags(fs)
	k := fs.Int("k", 4, "同時に動かす Store の数")
	m := fs.Int("m", 10, "各 Store が insert する回数")
	base := fs.String("base", "empty", "初期状態: empty（空のスキーマ）| money（proto/money.db のコピー。実サイズでの競合）")
	maxAttempts := fs.Int("max-attempts", 30, "Update の最大試行回数")
	keep := fs.Bool("keep", false, "proto/race.db を消さずに残す")
	fs.Parse(args)

	e, err := newEnv(ctx, *bucket, *dir)
	if err != nil {
		return err
	}
	objects := &timedObjects{ObjectStore: &s3db.S3Objects{Client: e.s3, Bucket: e.bucket}}

	// 前回の残りを消してから初期状態を作る
	if _, err := e.purgeKey(ctx, raceKey); err != nil {
		return err
	}
	switch *base {
	case "empty":
		creator, err := s3db.New(objects, raceKey, filepath.Join(e.dir, "race-init"), s3db.Options{})
		if err != nil {
			return err
		}
		if err := creator.Create(ctx, createSchema); err != nil {
			return err
		}
		creator.Drop()
		creator.Close()
	case "money":
		if err := e.copyObject(ctx, moneyKey, raceKey); err != nil {
			return err
		}
	default:
		return fmt.Errorf("-base は empty か money: %s", *base)
	}
	size, err := e.headSize(ctx, raceKey)
	if err != nil {
		return err
	}
	fmt.Printf("race: K=%d M=%d base=%s 初期サイズ=%s max-attempts=%d\n", *k, *m, *base, kib(size), *maxAttempts)

	stores := make([]*s3db.Store, *k)
	for i := range stores {
		s, err := s3db.New(objects, raceKey, filepath.Join(e.dir, fmt.Sprintf("race-%d", i)),
			s3db.Options{MaxAttempts: *maxAttempts})
		if err != nil {
			return err
		}
		defer s.Close()
		// 手元のコピーを先に持たせる（コールドスタート後の状態から始める）
		if err := s.Read(ctx, func(*sql.DB) error { return nil }); err != nil {
			return err
		}
		stores[i] = s
	}
	objects.reset()

	var (
		mu       sync.Mutex
		lat      samples
		failures []error
		wg       sync.WaitGroup
		startAll = make(chan struct{})
	)
	day := time.Now().In(time.FixedZone("JST", 9*3600)).Format("2006-01-02")
	for i, s := range stores {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-startAll
			for j := range *m {
				id := fmt.Sprintf("race-%02d-%03d", i, j)
				t := time.Now()
				err := s.Update(ctx, func(tx *sql.Tx) error {
					_, err := tx.Exec(`INSERT INTO expenses (id, date, payer, category_id, amount, created_by)
						VALUES (?, ?, 'race', 'race', 1, 'race@example.invalid')`, id, day)
					return err
				})
				mu.Lock()
				lat = append(lat, time.Since(t))
				if err != nil {
					failures = append(failures, fmt.Errorf("store %d insert %d: %w", i, j, err))
				}
				mu.Unlock()
			}
		}()
	}
	t0 := time.Now()
	close(startAll)
	wg.Wait()
	elapsed := time.Since(t0)

	var total s3db.Stats
	for i, s := range stores {
		st := s.Stats()
		fmt.Printf("  store %d: PUT=%d やり直し=%d 412=%d 409=%d 反映済み判定=%d ダウンロード=%d 304=%d\n",
			i, st.Puts, st.Retries, st.Conflicts412, st.Conflicts409, st.Landed, st.Downloads, st.NotModified)
		total.Puts += st.Puts
		total.Retries += st.Retries
		total.Conflicts412 += st.Conflicts412
		total.Conflicts409 += st.Conflicts409
		total.Landed += st.Landed
		total.Downloads += st.Downloads
	}
	for _, f := range failures {
		fmt.Printf("  失敗: %v\n", f)
	}

	// 別の新しい Store（= 新しいインスタンス）で S3 上の最終状態を数える
	verifier, err := s3db.New(&s3db.S3Objects{Client: e.s3, Bucket: e.bucket}, raceKey, filepath.Join(e.dir, "race-verify"), s3db.Options{})
	if err != nil {
		return err
	}
	defer verifier.Close()
	var got, distinct int
	if err := verifier.Read(ctx, func(db *sql.DB) error {
		return db.QueryRow(`SELECT count(*), count(DISTINCT id) FROM expenses WHERE id LIKE 'race-%'`).Scan(&got, &distinct)
	}); err != nil {
		return err
	}
	want := *k * *m
	verdict := "OK（取りこぼしゼロ）"
	if got != want || distinct != want {
		verdict = "NG"
	}
	fmt.Printf("結果: 件数=%d (distinct %d) 期待=%d → %s  失敗した Update=%d\n", got, distinct, want, verdict, len(failures))
	fmt.Printf("所要 %s  合計 PUT=%d（成功 %d）やり直し=%d 412=%d 409=%d 反映済み判定=%d 取り直しダウンロード=%d\n",
		ms(elapsed), total.Puts, int64(want-len(failures)), total.Retries, total.Conflicts412, total.Conflicts409, total.Landed, total.Downloads)
	fmt.Printf("Update 1 回の時間（やり直し込み）: %s\n  GET: %s\n  PUT: %s\n", lat, objects.gets, objects.puts)

	if *keep {
		return nil
	}
	nv, err := e.purgeKey(ctx, raceKey)
	if err != nil {
		return err
	}
	fmt.Printf("後片付け: %s の全バージョンを削除 (%d)\n", raceKey, nv)
	if got != want {
		return fmt.Errorf("件数が合わない")
	}
	return nil
}
