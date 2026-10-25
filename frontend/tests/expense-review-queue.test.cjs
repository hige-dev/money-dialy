const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadModule(file, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported = {};
  const context = { module: { exports: exported }, exports: exported, require, ...globals };
  vm.runInNewContext(source, context);
  return context.module.exports;
}

const review = loadModule('utils/expenseReview.ts');
const { buildExpenseReviewQueue, defaultReviewPeriod, duplicateReviewKey, readReviewedDuplicates, reviewedDuplicatesStorageKey, setDuplicateReviewed } = review;
const plain = value => JSON.parse(JSON.stringify(value));
const now = new Date('2026-10-25T03:00:00Z');
const categories = [{ id: 'food', name: '食費', isActive: true }, { id: 'unknown', name: '未分類', isActive: true }, { id: 'old', name: '旧カテゴリ', isActive: false }];
const expense = (id, changes = {}) => ({ id, date: '2026-10-01', amount: 1000, payer: 'カード', place: 'スーパー', memo: '', category: 'food', visibility: 'public', createdBy: '自分', createdAt: '2026-10-01T03:00:00Z', updatedAt: '2026-10-01T03:00:00Z', ...changes });
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('初期期間は年をまたぐ直近3か月の初日から当日まで', () => {
  assert.deepEqual(plain(defaultReviewPeriod(new Date(2026, 0, 15))), { start: '2025-11-01', end: '2026-01-15' });
  assert.deepEqual(plain(defaultReviewPeriod(new Date(2024, 1, 29))), { start: '2023-12-01', end: '2024-02-29' });
});

test('未分類は空欄・旧名称・未分類カテゴリID・不明IDを含み、非アクティブな既存カテゴリは除く', () => {
  const rows = [expense('空欄', { category: '' }), expense('旧名称', { category: '未分類' }), expense('ID', { category: 'unknown' }), expense('不明', { category: 'deleted' }), expense('分類済み'), expense('非アクティブ', { category: 'old' })];
  const queue = buildExpenseReviewQueue(rows, categories, '自分', now);
  assert.deepEqual(new Set(queue.uncategorized.map(row => row.id)), new Set(['空欄', '旧名称', 'ID', '不明']));
});

test('詳細待ちは利用日ではなく取込から14日を基準にし、境界・未来・補完済みを区別する', () => {
  const rows = [
    expense('14日', { importStatus: 'pending', createdAt: '2026-10-11T03:00:00Z' }),
    expense('1秒前', { importStatus: 'pending', createdAt: '2026-10-11T03:00:01Z' }),
    expense('古い利用日の新規取込', { date: '2026-08-01', importStatus: 'pending', createdAt: '2026-10-24T03:00:00Z' }),
    expense('未来', { importStatus: 'pending', createdAt: '2026-11-01T03:00:00Z' }),
    expense('補完済み', { importStatus: 'complete' }), expense('手入力'),
  ];
  assert.deepEqual(plain(buildExpenseReviewQueue(rows, categories, '自分', now).pending).map(row => row.id), ['14日']);
});

test('取込日時がない明細は利用日を使い、不正な日付は詳細待ちに含めない', () => {
  const rows = [expense('日時なし', { createdAt: '', importStatus: 'pending' }), expense('不正', { createdAt: '', date: '', importStatus: 'pending' }), expense('存在しない日付', { createdAt: '', date: '2026-02-30', importStatus: 'pending' })];
  assert.deepEqual(plain(buildExpenseReviewQueue(rows, categories, '自分', now).pending).map(row => row.id), ['日時なし']);
});

test('他人の非公開・金額のみ公開はすべての確認待ちから除き、自分の非公開は含める', () => {
  const rows = [
    expense('自分', { visibility: 'private', category: 'unknown', importStatus: 'pending' }),
    expense('他人非公開', { createdBy: '他人', visibility: 'private', category: 'unknown', importStatus: 'pending' }),
    expense('他人金額のみ', { createdBy: '他人', visibility: 'summary', category: '', importStatus: 'pending' }),
    expense('手入力'),
  ];
  const queue = buildExpenseReviewQueue(rows, categories, '自分', now);
  assert.deepEqual(plain(queue.uncategorized).map(row => row.id), ['自分']);
  assert.deepEqual(plain(queue.pending).map(row => row.id), ['自分']);
  assert.deepEqual(plain(queue.duplicates).map(pair => pair.imported.id), ['自分']);
});

test('未分類と詳細待ちは重なっても両方に残り、速報の補完・分類修正・削除で件数が変わる', () => {
  const imported = expense('取込', { category: 'unknown', importStatus: 'pending' });
  const rows = [imported, expense('手入力')];
  let queue = buildExpenseReviewQueue(rows, categories, '自分', now);
  assert.deepEqual([queue.uncategorized.length, queue.pending.length, queue.duplicates.length], [1, 1, 1]);
  queue = buildExpenseReviewQueue([{ ...imported, category: 'food', importStatus: 'complete' }, rows[1]], categories, '自分', now);
  assert.deepEqual([queue.uncategorized.length, queue.pending.length, queue.duplicates.length], [0, 0, 1]);
  queue = buildExpenseReviewQueue([imported], categories, '自分', now);
  assert.equal(queue.duplicates.length, 0);
});

test('確認済みは一組だけに適用し、再読み込みで維持し、取り消せる', () => {
  const store = storage();
  const imported = expense('取込', { importStatus: 'pending' });
  const first = { manual: expense('手入力1'), imported };
  const second = { manual: expense('手入力2'), imported };
  assert.equal(readReviewedDuplicates(store, '自分').size, 0);
  setDuplicateReviewed(store, '自分', first, true);
  let keys = readReviewedDuplicates(store, '自分');
  assert.equal(keys.has(duplicateReviewKey(first)), true);
  assert.equal(keys.has(duplicateReviewKey(second)), false);
  setDuplicateReviewed(store, '自分', second, true);
  keys = setDuplicateReviewed(store, '自分', first, false);
  assert.equal(keys.has(duplicateReviewKey(first)), false);
  assert.equal(keys.has(duplicateReviewKey(second)), true);
});

test('確認済みは利用者別に分離し、メモや利用先を保存しない', () => {
  const store = storage();
  const candidate = { manual: expense('手入力', { memo: '保存しないメモ', place: '保存しない利用先' }), imported: expense('取込', { importStatus: 'complete' }) };
  setDuplicateReviewed(store, '自分', candidate, true);
  assert.equal(readReviewedDuplicates(store, '他人').size, 0);
  const value = store.getItem(reviewedDuplicatesStorageKey('自分'));
  assert.equal(value.includes('保存しない'), false);
  assert.notEqual(reviewedDuplicatesStorageKey('自分'), reviewedDuplicatesStorageKey('他人'));
});

test('手入力・自動取込の更新、速報の補完後には同じ組でも確認済みを引き継がない', () => {
  const candidate = { manual: expense('手入力'), imported: expense('取込', { importStatus: 'pending' }) };
  const original = duplicateReviewKey(candidate);
  assert.notEqual(duplicateReviewKey({ ...candidate, manual: { ...candidate.manual, updatedAt: '更新日時' } }), original);
  assert.notEqual(duplicateReviewKey({ ...candidate, imported: { ...candidate.imported, updatedAt: '更新日時' } }), original);
  assert.notEqual(duplicateReviewKey({ ...candidate, imported: { ...candidate.imported, importStatus: 'complete' } }), original);
});

test('保存失敗や壊れた保存データを成功として扱わない', () => {
  const candidate = { manual: expense('手入力'), imported: expense('取込') };
  const store = storage();
  store.setItem(reviewedDuplicatesStorageKey('自分'), '{}');
  assert.throws(() => readReviewedDuplicates(store, '自分'));
  assert.throws(() => setDuplicateReviewed(store, '自分', candidate, true));
  assert.throws(() => setDuplicateReviewed({ getItem: () => null, setItem: () => { throw new Error('容量不足'); } }, '自分', candidate, true), /容量不足/);
});

test('確認待ちの期間取得は既存キャッシュを更新し、指定した全月を再取得できる', async () => {
  const calls = [];
  const api = loadModule('services/api.ts', {
    require: name => name === '../config' ? { config: { apiUrl: '/api' } } : review,
    crypto: require('node:crypto').webcrypto,
    TextEncoder,
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request);
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, data: [expense(request.month, { date: `${request.month}-01`, memo: `取得${calls.length}` })] }) };
    },
  });
  api.setAuthToken('検証トークン');
  assert.equal((await api.expensesApi.getByMonth('2026-10'))[0].memo, '取得1');
  assert.equal((await api.expensesApi.getByMonth('2026-10'))[0].memo, '取得1');
  assert.equal(calls.length, 1);
  const refreshed = await api.expensesApi.getByPeriod('2026-09-01', '2026-10-31', true);
  assert.equal(calls.length, 3);
  assert.equal(refreshed.length, 2);
  assert.notEqual((await api.expensesApi.getByMonth('2026-10'))[0].memo, '取得1');
  assert.equal(calls.length, 3);
});
