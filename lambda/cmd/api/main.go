package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"money-diary/internal/handler"
)

func main() {
	handler.ValidateEnvironment()
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
	if err := json.Unmarshal(event, &scheduled); err != nil {
		return nil, fmt.Errorf("イベントの解析に失敗しました: %w", err)
	}
	switch scheduled.Action {
	case "backup":
		return handler.HandleBackup(ctx)
	case "recurring":
		return handler.HandleScheduled(ctx)
	default:
		return nil, fmt.Errorf("不明なイベントのアクション: %q", scheduled.Action)
	}
}
