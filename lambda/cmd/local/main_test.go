package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"money-diary/internal/dynamo"
	"money-diary/internal/handler"
	"money-diary/internal/model"
)

func TestHTTPAdapter(t *testing.T) {
	api := httpAdapter(func(_ context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
		if event.RequestContext.HTTP.Method != "POST" || event.Headers["x-auth-token"] != localToken || event.Body != `{"action":"getCategories"}` {
			t.Fatalf("HTTP リクエストの変換結果が不正: %+v", event)
		}
		return events.APIGatewayV2HTTPResponse{StatusCode: 403, Headers: map[string]string{"Content-Type": "application/json"}, Body: `{"success":false}`}, nil
	})
	req := httptest.NewRequest("POST", "/api", strings.NewReader(`{"action":"getCategories"}`))
	req.Header.Set("X-Auth-Token", localToken)
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != 403 || rec.Header().Get("Content-Type") != "application/json" || rec.Body.String() != `{"success":false}` {
		t.Fatalf("HTTP 応答の変換結果が不正: %+v", rec)
	}
}

// DynamoDB Local を起動し、LOCAL_DYNAMO_TEST_ENDPOINT を指定した場合だけ実行する。
func TestLocalAPIIntegration(t *testing.T) {
	endpoint := os.Getenv("LOCAL_DYNAMO_TEST_ENDPOINT")
	if endpoint == "" {
		t.Skip("DynamoDB Local の接続先が未指定のため統合テストを省略")
	}
	client, err := dynamo.NewLocalClient(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.InitializeLocal(t.Context()); err != nil {
		t.Fatal(err)
	}
	api := httpAdapter(handler.NewHandler(client, verifyLocalToken))
	call := func(method, token, body string, want int, data any) {
		t.Helper()
		req := httptest.NewRequest(method, "/api", strings.NewReader(body))
		req.Header.Set("X-Auth-Token", token)
		rec := httptest.NewRecorder()
		api.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatalf("期待するステータス %d、実際 %d: %s", want, rec.Code, rec.Body.String())
		}
		if data != nil {
			var envelope struct {
				Success bool            `json:"success"`
				Data    json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if !envelope.Success {
				t.Fatalf("API が失敗: %s", rec.Body.String())
			}
			if err := json.Unmarshal(envelope.Data, data); err != nil {
				t.Fatal(err)
			}
		}
	}
	call("POST", "", `{"action":"getCategories"}`, 401, nil)
	call("POST", "invalid", `{"action":"getCategories"}`, 401, nil)
	call("OPTIONS", "", "", 204, nil)
	call("GET", "", "", 405, nil)
	call("POST", localToken, "{", 400, nil)
	call("POST", localToken, `{"action":"createExpense","expense":{"date":"2099-01-10","category":"local-food","amount":0}}`, 400, nil)
	var places []model.Place
	call("POST", localToken, `{"action":"getPlaces"}`, 200, &places)
	if places == nil {
		t.Fatal("空の場所一覧は null ではなく配列を返してください")
	}
	var categories []model.Category
	call("POST", localToken, `{"action":"getCategories"}`, 200, &categories)
	if len(categories) == 0 {
		t.Fatal("初期カテゴリが未登録")
	}
	var role struct {
		Role string `json:"role"`
	}
	call("POST", localToken, `{"action":"getMyRole"}`, 200, &role)
	if role.Role != "admin" {
		t.Fatal("ローカルユーザーが管理者ではありません")
	}
	var before model.MonthlySummary
	call("POST", localToken, `{"action":"getMonthlySummary","month":"2099-01"}`, 200, &before)
	var created model.Expense
	call("POST", localToken, `{"action":"createExpense","expense":{"date":"2099-01-10","category":"local-food","amount":1234,"payer":"現金","visibility":"public"}}`, 200, &created)
	t.Cleanup(func() {
		if err := client.DeleteExpense(context.Background(), created.ID); err != nil {
			t.Error(err)
		}
	})
	if created.ID == "" || created.CreatedBy != "local@example.test" {
		t.Fatalf("支出登録結果が不正: %+v", created)
	}
	if err := client.InitializeLocal(t.Context()); err != nil {
		t.Fatal(err)
	}
	var expenses []model.Expense
	call("POST", localToken, `{"action":"getExpenses","month":"2099-01"}`, 200, &expenses)
	found := false
	for _, e := range expenses {
		if e.ID == created.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("登録した支出が月別一覧にありません")
	}
	var after model.MonthlySummary
	call("POST", localToken, `{"action":"getMonthlySummary","month":"2099-01"}`, 200, &after)
	if after.Total != before.Total+1234 {
		t.Fatalf("登録後の集計が不正: %d", after.Total)
	}
	body, _ := json.Marshal(map[string]any{"action": "updateExpense", "id": created.ID, "expense": model.ExpenseInput{Date: "2099-01-10", Category: "local-food", Amount: 2345, Payer: "現金", Visibility: "public"}})
	call("POST", localToken, string(body), 200, &created)
	call("POST", localToken, `{"action":"getMonthlySummary","month":"2099-01"}`, 200, &after)
	if after.Total != before.Total+2345 {
		t.Fatalf("更新後の集計が不正: %d", after.Total)
	}
	body, _ = json.Marshal(map[string]string{"action": "deleteExpense", "id": created.ID})
	call("POST", localToken, string(body), 200, nil)
	call("POST", localToken, `{"action":"getMonthlySummary","month":"2099-01"}`, 200, &after)
	if after.Total != before.Total {
		t.Fatalf("削除後の集計が不正: %d", after.Total)
	}
}
