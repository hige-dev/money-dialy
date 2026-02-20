# Money Diary

シンプルな家計簿 Web アプリ。スマートフォンからの日常入力に最適化しています。

## 機能

- **支出入力** — カテゴリ選択 + 電卓 UI（`500+300` のような計算対応）
- **カレンダービュー** — 日別の支出合計を一覧表示
- **支出一覧** — 月別表示、編集・削除
- **集計** — カテゴリ別ドーナツチャート、月別推移グラフ、前月比・前年比
- **支払元フィルタ** — 支払元ごとの集計と残額管理
- **定期支出** — 毎月/隔月の自動登録（EventBridge スケジュール）
- **設定画面** — カテゴリ・場所・支払元のマスタ管理
- **認証** — Google ログイン、許可メールアドレスのみアクセス可

## 構成

```
Browser (React 19 + TypeScript)
  ↓ HTTPS + Google ID Token
CloudFront
  ├─ /api/* → Lambda Function URL (Go) → DynamoDB
  └─ /*     → S3 (静的ファイル)
```

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 19, TypeScript, Vite, Chart.js |
| バックエンド | Go, AWS Lambda (provided.al2023) |
| データベース | DynamoDB (オンデマンド) |
| 認証 | Google OAuth 2.0 (ID Token 検証) |
| インフラ | CloudFront + S3 + Lambda Function URL (OAC) |
| IaC | AWS SAM |

## プロジェクト構成

```
├── lambda/                 # Go バックエンド
│   ├── cmd/api/main.go     #   エントリーポイント
│   ├── internal/
│   │   ├── handler/        #   Lambda ハンドラー
│   │   ├── auth/           #   Google ID Token 検証
│   │   ├── dynamo/         #   DynamoDB クライアント
│   │   ├── service/        #   ビジネスロジック
│   │   ├── model/          #   構造体定義
│   │   └── apperror/       #   エラー型
│   ├── template.yaml       #   SAM テンプレート
│   └── Makefile
├── frontend/               # React フロントエンド
│   └── src/
│       ├── pages/          #   各画面
│       ├── components/     #   共通コンポーネント
│       ├── contexts/       #   認証 Context
│       └── services/       #   API クライアント
└── scripts/                # デプロイスクリプト
```

## セットアップ

### 前提条件

- AWS CLI v2 + AWS アカウント
- Go 1.21+
- Node.js 20+
- AWS SAM CLI
- Google Cloud プロジェクト（OAuth 用）

### 1. 環境ファイルの準備

```bash
cp .env.setup.example .env.setup
cp lambda/samconfig.toml.example lambda/samconfig.toml
cp frontend/.env.example frontend/.env.production
cp frontend/.env.example frontend/.env.development
```

各ファイルを自分の環境に合わせて編集してください。

### 2. Google OAuth の設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. OAuth 同意画面を設定（外部 / テスト用にメールアドレスを追加）
3. 認証情報 → OAuth 2.0 クライアント ID を作成（Web アプリケーション）
   - 承認済み JavaScript 生成元: `http://localhost:5173` と CloudFront ドメイン
4. クライアント ID を `lambda/samconfig.toml` と `frontend/.env.*` に設定

### 3. バックエンドのデプロイ

```bash
cd lambda
make build
sam deploy --guided   # 初回のみ。2回目以降は ./scripts/deploy-backend.sh
```

### 4. 初期データの登録

デプロイ後、DynamoDB の master テーブルにマスタデータを登録します。

> アプリの設定画面（`/settings`）からも追加・編集できます。
> 最低限 **ユーザー 1 件 + カテゴリ 1 件** を登録すればアプリが使えます。

#### ユーザー登録（必須）

ログインに使う Google アカウントのメールアドレスを登録します。

```bash
MASTER_TABLE=money-diary-master  # sam deploy 時の出力を確認

aws dynamodb put-item --table-name $MASTER_TABLE --item '{
  "type": {"S": "user"},
  "id": {"S": "your-email@gmail.com"},
  "role": {"S": "admin"}
}'
```

#### カテゴリの例

以下は一般的な家計簿カテゴリの例です。必要に応じて追加・変更してください。

| # | カテゴリ | 色 | 備考 |
|---|---------|-----|------|
| 1 | 食費 | `#FF6384` | スーパー・食料品 |
| 2 | 外食 | `#FF9F40` | レストラン・カフェ |
| 3 | 日用品 | `#FFCD56` | 洗剤・消耗品 |
| 4 | 交通費 | `#4BC0C0` | 電車・バス・ガソリン |
| 5 | 住居費 | `#36A2EB` | 家賃・ローン |
| 6 | 光熱費 | `#9966FF` | 電気・ガス・水道 |
| 7 | 通信費 | `#C9CBCF` | スマホ・ネット回線 |
| 8 | 医療費 | `#E7E9ED` | 病院・薬 |
| 9 | 趣味・娯楽 | `#7BC8A4` | 旅行・映画・書籍 |
| 10 | 衣服・美容 | `#F7A35C` | 服・美容院 |
| 11 | 教育費 | `#8085E9` | 習い事・書籍 |
| 12 | 保険 | `#F15C80` | 生命保険・損害保険 |
| 13 | その他 | `#AEB6BF` | 上記に当てはまらないもの |
| 14 | 収入 | `#2ECC71` | 給料・副収入（集計から除外） |

```bash
# 登録例
aws dynamodb put-item --table-name $MASTER_TABLE --item '{
  "type": {"S": "category"},
  "id": {"S": "食費"}, "name": {"S": "食費"},
  "sortOrder": {"N": "1"}, "color": {"S": "#FF6384"},
  "isActive": {"BOOL": true}, "isExpense": {"BOOL": true}
}'
```

> `isExpense: false` のカテゴリ（収入など）は集計の合計に含まれません。

#### 支払元の例

| 名前 | 残額追跡 |
|------|---------|
| 現金 | - |
| クレジットカード | - |
| 銀行口座 | あり |
| 電子マネー | あり |

#### 場所の例

スーパー、コンビニ、ドラッグストア、ネット通販、その他 など

### 5. フロントエンドのデプロイ

```bash
# S3 バケット作成（初回のみ）
aws s3 mb s3://your-frontend-bucket

# デプロイ
./scripts/deploy-frontend.sh <S3バケット名> <CloudFront Distribution ID> frontend
```

### 6. CloudFront の設定

| ビヘイビア | オリジン | 備考 |
|-----------|---------|------|
| `/api/*` | Lambda Function URL | OAC (SigV4) |
| `/*` (デフォルト) | S3 バケット | OAC |

- エラーページ: 403 → `/index.html`（SPA ルーティング対応）

## ローカル開発

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173
```

Vite のカスタムプラグインが `/api` リクエストを `aws lambda invoke` に転送します。
Lambda がデプロイ済みであれば、ローカルで API 連携の動作確認ができます。

## スクリプト

| スクリプト | 説明 |
|-----------|------|
| `scripts/deploy-backend.sh` | Lambda ビルド + SAM デプロイ |
| `scripts/deploy-frontend.sh` | フロントエンドビルド + S3 同期 + CloudFront 無効化 |

## セキュリティ

### 認証・認可

- **Google OAuth 2.0** — フロントエンドで取得した ID Token を
  Lambda 側で `go-oidc/v3` により署名検証。
  DynamoDB の master テーブルに登録済みのメールアドレスのみアクセスを許可
- **シークレット管理** — API キーやクレデンシャルのハードコーディングなし。
  すべて環境変数 or SAM パラメータで管理

### API 保護

- **Lambda Function URL + CloudFront OAC** —
  Function URL の `AuthType: AWS_IAM` と CloudFront OAC（SigV4 署名）により、
  CloudFront 経由以外のアクセスを遮断。
  フロントエンドは POST ボディの SHA-256 ハッシュを
  `x-amz-content-sha256` ヘッダーで送信し署名整合性を維持
- **CORS ホワイトリスト** — `ALLOWED_ORIGIN` 環境変数で許可オリジンを制限

### Google Sheets API 接続

- **Workload Identity Federation（WIF）** —
  サービスアカウントキーファイルを持たずに、
  Lambda 実行ロールの AWS 認証情報から GCP STS 経由で Sheets API にアクセス。
  長期クレデンシャルの漏洩リスクを排除

## コスト

**AWS 無料枠内** で運用できるよう設計しています。

### コンピュート

- **Lambda 128 MB** — 最小メモリで十分な Go バイナリ。
  月 10,000 リクエスト程度では無料枠内
- **EventBridge Schedule** — 定期支出の月次登録 + 日次バックアップで
  月 60 イベント程度。無料枠（月 14M イベント）内

### データストア

- **DynamoDB オンデマンド** — 個人用途のリクエスト量は
  無料枠（読み取り 25 RRU / 書き込み 25 WRU、ストレージ 25 GB）に収まる
- **GSI `yearMonth-date-index`** — 月別クエリを Scan ではなく Query で実行し、
  読み取りユニット消費を最小化
- **集計キャッシュ** — 月別サマリーを DynamoDB にキャッシュ保存し、
  毎リクエストの再集計を回避

### 配信

- **CloudFront 無料プラン** — Flat-rate Free プラン（$0/月）を利用。
  月 100 GB 転送 / 100 万リクエストまで無料、WAF ルール 5 個・DDoS 保護付き。
  個人用途には十分で、超過時もオーバーチャージなし
- **キャッシュ戦略** — Vite のハッシュ付きアセットに
  `Cache-Control: public, max-age=31536000, immutable` を設定。
  キャッシュヒット率をほぼ 100% に維持し、S3 GET リクエストと転送量を削減
- **index.html のみ `no-cache`** — デプロイ時に最新バージョンを即時反映

### フロントエンド API キャッシュ

- マスタデータ・月別支出・集計をメモリキャッシュし、
  同一セッション内の重複 API 呼び出しを削減。Lambda 実行回数を 30〜50% 低減

### バックアップ

- **Google Sheets への日次全件洗い替え** — 個別の非同期バックアップ（CRUD ごと）ではなく、
  1 日 1 回の一括同期でシンプルさと整合性を両立。
  Sheets API 呼び出し回数も最小限に抑制

## ライセンス

MIT
