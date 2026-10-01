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
    Logger.log('設定エラー: BACKEND_URL または WEBHOOK_SECRET が未設定です。setConfig(url, secret) を実行してください。');
    return;
  }

  // 対象の件名を配列で定義
  const TARGET_SUBJECTS = [
    'カード利用のお知らせ(家族会員ご利用分)',
    'カード利用のお知らせ(本人ご利用分)',
    '【速報版】カード利用のお知らせ(家族会員ご利用分)',
    '【速報版】カード利用のお知らせ(本人ご利用分)'
  ];

  // OR条件を用いてGmail内を検索
  const subjectsQuery = TARGET_SUBJECTS.map(sub => `subject:"${sub}"`).join(' OR ');

  // 1. これまでの条件をまとめる
  const baseConditions = [
    'is:unread',
    'label:ProcessedForLINE',
    'from:info@mail.rakuten-card.co.jp',
    `(${subjectsQuery})`
  ].join(' ');

const TARGET_EMAILS = [
  'joe.yshr380+rpay@gmail.com',
  'joe.yshr380+amazon@gmail.com'
];

const targetEmailQuery = TARGET_EMAILS.map(sub => `"${sub}"`).join(' OR '); // Use plain email strings to avoid '+' parsing issues

const baseConditions2 = [
    'is:unread',
    'label:ProcessedForLINE',
    `(${targetEmailQuery})`
  ].join(' ');

  // 2. 全体をカッコで囲んで OR 条件を追加
  const query = `(${baseConditions}) OR (${baseConditions2})`;

  Logger.log(`検索条件: ${query}`);

  const threads = GmailApp.search(query, 0, 20);
  const labelProcessed = getOrCreateLabel('処理済み');

  let successCount = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const message of messages) {
      if (!message.isUnread()) continue;

      // 件名がいずれかの対象件名と完全一致するものだけ処理
      const subject = message.getSubject().trim();
      if (!TARGET_SUBJECTS.includes(subject) || !isRakutenSender(message.getFrom())) {
        continue;
      }

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
        let isSuccess = false;
        let jsonRes = null;

        if (code === 200) {
          try {
            jsonRes = JSON.parse(resText);
            if (jsonRes && jsonRes.success === true) {
              isSuccess = true;
            }
          } catch (err) {
            // JSON 以外のレスポンス（HTML等）は失敗扱い
            isSuccess = false;
          }
        }

        if (isSuccess) {
          Logger.log(`取込成功: ${message.getId()} - ${message.getSubject()}`);
          message.markRead();
          thread.addLabel(labelProcessed);
          successCount++;
        } else {
          Logger.log(`取込失敗: HTTP ${code}、JSON応答 ${jsonRes !== null}、内容 ${resText.substring(0, 150)}`);
        }
      } catch (e) {
        Logger.log(`送信失敗: ${e.toString()}`);
      }
    }
  }

  Logger.log(`完了: ${successCount} 件のメールを処理しました。`);
}

function isRakutenSender(from) {
  return /(?:^|<)info@mail\.rakuten-card\.co\.jp(?:>|$)/i.test(from.trim());
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
 * 定期実行トリガーの登録 (1時間置きに実行)
 */
function createTimeDrivenTrigger() {
  // 既存トリガーの重複登録を防止
  deleteTriggers();

  ScriptApp.newTrigger('processRakutenCardEmails')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('1時間おきの自動実行トリガーを作成しました。');
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
