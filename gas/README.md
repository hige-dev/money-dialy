# Google Apps Script プロジェクト

このディレクトリには、用途ごとに独立したGASプロジェクトがあります。設定と反映手順は各プロジェクトのREADMEを参照してください。

| プロジェクト | 処理 | 手順 |
| --- | --- | --- |
| [Gmail取込](gmail-import/README.md) | カード利用通知をGmailから取得してLambdaへ送信 | Clasp設定、スクリプトプロパティ、時間主導トリガー |
| [LINE通知](line-notifier/README.md) | 取込済みメールをLINEへ通知し、Webhookを受け付ける | LINE設定、ソース反映、ウェブアプリ更新 |

Gmail取込の対象メール、分類と照合の仕様は[メール自動取込の説明](../docs/gmail-import.md)を参照してください。
