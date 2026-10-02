const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const sent = [];
const read = [];
let searchQuery;
const searchCalls = [];
function message(id, subject, from, body = '利用明細') {
  return {
    isUnread: () => true,
    getId: () => id,
    getSubject: () => subject,
    getFrom: () => from,
    getDate: () => new Date('2026-09-25T00:00:00Z'),
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
  message('楽天ペイ', '楽天ペイお支払い完了のお知らせ【楽天ペイアプリ】', '楽天ペイ <no-reply@pay.rakuten.co.jp>'),
  message('偽装', '【速報版】カード利用のお知らせ(本人ご利用分)', '偽装 <info@mail.rakuten-card.co.jp.evil.example>'),
  message('別件', '別の件名', '楽天カード株式会社 <info@mail.rakuten-card.co.jp>'),
  message('三井住友送信元不一致', 'ご利用のお知らせ【三井住友カード】', 'notice@example.com', '別のサービスのメールです。'),
  message('三井住友件名不一致', 'ご利用のお知らせ', 'notice@vpass.ne.jp', '三井住友カードをご利用いただきありがとうございます。'),
  message('楽天ペイ送信元不一致', '楽天ペイお支払い完了のお知らせ【楽天ペイアプリ】', 'notice@example.com'),
  message('楽天ペイ件名不一致', 'お支払い完了のお知らせ', '楽天ペイ <no-reply@pay.rakuten.co.jp>'),
];
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
const context = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '設定済み' }) },
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
assert.deepEqual(sent, ['速報', '詳細', '三井住友送信元', '三井住友本文', '楽天ペイ']);
assert.deepEqual(read, ['速報', '詳細', '三井住友送信元', '三井住友本文', '楽天ペイ']);
assert.deepEqual(
  searchCalls.map(({ start, max }) => [start, max]),
  [[0, 20], [20, 20]],
);
assert.equal(searchCalls.every(call => call.query === searchQuery), true);
assert.equal(
  searchQuery,
  'is:unread ((from:info@mail.rakuten-card.co.jp (subject:"カード利用のお知らせ(家族会員ご利用分)" OR subject:"カード利用のお知らせ(本人ご利用分)" OR subject:"【速報版】カード利用のお知らせ(家族会員ご利用分)" OR subject:"【速報版】カード利用のお知らせ(本人ご利用分)")) OR (subject:"ご利用のお知らせ【三井住友カード】" {from:vpass.ne.jp from:smbc-card.com from:smbc.co.jp "三井住友カード"}) OR (from:pay.rakuten.co.jp (subject:"楽天ペイお支払い完了のお知らせ" OR subject:"楽天ペイアプリ")))',
);
assert.equal(searchQuery.includes('ProcessedForLINE'), false);
assert.equal(searchQuery.includes('joe.yshr380'), false);
console.log('3系統の件名と送信元・本文判定: 成功');
