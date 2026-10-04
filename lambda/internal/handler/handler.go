package handler

import (
	"context"
	"crypto/subtle"
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

func getHeader(headers map[string]string, key string) string {
	value, _ := findHeader(headers, key)
	return value
}

func findHeader(headers map[string]string, key string) (string, bool) {
	lowerKey := strings.ToLower(key)
	for k, v := range headers {
		if strings.ToLower(k) == lowerKey {
			return v, true
		}
	}
	return "", false
}

// Handle は Lambda ハンドラー
func Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	return handle(ctx, event, dynamo.GetClient, auth.VerifyIDToken)
}

// NewHandler は指定した保存先とトークン検証関数を使うハンドラーを生成する。
// 本番の Handle は常に通常の AWS クライアントと Google 認証を使用する。
func NewHandler(client *dynamo.Client, verify func(context.Context, string) (*model.AuthUser, error)) func(context.Context, events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	return func(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
		return handle(ctx, event, func(context.Context) (*dynamo.Client, error) { return client, nil }, verify)
	}
}

func handle(ctx context.Context, event events.APIGatewayV2HTTPRequest, getClient func(context.Context) (*dynamo.Client, error), verify func(context.Context, string) (*model.AuthUser, error)) (events.APIGatewayV2HTTPResponse, error) {
	origin := getHeader(event.Headers, "origin")

	// CORS の事前リクエスト
	if event.RequestContext.HTTP.Method == "OPTIONS" {
		return events.APIGatewayV2HTTPResponse{
			StatusCode: 204,
			Headers:    corsHeaders(origin),
		}, nil
	}

	if event.RequestContext.HTTP.Method != "POST" {
		return errorResponse(405, "許可されていない HTTP メソッドです", origin), nil
	}

	// リクエストボディをパース
	var req model.ActionRequest
	if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
		return errorResponse(400, "リクエストの解析に失敗しました", origin), nil
	}

	// DynamoDB クライアント初期化
	client, err := getClient(ctx)
	if err != nil {
		log.Printf("DynamoDB クライアントの初期化に失敗: %v", err)
		return errorResponse(500, "サーバーエラーが発生しました", origin), nil
	}

	// Webhook 認証の判定
	webhookSecretHeader, webhookHeaderPresent := findHeader(event.Headers, "x-webhook-secret")
	expectedSecret := os.Getenv("WEBHOOK_SECRET")
	if webhookHeaderPresent {
		if expectedSecret == "" || subtle.ConstantTimeCompare([]byte(webhookSecretHeader), []byte(expectedSecret)) != 1 {
			log.Printf("Webhook 認証に失敗しました")
			return errorResponse(401, "認証に失敗しました", origin), nil
		}
		// Webhook 経由の処理
		if req.Action == "webhookGmail" || req.Gmail != nil {
			if req.Gmail == nil {
				return errorResponse(400, "gmail ペイロードは必須です", origin), nil
			}
			log.Printf("[Webhook] Gmail の処理を開始: messageId=%s, 件名=%s", req.Gmail.MessageID, req.Gmail.Subject)
			// システムユーザーとして登録
			defaultUser := os.Getenv("WEBHOOK_USER_EMAIL")
			if defaultUser == "" {
				defaultUser = "system@gmail-webhook"
			}
			result, err := service.ProcessGmailWebhook(ctx, client, req.Gmail, defaultUser)
			if err != nil {
				if appErr, ok := err.(*apperror.AppError); ok {
					return errorResponse(appErr.StatusCode, appErr.Message, origin), nil
				}
				log.Printf("Webhook の処理に失敗: %v", err)
				return errorResponse(500, "サーバーエラーが発生しました", origin), nil
			}
			log.Printf("[Webhook] Gmail の処理が完了: messageId=%s, 結果=%+v", req.Gmail.MessageID, result)
			return successResponse(result, origin), nil
		}
	}

	// トークン認証 (通常のフロントエンド用)
	token := getHeader(event.Headers, "x-auth-token")
	if token == "" {
		return errorResponse(401, "認証トークンは必須です", origin), nil
	}

	user, err := verify(ctx, token)
	if err != nil {
		log.Printf("トークンの検証に失敗: %v", err)
		return errorResponse(401, "認証に失敗しました", origin), nil
	}

	// ユーザー登録確認（メールベース認証）
	registered, err := service.IsUserRegistered(ctx, client, user.Email)
	if err != nil {
		log.Printf("ユーザーの登録確認に失敗: %v", err)
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
		log.Printf("アクションの実行に失敗: %v", err)
		return errorResponse(500, "サーバーエラーが発生しました", origin), nil
	}

	return successResponse(result, origin), nil
}

// requiresAdmin は管理者に限定するアクションを判定する。
func requiresAdmin(action string) bool {
	switch action {
	case "createCategory", "updateCategory", "deleteCategory",
		"createPlace", "updatePlace", "deletePlace",
		"createPayer", "updatePayer", "deletePayer",
		"getAllMappings", "createMapping", "updateMapping", "deleteMapping",
		"getRecurringExpenses", "createRecurringExpense", "updateRecurringExpense", "deleteRecurringExpense", "processRecurring":
		return true
	default:
		return false
	}
}

func handleAction(ctx context.Context, client *dynamo.Client, req *model.ActionRequest, userEmail string) (any, error) {
	if requiresAdmin(req.Action) {
		role, err := service.GetUserRole(ctx, client, userEmail)
		if err != nil {
			return nil, err
		}
		if role != "admin" {
			return nil, apperror.WithStatus(403, "この操作には管理者権限が必要です")
		}
	}
	switch req.Action {
	case "getCategories":
		return service.GetCategories(ctx, client, userEmail)

	case "getPlaces":
		return service.GetPlaces(ctx, client)

	case "getPayers":
		return service.GetPayers(ctx, client)

	case "getExpenses":
		if req.Month == "" {
			return nil, apperror.New("month は必須です")
		}
		return service.GetExpensesByMonth(ctx, client, req.Month, userEmail)

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

	case "bulkCreateExpenses":
		if len(req.Expenses) == 0 {
			return nil, apperror.New("expenses は必須です")
		}
		return service.BulkCreateExpenses(ctx, client, req.Expenses, userEmail)

	case "deleteExpense":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		return nil, service.DeleteExpense(ctx, client, req.ID)

	case "getMonthlySummary":
		if req.Month == "" {
			return nil, apperror.New("month は必須です")
		}
		return service.GetMonthlySummary(ctx, client, req.Month, req.Payer, userEmail)

	case "getYearlySummary":
		if req.Month == "" {
			return nil, apperror.New("month は必須です")
		}
		return service.GetYearlySummary(ctx, client, req.Month, req.Payer, userEmail)

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

	case "getAllMappings":
		return service.GetAllMappings(ctx, client)
	case "createMapping":
		// リクエストからメール設定を作成する
		m := &model.EmailMapping{
			Type:       req.MappingType,
			Identifier: req.MappingIdentifier,
			Payer:      req.MappingPayer,
			Category:   req.MappingCategory,
			Place:      req.MappingPlace,
			Exclude:    req.MappingExclude != nil && *req.MappingExclude,
			Comment:    req.MappingComment,
		}
		return service.CreateMapping(ctx, client, m)
	case "updateMapping":
		// 更新対象を特定する type と identifier を確認する
		if req.MappingType == "" || req.MappingIdentifier == "" {
			return nil, apperror.New("type と identifier は必須です")
		}
		m := &model.EmailMapping{
			Payer:    req.MappingPayer,
			Category: req.MappingCategory,
			Place:    req.MappingPlace,
			Exclude:  req.MappingExclude != nil && *req.MappingExclude,
			Comment:  req.MappingComment,
		}
		return service.UpdateMapping(ctx, client, req.MappingType, req.MappingIdentifier, m)

	case "deleteMapping":
		if req.MappingType == "" || req.MappingIdentifier == "" {
			return nil, apperror.New("type と identifier は必須です")
		}
		return nil, service.DeleteMapping(ctx, client, req.MappingType, req.MappingIdentifier)

	case "processRecurring":
		count, err := service.ProcessRecurringExpenses(ctx, client, userEmail)
		if err != nil {
			return nil, err
		}
		return map[string]int{"created": count}, nil

	// --- マスタ管理 ---

	case "getAllCategories":
		return service.GetAllCategories(ctx, client, userEmail)

	case "createCategory":
		if req.Category == nil {
			return nil, apperror.New("category は必須です")
		}
		return service.CreateCategory(ctx, client, req.Category, userEmail)

	case "updateCategory":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		if req.Category == nil {
			return nil, apperror.New("category は必須です")
		}
		return service.UpdateCategory(ctx, client, req.ID, req.Category, userEmail)

	case "deleteCategory":
		if req.ID == "" {
			return nil, apperror.New("id は必須です")
		}
		return nil, service.DeleteCategory(ctx, client, req.ID, userEmail)

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
	client, err := dynamo.GetClient(ctx)
	if err != nil {
		log.Printf("DynamoDB クライアントの初期化に失敗: %v", err)
		return nil, err
	}
	count, err := service.ProcessRecurringExpenses(ctx, client, "system@scheduled")
	if err != nil {
		log.Printf("定期支出の登録に失敗: %v", err)
		return nil, err
	}
	log.Printf("定期支出を%d件作成しました", count)
	return map[string]int{"created": count}, nil
}

// HandleBackup は EventBridge Schedule から呼ばれ、DynamoDB → Sheets バックアップを行う
func HandleBackup(ctx context.Context) (any, error) {
	client, err := dynamo.GetClient(ctx)
	if err != nil {
		log.Printf("DynamoDB クライアントの初期化に失敗: %v", err)
		return nil, err
	}
	if err := backup.SyncExpenses(ctx, client); err != nil {
		log.Printf("支出のバックアップに失敗: %v", err)
		return nil, err
	}
	return map[string]string{"status": "ok"}, nil
}

// ValidateEnvironment は本番起動時に必須の環境変数を確認する。
func ValidateEnvironment() {
	// 環境変数チェック
	required := []string{"DYNAMO_EXPENSE_TABLE", "DYNAMO_MASTER_TABLE", "GOOGLE_CLIENT_ID"}
	for _, key := range required {
		if os.Getenv(key) == "" {
			log.Fatalf("環境変数 %s が設定されていません", key)
		}
	}
}
