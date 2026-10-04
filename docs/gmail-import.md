# メール自動取込 & 自動分類 (Gmail + GAS 連携)

クレジットカードなどの利用通知メールを Gmail で受信した際、Google Apps Script (GAS) を介して Money Diary に自動登録し、設定したルールに従って支払元やカテゴリを自動分類する機能です。

```
Gmail (利用通知メール受信)
  ↓ 時間主導トリガー（createTimeDrivenTrigger() は1時間おき）
Google Apps Script (GAS)
  ↓ Webhook POST (JSON)
Lambda Function URL (Go)
  ├─ パーサーでメール本文から日付・金額・利用先を抽出
  ├─ メール自動分類マッピング (DynamoDB) に基づき支払元・カテゴリを適用
  └─ DynamoDB (expenses) に明細ごとに登録・補完
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
2. リポジトリ内の [`gas/gmail-import/Code.js`](../gas/gmail-import/Code.js) および [`gas/gmail-import/appsscript.json`](../gas/gmail-import/appsscript.json) の内容をプロジェクトに反映します。
   - ※ `appsscript.json` を表示するには、プロジェクト設定で「マニフェスト ファイル「appsscript.json」をエディタで表示する」を有効にします。
3. GASエディタの「プロジェクトの設定」→「スクリプト プロパティ」で次の値を登録します：
   - `BACKEND_URL`: デプロイ時に取得した `WebhookUrl`
   - `WEBHOOK_SECRET`: 設定した `WebhookSecret`
4. トリガー（時計アイコン）を開き、`processPaymentEmails` を時間主導で登録します。`createTimeDrivenTrigger` を実行する場合は1時間おきに登録されます。

Claspを使う手順は[Gmail取込GASのREADME](../gas/gmail-import/README.md)を参照してください。

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
   - **適用する場所**: 一致時に自動設定する場所（例: `Amazon`, `セブンイレブン` などマスタから選択）
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

---

## 楽天カード速報版と詳細版

楽天カードの「【速報版】カード利用のお知らせ(本人ご利用分)」および家族会員分も対象です。速報版は利用日・利用者・金額を明細ごとに登録し、利用先は空欄で「詳細待ち」と表示します。支出一覧と集計にはこの時点から含まれ、編集・削除もできます。

後日届く詳細版は、楽天カード、元の利用日、利用者、金額が完全一致する「詳細待ち」の支出を1件ずつ補完します。同日同額の明細も別々に扱います。詳細版が先に取り込まれた場合も、後から届いた速報版を未照合の詳細明細と1件ずつ対応付け、支出は追加しません。利用先が空欄なら詳細版の値を入れ、カテゴリ・支払元・メモは詳細版の自動分類結果に更新します。ただし、速報版の登録後に手動で変更した項目は保持します。

一致する速報明細がない場合、詳細版は別の支出として登録します。金額や利用日が変わって一致しない場合、速報明細は「詳細待ち」のまま残り、両方が集計されます。内容を確認して不要な明細を削除してください。未補完明細の自動削除や、既存データの一括照合は行いません。

メールIDと明細位置で再送を識別し、途中まで取込済みのメールを再送しても既存明細を再登録しません。詳細版による補完結果も同じ識別子で管理します。GAS は未読メールのうち、次のいずれかに該当するものを取り込みます。

- 楽天カード: 送信元が `info@mail.rakuten-card.co.jp` で、件名が次のいずれかと完全一致するメール。
  - `カード利用のお知らせ(家族会員ご利用分)`
  - `カード利用のお知らせ(本人ご利用分)`
  - `【速報版】カード利用のお知らせ(家族会員ご利用分)`
  - `【速報版】カード利用のお知らせ(本人ご利用分)`
- 三井住友カード: 件名に `ご利用のお知らせ【三井住友カード】` を含み、送信元に `vpass.ne.jp`、`smbc-card.com`、`smbc.co.jp` のいずれかを含むか、本文に `三井住友カード` を含むメール。
- 楽天ペイ: 送信元に `no-reply@pay.rakuten.co.jp` または `pay.rakuten.co.jp` を含み、件名に `楽天ペイお支払い完了のお知らせ` または `楽天ペイアプリ` を含むメール。

Gmail検索は20スレッドずつ行い、全ページの検索結果を収集してから各メールを処理します。

LINE通知処理の `ProcessedForLINE` ラベルは取込条件に含みません。バックエンドが成功応答を返すと、GAS はメールを既読化してスレッドへ `処理済み` ラベルを付けます。LINE通知処理はこのラベルを取込成功の印として検索します。
