/**
 * Money Diary - Gmail クレカ利用通知自動取得 GAS スクリプト
 */

const RAKUTEN_CARD_SUBJECTS = [
  'カード利用のお知らせ(家族会員ご利用分)',
  'カード利用のお知らせ(本人ご利用分)',
  '【速報版】カード利用のお知らせ(家族会員ご利用分)',
  '【速報版】カード利用のお知らせ(本人ご利用分)'
];
const SMBC_SUBJECT_PHRASE = 'ご利用のお知らせ【三井住友カード】';
const RAKUTEN_PAY_SUBJECT_PHRASES = [
  '楽天ペイお支払い完了のお知らせ',
  '楽天ペイアプリ'
];

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
 * 未読の利用通知メールを検索し、バックエンド API に送信する
 */
function processRakutenCardEmails() {
  const config = getScriptConfig();
  if (!config.backendUrl || !config.webhookSecret) {
    Logger.log('設定エラー: BACKEND_URL または WEBHOOK_SECRET が未設定です。setConfig(url, secret) を実行してください。');
    return;
  }

  const rakutenSubjectsQuery = RAKUTEN_CARD_SUBJECTS
    .map(subject => `subject:"${subject}"`)
    .join(' OR ');
  const smbcQuery = `subject:"${SMBC_SUBJECT_PHRASE}" {from:vpass.ne.jp from:smbc-card.com from:smbc.co.jp "三井住友カード"}`;
  const rakutenPaySubjectsQuery = RAKUTEN_PAY_SUBJECT_PHRASES
    .map(phrase => `subject:"${phrase}"`)
    .join(' OR ');
  const query = [
    'is:unread',
    `((from:info@mail.rakuten-card.co.jp (${rakutenSubjectsQuery})) OR (${smbcQuery}) OR (from:pay.rakuten.co.jp (${rakutenPaySubjectsQuery})))`
  ].join(' ');

  Logger.log(`検索条件: ${query}`);

  const pageSize = 20;
  const threads = [];
  let start = 0;
  while (true) {
    const page = GmailApp.search(query, start, pageSize);
    threads.push(...page);
    if (page.length < pageSize) break;
    start += page.length;
  }

  const labelProcessed = getOrCreateLabel('処理済み');

  let successCount = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const message of messages) {
      if (!message.isUnread()) continue;

      const subject = message.getSubject().trim();
      const from = message.getFrom();
      const body = message.getPlainBody();
      if (!isSupportedImportEmail(from, subject, body)) {
        continue;
      }

      const payload = {
        action: 'webhookGmail',
        gmail: {
          messageId: message.getId(),
          date: message.getDate().toISOString(),
          subject: message.getSubject(),
          body,
          from
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

function isSmbcEmail(from, subject, body) {
  const isSmbcSender = from.includes('vpass.ne.jp') ||
    from.includes('smbc-card.com') ||
    from.includes('smbc.co.jp');
  return subject.trim().includes(SMBC_SUBJECT_PHRASE) &&
    (isSmbcSender || body.includes('三井住友カード'));
}

function isRakutenPayEmail(from, subject) {
  const isRakutenPaySender = from.includes('no-reply@pay.rakuten.co.jp') ||
    from.includes('pay.rakuten.co.jp');
  const hasRakutenPaySubject = RAKUTEN_PAY_SUBJECT_PHRASES.some(phrase => subject.includes(phrase));
  return isRakutenPaySender && hasRakutenPaySubject;
}

function isSupportedImportEmail(from, subject, body) {
  const isRakutenCardEmail = RAKUTEN_CARD_SUBJECTS.includes(subject.trim()) && isRakutenSender(from);
  return isRakutenCardEmail ||
    isSmbcEmail(from, subject, body) ||
    isRakutenPayEmail(from, subject);
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
