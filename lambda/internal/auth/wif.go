package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

var (
	sheetsService *sheets.Service
	sheetsOnce    sync.Once
	sheetsErr     error
)

// buildExternalAccountJSON は Workload Identity Federation の認証情報JSONを構築する。
// ../library の googleAuth.ts と同じ構造。
func buildExternalAccountJSON() ([]byte, error) {
	projectNumber := os.Getenv("GCP_PROJECT_NUMBER")
	poolID := os.Getenv("GCP_WIF_POOL_ID")
	providerID := os.Getenv("GCP_WIF_PROVIDER_ID")
	serviceAccountEmail := os.Getenv("GCP_SERVICE_ACCOUNT_EMAIL")

	if projectNumber == "" || poolID == "" || providerID == "" || serviceAccountEmail == "" {
		return nil, fmt.Errorf(
			"Workload Identity Federation の環境変数が不足しています: " +
				"GCP_PROJECT_NUMBER, GCP_WIF_POOL_ID, GCP_WIF_PROVIDER_ID, GCP_SERVICE_ACCOUNT_EMAIL",
		)
	}

	config := map[string]any{
		"type":               "external_account",
		"audience":           fmt.Sprintf("//iam.googleapis.com/projects/%s/locations/global/workloadIdentityPools/%s/providers/%s", projectNumber, poolID, providerID),
		"subject_token_type": "urn:ietf:params:aws:token-type:aws4_request",
		"token_url":          "https://sts.googleapis.com/v1/token",
		"credential_source": map[string]any{
			"environment_id":              "aws1",
			"regional_cred_verification_url": "https://sts.{region}.amazonaws.com?Action=GetCallerIdentity&Version=2011-06-15",
		},
		"service_account_impersonation_url": fmt.Sprintf(
			"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/%s:generateAccessToken",
			serviceAccountEmail,
		),
	}

	return json.Marshal(config)
}

// GetSheetsService は Google Sheets API クライアントを取得する（シングルトン）
// 注意: credentials と service は Lambda の複数リクエストにまたがって再利用されるため、
// リクエストコンテキストではなく context.Background() で初期化する。
// リクエストコンテキストを使うとリクエスト完了時にキャンセルされ、
// 以降のトークンリフレッシュが "context canceled" で失敗する。
func GetSheetsService(ctx context.Context) (*sheets.Service, error) {
	sheetsOnce.Do(func() {
		credJSON, err := buildExternalAccountJSON()
		if err != nil {
			sheetsErr = err
			return
		}

		bgCtx := context.Background()

		creds, err := google.CredentialsFromJSON(bgCtx, credJSON,
			"https://www.googleapis.com/auth/spreadsheets",
		)
		if err != nil {
			sheetsErr = fmt.Errorf("WIF認証情報の構築に失敗: %w", err)
			return
		}

		svc, err := sheets.NewService(bgCtx, option.WithCredentials(creds))
		if err != nil {
			sheetsErr = fmt.Errorf("Sheets APIクライアントの作成に失敗: %w", err)
			return
		}

		sheetsService = svc
	})

	return sheetsService, sheetsErr
}
