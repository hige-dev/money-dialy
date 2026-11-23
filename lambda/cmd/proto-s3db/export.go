package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"money-diary/internal/dynamo"
	"money-diary/internal/s3db"
)

// runExport は本番 DynamoDB を読み取りだけして SQLite に入れ、proto/money.db に置く。
func runExport(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("export", flag.ExitOnError)
	bucket, dir := commonFlags(fs)
	force := fs.Bool("force", false, "proto/money.db が既にあれば全バージョンを消してから作り直す")
	fs.Parse(args)

	if os.Getenv("DYNAMO_EXPENSE_TABLE") == "" || os.Getenv("DYNAMO_MASTER_TABLE") == "" {
		return errors.New("DYNAMO_EXPENSE_TABLE と DYNAMO_MASTER_TABLE を設定してください")
	}
	e, err := newEnv(ctx, *bucket, *dir)
	if err != nil {
		return err
	}

	// --- 本番 DynamoDB を読む（読み取り専用の関数だけを使う） ---
	t0 := time.Now()
	ddb, err := dynamo.GetClient(ctx)
	if err != nil {
		return err
	}
	expenses, err := ddb.ScanAllExpenses(ctx)
	if err != nil {
		return err
	}
	cats, err := ddb.GetAllCategories(ctx)
	if err != nil {
		return err
	}
	payers, err := ddb.GetAllPayers(ctx)
	if err != nil {
		return err
	}
	places, err := ddb.GetAllPlaces(ctx)
	if err != nil {
		return err
	}
	readDur := time.Since(t0)
	fmt.Printf("DynamoDB 読み取り: expenses(scan)=%d categories=%d payers=%d places=%d (%s)\n",
		len(expenses), len(cats), len(payers), len(places), ms(readDur))

	// --- SQLite に入れて S3 に置く（If-None-Match: *） ---
	if *force {
		n, err := e.purgeKey(ctx, moneyKey)
		if err != nil {
			return fmt.Errorf("既存の %s の削除に失敗: %w", moneyKey, err)
		}
		fmt.Printf("既存の %s を削除: %d バージョン\n", moneyKey, n)
	}
	store, err := s3db.New(&s3db.S3Objects{Client: e.s3, Bucket: e.bucket}, moneyKey, filepath.Join(e.dir, "export"), s3db.Options{})
	if err != nil {
		return err
	}
	defer store.Close()

	var inserted, skipped int
	t1 := time.Now()
	err = store.Create(ctx, func(tx *sql.Tx) error {
		if err := createSchema(tx); err != nil {
			return err
		}
		var err error
		inserted, skipped, err = insertAll(tx, expenses, cats, payers, places)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO meta (key, value) VALUES ('exported_at', ?)`, time.Now().UTC().Format(time.RFC3339))
		return err
	})
	if errors.Is(err, s3db.ErrAlreadyExists) {
		return fmt.Errorf("%s は既にある（作り直すなら -force）: %w", moneyKey, err)
	}
	if err != nil {
		return err
	}
	createDur := time.Since(t1)

	st, err := os.Stat(store.LocalPath())
	if err != nil {
		return err
	}
	remote, err := e.headSize(ctx, moneyKey)
	if err != nil {
		return err
	}

	// 入った件数を DB から数え直す
	var nExp, nCat, nPay, nPlace, nImport int
	if err := store.Read(ctx, func(db *sql.DB) error {
		for q, dst := range map[string]*int{
			`SELECT count(*) FROM expenses`:                               &nExp,
			`SELECT count(*) FROM categories`:                             &nCat,
			`SELECT count(*) FROM payers`:                                 &nPay,
			`SELECT count(*) FROM places`:                                 &nPlace,
			`SELECT count(*) FROM expenses WHERE import_card IS NOT NULL`: &nImport,
		} {
			if err := db.QueryRow(q).Scan(dst); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}
	fmt.Printf("SQLite: expenses=%d (投入 %d, 日付なしで除外 %d, うち取込データ %d) categories=%d payers=%d places=%d\n",
		nExp, inserted, skipped, nImport, nCat, nPay, nPlace)
	fmt.Printf("DB ファイル: local=%s s3=%s\n", kib(st.Size()), kib(remote))
	fmt.Printf("作成+アップロード: %s  ETag=%s\n", ms(createDur), store.ETag())
	return nil
}
