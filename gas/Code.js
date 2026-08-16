/**
 * Money Diary - Gmail クレカ利用通知自動取得 GAS スクリプト
 */

// スクリプトプロパティから設定を取得
function getScriptConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    backendUrl: props.getProperty('BACKEND_URL'),
    webhookSecret: props.getProperty('WEBHOOK_SECRET')
  };
}

/**
 * 初回セットアップ用: スクリプトプロパティを設定
 * @param {string} backendUrl - Lambda Function URL (例: https://xxxx.lambda-url.ap-northeast-1.on.aws/)
 * @param {string} webhookSecret - template.yaml の WebhookSecret に設定した共通シークレット
 */
function setConfig(backendUrl, webhookSecret) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('BACKEND_URL', backendUrl);
  props.setProperty('WEBHOOK_SECRET', webhookSecret);
  Logger.log('スクリプトプロパティを設定しました。');
}

/**
 * 未読の楽天カード利用メールを検索し、バックエンド API に送信する
 */
function processRakutenCardEmails() {
  const config = getScriptConfig();
  if (!config.backendUrl || !config.webhookSecret) {
    Logger.log('ERROR: BACKEND_URL または WEBHOOK_SECRET が未設定です。setConfig(url, secret) を実行してください。');
    return;
  }

  // 未読の楽天カードメールを検索
  const query = 'label:unread (from:info@mail.rakuten-card.co.jp OR subject:"カード利用のお知らせ")';
  const threads = GmailApp.search(query, 0, 20);
  const labelProcessed = getOrCreateLabel('処理済み');

  let successCount = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const message of messages) {
      if (!message.isUnread()) continue;

      const payload = {
        action: 'webhookGmail',
        gmail: {
          messageId: message.getId(),
          date: message.getDate().toISOString(),
          subject: message.getSubject(),
          body: message.getPlainBody(),
          from: message.getFrom()
        }
      };

      const options = {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'X-Webhook-Secret': config.webhookSecret
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      try {
        const response = UrlFetchApp.fetch(config.backendUrl, options);
        const code = response.getResponseCode();
        const resText = response.getContentText();

        if (code === 200) {
          Logger.log(`[OK] Message ID: ${message.getId()} - ${message.getSubject()}`);
          message.markRead();
          thread.addLabel(labelProcessed);
          successCount++;
        } else {
          Logger.log(`[FAIL] Code: ${code}, Body: ${resText}`);
        }
      } catch (e) {
        Logger.log(`[ERROR] Fetch failed: ${e.toString()}`);
      }
    }
  }

  Logger.log(`完了: ${successCount} 件のメールを処理しました。`);
}

/**
 * ラベルを取得（存在しなければ作成）
 */
function getOrCreateLabel(name) {
  let label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
  }
  return label;
}

/**
 * 定期実行トリガーの登録 (15分置きに実行)
 */
function createTimeDrivenTrigger() {
  // 既存トリガーの重複登録を防止
  deleteTriggers();

  ScriptApp.newTrigger('processRakutenCardEmails')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('15分おきの自動実行トリガーを作成しました。');
}

/**
 * 登録済みトリガーの削除
 */
function deleteTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'processRakutenCardEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  Logger.log('既存のトリガーを削除しました。');
}
