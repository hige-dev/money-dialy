const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : ['2026-10-19T12:00:00Z']));
  }
  static now() {
    return RealDate.parse('2026-10-19T12:00:00Z');
  }
}

const sent = [];
const forwardedFromById = {};
const read = [];
const deletedTriggers = [];
const scriptProperties = new Map([
  ['BACKEND_URL', '設定済み'],
  ['WEBHOOK_SECRET', '設定済み'],
  ['GMAIL_IMPORT_LAST_SCAN_AT', '2026-09-25T11:55:00.000Z'],
  ['AU_PAY_FORWARD_TO', ' User+AuPay@example.com '],
]);
const triggers = [
  { handlerFunction: 'processRakutenCardEmails', getHandlerFunction() { return this.handlerFunction; } },
  { handlerFunction: 'processPaymentEmails', getHandlerFunction() { return this.handlerFunction; } },
  { handlerFunction: 'forwardEmailToLine', getHandlerFunction() { return this.handlerFunction; } },
];
let searchQuery;
const searchCalls = [];
function message(id, subject, from, body = '利用明細', unread = true, date = '2026-09-25T12:00:00Z', to = 'user@example.com', deliveredTo = '') {
  return {
    getTo: () => to,
    getHeader: name => (name === 'Delivered-To' ? deliveredTo : ''),
    isUnread: () => unread,
    getId: () => id,
    getSubject: () => subject,
    getFrom: () => from,
    getDate: () => new Date(date),
    getPlainBody: () => {
      assert.equal(searchCalls.length, 2);
      return body;
    },
    markRead: () => {
      assert.equal(searchCalls.length, 2);
      read.push(id);
    },
  };
}
const messages = [
  message('速報', '【速報版】カード利用のお知らせ(本人ご利用分)', '楽天カード株式会社 <info@mail.rakuten-card.co.jp>'),
  message('詳細', 'カード利用のお知らせ(家族会員ご利用分)', 'info@mail.rakuten-card.co.jp'),
  message('三井住友送信元', 'ご利用のお知らせ【三井住友カード】', 'Vpass <notice@vpass.ne.jp>'),
  message('三井住友本文', 'ご利用のお知らせ【三井住友カード】', 'notice@example.com', '三井住友カードをご利用いただきありがとうございます。'),
  message('楽天ペイ', '楽天ペイお支払い完了のお知らせ【楽天ペイアプリ】', '楽天ペイ <no-reply@pay.rakuten.co.jp>', '利用明細', false, '2026-10-15T02:12:00Z'),
  message('au PAY', '【au PAY】ご利用のお知らせ [メールコードP1001]', 'info@wallet.auone.jp'),
  message('au PAY表示名付き', '【au PAY】ご利用のお知らせ [メールコードP1001]', 'au PAY <info@wallet.auone.jp>'),
  message('偽装', '【速報版】カード利用のお知らせ(本人ご利用分)', '偽装 <info@mail.rakuten-card.co.jp.evil.example>'),
  message('別件', '別の件名', '楽天カード株式会社 <info@mail.rakuten-card.co.jp>'),
  message('三井住友送信元不一致', 'ご利用のお知らせ【三井住友カード】', 'notice@example.com', '別のサービスのメールです。'),
  message('三井住友件名不一致', 'ご利用のお知らせ', 'notice@vpass.ne.jp', '三井住友カードをご利用いただきありがとうございます。'),
  message('楽天ペイ送信元不一致', '楽天ペイお支払い完了のお知らせ【楽天ペイアプリ】', 'notice@example.com'),
  message('楽天ペイ件名不一致', 'お支払い完了のお知らせ', '楽天ペイ <no-reply@pay.rakuten.co.jp>'),
  message('au PAY送信元不一致', '【au PAY】ご利用のお知らせ [メールコードP1001]', 'notice@example.com'),
  message('au PAY送信元偽装', '【au PAY】ご利用のお知らせ [メールコードP1001]', 'au PAY <info@wallet.auone.jp.evil.example>'),
  message('au PAY件名不一致', '【au PAY】チャージのお知らせ', 'info@wallet.auone.jp'),
  message('au PAYメールコード不一致', '【au PAY】ご利用のお知らせ [メールコードP1002]', 'info@wallet.auone.jp'),
];
// 同じ件名の転送メールは1スレッドにまとまる
const forwardedMessages = [
  message('au PAY転送', 'Fwd: 【au PAY】ご利用のお知らせ [メールコードP1001]', '転送者 <forwarder@example.com>', '利用明細', true, '2026-09-25T12:00:00Z', '取込用 <user+aupay@example.com>'),
  message('au PAY転送引用符付き宛先', 'FW: 【au PAY】ご利用のお知らせ [メールコードP1001]', 'other-forwarder@example.com', '利用明細', true, '2026-09-25T12:00:00Z', '"user+aupay@example.com" <user+aupay@example.com>'),
  message('au PAY転送配送先', 'FW: 【au PAY】ご利用のお知らせ [メールコードP1001]', 'forwarder@example.com', '利用明細', true, '2026-09-25T12:00:00Z', 'other@example.com', 'user+aupay@example.com'),
  message('au PAY転送宛先不一致', 'Fwd: 【au PAY】ご利用のお知らせ [メールコードP1001]', 'forwarder@example.com', '利用明細', true, '2026-09-25T12:00:00Z', 'user@example.com'),
  message('au PAY転送宛先偽装', 'Fwd: 【au PAY】ご利用のお知らせ [メールコードP1001]', 'forwarder@example.com', '利用明細', true, '2026-09-25T12:00:00Z', 'user+aupay@example.com.evil.example'),
  message('au PAY転送元偽装', 'Fwd: 【au PAY】ご利用のお知らせ [メールコードP1001]', '"forwarder@example.com" <evil@example.com>', '利用明細', true, '2026-09-25T12:00:00Z', 'user@example.com'),
  message('au PAY転送件名不一致', 'Fwd: 【au PAY】チャージのお知らせ', 'forwarder@example.com', '利用明細', true, '2026-09-25T12:00:00Z', 'user+aupay@example.com'),
];
const staleMessage = message(
  '前回処理済み',
  'ご利用のお知らせ【三井住友カード】',
  'Vpass <notice@vpass.ne.jp>',
  '利用明細',
  true,
  '2026-09-25T11:49:00Z',
);
const invalidSmbcThreads = Array.from({ length: 20 }, (_, index) => ({
  getMessages: () => [message(
    `SMBC無効${index}`,
    'ご利用のお知らせ【三井住友カード】',
    'notice@example.com',
    '別のサービスのメールです。',
  )],
  addLabel: () => {},
}));
const messageThreads = messages.map(currentMessage => ({
  getMessages: () => [currentMessage],
  addLabel: () => {},
}));
messageThreads.push({
  getMessages: () => forwardedMessages,
  addLabel: () => {},
});
messageThreads[0] = {
  getMessages: () => [messages[0], staleMessage],
  addLabel: () => {},
};
const context = {
  Date: FixedDate,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => scriptProperties.get(key) ?? null,
      setProperty: (key, value) => scriptProperties.set(key, value),
    }),
  },
  GmailApp: {
    search: (query, start, max) => {
      searchQuery = query;
      searchCalls.push({ query, start, max });
      if (start === 0) return invalidSmbcThreads;
      if (start === 20) return messageThreads;
      return [];
    },
    getUserLabelByName: () => ({}),
  },
  UrlFetchApp: {
    fetch: (_url, options) => {
      assert.equal(searchCalls.length, 2);
      const gmail = JSON.parse(options.payload).gmail;
      sent.push(gmail.messageId);
      forwardedFromById[gmail.messageId] = gmail.forwardedFrom;
      return { getResponseCode: () => 200, getContentText: () => '{"success":true}' };
    },
  },
  Logger: { log: () => {} },
  LockService: {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
  },
  ScriptApp: {
    getProjectTriggers: () => [...triggers],
    deleteTrigger: trigger => {
      deletedTriggers.push(trigger.handlerFunction);
      triggers.splice(triggers.indexOf(trigger), 1);
    },
    newTrigger: handlerFunction => ({
      timeBased: () => ({
        everyHours: hours => ({
          create: () => {
            triggers.push({ handlerFunction, getHandlerFunction() { return this.handlerFunction; }, hours });
          },
        }),
      }),
    }),
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.js'), 'utf8'), context);
assert.equal(context.isRakutenCardSender('楽天カード株式会社 <info@mail.rakuten-card.co.jp>'), true);
assert.equal(context.isRakutenCardSender('info@mail.rakuten-card.co.jp'), true);
assert.equal(context.isRakutenCardSender('偽装 <info@mail.rakuten-card.co.jp.evil.example>'), false);
context.processPaymentEmails();
assert.deepEqual(sent, ['速報', '詳細', '三井住友送信元', '三井住友本文', '楽天ペイ', 'au PAY', 'au PAY表示名付き', 'au PAY転送', 'au PAY転送引用符付き宛先', 'au PAY転送配送先']);
assert.equal(sent.includes('前回処理済み'), false);
assert.deepEqual(read, ['速報', '詳細', '三井住友送信元', '三井住友本文', '楽天ペイ', 'au PAY', 'au PAY表示名付き', 'au PAY転送', 'au PAY転送引用符付き宛先', 'au PAY転送配送先']);
assert.deepEqual(
  searchCalls.map(({ start, max }) => [start, max]),
  [[0, 20], [20, 20]],
);
assert.equal(searchCalls.every(call => call.query === searchQuery), true);
assert.equal(searchQuery.startsWith('after:2026/09/23 '), true);
assert.equal(searchQuery.includes('is:unread'), false);
assert.equal(searchQuery.includes('ProcessedForLINE'), false);
assert.equal(searchQuery.includes('joe.yshr380'), false);
assert.equal(
  searchQuery.includes('((from:info@wallet.auone.jp OR ({to:user+aupay@example.com deliveredto:user+aupay@example.com})) subject:"【au PAY】ご利用のお知らせ [メールコードP1001]")'),
  true,
);
assert.equal(forwardedFromById['au PAY転送'], 'info@wallet.auone.jp');
assert.equal(forwardedFromById['au PAY転送引用符付き宛先'], 'info@wallet.auone.jp');
assert.equal(forwardedFromById['au PAY転送配送先'], 'info@wallet.auone.jp');
assert.equal(forwardedFromById['au PAY'], undefined);
assert.equal(forwardedFromById['楽天ペイ'], undefined);
assert.equal(new Date(scriptProperties.get('GMAIL_IMPORT_LAST_SCAN_AT')).getTime() > Date.parse('2026-09-25T11:55:00.000Z'), true);

const baseSent = ['速報', '詳細', '三井住友送信元', '三井住友本文', '楽天ペイ', 'au PAY', 'au PAY表示名付き'];
function runWithForwardConfig(forwardFrom, forwardTo) {
  for (const [name, value] of [['AU_PAY_FORWARD_FROM', forwardFrom], ['AU_PAY_FORWARD_TO', forwardTo]]) {
    if (value === null) scriptProperties.delete(name);
    else scriptProperties.set(name, value);
  }
  scriptProperties.set('GMAIL_IMPORT_LAST_SCAN_AT', '2026-09-25T11:55:00.000Z');
  sent.length = 0;
  read.length = 0;
  searchCalls.length = 0;
  context.processPaymentEmails();
}

// 転送元だけを設定した場合は、転送元のアドレスで判定する。表示名にアドレスを書いた偽装は対象外
runWithForwardConfig(' Forwarder@Example.com ', null);
assert.deepEqual(sent, [...baseSent, 'au PAY転送', 'au PAY転送配送先', 'au PAY転送宛先不一致', 'au PAY転送宛先偽装']);
assert.equal(searchQuery.includes('((from:info@wallet.auone.jp OR (from:forwarder@example.com)) subject:"【au PAY】ご利用のお知らせ [メールコードP1001]")'), true);
assert.equal(forwardedFromById['au PAY転送宛先不一致'], 'info@wallet.auone.jp');

// 転送元と転送先を両方設定した場合は、両方に一致したメールだけを取り込む
runWithForwardConfig('forwarder@example.com', 'user+aupay@example.com');
assert.deepEqual(sent, [...baseSent, 'au PAY転送', 'au PAY転送配送先']);
assert.equal(searchQuery.includes('((from:info@wallet.auone.jp OR (from:forwarder@example.com {to:user+aupay@example.com deliveredto:user+aupay@example.com})) subject:"【au PAY】ご利用のお知らせ [メールコードP1001]")'), true);

// 未設定、またはどちらかが不正な場合は、転送メールを取り込まない
for (const [forwardFrom, forwardTo] of [
  [null, null],
  [null, 'user+aupay@example.com} OR {is:unread'],
  ['forwarder@example.com OR is:unread', null],
  ['不正な値', 'user+aupay@example.com'],
]) {
  runWithForwardConfig(forwardFrom, forwardTo);
  assert.deepEqual(sent, baseSent);
  assert.equal(searchQuery.includes('(from:info@wallet.auone.jp subject:"【au PAY】ご利用のお知らせ [メールコードP1001]")'), true);
  assert.equal(searchQuery.includes('deliveredto:'), false);
}
scriptProperties.delete('AU_PAY_FORWARD_FROM');
scriptProperties.set('AU_PAY_FORWARD_TO', 'user+aupay@example.com');

scriptProperties.delete('GMAIL_IMPORT_LAST_SCAN_AT');
sent.length = 0;
read.length = 0;
searchCalls.length = 0;
context.processRakutenCardEmails();
assert.equal(searchQuery.startsWith('{is:unread after:2026/10/10} '), true);
assert.deepEqual(sent, ['速報', '前回処理済み', '詳細', '三井住友送信元', '三井住友本文', '楽天ペイ', 'au PAY', 'au PAY表示名付き', 'au PAY転送', 'au PAY転送引用符付き宛先', 'au PAY転送配送先']);
assert.equal(sent.includes('楽天ペイ'), true);
assert.equal(read.includes('楽天ペイ'), true);

context.createTimeDrivenTrigger();
assert.deepEqual(deletedTriggers, ['processRakutenCardEmails', 'processPaymentEmails']);
assert.equal(triggers.some(trigger => trigger.handlerFunction === 'processRakutenCardEmails'), false);
assert.equal(triggers.some(trigger => trigger.handlerFunction === 'forwardEmailToLine'), true);
assert.equal(triggers.filter(trigger => trigger.handlerFunction === 'processPaymentEmails').length, 1);
assert.equal(triggers.find(trigger => trigger.handlerFunction === 'processPaymentEmails').hours, 1);

context.createTimeDrivenTrigger();
assert.equal(triggers.filter(trigger => trigger.handlerFunction === 'processPaymentEmails').length, 1);
assert.equal(triggers.some(trigger => trigger.handlerFunction === 'forwardEmailToLine'), true);

triggers.push({ handlerFunction: 'processRakutenCardEmails', getHandlerFunction() { return this.handlerFunction; } });
context.deleteTriggers();
assert.equal(triggers.some(trigger => trigger.handlerFunction === 'processPaymentEmails'), false);
assert.equal(triggers.some(trigger => trigger.handlerFunction === 'processRakutenCardEmails'), false);
assert.equal(triggers.some(trigger => trigger.handlerFunction === 'forwardEmailToLine'), true);
console.log('4系統の対象判定、au PAY転送メールの転送元・転送先判定、既読メールの差分取込、初回7日分の補完、ページング、旧トリガー互換、トリガー管理: 成功');
