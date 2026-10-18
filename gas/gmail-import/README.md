# Gmail取込 GAS

カード利用通知をGmailから取得し、LambdaのGmail Webhookへ送信するGASプロジェクトです。[取込対象と照合の仕様](../../docs/gmail-import.md)も参照してください。

## ファイル

- `Code.js`: メール検索、Webhook送信、処理済みメールの既読化とラベル付与、トリガー登録
- `appsscript.json`: 実行環境と権限の設定
- `.clasp.json.example`: ローカルClasp設定のひな型
- `package.json`: Claspコマンド
- `Code.test.cjs`: 対象件名、送信元、本文判定のローカルテスト

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

GASエディタのトリガー画面から `processPaymentEmails` を時間主導で登録できます。`createTimeDrivenTrigger` を実行すると、同関数の既存トリガーを削除して1時間ごとのトリガーを登録します。`deleteTriggers` は同関数の既存トリガーを削除します。初回実行では未読メールに加えて直近7日以内の既読メールを処理し、2回目以降は前回の処理時刻の5分前以降に届いた対象メールを既読・未読を問わず処理します。取込対象の条件は次のとおりです。

- 楽天カード: 送信元が `info@mail.rakuten-card.co.jp` で、件名が次のいずれかと完全一致するメール。
  - `カード利用のお知らせ(家族会員ご利用分)`
  - `カード利用のお知らせ(本人ご利用分)`
  - `【速報版】カード利用のお知らせ(家族会員ご利用分)`
  - `【速報版】カード利用のお知らせ(本人ご利用分)`
- 三井住友カード: 件名に `ご利用のお知らせ【三井住友カード】` を含み、送信元に `vpass.ne.jp`、`smbc-card.com`、`smbc.co.jp` のいずれかを含むか、本文に `三井住友カード` を含むメール。
- 楽天ペイ: 送信元に `no-reply@pay.rakuten.co.jp` または `pay.rakuten.co.jp` を含み、件名に `楽天ペイお支払い完了のお知らせ` または `楽天ペイアプリ` を含むメール。
- au PAY: 送信元が `info@wallet.auone.jp` で、件名に `【au PAY】ご利用のお知らせ [メールコードP1001]` を含むメール。バックエンドは本文の種別が `支払` の明細を取り込みます。

Gmail検索は20スレッドずつ行い、全ページの検索結果を収集してから各メールを処理します。検索条件は前回時刻より2日分広く取り、メールごとに前回時刻の5分前以降かを判定します。

前回の処理時刻はスクリプトプロパティ `GMAIL_IMPORT_LAST_SCAN_AT` に自動保存します。初回実行では直近7日より前の既読メールは取り込みません。Webhook送信に失敗した場合は、最も早い失敗メールの5分前まで時刻を戻して次回再試行します。成功済みメールが再送されても、バックエンドはGmailメッセージIDで重複登録を防ぎます。

`ProcessedForLINE` ラベルは取込条件に含みません。バックエンドが成功応答を返すと、メールを既読化してスレッドへ `処理済み` ラベルを付けます。このラベルをLINE通知処理が取込成功の印として検索します。

スクリプトプロパティの値だけを変更する場合、ソースの再同期は不要です。

## ローカル検証

```bash
node Code.test.cjs
```
