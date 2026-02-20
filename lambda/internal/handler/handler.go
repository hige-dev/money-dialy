package handler

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"

	"money-diary/internal/apperror"
	"money-diary/internal/auth"
	"money-diary/internal/backup"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
	"money-diary/internal/service"
)

// matchOrigin はリクエストの Origin が許可リストに含まれるか判定する。
// ALLOWED_ORIGIN はカンマ区切りで複数オリジンを指定可能。
func matchOrigin(requestOrigin string) string {
	allowed := os.Getenv("ALLOWED_ORIGIN")
	if allowed == "" || allowed == "*" {
		return "*"
	}
	for _, o := range strings.Split(allowed, ",") {
		if strings.TrimSpace(o) == requestOrigin {
			return requestOrigin
		}
	}
	// マッチしない場合は最初のオリジンを返す（ブラウザ側でブロックされる）
	return strings.TrimSpace(strings.Split(allowed, ",")[0])
}

func corsHeaders(requestOrigin string) map[string]string {
	return map[string]string{
		"Access-Control-Allow-Origin":  matchOrigin(requestOrigin),
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, X-Auth-Token, x-amz-content-sha256",
	}
}

func jsonResponse(statusCode int, body any, requestOrigin string) events.APIGatewayV2HTTPResponse {
	b, _ := json.Marshal(body)
	headers := corsHeaders(requestOrigin)
	headers["Content-Type"] = "application/json"
	return events.APIGatewayV2HTTPResponse{
		StatusCode: statusCode,
		Headers:    headers,
		Body:       string(b),
	}
}

func successResponse(data any, requestOrigin string) events.APIGatewayV2HTTPResponse {
	return jsonResponse(200, model.APIResponse{Success: true, Data: data}, requestOrigin)
}

func errorResponse(statusCode int, errMsg string, requestOrigin string) events.APIGatewayV2HTTPResponse {
	return jsonResponse(statusCode, model.APIResponse{Success: false, Error: errMsg}, requestOrigin)
}

// Handle は Lambda ハンドラー
func Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	origin := event.Headers["origin"]

	// CORS preflight
	if event.RequestContext.HTTP.Method == "OPTIONS" {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 204,
			Headers:    corsHeaders(origin),
		}, nil
	}

	if event.RequestContext.HTTP.Method != "POST" {
		return errorResponse(405, "Method not allowed", origin), nil
	}

	// リクエストボディをパース
	var req model.ActionRequest
	if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
		return errorResponse(400, "リクエストの解析に失敗しました", origin), nil
	}

	// 認証
	token := event.Headers["x-auth-token"]
	if token == "" {
		return errorResponse(401, "Token required", origin), nil
	}

	user, err := auth.VerifyIDToken(ctx, token)
	if err != nil {
		log.Printf("Token verification failed: %v", err)
		return errorResponse(401, "Unauthorized", origin), nil
	}

	// DynamoDB クライアント初期化
	client, err := dynamo.NewClient(ctx)
	if err != nil {
		log.Printf("DynamoDB client error: %v", err)
		return errorResponse(500, "サーバーエラーが発生しました", origin), nil
	}

	// ユーザー登録確認（メールベース認証）
	registered, err := service.IsUserRegistered(ctx, client, user.Email)
	if err != nil {
		log.Printf("User check error: %v", err)
		return errorResponse(500, "サーバーエラーが発生しました", origin), nil
	}
	if !registered {
		return errorResponse(403, "このアカウントでは利用できません", origin), nil
	}

	// アクション実行
	result, err := handleAction(ctx, client, &req, user.Email)
	if err != nil {
		if appErr, ok := err.(*apperror.AppError); ok {
			return errorResponse(appErr.StatusCode, appErr.Message, origin), nil
		}
		log.Printf("Internal error: %v", err)
		return errorResponse(500, "サーバーエラーが発生しました", origin), nil
	}

	return successResponse(result, origin), nil
}

func handleAction(ctx context.Context, client *dynamo.Client, req *model.ActionRequest, userEmail string) (any, error) {
	switch req.Action {
	case "getCategories":
		return service.GetCategories(ctx, client)

	case "getPlaces":
		return service.GetPlaces(ctx, client)

	case "getPayers":
		return service.GetPayers(ctx, client)

	case "getExpenses":
		if req.Month == "" {
			return nil, apperror.New("month は必須です")
		}
		return service.GetExpensesByMonth(ctx, client, req.Month)

	case "createExpense":
		if req.Expense == nil {
			return nil, apperror.New("expense は必須です")
		}
		return service.CreateExpense(ctx, client, req.Expense, userEmail)

	case "updateExpense":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		if req.Expense == nil {
			return nil, apperror.New("expense は必須です")
		}
		return service.UpdateExpense(ctx, client, req.ID, req.Expense)

	case "deleteExpense":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		return nil, service.DeleteExpense(ctx, client, req.ID)

	case "getMonthlySummary":
		if req.Month == "" {
			return nil, apperror.New("month は必須です")
		}
		return service.GetMonthlySummary(ctx, client, req.Month, req.Payer)

	case "getYearlySummary":
		if req.Month == "" {
			return nil, apperror.New("month は必須です")
		}
		return service.GetYearlySummary(ctx, client, req.Month, req.Payer)

	case "getPayerBalance":
		if req.Payer == "" {
			return nil, apperror.New("payer は必須です")
		}
		if req.Month == "" {
			return nil, apperror.New("month は必須です")
		}
		return service.GetPayerBalance(ctx, client, req.Payer, req.Month)

	case "getMyRole":
		role, err := service.GetUserRole(ctx, client, userEmail)
		if err != nil {
			return nil, err
		}
		return map[string]string{"role": role}, nil

	case "getRecurringExpenses":
		return service.GetRecurringExpenses(ctx, client)

	case "createRecurringExpense":
		if req.RecurringExpense == nil {
			return nil, apperror.New("recurringExpense は必須です")
		}
		return service.CreateRecurringExpense(ctx, client, req.RecurringExpense)

	case "updateRecurringExpense":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		if req.RecurringExpense == nil {
			return nil, apperror.New("recurringExpense は必須です")
		}
		return service.UpdateRecurringExpense(ctx, client, req.ID, req.RecurringExpense)

	case "deleteRecurringExpense":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		return nil, service.DeleteRecurringExpense(ctx, client, req.ID)

	case "processRecurring":
		count, err := service.ProcessRecurringExpenses(ctx, client, userEmail)
		if err != nil {
			return nil, err
		}
		return map[string]int{"created": count}, nil

	// --- マスタ管理 ---

	case "getAllCategories":
		return service.GetAllCategories(ctx, client)

	case "createCategory":
		if req.Category == nil {
			return nil, apperror.New("category は必須です")
		}
		return service.CreateCategory(ctx, client, req.Category)

	case "updateCategory":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		if req.Category == nil {
			return nil, apperror.New("category は必須です")
		}
		return service.UpdateCategory(ctx, client, req.ID, req.Category)

	case "deleteCategory":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		return nil, service.DeleteCategory(ctx, client, req.ID)

	case "getAllPlaces":
		return service.GetAllPlaces(ctx, client)

	case "createPlace":
		if req.Place == nil {
			return nil, apperror.New("place は必須です")
		}
		return service.CreatePlace(ctx, client, req.Place)

	case "updatePlace":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		if req.Place == nil {
			return nil, apperror.New("place は必須です")
		}
		return service.UpdatePlace(ctx, client, req.ID, req.Place)

	case "deletePlace":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		return nil, service.DeletePlace(ctx, client, req.ID)

	case "getAllPayers":
		return service.GetAllPayers(ctx, client)

	case "createPayer":
		if req.PayerData == nil {
			return nil, apperror.New("payerData は必須です")
		}
		return service.CreatePayer(ctx, client, req.PayerData)

	case "updatePayer":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		if req.PayerData == nil {
			return nil, apperror.New("payerData は必須です")
		}
		return service.UpdatePayer(ctx, client, req.ID, req.PayerData)

	case "deletePayer":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		return nil, service.DeletePayer(ctx, client, req.ID)

	default:
		return nil, apperror.Newf("不明なアクション: %s", req.Action)
	}
}

// HandleScheduled は EventBridge Schedule から呼ばれ、定期支出の自動登録を行う
func HandleScheduled(ctx context.Context) (any, error) {
	client, err := dynamo.NewClient(ctx)
	if err != nil {
		log.Printf("DynamoDB client error: %v", err)
		return nil, err
	}
	count, err := service.ProcessRecurringExpenses(ctx, client, "system@scheduled")
	if err != nil {
		log.Printf("ProcessRecurringExpenses error: %v", err)
		return nil, err
	}
	log.Printf("ProcessRecurringExpenses: %d件作成", count)
	return map[string]int{"created": count}, nil
}

// HandleBackup は EventBridge Schedule から呼ばれ、DynamoDB → Sheets バックアップを行う
func HandleBackup(ctx context.Context) (any, error) {
	client, err := dynamo.NewClient(ctx)
	if err != nil {
		log.Printf("DynamoDB client error: %v", err)
		return nil, err
	}
	if err := backup.SyncExpenses(ctx, client); err != nil {
		log.Printf("SyncExpenses error: %v", err)
		return nil, err
	}
	return map[string]string{"status": "ok"}, nil
}

func init() {
	// 環境変数チェック
	required := []string{"DYNAMO_EXPENSE_TABLE", "DYNAMO_MASTER_TABLE", "GOOGLE_CLIENT_ID"}
	for _, key := range required {
		if os.Getenv(key) == "" {
			log.Fatalf("環境変数 %s が設定されていません", key)
		}
	}
}
