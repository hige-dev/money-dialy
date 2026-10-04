package main

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func TestRouteRejectsUnknownEvents(t *testing.T) {
	for _, input := range []string{`{}`, `null`, `[]`, `{"acton":"recurring"}`, `{"action":"cleanup"}`, `{"source":"aws.events"}`, `{"action":1}`, `{`} {
		t.Run(input, func(t *testing.T) {
			result, err := route(context.Background(), json.RawMessage(input))
			if err == nil || result != nil {
				t.Errorf("不明なイベントが拒否されませんでした: 結果=%v、エラー=%v", result, err)
			}
		})
	}
}

func TestRouteHTTP(t *testing.T) {
	result, err := route(context.Background(), json.RawMessage(`{"requestContext":{"http":{"method":"OPTIONS"}}}`))
	response, ok := result.(events.APIGatewayV2HTTPResponse)
	if err != nil || !ok || response.StatusCode != 204 {
		t.Errorf("HTTP イベントの振り分けに失敗: 結果=%v、エラー=%v", result, err)
	}
}
