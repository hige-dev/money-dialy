package main

import (
	"context"
	"encoding/json"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"money-diary/internal/handler"
)

func main() {
	lambda.Start(route)
}

// route はイベントタイプを判別して処理を振り分ける
func route(ctx context.Context, event json.RawMessage) (any, error) {
	var httpEvent events.APIGatewayV2HTTPRequest
	if err := json.Unmarshal(event, &httpEvent); err == nil && httpEvent.RequestContext.HTTP.Method != "" {
		return handler.Handle(ctx, httpEvent)
	}
	// 非HTTPイベント: action で振り分け
	var scheduled struct {
		Action string `json:"action"`
	}
	if err := json.Unmarshal(event, &scheduled); err == nil && scheduled.Action == "backup" {
		return handler.HandleBackup(ctx)
	}
	// デフォルト: 定期支出の自動登録（後方互換）
	return handler.HandleScheduled(ctx)
}
