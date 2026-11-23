// Package s3db は「S3 に置いた 1 つの SQLite ファイル」を DB として使う試作のストア。
//
// 仕組み:
//   - 各 Lambda インスタンス（= Store）はローカルディレクトリ（Lambda なら /tmp）に
//     DB ファイルのコピーと、その版の ETag を持つ。
//   - Read は GetObject + If-None-Match: 手元の ETag で最新か確かめ、304 なら手元をそのまま読む。
//   - Update は最新化 → ローカルでトランザクション → ファイル全体を PutObject + If-Match: 手元の ETag で
//     書き戻す（楽観ロック）。412/409 なら手元を捨てて取り直し、fn をやり直す。
//
// SQLite 側の前提:
//   - journal_mode は DELETE（WAL にしない）。DELETE モードではコミット完了時点で変更はすべて本体ファイルに
//     書かれており、ロールバックジャーナル（-journal）は削除済み。WAL だとコミット済みの変更が -wal に残り、
//     本体ファイルだけをアップロードすると変更が欠けるため使わない。
//   - さらにアップロード前に書き込み用の接続を閉じ（ロックも保持しない状態にし）、-journal / -wal が
//     残っていないことを確かめてから送る。
//   - 同一プロセス内の Read / Update / Create は mutex で直列化する。
package s3db

import (
	"context"
	"crypto/md5"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite" // pure Go の SQLite ドライバー（driver 名 "sqlite"）
)

// ErrAlreadyExists は Create したキーが既に S3 にあった。
var ErrAlreadyExists = errors.New("s3db: object already exists")

// Options は Store の設定。ゼロ値なら既定値を使う。
type Options struct {
	// MaxAttempts は Update の最大試行回数（初回を含む）。既定 10。
	MaxAttempts int
	// BaseBackoff はやり直し待ちの基準時間。n 回目の待ちは [0, min(BaseBackoff*2^(n-1), MaxBackoff)] の一様乱数（full jitter）。既定 50ms。
	BaseBackoff time.Duration
	// MaxBackoff は待ち時間の上限。既定 2s。
	MaxBackoff time.Duration
}

// Stats は Store の操作回数（計測・テスト用）。
type Stats struct {
	Gets          int64 // GetObject を呼んだ回数
	NotModified   int64 // うち 304 だった回数
	Downloads     int64 // 本体をダウンロードした回数
	DownloadBytes int64 // ダウンロードしたバイト数の合計
	Puts          int64 // PutObject を呼んだ回数
	Conflicts412  int64 // 412 PreconditionFailed を受けた回数
	Conflicts409  int64 // 409 ConditionalRequestConflict を受けた回数
	Retries       int64 // Update の fn をやり直した回数
	Discards      int64 // 手元のコピーを捨てた回数
	Landed        int64 // PUT はエラーだったが、実は自分の書き込みが S3 に反映されていた回数
}

type counters struct {
	gets, notModified, downloads, downloadBytes, puts, c412, c409, retries, discards, landed atomic.Int64
}

// Store は S3 上の 1 つの SQLite ファイルを扱う。1 つの Store が 1 つの Lambda インスタンスに相当する。
type Store struct {
	objects ObjectStore
	key     string
	path    string // 手元の DB ファイル
	opts    Options

	mu   sync.Mutex
	etag string  // 手元のファイルの版。"" は手元にコピーが無い
	rdb  *sql.DB // 読み取り用の接続（手元のファイルを差し替えるときは必ず閉じる）

	c counters
}

// New は Store を作る。localDir は手元のコピーを置くディレクトリ（Lambda なら /tmp 配下）。
func New(objects ObjectStore, key, localDir string, opts Options) (*Store, error) {
	if err := os.MkdirAll(localDir, 0o700); err != nil {
		return nil, fmt.Errorf("ローカルディレクトリの作成に失敗: %w", err)
	}
	if opts.MaxAttempts <= 0 {
		opts.MaxAttempts = 10
	}
	if opts.BaseBackoff <= 0 {
		opts.BaseBackoff = 50 * time.Millisecond
	}
	if opts.MaxBackoff <= 0 {
		opts.MaxBackoff = 2 * time.Second
	}
	s := &Store{
		objects: objects,
		key:     key,
		path:    filepath.Join(localDir, filepath.Base(key)),
		opts:    opts,
	}
	// 前回の残骸（別プロセスのもの等）は信用しない
	s.removeLocalFiles()
	return s, nil
}

// LocalPath は手元の DB ファイルのパス。
func (s *Store) LocalPath() string { return s.path }

// ETag は手元のコピーの ETag（無ければ ""）。
func (s *Store) ETag() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.etag
}

// Stats は操作回数のスナップショットを返す。
func (s *Store) Stats() Stats {
	return Stats{
		Gets: s.c.gets.Load(), NotModified: s.c.notModified.Load(),
		Downloads: s.c.downloads.Load(), DownloadBytes: s.c.downloadBytes.Load(),
		Puts: s.c.puts.Load(), Conflicts412: s.c.c412.Load(), Conflicts409: s.c.c409.Load(),
		Retries: s.c.retries.Load(), Discards: s.c.discards.Load(), Landed: s.c.landed.Load(),
	}
}

// Close は接続を閉じる（手元のファイルは残す）。
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closeReader()
}

// Drop は手元のコピーを捨てる（次の Read は全ダウンロードになる）。計測用。
func (s *Store) Drop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dropLocal()
}

// Read は手元のコピーを最新化してから fn を実行する。fn の中で書き込んではいけない（query_only で拒否される）。
func (s *Store) Read(ctx context.Context, fn func(*sql.DB) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refresh(ctx); err != nil {
		return err
	}
	if s.rdb == nil {
		db, err := openDB(s.path, true)
		if err != nil {
			return err
		}
		s.rdb = db
	}
	return fn(s.rdb)
}

// Update は最新の DB に対して fn をトランザクションで実行し、ファイル全体を条件付きで S3 に書き戻す。
// 他のインスタンスと競合したら（412/409）手元を捨てて取り直し、fn を最初からやり直す。
// そのため fn はやり直されても正しい結果になるように書く（tx の外に副作用を持たない）。
func (s *Store) Update(ctx context.Context, fn func(*sql.Tx) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var lastErr error
	for attempt := 1; attempt <= s.opts.MaxAttempts; attempt++ {
		if attempt > 1 {
			s.c.retries.Add(1)
			if err := s.sleepBackoff(ctx, attempt-1); err != nil {
				return err
			}
		}
		if err := s.refresh(ctx); err != nil {
			return err
		}
		if err := s.applyLocal(ctx, fn); err != nil {
			return err
		}
		err := s.upload(ctx, PutCondition{IfMatch: s.etag}, true)
		if err == nil {
			return nil
		}
		if errors.Is(err, errLanded) {
			return nil
		}
		if !isConflict(err) {
			return err
		}
		lastErr = err
	}
	return fmt.Errorf("s3db: %d 回試しても競合が解消しない: %w", s.opts.MaxAttempts, lastErr)
}

// Create は新しい DB を init で作り、キーがまだ無いときだけ（If-None-Match: *）S3 に置く。
// 既にあれば ErrAlreadyExists を返す。
func (s *Store) Create(ctx context.Context, init func(*sql.Tx) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dropLocal()
	if err := s.applyLocal(ctx, init); err != nil {
		s.discard()
		return err
	}
	// 新規作成のファイルは中身が同じになり得る（同じ init なら同じバイト列）ので、反映済みかの判定はしない
	err := s.upload(ctx, PutCondition{IfNoneMatchAny: true}, false)
	if errors.Is(err, ErrPreconditionFailed) {
		return fmt.Errorf("%w: %v", ErrAlreadyExists, err)
	}
	return err
}

// --- 内部処理（すべて s.mu を持った状態で呼ぶ） ---

var errLanded = errors.New("s3db: put reported error but object landed")

func isConflict(err error) bool {
	return errors.Is(err, ErrPreconditionFailed) || errors.Is(err, ErrConditionalConflict)
}

// refresh は手元のコピーを S3 の最新版にそろえる。
func (s *Store) refresh(ctx context.Context) error {
	s.c.gets.Add(1)
	body, etag, err := s.objects.Get(ctx, s.key, s.etag)
	if errors.Is(err, ErrNotModified) {
		if s.etag == "" {
			return fmt.Errorf("s3db: 手元に無いのに 304 が返った: %w", err)
		}
		s.c.notModified.Add(1)
		return nil
	}
	if err != nil {
		return fmt.Errorf("s3db: %s の取得に失敗: %w", s.key, err)
	}
	defer body.Close()

	// 一時ファイルに書き切ってから rename で差し替える（途中で失敗しても手元が壊れない）
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".download-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	n, err := io.Copy(tmp, body)
	if err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("s3db: ダウンロードに失敗: %w", err)
	}
	// 古いファイルを開いている接続は差し替え後に古い inode を読み続けるので閉じる。
	// 古い -journal が残っていると新しいファイルに「ホットジャーナル」として巻き戻しが掛かるので先に消す。
	s.dropLocal()
	if err := os.Rename(tmpName, s.path); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("s3db: 差し替えに失敗: %w", err)
	}
	s.etag = etag
	s.c.downloads.Add(1)
	s.c.downloadBytes.Add(n)
	return nil
}

// applyLocal は手元のファイルに対して fn をトランザクションで実行し、コミットして接続を閉じる。
// 失敗したら手元を S3 と同じ状態のまま（ロールバック）にする。コミット後の失敗では手元を捨てる。
func (s *Store) applyLocal(ctx context.Context, fn func(*sql.Tx) error) error {
	// 読み取り用接続は閉じておく（書き込み中のファイルを別接続で掴まない）
	if err := s.closeReader(); err != nil {
		return err
	}
	db, err := openDB(s.path, false)
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		db.Close()
		return fmt.Errorf("s3db: トランザクション開始に失敗: %w", err)
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		db.Close()
		return err
	}
	if err := tx.Commit(); err != nil {
		db.Close()
		s.discard()
		return fmt.Errorf("s3db: コミットに失敗: %w", err)
	}
	// 接続を閉じてロックも含めすべて手放す。DELETE モードなのでコミット済みの内容は本体ファイルにある。
	if err := db.Close(); err != nil {
		s.discard()
		return fmt.Errorf("s3db: 接続のクローズに失敗: %w", err)
	}
	for _, suffix := range []string{"-journal", "-wal"} {
		if _, err := os.Stat(s.path + suffix); err == nil {
			s.discard()
			return fmt.Errorf("s3db: コミット後に %s が残っている（ファイルが完結していない）", suffix)
		}
	}
	return nil
}

// upload は手元のファイルを条件付きで S3 に置く。
// 成功したら ETag を更新する。失敗したら必ず手元を捨てる（手元が S3 より先に進んだまま残らないように）。
// ただし PUT がエラーでも実は反映されていた（SDK の再送で自分の書き込みに 412 を受けた等）場合は
// 取り直したファイルの ETag が送った中身の MD5 と一致するので、errLanded を返して成功扱いにする。
func (s *Store) upload(ctx context.Context, cond PutCondition, checkLanded bool) error {
	f, err := os.Open(s.path)
	if err != nil {
		s.discard()
		return err
	}
	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		f.Close()
		s.discard()
		return err
	}
	wantETag := `"` + hex.EncodeToString(h.Sum(nil)) + `"`
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		f.Close()
		s.discard()
		return err
	}

	s.c.puts.Add(1)
	etag, putErr := s.objects.Put(ctx, s.key, f, cond)
	f.Close()
	if putErr == nil {
		s.etag = etag
		return nil
	}

	switch {
	case errors.Is(putErr, ErrPreconditionFailed):
		s.c.c412.Add(1)
	case errors.Is(putErr, ErrConditionalConflict):
		s.c.c409.Add(1)
	}
	s.discard()

	// 自分の書き込みが実は反映されていないか確かめる（取り直しは次の試行の最新化も兼ねる）
	if !checkLanded {
		return putErr
	}
	if rerr := s.refresh(ctx); rerr == nil && s.etag == wantETag {
		s.c.landed.Add(1)
		return errLanded
	}
	return putErr
}

// discard は手元のコピーを捨てる（失敗・競合時。統計に数える）。
func (s *Store) discard() {
	if _, err := os.Stat(s.path); err == nil || s.etag != "" {
		s.c.discards.Add(1)
	}
	s.dropLocal()
}

// dropLocal は接続を閉じて手元のファイルと ETag を消す。
func (s *Store) dropLocal() {
	_ = s.closeReader()
	s.removeLocalFiles()
	s.etag = ""
}

func (s *Store) removeLocalFiles() {
	for _, suffix := range []string{"", "-journal", "-wal", "-shm"} {
		_ = os.Remove(s.path + suffix)
	}
}

func (s *Store) closeReader() error {
	if s.rdb == nil {
		return nil
	}
	err := s.rdb.Close()
	s.rdb = nil
	return err
}

func (s *Store) sleepBackoff(ctx context.Context, n int) error {
	d := s.opts.BaseBackoff << (n - 1)
	if d > s.opts.MaxBackoff || d <= 0 {
		d = s.opts.MaxBackoff
	}
	wait := time.Duration(rand.Int64N(int64(d) + 1))
	t := time.NewTimer(wait)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// openDB は手元のファイルを開く。接続は 1 本に限る（:memory: でない限り問題ないが、ロックの見通しを良くする）。
func openDB(path string, readOnly bool) (*sql.DB, error) {
	dsn := "file:" + path + "?_pragma=busy_timeout(5000)"
	if readOnly {
		dsn += "&_pragma=query_only(1)"
	} else {
		// DELETE: コミット時に変更を本体へ書き、ジャーナルを削除する。FULL: コミット時に fsync する。
		dsn += "&_pragma=journal_mode(DELETE)&_pragma=synchronous(FULL)&_txlock=immediate"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("s3db: DB を開けない: %w", err)
	}
	db.SetMaxOpenConns(1)
	return db, nil
}
