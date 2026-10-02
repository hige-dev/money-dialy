# LINE通知 GAS

取込済みの対象メールをLINEへ通知するGASプロジェクトです。[Gmail取込 GAS](../gmail-import/README.md)とは別のプロジェクトとして設定します。楽天カードの速報版と詳細版の通知に対応しています。

## Claspとスクリプトプロパティ

このディレクトリの `.clasp.json.example` を `.clasp.json` にコピーし、通知用GASプロジェクトの `scriptId` を設定します。`.clasp.json` はGit管理対象外です。

GASエディタの「プロジェクトの設定」→「スクリプト プロパティ」に次の値を登録します。コードは実行時に値を読み込むため、**値だけの変更ではClaspの再同期やウェブアプリの再デプロイは不要**です。

| プロパティ | 値 |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developersのチャネルアクセストークン |
| `LINE_GROUP_ID` | 通知先グループID |
| `LINE_GMAIL_LABELS_JSON` | 通知対象のGmailラベル名を含むJSONオブジェクト |

`LINE_GMAIL_LABELS_JSON` の各値にGmailで使用するラベル名を設定します。

```json
{
  "rakutenSelf": "本人向け詳細ラベル名",
  "rakutenAlertSelf": "本人向け速報ラベル名",
  "rakutenFamily": "家族向け詳細ラベル名",
  "rakutenAlertFamily": "家族向け速報ラベル名",
  "rakutenPay": "楽天ペイ通知ラベル名",
  "amazonCard": "Amazonカード通知ラベル名"
}
```

スクリプトプロパティは同じGASプロジェクトの編集者間で共有されます。Gmail通知は `forwardEmailToLine` を時間主導トリガーに登録して実行します。

## Webhookの現在の制限

`webhook.js` の `doPost(e)` は受信したJSONを処理しますが、LINEの `X-Line-Signature` を検証していません。[Apps Scriptのウェブアプリのイベントオブジェクト](https://developers.google.com/apps-script/guides/web)には受信HTTPヘッダーが含まれないため、このGASウェブアプリでは署名を確認できません。[LINEはイベント処理前の署名検証を求めています](https://developers.line.biz/ja/docs/messaging-api/verify-webhook-signature/)。現行の公開URLには、LINE以外からのリクエストも到達し得ます。署名を検証できる受信構成への変更は別作業です。

## ウェブアプリの初回デプロイ

1. このディレクトリで `npx --yes @google/clasp@3.4.1 push` を実行し、`doPost` と `doGet` を含むソースをGASプロジェクトへ同期します。
2. GASエディタで「デプロイ」→「新しいデプロイ」を開き、種類の選択から「ウェブアプリ」を選びます。
3. 実行ユーザーをデプロイするユーザーにし、アクセスできるユーザーを匿名アクセスを含む「全員」に設定してデプロイします。`appsscript.json` の `webapp.executeAs` は `USER_DEPLOYING`、`webapp.access` は `ANYONE_ANONYMOUS` です。LINEからGoogleアカウントへのログインなしで到達できる設定が必要です。
4. 発行されたウェブアプリURLをコピーします。LINE DevelopersコンソールでMessaging APIチャネルの「Messaging API設定」→「Webhook URL」に登録して「検証」を実行し、「Webhookの利用」を有効にします。

操作画面は[Googleのウェブアプリ公開手順](https://developers.google.com/apps-script/guides/web)と[LINEのWebhook URL設定手順](https://developers.line.biz/ja/docs/messaging-api/building-bot/)を参照してください。

## ソース変更とウェブアプリ更新

このディレクトリで `npx --yes @google/clasp@3.4.1 push` を実行すると、ローカルのソースがGASプロジェクトへ同期されます。`clasp push` だけでは、公開済みウェブアプリのコードは更新されません。

Webhook用の `doPost` または `doGet` のコード変更を公開済みウェブアプリへ反映する場合は、GASの「デプロイ」→「デプロイを管理」で**既存のウェブアプリデプロイを新しいバージョンに更新**します。同じデプロイを更新する場合、ウェブアプリURLは維持されます。操作は[Google Apps Scriptのデプロイ管理ガイド](https://developers.google.com/apps-script/concepts/deployments)にも記載されています。時間主導トリガーは既存の設定を引き続き使用できます。

**LINE DevelopersのWebhook URLは、実際のウェブアプリURLが変わった場合にだけ変更**します。スクリプトプロパティの値の変更、`clasp push`、同じデプロイの新バージョンへの更新では、URLを変更しません。

## ローカル検証

```bash
node test.cjs
```
