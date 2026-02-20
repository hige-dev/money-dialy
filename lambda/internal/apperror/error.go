package apperror

import "fmt"

// AppError はビジネスロジックのエラー（クライアントにメッセージを返しても安全なエラー）
type AppError struct {
	Message    string
	StatusCode int
}

func (e *AppError) Error() string {
	return e.Message
}

// New は AppError を生成する（デフォルト 400 Bad Request）
func New(message string) *AppError {
	return &AppError{Message: message, StatusCode: 400}
}

// WithStatus は指定したステータスコードの AppError を生成する
func WithStatus(statusCode int, message string) *AppError {
	return &AppError{Message: message, StatusCode: statusCode}
}

// Newf はフォーマット付き AppError を生成する
func Newf(format string, args ...any) *AppError {
	return &AppError{Message: fmt.Sprintf(format, args...), StatusCode: 400}
}
