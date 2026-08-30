# Money Diary - GAS (Google Apps Script) Gmail 自動取得

Gmailに届くクレジットカード（楽天カード等）の利用通知メールを定期取得し、認証付きの Backend Lambda に自動送信する GAS プロジェクトです。

## ディレクトリ構成

- `Code.js` — Gmail検索、取得、API送信、既読化・ラベル付与、トリガー登録の処理
- `appsscript.json` — GAS 設定ファイル
- `.clasp.json` — clasp プロジェクト設定 (Git対象外)

---

## セットアップ & clasp での自動デプロイ手順

### 1. clasp のログイン（初回のみ）

```bash
cd gas
npx @google/clasp login
```

※ブラウザが開き、Google アカウントでの承認を求められます。また、[Google Apps Script 設定画面](https://script.google.com/home/usersettings) で **Google Apps Script API** を「オン」にしてください。

### 2. GAS プロジェクトの作成 or 既存プロジェクトへの紐付け

#### 新規作成する場合
```bash
cd gas
npx @google/clasp create --title "MoneyDiary-GmailImport" --type standalone
```
`gas/.clasp.json` が自動作成されます。

#### 既に作成済みの GAS に紐付ける場合
`.clasp.json.example` を `.clasp.json` にコピーし、GASの `scriptId` を設定します。
```json
{
  "scriptId": "YOUR_SCRIPT_ID_HERE",
  "rootDir": "./"
}
```

### 3. コードのプッシュ (自動デプロイ)

以下のスクリプトまたは npm コマンドでコードを GAS に反映できます：

```bash
./scripts/deploy-gas.sh
```
または
```bash
cd gas
npm run push
```

---

## 初期設定 (GAS側の環境変数・トリガー設定)

1. `npx @google/clasp open` またはブラウザで GAS エディタを開きます。
2. エディタ上で `setConfig` 関数を選択し、以下の引数を設定して実行（あるいはスクリプトプロパティを手動設定）します：
   - `BACKEND_URL`: Lambda Function URL (例: `https://xxxx.lambda-url.ap-northeast-1.on.aws/`)
   - `WEBHOOK_SECRET`: Lambdaの `template.yaml` に指定した共通シークレット文字列
3. `createTimeDrivenTrigger` 関数を実行すると、15分おきの自動実行トリガーが設定されます。
