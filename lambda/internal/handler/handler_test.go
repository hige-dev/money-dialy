package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
)

func TestAdminAuthorization(t *testing.T) {
	actions := []string{
		"createCategory", "updateCategory", "deleteCategory",
		"createPlace", "updatePlace", "deletePlace",
		"createPayer", "updatePayer", "deletePayer",
		"getAllMappings", "createMapping", "updateMapping", "deleteMapping",
		"getRecurringExpenses", "createRecurringExpense", "updateRecurringExpense", "deleteRecurringExpense", "processRecurring",
	}
	for _, role := range []string{"user", "", "unknown", "admin"} {
		t.Run("ロール="+role, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Header.Get("X-Amz-Target") != "DynamoDB_20120810.GetItem" {
					t.Errorf("権限確認以外の処理が実行されました: %s", r.Header.Get("X-Amz-Target"))
				}
				w.Header().Set("Content-Type", "application/x-amz-json-1.0")
				json.NewEncoder(w).Encode(map[string]any{"Item": map[string]any{"type": map[string]string{"S": "user"}, "id": map[string]string{"S": "test@example.test"}, "role": map[string]string{"S": role}}})
			}))
			defer server.Close()
			client, err := dynamo.NewLocalClient(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			api := NewHandler(client, func(context.Context, string) (*model.AuthUser, error) {
				return &model.AuthUser{Email: "test@example.test"}, nil
			})
			for _, action := range actions {
				// 管理者は認可を通過し、必須入力の検証まで到達する。
				if role == "admin" && (action == "getAllMappings" || action == "getRecurringExpenses" || action == "processRecurring" || action == "createMapping") {
					continue
				}
				before := calls
				response, err := api(context.Background(), events.APIGatewayV2HTTPRequest{
					RequestContext: events.APIGatewayV2HTTPRequestContext{HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Method: "POST"}},
					Headers:        map[string]string{"x-auth-token": "test"}, Body: `{"action":"` + action + `"}`,
				})
				want := 403
				if role == "admin" {
					want = 400
				}
				if err != nil || response.StatusCode != want || calls-before != 2 {
					t.Errorf("%s: ステータス=%d、期待=%d、保存先の呼び出し=%d、エラー=%v", action, response.StatusCode, want, calls-before, err)
				}
			}
			response, err := api(context.Background(), events.APIGatewayV2HTTPRequest{
				RequestContext: events.APIGatewayV2HTTPRequestContext{HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Method: "POST"}},
				Headers:        map[string]string{"x-auth-token": "test"}, Body: `{"action":"getMyRole"}`,
			})
			if err != nil || response.StatusCode != 200 {
				t.Errorf("一般ユーザー向けの操作に失敗: %+v、%v", response, err)
			}
		})
	}
}

func TestWebhookAuthentication(t *testing.T) {
	for _, tc := range []struct {
		name, secret string
		headers      map[string]string
		want         int
	}{
		{"一致", "secret", map[string]string{"X-Webhook-Secret": "secret"}, 400},
		{"不一致", "secret", map[string]string{"x-webhook-secret": "wrong", "x-auth-token": "test"}, 401},
		{"空のヘッダー", "secret", map[string]string{"x-webhook-secret": ""}, 401},
		{"秘密値未設定", "", map[string]string{"x-webhook-secret": "secret"}, 401},
		{"ヘッダーなし", "secret", nil, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("WEBHOOK_SECRET", tc.secret)
			verified := false
			response, err := handle(context.Background(), events.APIGatewayV2HTTPRequest{
				RequestContext: events.APIGatewayV2HTTPRequestContext{HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Method: "POST"}},
				Headers:        tc.headers, Body: `{"action":"webhookGmail"}`,
			}, func(context.Context) (*dynamo.Client, error) { return nil, nil }, func(context.Context, string) (*model.AuthUser, error) {
				verified = true
				return nil, errors.New("トークン検証が呼び出されました")
			})
			if err != nil || response.StatusCode != tc.want || verified {
				t.Errorf("ステータス=%d、期待=%d、トークン検証=%v、エラー=%v", response.StatusCode, tc.want, verified, err)
			}
		})
	}
}
