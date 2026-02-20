# デプロイ手順

## 全体構成

```
[ブラウザ] → [CloudFront] → [S3: フロントエンド]
                          → [Lambda Function URL: Go API] → [DynamoDB]
```

## 前提条件

- AWS CLI 設定済み（`aws configure`）
- AWS SAM CLI インストール済み
- Go 1.25+ インストール済み
- Node.js 24+ インストール済み
- gcloud CLI インストール済み
- Google Cloud プロジェクト作成済み

---

## 0. 変数の定義

以降の手順で繰り返し使う値を、最初にシェル変数として定義しておく。
各ステップで値が確定したタイミングで `export` する。

```bash
# === GCP ===
export GCP_PROJECT_ID="your-gcp-project-id"
export GCP_PROJECT_NUMBER=""          # 1.4 で取得して設定
export GCP_SA_NAME="money-diary-sa"
export GCP_SA_EMAIL="${GCP_SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
export GCP_WIF_POOL_ID="money-diary-pool"
export GCP_WIF_PROVIDER_ID="money-diary-aws"
export GOOGLE_CLIENT_ID=""            # 1.2 で取得して設定

# === AWS ===
export AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export AWS_REGION="ap-northeast-1"
export S3_BUCKET="money-diary-frontend-${AWS_ACCOUNT_ID}"
export SAM_STACK_NAME="money-diary"
export LAMBDA_FUNCTION_NAME=""        # 2.2 で取得して設定
export CF_DISTRIBUTION_ID=""          # 3.2 で取得して設定
export CF_DOMAIN=""                   # 3.2 で取得して設定

# === Spreadsheet ===
export SPREADSHEET_ID=""
```

---

## 1. Google Cloud 設定

### 1.1 APIの有効化

```bash
gcloud config set project "${GCP_PROJECT_ID}"
gcloud services enable sheets.googleapis.com
gcloud services enable iamcredentials.googleapis.com
gcloud services enable sts.googleapis.com
```

### 1.2 OAuth クライアントID の作成

1. [Google Cloud Console](https://console.cloud.google.com/) → 「APIとサービス」→「認証情報」
2. 「認証情報を作成」→「OAuth クライアント ID」
3. アプリケーションの種類: 「ウェブ アプリケーション」
4. 承認済みの JavaScript 生成元に追加:
   - `http://localhost:5173`（開発用）
   - `https://${CF_DOMAIN}`（本番用、3.2 完了後に追加）
5. 作成後、クライアント ID を変数に設定:

```bash
export GOOGLE_CLIENT_ID="xxxx.apps.googleusercontent.com"
```

### 1.3 サービスアカウントの作成

```bash
gcloud iam service-accounts create "${GCP_SA_NAME}" \
  --display-name="Money Diary Sheets API"

# 確認
gcloud iam service-accounts describe "${GCP_SA_EMAIL}"
```

### 1.4 Workload Identity Federation の設定

```bash
# プロジェクト番号を取得して変数に設定
export GCP_PROJECT_NUMBER="$(gcloud projects describe ${GCP_PROJECT_ID} --format='value(projectNumber)')"
echo "GCP_PROJECT_NUMBER=${GCP_PROJECT_NUMBER}"

# Workload Identity Pool の作成
gcloud iam workload-identity-pools create "${GCP_WIF_POOL_ID}" \
  --location="global" \
  --display-name="Money Diary AWS Pool"

# AWS プロバイダーの作成
gcloud iam workload-identity-pools providers create-aws "${GCP_WIF_PROVIDER_ID}" \
  --location="global" \
  --workload-identity-pool="${GCP_WIF_POOL_ID}" \
  --account-id="${AWS_ACCOUNT_ID}"

# サービスアカウントに権限借用を許可
gcloud iam service-accounts add-iam-policy-binding "${GCP_SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GCP_WIF_POOL_ID}/attribute.aws_account/${AWS_ACCOUNT_ID}"
```

### 設定値の確認

```bash
echo "=== 設定値一覧 ==="
echo "GCP_PROJECT_ID:     ${GCP_PROJECT_ID}"
echo "GCP_PROJECT_NUMBER: ${GCP_PROJECT_NUMBER}"
echo "GCP_SA_EMAIL:       ${GCP_SA_EMAIL}"
echo "GCP_WIF_POOL_ID:    ${GCP_WIF_POOL_ID}"
echo "GCP_WIF_PROVIDER_ID:${GCP_WIF_PROVIDER_ID}"
echo "GOOGLE_CLIENT_ID:   ${GOOGLE_CLIENT_ID}"
echo "AWS_ACCOUNT_ID:     ${AWS_ACCOUNT_ID}"
```

---

## 2. AWS バックエンドデプロイ

### 2.1 初回デプロイ

```bash
cd lambda
make build
sam deploy --guided \
  --stack-name "${SAM_STACK_NAME}" \
  --region "${AWS_REGION}" \
  --parameter-overrides \
    "SpreadsheetId=${SPREADSHEET_ID}" \
    "GcpProjectNumber=${GCP_PROJECT_NUMBER}" \
    "GcpWifPoolId=${GCP_WIF_POOL_ID}" \
    "GcpWifProviderId=${GCP_WIF_PROVIDER_ID}" \
    "GcpServiceAccountEmail=${GCP_SA_EMAIL}" \
    "GoogleClientId=${GOOGLE_CLIENT_ID}" \
    "AllowedOrigin=*"
```

`--guided` のプロンプトで聞かれる追加項目:
```
Confirm changes before deploy: y
Allow SAM CLI IAM role creation: y
Disable rollback: n
Save arguments to configuration file: y
SAM configuration file: samconfig.toml
SAM configuration environment: default
```

### 2.2 Lambda Function URL の確認

```bash
# 出力から Function URL と関数名を取得
export LAMBDA_FUNCTION_URL="$(aws cloudformation describe-stacks \
  --stack-name "${SAM_STACK_NAME}" \
  --query 'Stacks[0].Outputs[?OutputKey==`FunctionUrl`].OutputValue' \
  --output text)"

export LAMBDA_FUNCTION_NAME="$(aws cloudformation describe-stacks \
  --stack-name "${SAM_STACK_NAME}" \
  --query 'Stacks[0].Outputs[?OutputKey==`FunctionArn`].OutputValue' \
  --output text | awk -F: '{print $NF}')"

echo "LAMBDA_FUNCTION_URL:  ${LAMBDA_FUNCTION_URL}"
echo "LAMBDA_FUNCTION_NAME: ${LAMBDA_FUNCTION_NAME}"
```

### 2.3 2回目以降のデプロイ

```bash
./scripts/deploy-backend.sh
```

---

## 3. CloudFront + S3 の設定

### 3.1 S3 バケットの作成

```bash
aws s3 mb "s3://${S3_BUCKET}" --region "${AWS_REGION}"
```

### 3.2 CloudFront ディストリビューションの作成

AWS コンソールで CloudFront ディストリビューションを作成:

#### S3 オリジン（フロントエンド）

| 設定 | 値 |
|------|-----|
| Origin domain | `${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com` |
| Origin path | `/frontend` |
| Origin access | Origin access control settings (OAC) |
| S3 bucket access | OAC を新規作成 |

#### Lambda オリジン（API）

Lambda Function URL のドメイン部分を使用（`https://` と末尾 `/` を除いた部分）。

| 設定 | 値 |
|------|-----|
| Origin domain | `${LAMBDA_FUNCTION_URL}` のドメイン部分 |
| Origin access | Origin access control settings (OAC) |
| OAC | 新規作成 (Signing protocol: SigV4, Origin type: Lambda) |

#### ビヘイビア設定

**デフォルトビヘイビア（S3）:**

| 設定 | 値 |
|------|-----|
| Path pattern | Default (*) |
| Origin | S3 オリジン |
| Viewer protocol policy | Redirect HTTP to HTTPS |
| Cache policy | CachingOptimized |

**API ビヘイビア（Lambda）:**

| 設定 | 値 |
|------|-----|
| Path pattern | `/api` |
| Origin | Lambda オリジン |
| Viewer protocol policy | HTTPS only |
| Allowed HTTP methods | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE |
| Cache policy | CachingDisabled |
| Origin request policy | AllViewerExceptHostHeader |

**エラーページ設定（SPA対応）:**

| HTTP error code | Response page path | HTTP response code |
|-----------------|--------------------|--------------------|
| 403 | `/index.html` | 200 |
| 404 | `/index.html` | 200 |

#### ディストリビューション作成後

```bash
export CF_DISTRIBUTION_ID="EXXXXXXXXXX"
export CF_DOMAIN="dxxxxxxxxxx.cloudfront.net"
echo "CF_DISTRIBUTION_ID: ${CF_DISTRIBUTION_ID}"
echo "CF_DOMAIN:          ${CF_DOMAIN}"
```

### 3.3 S3 バケットポリシー

CloudFront OAC を設定すると、AWS コンソールがバケットポリシーをコピーするよう案内が出る。
または以下を手動で設定:

```bash
cat <<EOF | aws s3api put-bucket-policy --bucket "${S3_BUCKET}" --policy file:///dev/stdin
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${S3_BUCKET}/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::${AWS_ACCOUNT_ID}:distribution/${CF_DISTRIBUTION_ID}"
        }
      }
    }
  ]
}
EOF
```

### 3.4 Lambda リソースポリシーの追加

```bash
aws lambda add-permission \
  --function-name "${LAMBDA_FUNCTION_NAME}" \
  --statement-id cloudfront-oac \
  --action lambda:InvokeFunctionUrl \
  --principal cloudfront.amazonaws.com \
  --source-arn "arn:aws:cloudfront::${AWS_ACCOUNT_ID}:distribution/${CF_DISTRIBUTION_ID}"
```

---

## 4. フロントエンドデプロイ

### 4.1 AllowedOrigin の更新

```bash
cd lambda

# samconfig.toml の AllowedOrigin を更新して再デプロイ
sam deploy \
  --parameter-overrides \
    "SpreadsheetId=${SPREADSHEET_ID}" \
    "GcpProjectNumber=${GCP_PROJECT_NUMBER}" \
    "GcpWifPoolId=${GCP_WIF_POOL_ID}" \
    "GcpWifProviderId=${GCP_WIF_PROVIDER_ID}" \
    "GcpServiceAccountEmail=${GCP_SA_EMAIL}" \
    "GoogleClientId=${GOOGLE_CLIENT_ID}" \
    "AllowedOrigin=https://${CF_DOMAIN}"
```

### 4.2 Google OAuth の承認済みオリジン追加

Google Cloud Console で OAuth クライアント ID の「承認済みの JavaScript 生成元」に追加:

```bash
echo "以下のURLを承認済みオリジンに追加してください:"
echo "https://${CF_DOMAIN}"
```

### 4.3 環境変数の設定

```bash
cd frontend

cat > .env.production <<EOF
VITE_GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
VITE_API_URL=https://${CF_DOMAIN}/api
VITE_ALLOWED_EMAILS=
EOF
```

### 4.4 フロントエンドのビルド＆デプロイ

```bash
./scripts/deploy-frontend.sh "${S3_BUCKET}" "${CF_DISTRIBUTION_ID}"
```

---

## 5. 動作確認

```bash
echo "以下のURLにアクセスして動作確認:"
echo "https://${CF_DOMAIN}"
```

1. Google ログインが表示される
2. DynamoDB に登録したメールアドレスでログイン
3. カテゴリが表示される（設定画面で追加可能）
4. 支出を入力して「登録」→ DynamoDB にデータが保存される
5. 一覧ページで登録したデータが表示される
6. 集計ページでグラフが表示される

---

## 6. ローカル開発

### フロントエンド

```bash
cd frontend

cat > .env.development <<EOF
VITE_GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
VITE_API_URL=https://${CF_DOMAIN}/api
VITE_ALLOWED_EMAILS=
EOF

npm run dev
# http://localhost:5173 で起動
```

### バックエンド（SAM Local）

```bash
cd lambda
make build
sam local invoke MoneyDiaryApiFunction --event events/test.json
```

テストイベント例 (`lambda/events/test.json`):
```json
{
  "requestContext": {
    "http": { "method": "POST" }
  },
  "headers": {
    "x-auth-token": "<Google ID Token>"
  },
  "body": "{\"action\": \"getCategories\"}"
}
```

### ログ確認

```bash
sam logs --name MoneyDiaryApiFunction --tail
```

---

## 変数一覧（最終確認用）

全ステップ完了後に全変数が埋まっていることを確認:

```bash
echo "=== GCP ==="
echo "GCP_PROJECT_ID:      ${GCP_PROJECT_ID}"
echo "GCP_PROJECT_NUMBER:  ${GCP_PROJECT_NUMBER}"
echo "GCP_SA_EMAIL:        ${GCP_SA_EMAIL}"
echo "GCP_WIF_POOL_ID:     ${GCP_WIF_POOL_ID}"
echo "GCP_WIF_PROVIDER_ID: ${GCP_WIF_PROVIDER_ID}"
echo "GOOGLE_CLIENT_ID:    ${GOOGLE_CLIENT_ID}"
echo ""
echo "=== AWS ==="
echo "AWS_ACCOUNT_ID:      ${AWS_ACCOUNT_ID}"
echo "AWS_REGION:          ${AWS_REGION}"
echo "S3_BUCKET:           ${S3_BUCKET}"
echo "SAM_STACK_NAME:      ${SAM_STACK_NAME}"
echo "LAMBDA_FUNCTION_NAME:${LAMBDA_FUNCTION_NAME}"
echo "CF_DISTRIBUTION_ID:  ${CF_DISTRIBUTION_ID}"
echo "CF_DOMAIN:           ${CF_DOMAIN}"
echo ""
echo "=== Spreadsheet ==="
echo "SPREADSHEET_ID:      ${SPREADSHEET_ID}"
```

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| 403 Forbidden (Lambda) | CloudFront OAC の<br>リソースポリシー未設定 | 4.4 の<br>`aws lambda add-permission`<br>を実行 |
| 401 Unauthorized | Google ID Token<br>検証失敗 | `GOOGLE_CLIENT_ID` が<br>正しいか確認 |
| 403 このアカウントでは<br>利用できません | `users` シートに<br>メール未登録 | スプシに<br>メールアドレスを追加 |
| CORS エラー | `ALLOWED_ORIGIN`<br>不一致 | Lambda の環境変数を<br>CloudFront ドメインに<br>合わせる |
| Sheets API エラー | SAに<br>スプシ共有されていない | スプシの共有設定を確認 |
| WIF 認証エラー | Pool/Provider/SA<br>設定不備 | `gcloud` コマンドで<br>設定を再確認 |

---

## コスト目安

| サービス | 無料枠 | 備考 |
|---------|--------|------|
| Lambda | 月100万リクエスト | 個人利用では到達しない |
| DynamoDB | オンデマンド | 個人利用ならほぼ無料 |
| S3 | 5GB | 静的ファイル数MB |
| CloudFront | 月1TB | 個人利用範囲内 |
| **合計** | **月額ほぼ 0円** | |
