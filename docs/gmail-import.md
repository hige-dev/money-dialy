# メール自動取込 & 自動分類 (Gmail + GAS 連携)

クレジットカードなどの利用通知メールを Gmail で受信した際、Google Apps Script (GAS) を介して Money Diary に自動登録し、設定したルールに従って支払元やカテゴリを自動分類する機能です。

```
Gmail (利用通知メール受信)
  ↓ 定期実行 (1分〜数分おき)
Google Apps Script (GAS)
  ↓ Webhook POST (JSON)
Lambda Function URL (Go)
  ├─ パーサーでメール本文から日付・金額・利用先を抽出
  ├─ メール自動分類マッピング (DynamoDB) に基づき支払元・カテゴリを適用
  └─ DynamoDB (expenses) に一括登録
```

---

## 1. 事前準備 (バックエンド)

`lambda/samconfig.toml` またはデプロイ時パラメータで `WebhookSecret` を設定してデプロイします。

```toml
# lambda/samconfig.toml の例
[default.deploy.parameters]
parameter_overrides = [
  "WebhookSecret=your-secure-random-secret-key"
]
```

デプロイ後に出力される `WebhookUrl`（Lambda Function URL）を控えておきます。

---

## 2. Google Apps Script (GAS) のセットアップ

### 手順

1. [Google Apps Script](https://script.google.com/) にアクセスし、「新しいプロジェクト」を作成。
2. リポジトリ内の [`gas/Code.js`](../gas/Code.js) および [`gas/appsscript.json`](../gas/appsscript.json) の内容をプロジェクトに反映します。
   - ※ `appsscript.json` を表示するには、プロジェクト設定で「マニフェスト ファイル「appsscript.json」をエディタで表示する」を有効にします。
3. エディタ上で `setConfig(backendUrl, webhookSecret)` を実行してスクリプトプロパティを設定します：
   - `backendUrl`: デプロイ時に取得した `WebhookUrl`
   - `webhookSecret`: 設定した `WebhookSecret`
4. トリガー（時計アイコン）を開き、`processRakutenCardEmails` を定期実行（例: 5分〜15分おき）に設定します。

---

## 3. メール自動分類マッピングの設定

Web アプリケーション上で、取り込まれるメールに応じた支払元やカテゴリの自動割り当てルールを作成できます。

### 設定手順
1. Money Diary の **「設定」** ページを開く
2. 上部の **「メール自動分類マッピング」** をクリック（`/mappings`）
3. **「+ 追加」** を押し、条件を設定します：
   - **一致条件**:
     - `件名`: メールの件名による判定（例: `本人ご利用分` ➔ 支払元: `自分`）
     - `本文キーワード`: 利用先や本文内容による判定（例: `Amazon` ➔ カテゴリ: `日用品`）
   - **条件テキスト**: マッチさせたい文字列
   - **適用する支払元**: 一致時に自動設定する支払元
   - **適用するカテゴリ**: 一致時に自動設定するカテゴリ
   - **メモ/コメント**: 説明（任意）

---

## 4. パーサーの追加・拡張

新しいクレジットカードやサービスのメール通知に対応する場合は、`lambda/internal/parser/` 配下に `CardEmailParser` インターフェースを実装したパーサーを追加します。

```go
type CardEmailParser interface {
    Name() string
    CanParse(from, subject, body string) bool
    Parse(subject, body string) ([]model.ExpenseInput, error)
}
```
実装ファイルで `init()` 内に `RegisterParser(&YourParser{})` を呼ぶことで自動認識されます。
