// proto-s3db は「S3 に置いた SQLite ファイルを DB にする」案の試作と計測（アプリ本体には組み込まない）。
//
// 使い方:
//
//	export DYNAMO_EXPENSE_TABLE=money-diary-expenses   # export のみ。本番テーブルは読むだけ
//	export DYNAMO_MASTER_TABLE=money-diary-master
//	go run ./cmd/proto-s3db export -dir /path/to/workdir [-force]
//	go run ./cmd/proto-s3db bench  -dir /path/to/workdir [-n 20]
//	go run ./cmd/proto-s3db race   -dir /path/to/workdir [-k 4 -m 10] [-base empty|money]
//
// 行の中身は表示しない（件数・サイズ・時間だけ）。使う S3 キーは proto/ 配下だけ。
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"money-diary/internal/s3db"
)

const (
	keyPrefix = "proto/"
	moneyKey  = "proto/money.db"
	benchKey  = "proto/bench.db"
	raceKey   = "proto/race.db"
)

type env struct {
	s3     *s3.Client
	bucket string
	dir    string
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: proto-s3db export|bench|race [flags]")
		os.Exit(2)
	}
	cmd, args := os.Args[1], os.Args[2:]
	ctx := context.Background()
	var err error
	switch cmd {
	case "export":
		err = runExport(ctx, args)
	case "bench":
		err = runBench(ctx, args)
	case "race":
		err = runRace(ctx, args)
	default:
		err = fmt.Errorf("不明なサブコマンド: %s", cmd)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// commonFlags は全サブコマンド共通のフラグを登録する。
func commonFlags(fs *flag.FlagSet) (bucket, dir *string) {
	bucket = fs.String("bucket", os.Getenv("PROTO_S3DB_BUCKET"), "試作用バケット（既定は環境変数 PROTO_S3DB_BUCKET）")
	dir = fs.String("dir", "", "手元の DB ファイルを置く作業ディレクトリ（必須）")
	return
}

func newEnv(ctx context.Context, bucket, dir string) (*env, error) {
	if bucket == "" {
		return nil, errors.New("-bucket か環境変数 PROTO_S3DB_BUCKET でバケットを指定してください")
	}
	if dir == "" {
		return nil, errors.New("-dir を指定してください")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-northeast-1"))
	if err != nil {
		return nil, err
	}
	return &env{s3: s3.NewFromConfig(cfg), bucket: bucket, dir: abs}, nil
}

func checkKey(key string) error {
	if !strings.HasPrefix(key, keyPrefix) {
		return fmt.Errorf("%s 以外のキーは使わない: %s", keyPrefix, key)
	}
	return nil
}

// headSize はオブジェクトのサイズを返す。
func (e *env) headSize(ctx context.Context, key string) (int64, error) {
	out, err := e.s3.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &e.bucket, Key: &key})
	if err != nil {
		return 0, err
	}
	return aws.ToInt64(out.ContentLength), nil
}

// copyObject は proto/ 配下で src を dst に複製する。
func (e *env) copyObject(ctx context.Context, src, dst string) error {
	if err := checkKey(src); err != nil {
		return err
	}
	if err := checkKey(dst); err != nil {
		return err
	}
	_, err := e.s3.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:     &e.bucket,
		Key:        &dst,
		CopySource: aws.String(e.bucket + "/" + src),
	})
	return err
}

// purgeKey は key の全バージョン（削除マーカー含む）を消す。proto/ 配下のみ。
func (e *env) purgeKey(ctx context.Context, key string) (int, error) {
	if err := checkKey(key); err != nil {
		return 0, err
	}
	var ids []types.ObjectIdentifier
	p := s3.NewListObjectVersionsPaginator(e.s3, &s3.ListObjectVersionsInput{Bucket: &e.bucket, Prefix: &key})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return 0, err
		}
		for _, v := range page.Versions {
			if aws.ToString(v.Key) == key {
				ids = append(ids, types.ObjectIdentifier{Key: v.Key, VersionId: v.VersionId})
			}
		}
		for _, m := range page.DeleteMarkers {
			if aws.ToString(m.Key) == key {
				ids = append(ids, types.ObjectIdentifier{Key: m.Key, VersionId: m.VersionId})
			}
		}
	}
	for chunk := range slices.Chunk(ids, 1000) {
		out, err := e.s3.DeleteObjects(ctx, &s3.DeleteObjectsInput{Bucket: &e.bucket, Delete: &types.Delete{Objects: chunk, Quiet: aws.Bool(true)}})
		if err != nil {
			return 0, err
		}
		if len(out.Errors) > 0 {
			return 0, fmt.Errorf("%d 件の削除に失敗: %s", len(out.Errors), aws.ToString(out.Errors[0].Message))
		}
	}
	return len(ids), nil
}

// --- 計測の集計 ---

type samples []time.Duration

func (s samples) pct(p float64) time.Duration {
	if len(s) == 0 {
		return 0
	}
	c := slices.Clone(s)
	slices.Sort(c)
	i := int(float64(len(c))*p+0.999999) - 1
	if i < 0 {
		i = 0
	}
	if i >= len(c) {
		i = len(c) - 1
	}
	return c[i]
}

func (s samples) String() string {
	return fmt.Sprintf("n=%d p50=%s p90=%s max=%s", len(s), ms(s.pct(0.5)), ms(s.pct(0.9)), ms(s.pct(1)))
}

func ms(d time.Duration) string {
	return fmt.Sprintf("%.1fms", float64(d.Microseconds())/1000)
}

func kib(n int64) string {
	return fmt.Sprintf("%d bytes (%.1f KiB)", n, float64(n)/1024)
}

// timedObjects は S3 操作ごとの時間を記録する（Update 全体の内訳を見るため）。
type timedObjects struct {
	s3db.ObjectStore
	mu   sync.Mutex
	gets samples // 200 / 304 を問わず GET 本体の読み切りまで
	puts samples
}

func (t *timedObjects) Get(ctx context.Context, key, ifNoneMatch string) (io.ReadCloser, string, error) {
	start := time.Now()
	body, etag, err := t.ObjectStore.Get(ctx, key, ifNoneMatch)
	if err != nil {
		t.add(&t.gets, time.Since(start))
		return body, etag, err
	}
	return &timedBody{ReadCloser: body, done: func() { t.add(&t.gets, time.Since(start)) }}, etag, nil
}

func (t *timedObjects) Put(ctx context.Context, key string, body io.ReadSeeker, cond s3db.PutCondition) (string, error) {
	start := time.Now()
	etag, err := t.ObjectStore.Put(ctx, key, body, cond)
	t.add(&t.puts, time.Since(start))
	return etag, err
}

func (t *timedObjects) add(s *samples, d time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()
	*s = append(*s, d)
}

func (t *timedObjects) reset() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.gets, t.puts = nil, nil
}

type timedBody struct {
	io.ReadCloser
	done func()
	once sync.Once
}

func (b *timedBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(b.done)
	return err
}
