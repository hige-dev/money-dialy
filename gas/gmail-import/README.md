# Gmail取込 GAS

カード利用通知をGmailから取得し、LambdaのGmail Webhookへ送信するGASプロジェクトです。[取込対象と照合の仕様](../../docs/gmail-import.md)も参照してください。

## ファイル

- `Code.js`: メール検索、Webhook送信、処理済みメールの既読化とラベル付与、トリガー登録
- `appsscript.json`: 実行環境と権限の設定
- `.clasp.json.example`: ローカルClasp設定のひな型
- `package.json`: Claspコマンド
- `Code.test.cjs`: 件名・送信元判定のローカルテスト

## Claspの設定とソース反映

このディレクトリで作業します。GASを利用するGoogleアカウントでGoogle Apps Script APIを有効にしてから、Claspにログインします。

```bash
cd gas/gmail-import
npm install
npm run login
```

既存のGASプロジェクトを使う場合は、`.clasp.json.example` を `.clasp.json` にコピーし、対象プロジェクトの `scriptId` を設定します。新規に作成する場合は `npm run create` を実行します。`.clasp.json` はGit管理対象外です。

```bash
npm run push
```

`npm run push` またはリポジトリルートの `scripts/deploy-gas.sh` は、このディレクトリのソースを紐付けたGASプロジェクトへ同期します。このプロジェクトは時間主導トリガーで実行し、ウェブアプリのデプロイを使用しません。コード変更の反映にウェブアプリのデプロイ操作は不要です。[Claspの公式ガイド](https://developers.google.com/apps-script/guides/clasp)も参照してください。

## スクリプトプロパティとトリガー

GASエディタの「プロジェクトの設定」→「スクリプト プロパティ」で次の値を設定します。`Code.js` は実行時にこれらの値を読み込みます。

| プロパティ | 値 |
| --- | --- |
| `BACKEND_URL` | Lambdaの `WebhookUrl` |
| `WEBHOOK_SECRET` | バックエンドの `WebhookSecret` と同じ値 |

GASエディタのトリガー画面から `processRakutenCardEmails` を時間主導で登録できます。`createTimeDrivenTrigger` を実行すると、同関数の既存トリガーを削除して1時間ごとのトリガーを登録します。取込対象は未読かつ `ProcessedForLINE` ラベルの付いたメールです。送信成功後にメールを既読化し、スレッドへ `処理済み` ラベルを付けます。

スクリプトプロパティの値だけを変更する場合、ソースの再同期は不要です。

## ローカル検証

```bash
node Code.test.cjs
```
