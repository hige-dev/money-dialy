package s3db

import (
	"bytes"
	"context"
	"crypto/md5"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// fakeS3 は 1 キーぶんの条件付き GET/PUT を S3 と同じ意味で返す偽物。ETag は中身の MD5（S3 の単一 PUT と同じ）。
type fakeS3 struct {
	mu      sync.Mutex
	objects map[string][]byte

	// putHook が nil でなければ PUT のたびに呼ぶ。返したエラーをそのまま返す（commit=true なら書き込みは反映する）。
	putHook func(n int) (err error, commit bool)
	putN    int
}

func newFakeS3() *fakeS3 { return &fakeS3{objects: map[string][]byte{}} }

func etagOf(b []byte) string {
	sum := md5.Sum(b)
	return `"` + hex.EncodeToString(sum[:]) + `"`
}

func (f *fakeS3) Get(_ context.Context, key, ifNoneMatch string) (io.ReadCloser, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, "", ErrNotFound
	}
	et := etagOf(b)
	if ifNoneMatch != "" && ifNoneMatch == et {
		return nil, "", ErrNotModified
	}
	return io.NopCloser(bytes.NewReader(bytes.Clone(b))), et, nil
}

func (f *fakeS3) Put(_ context.Context, key string, body io.ReadSeeker, cond PutCondition) (string, error) {
	data, err := io.ReadAll(body)
	if err != nil {
		return "", err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.putN++
	cur, exists := f.objects[key]
	if cond.IfNoneMatchAny && exists {
		return "", ErrPreconditionFailed
	}
	if cond.IfMatch != "" && (!exists || etagOf(cur) != cond.IfMatch) {
		return "", ErrPreconditionFailed
	}
	if f.putHook != nil {
		if herr, commit := f.putHook(f.putN); herr != nil {
			if commit {
				f.objects[key] = data
			}
			return "", herr
		}
	}
	f.objects[key] = data
	return etagOf(data), nil
}

// current は S3 上の今の中身を返す。
func (f *fakeS3) current(key string) []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.objects[key]
}

const testKey = "proto/test.db"

func createTable(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER NOT NULL) STRICT`)
	return err
}

func insertRow(id string) func(*sql.Tx) error {
	return func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO t (id, v) VALUES (?, 1)`, id)
		return err
	}
}

func newStore(t *testing.T, f *fakeS3) *Store {
	t.Helper()
	s, err := New(f, testKey, t.TempDir(), Options{BaseBackoff: time.Millisecond, MaxBackoff: 5 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func count(t *testing.T, s *Store) int {
	t.Helper()
	var n int
	if err := s.Read(context.Background(), func(db *sql.DB) error {
		return db.QueryRow(`SELECT count(*) FROM t`).Scan(&n)
	}); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestCreateReadUpdate(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	a := newStore(t, f)
	if err := a.Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	if a.ETag() != etagOf(f.current(testKey)) {
		t.Fatalf("Create 後の ETag が S3 と違う")
	}
	// 2 回目の Create は既に在るので失敗する
	b := newStore(t, f)
	if err := b.Create(ctx, createTable); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("want ErrAlreadyExists, got %v", err)
	}
	if err := a.Update(ctx, insertRow("x")); err != nil {
		t.Fatal(err)
	}
	if a.ETag() != etagOf(f.current(testKey)) {
		t.Fatalf("Update 後の ETag が S3 と違う")
	}
	if got := count(t, b); got != 1 {
		t.Fatalf("count = %d, want 1", got)
	}
}

func TestReadUsesNotModified(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	a := newStore(t, f)
	if err := a.Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	b := newStore(t, f)
	for range 5 {
		count(t, b)
	}
	st := b.Stats()
	if st.Downloads != 1 || st.NotModified != 4 {
		t.Fatalf("downloads=%d notModified=%d, want 1 and 4", st.Downloads, st.NotModified)
	}
	// 他が更新したら取り直す
	if err := a.Update(ctx, insertRow("x")); err != nil {
		t.Fatal(err)
	}
	if got := count(t, b); got != 1 {
		t.Fatalf("count = %d, want 1", got)
	}
	if st := b.Stats(); st.Downloads != 2 {
		t.Fatalf("downloads=%d, want 2", st.Downloads)
	}
}

func TestUpdateRefreshesStaleCopy(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	a := newStore(t, f)
	b := newStore(t, f)
	if err := a.Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	count(t, b) // b に古い版を持たせる
	staleETag := b.ETag()
	if err := a.Update(ctx, insertRow("from-a")); err != nil {
		t.Fatal(err)
	}

	// b の fn が何回呼ばれたかを数える
	calls := 0
	err := b.Update(ctx, func(tx *sql.Tx) error {
		calls++
		return insertRow("from-b")(tx)
	})
	if err != nil {
		t.Fatal(err)
	}
	st := b.Stats()
	// b は最新化してから書くので、ここでは 412 にならない（Update の頭で取り直す）
	if calls != 1 || st.Conflicts412 != 0 {
		t.Fatalf("calls=%d 412=%d", calls, st.Conflicts412)
	}
	if b.ETag() == staleETag || b.ETag() != etagOf(f.current(testKey)) {
		t.Fatalf("ETag が更新されていない")
	}
	if got := count(t, a); got != 2 {
		t.Fatalf("count = %d, want 2", got)
	}
}

// fn を実行している間に他のインスタンスが書き込む → PUT が 412 → 手元を捨てて取り直し、fn をやり直す。
func TestUpdateConflictDuringFn(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	a := newStore(t, f)
	b := newStore(t, f)
	if err := a.Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	calls := 0
	err := b.Update(ctx, func(tx *sql.Tx) error {
		calls++
		if calls == 1 {
			// b が手元で作業中に a が書き込む（別インスタンスなので b の mutex とは無関係）
			if err := a.Update(ctx, insertRow("from-a")); err != nil {
				return err
			}
		}
		return insertRow("from-b")(tx)
	})
	if err != nil {
		t.Fatal(err)
	}
	st := b.Stats()
	if calls != 2 || st.Conflicts412 != 1 || st.Retries != 1 || st.Discards < 1 {
		t.Fatalf("calls=%d stats=%+v", calls, st)
	}
	if b.ETag() != etagOf(f.current(testKey)) {
		t.Fatalf("ETag が S3 と違う")
	}
	if got := count(t, a); got != 2 {
		t.Fatalf("count = %d, want 2（a の行が失われた）", got)
	}
}

func TestUpdateRetriesOn409(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	a := newStore(t, f)
	if err := a.Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	f.putHook = func(n int) (error, bool) {
		if n == 2 { // Create の次の PUT を 1 回だけ 409 にする
			return ErrConditionalConflict, false
		}
		return nil, false
	}
	if err := a.Update(ctx, insertRow("x")); err != nil {
		t.Fatal(err)
	}
	st := a.Stats()
	if st.Conflicts409 != 1 || st.Retries != 1 {
		t.Fatalf("stats=%+v", st)
	}
	if got := count(t, a); got != 1 {
		t.Fatalf("count = %d, want 1", got)
	}
}

// 412/409 以外の失敗では、やり直さずにエラーを返し、手元を捨てて S3 と同じ状態に戻っていること。
func TestUploadFailureDiscardsLocal(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	a := newStore(t, f)
	if err := a.Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	before := f.current(testKey)
	boom := errors.New("network down")
	f.putHook = func(int) (error, bool) { return boom, false }
	if err := a.Update(ctx, insertRow("x")); !errors.Is(err, boom) {
		t.Fatalf("want boom, got %v", err)
	}
	if st := a.Stats(); st.Discards != 1 || st.Retries != 0 {
		t.Fatalf("stats=%+v", st)
	}
	// 手元のファイルは S3 と同じ版に戻っている（捨てて取り直した）
	local, err := os.ReadFile(a.LocalPath())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(local, before) || a.ETag() != etagOf(before) {
		t.Fatalf("手元が S3 より先に進んだまま残っている")
	}
	f.putHook = nil
	if got := count(t, a); got != 0 {
		t.Fatalf("count = %d, want 0（失敗した書き込みが見えている）", got)
	}
}

// 取り直しにも失敗したときは、手元のファイル自体が無いこと。
func TestUploadFailureWithoutRefetchLeavesNoLocalFile(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	a := newStore(t, f)
	if err := a.Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	boom := errors.New("network down")
	f.putHook = func(int) (error, bool) {
		// PUT 失敗と同時に S3 からキーも消える（取り直しが失敗する）
		delete(f.objects, testKey)
		return boom, false
	}
	if err := a.Update(ctx, insertRow("x")); !errors.Is(err, boom) {
		t.Fatalf("want boom, got %v", err)
	}
	if _, err := os.Stat(a.LocalPath()); !os.IsNotExist(err) {
		t.Fatalf("手元のファイルが残っている: %v", err)
	}
	if a.ETag() != "" {
		t.Fatalf("ETag が残っている")
	}
}

func TestUpdateGivesUpAfterMaxAttempts(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	s, err := New(f, testKey, t.TempDir(), Options{MaxAttempts: 3, BaseBackoff: time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	f.putHook = func(int) (error, bool) { return ErrConditionalConflict, false }
	err = s.Update(ctx, insertRow("x"))
	if !errors.Is(err, ErrConditionalConflict) {
		t.Fatalf("want 409, got %v", err)
	}
	if st := s.Stats(); st.Puts != 4 || st.Retries != 2 || st.Conflicts409 != 3 {
		t.Fatalf("stats=%+v", st)
	}
	f.putHook = nil
	if got := count(t, s); got != 0 {
		t.Fatalf("count = %d, want 0", got)
	}
}

// PUT は反映されたのに応答がエラー（SDK の再送が自分の書き込みに 412 を受けた等）なら、やり直さず成功扱い。
func TestPutLandedButReportedConflict(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	a := newStore(t, f)
	if err := a.Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	f.putHook = func(n int) (error, bool) {
		if n == 2 {
			return ErrPreconditionFailed, true
		}
		return nil, false
	}
	calls := 0
	err := a.Update(ctx, func(tx *sql.Tx) error { calls++; return insertRow("x")(tx) })
	if err != nil {
		t.Fatal(err)
	}
	if st := a.Stats(); calls != 1 || st.Landed != 1 || st.Retries != 0 {
		t.Fatalf("calls=%d stats=%+v", calls, st)
	}
	if got := count(t, a); got != 1 {
		t.Fatalf("count = %d, want 1（二重に入った）", got)
	}
}

// fn がエラーなら何も書き戻さず、手元もロールバックされている。
func TestFnErrorRollsBack(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	a := newStore(t, f)
	if err := a.Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	puts := a.Stats().Puts
	bad := errors.New("bad input")
	err := a.Update(ctx, func(tx *sql.Tx) error {
		if err := insertRow("x")(tx); err != nil {
			return err
		}
		return bad
	})
	if !errors.Is(err, bad) {
		t.Fatalf("want bad, got %v", err)
	}
	if a.Stats().Puts != puts {
		t.Fatalf("fn が失敗したのに PUT した")
	}
	if got := count(t, a); got != 0 {
		t.Fatalf("count = %d, want 0", got)
	}
}

// 複数インスタンスが同時に書いても取りこぼしが無い。
func TestConcurrentStoresNoLostUpdates(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	const K, M = 4, 8
	stores := make([]*Store, K)
	for i := range stores {
		s, err := New(f, testKey, filepath.Join(t.TempDir(), fmt.Sprint(i)), Options{MaxAttempts: 200, BaseBackoff: time.Millisecond, MaxBackoff: 10 * time.Millisecond})
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		stores[i] = s
	}
	if err := stores[0].Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, K*M)
	for i, s := range stores {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range M {
				if err := s.Update(ctx, insertRow(fmt.Sprintf("%d-%d", i, j))); err != nil {
					errs <- err
				}
			}
		}()
	}
	// 同じ Store を複数 goroutine から使っても mutex で直列化される
	wg.Add(1)
	go func() {
		defer wg.Done()
		for range M {
			if err := stores[0].Read(ctx, func(db *sql.DB) error {
				var n int
				return db.QueryRow(`SELECT count(*) FROM t`).Scan(&n)
			}); err != nil {
				errs <- err
			}
		}
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if got := count(t, stores[1]); got != K*M {
		t.Fatalf("count = %d, want %d", got, K*M)
	}
}

func TestReadIsReadOnly(t *testing.T) {
	ctx := context.Background()
	f := newFakeS3()
	a := newStore(t, f)
	if err := a.Create(ctx, createTable); err != nil {
		t.Fatal(err)
	}
	err := a.Read(ctx, func(db *sql.DB) error {
		_, err := db.Exec(`INSERT INTO t (id, v) VALUES ('x', 1)`)
		return err
	})
	if err == nil {
		t.Fatal("Read の中で書き込めてしまった")
	}
}
