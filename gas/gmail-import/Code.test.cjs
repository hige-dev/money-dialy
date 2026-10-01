const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const sent = [];
const read = [];
let searchQuery;
function message(id, subject, from) {
  return {
    isUnread: () => true,
    getId: () => id,
    getSubject: () => subject,
    getFrom: () => from,
    getDate: () => new Date('2026-09-25T00:00:00Z'),
    getPlainBody: () => '利用明細',
    markRead: () => read.push(id),
  };
}
const messages = [
  message('速報', '【速報版】カード利用のお知らせ(本人ご利用分)', '楽天カード株式会社 <info@mail.rakuten-card.co.jp>'),
  message('詳細', 'カード利用のお知らせ(家族会員ご利用分)', 'info@mail.rakuten-card.co.jp'),
  message('偽装', '【速報版】カード利用のお知らせ(本人ご利用分)', '偽装 <info@mail.rakuten-card.co.jp.evil.example>'),
  message('別件', '別の件名', '楽天カード株式会社 <info@mail.rakuten-card.co.jp>'),
];
const context = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '設定済み' }) },
  GmailApp: {
    search: (query) => {
      searchQuery = query;
      return [{ getMessages: () => messages, addLabel: () => {} }];
    },
    getUserLabelByName: () => ({}),
  },
  UrlFetchApp: {
    fetch: (_url, options) => {
      sent.push(JSON.parse(options.payload).gmail.messageId);
      return { getResponseCode: () => 200, getContentText: () => '{"success":true}' };
    },
  },
  Logger: { log: () => {} },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.js'), 'utf8'), context);
assert.equal(context.isRakutenSender('楽天カード株式会社 <info@mail.rakuten-card.co.jp>'), true);
assert.equal(context.isRakutenSender('info@mail.rakuten-card.co.jp'), true);
assert.equal(context.isRakutenSender('偽装 <info@mail.rakuten-card.co.jp.evil.example>'), false);
context.processRakutenCardEmails();
assert.deepEqual(sent, ['速報', '詳細']);
assert.deepEqual(read, ['速報', '詳細']);
assert.equal(
  searchQuery,
  'is:unread from:info@mail.rakuten-card.co.jp (subject:"カード利用のお知らせ(家族会員ご利用分)" OR subject:"カード利用のお知らせ(本人ご利用分)" OR subject:"【速報版】カード利用のお知らせ(家族会員ご利用分)" OR subject:"【速報版】カード利用のお知らせ(本人ご利用分)")',
);
assert.equal(searchQuery.includes('ProcessedForLINE'), false);
console.log('楽天カードの件名と送信元判定: 成功');
