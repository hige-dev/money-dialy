package s3db

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

// S3 操作の結果を表す番兵エラー。ObjectStore の実装はこれらを errors.Is で判定できるように包んで返す。
var (
	// ErrNotModified は条件付き GET（If-None-Match）で手元と同じ版だった（HTTP 304）。
	ErrNotModified = errors.New("s3db: not modified (304)")
	// ErrNotFound はオブジェクトが存在しない（HTTP 404）。
	ErrNotFound = errors.New("s3db: object not found (404)")
	// ErrPreconditionFailed は条件付き PUT の条件が合わなかった（HTTP 412）。
	ErrPreconditionFailed = errors.New("s3db: precondition failed (412)")
	// ErrConditionalConflict は同じキーへの条件付き書き込みが競合した（HTTP 409 ConditionalRequestConflict）。
	ErrConditionalConflict = errors.New("s3db: conditional request conflict (409)")
)

// PutCondition は条件付き PUT の条件。どちらか一方だけを指定する。
type PutCondition struct {
	// IfMatch が空でなければ、S3 上の ETag がこれと一致するときだけ書き込む。
	IfMatch string
	// IfNoneMatchAny が true なら、キーがまだ存在しないときだけ書き込む（If-None-Match: *）。
	IfNoneMatchAny bool
}

// ObjectStore は Store が使う S3 操作の最小インターフェース（テストでは偽物に差し替える）。
type ObjectStore interface {
	// Get はオブジェクトを取得する。ifNoneMatch が空でなく ETag が一致すれば ErrNotModified を返す。
	Get(ctx context.Context, key, ifNoneMatch string) (body io.ReadCloser, etag string, err error)
	// Put はオブジェクトを条件付きで書き込み、新しい ETag を返す。
	Put(ctx context.Context, key string, body io.ReadSeeker, cond PutCondition) (etag string, err error)
}

// S3Objects は ObjectStore の S3 実装。
type S3Objects struct {
	Client *s3.Client
	Bucket string
}

var _ ObjectStore = (*S3Objects)(nil)

// Get は GetObject を呼ぶ。
func (o *S3Objects) Get(ctx context.Context, key, ifNoneMatch string) (io.ReadCloser, string, error) {
	in := &s3.GetObjectInput{Bucket: aws.String(o.Bucket), Key: aws.String(key)}
	if ifNoneMatch != "" {
		in.IfNoneMatch = aws.String(ifNoneMatch)
	}
	out, err := o.Client.GetObject(ctx, in)
	if err != nil {
		return nil, "", mapS3Error(err)
	}
	return out.Body, aws.ToString(out.ETag), nil
}

// Put は PutObject を条件付きで呼ぶ。
func (o *S3Objects) Put(ctx context.Context, key string, body io.ReadSeeker, cond PutCondition) (string, error) {
	in := &s3.PutObjectInput{
		Bucket:      aws.String(o.Bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String("application/vnd.sqlite3"),
	}
	switch {
	case cond.IfNoneMatchAny:
		in.IfNoneMatch = aws.String("*")
	case cond.IfMatch != "":
		in.IfMatch = aws.String(cond.IfMatch)
	default:
		return "", errors.New("s3db: 無条件の PUT は使わない（IfMatch か IfNoneMatchAny を指定）")
	}
	out, err := o.Client.PutObject(ctx, in)
	if err != nil {
		return "", mapS3Error(err)
	}
	return aws.ToString(out.ETag), nil
}

// mapS3Error は HTTP ステータスで番兵エラーに包む。元のエラー（エラーコード）も文字列に残す。
func mapS3Error(err error) error {
	var re *awshttp.ResponseError
	if !errors.As(err, &re) {
		return err
	}
	code := ""
	var ae smithy.APIError
	if errors.As(err, &ae) {
		code = ae.ErrorCode()
	}
	switch re.HTTPStatusCode() {
	case 304:
		return fmt.Errorf("%w [%s]", ErrNotModified, code)
	case 404:
		return fmt.Errorf("%w [%s]", ErrNotFound, code)
	case 412:
		return fmt.Errorf("%w [%s]: %v", ErrPreconditionFailed, code, err)
	case 409:
		return fmt.Errorf("%w [%s]: %v", ErrConditionalConflict, code, err)
	}
	return err
}
