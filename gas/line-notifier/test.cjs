const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const labelsJson = JSON.stringify({
  rakutenSelf: 'test/rakuten/self/detail',
  rakutenAlertSelf: 'test/rakuten/self/alert',
  rakutenFamily: 'test/rakuten/family/detail',
  rakutenAlertFamily: 'test/rakuten/family/alert',
  rakutenPay: 'test/rakuten/pay',
  amazonCard: 'test/card/amazon'
});
const scriptProperties = new Map(Object.entries({
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token-only',
  LINE_GROUP_ID: 'test-group-only',
  LINE_GMAIL_LABELS_JSON: labelsJson
}));
const fetches = [];
const logs = [];
const queries = [];
const addedLabels = [];
const context = {
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => scriptProperties.has(key) ? scriptProperties.get(key) : null,
      setProperty: (key, value) => scriptProperties.set(key, String(value))
    })
  },
  GmailApp: {
    search: (query, start) => {
      queries.push(query);
      if (query.includes('is:unread') || start > 0) return [];
      return [testThread];
    },
    getUserLabelByName: () => null,
    createLabel: name => ({ name })
  },
  UrlFetchApp: {
    fetch: (url, options) => {
      fetches.push({ url, options });
      return { getResponseCode: () => 200 };
    }
  },
  LockService: {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
  },
  Utilities: { formatDate: () => '2026/10/01 12:00' },
  Logger: { log: message => logs.push(String(message)) },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: text => ({ text, setMimeType: () => ({ text }) })
  },
  JSON,
  Date,
  Set,
  Map,
  Array,
  Number,
  Math
};

const directory = __dirname;
vm.createContext(context);
for (const filename of ['Config.js', 'EmailForward.js', 'webhook.js']) {
  vm.runInContext(fs.readFileSync(path.join(directory, filename), 'utf8'), context, {
    filename
  });
}

const configuration = context.getLineConfiguration();
assert.equal(configuration.groupId, 'test-group-only');
assert.equal(configuration.notificationTargets.length, 6);

const detailSelf = configuration.notificationTargets[0].gmailLabel;
const alertSelf = configuration.notificationTargets[1].gmailLabel;
const detailFamily = configuration.notificationTargets[2].gmailLabel;
const alertFamily = configuration.notificationTargets[3].gmailLabel;
const rakutenPay = configuration.notificationTargets[4].gmailLabel;
const amazonCard = configuration.notificationTargets[5].gmailLabel;
const imported = configuration.importSuccessLabel;
assert.equal(context.isLineNotificationTarget(
  'カード利用のお知らせ(本人ご利用分)', [detailSelf, imported], true, configuration
), true);
assert.equal(context.isLineNotificationTarget(
  '【速報版】カード利用のお知らせ(本人ご利用分)', [alertSelf, imported], true, configuration
), true);
assert.equal(context.isLineNotificationTarget(
  '【速報版】カード利用のお知らせ(本人ご利用分)', [detailSelf, imported], true, configuration
), false);
assert.equal(context.isLineNotificationTarget(
  'カード利用のお知らせ(家族会員ご利用分)', [alertFamily, imported], true, configuration
), false);
assert.equal(context.isLineNotificationTarget(
  '【速報版】カード利用のお知らせ(家族会員ご利用分)', [alertFamily, imported], true, configuration
), true);
assert.equal(context.isLineNotificationTarget(
  'カード利用のお知らせ(家族会員ご利用分)', [detailFamily, imported], true, configuration
), true);
assert.equal(context.isLineNotificationTarget(
  '楽天ペイお支払い完了のお知らせ【楽天ペイアプリ】',
  [rakutenPay, imported], true, configuration
), true);
assert.equal(context.isLineNotificationTarget(
  'ご利用のお知らせ【三井住友カード】',
  [amazonCard, imported], true, configuration
), true);
assert.equal(context.isLineNotificationTarget(
  'カード利用のお知らせ(本人ご利用分)', [detailSelf], true, configuration
), false);
assert.equal(context.isEligibleForLineNotification(
  'カード利用のお知らせ(本人ご利用分)', true, [detailSelf, imported], configuration
), false);

scriptProperties.delete('LINE_GROUP_ID');
assert.throws(() => context.getLineConfiguration(), /LINE_GROUP_ID/);
scriptProperties.set('LINE_GROUP_ID', 'test-group-only');
scriptProperties.delete('LINE_GMAIL_LABELS_JSON');
assert.throws(() => context.getLineConfiguration(), /LINE_GMAIL_LABELS_JSON/);
scriptProperties.set('LINE_GMAIL_LABELS_JSON', labelsJson);

const cursor = Date.now() - 60000;
scriptProperties.set('LAST_PROCESSED_TIME_MS', String(cursor));
const alertMessage = {
  isUnread: () => false,
  getId: () => 'test-alert-message',
  getSubject: () => '【速報版】カード利用のお知らせ(本人ご利用分)',
  getFrom: () => 'test sender',
  getDate: () => new Date(cursor + 5000),
  getPlainBody: () => 'テスト本文'
};
const testThread = {
  getLabels: () => [alertSelf, imported].map(name => ({ getName: () => name })),
  getMessages: () => [alertMessage],
  addLabel: label => addedLabels.push(label.name)
};
context.forwardEmailToLineWithLock();
assert.ok(queries.some(query => query.includes(`label:${imported}`)));
assert.deepEqual(addedLabels, ['ProcessedForLINE']);
assert.equal(fetches.at(-1).options.headers.Authorization, 'Bearer test-token-only');
assert.equal(JSON.parse(fetches.at(-1).options.payload).to, 'test-group-only');
assert.ok(scriptProperties.get('LINE_SENT_MESSAGE_IDS_V1').includes('test-alert-message'));

const webhookGroupId = 'test-webhook-group-only';
const webhookBody = JSON.stringify({
  events: [{ source: { type: 'group', groupId: webhookGroupId } }]
});
context.doPost({ postData: { contents: webhookBody } });
assert.ok(!logs.join('\n').includes(webhookGroupId));
assert.ok(!logs.join('\n').includes('test-token-only'));
assert.ok(!logs.join('\n').includes(webhookBody));

console.log('設定読込、速報・詳細判定、通知送信、Webhookログの確認: 成功');
