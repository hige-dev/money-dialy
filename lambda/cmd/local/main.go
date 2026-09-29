// ローカル検証用の HTTP サーバー。本番 Lambda には含めない。
package main

import (
	"context"
	"errors"
	"flag"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"money-diary/internal/dynamo"
	"money-diary/internal/handler"
	"money-diary/internal/model"
)

const localToken = "money-diary-local"

func verifyLocalToken(_ context.Context, token string) (*model.AuthUser, error) {
	if token != localToken {
		return nil, errors.New("ローカル検証用トークンが一致しません")
	}
	return &model.AuthUser{Email: "local@example.test", Name: "ローカル検証ユーザー"}, nil
}

type lambdaHandler func(context.Context, events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error)

// httpAdapter は通常の HTTP リクエストを本番と同じ Lambda ハンドラーに渡す。
func httpAdapter(handle lambdaHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1024*1024))
		if err != nil {
			http.Error(w, "リクエスト本文を読み込めません", http.StatusBadRequest)
			return
		}
		headers := make(map[string]string)
		for key := range r.Header {
			headers[strings.ToLower(key)] = r.Header.Get(key)
		}
		response, err := handle(r.Context(), events.APIGatewayV2HTTPRequest{
			Version: "2.0", RawPath: r.URL.Path, Headers: headers, Body: string(body),
			RequestContext: events.APIGatewayV2HTTPRequestContext{HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Method: r.Method, Path: r.URL.Path}},
		})
		if err != nil {
			http.Error(w, "API の処理に失敗しました", http.StatusInternalServerError)
			return
		}
		for key, value := range response.Headers {
			w.Header().Set(key, value)
		}
		w.WriteHeader(response.StatusCode)
		_, _ = io.WriteString(w, response.Body)
	}
}

func main() {
	endpoint := flag.String("dynamo-endpoint", "http://127.0.0.1:8000", "DynamoDB Local の接続先")
	port := flag.Int("port", 8080, "ローカル API のポート")
	flag.Parse()
	client, err := dynamo.NewLocalClient(*endpoint)
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := client.InitializeLocal(ctx); err != nil {
		log.Fatalf("ローカル DB の初期化に失敗しました。DynamoDB Local を起動してください: %v", err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api", httpAdapter(handler.NewHandler(client, verifyLocalToken)))
	server := &http.Server{Addr: "127.0.0.1:" + strconv.Itoa(*port), Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second}
	log.Printf("ローカル API を http://%s/api で起動します", server.Addr)
	log.Fatal(server.ListenAndServe())
}
