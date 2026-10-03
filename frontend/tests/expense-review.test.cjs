const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/expenseReview.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exported = {};
const context = { module: { exports: exported }, exports: exported, require };
vm.runInNewContext(source, context);
const { monthsInRange, filterExpenses, findDuplicateCandidates, validateAmountRange, loadExpensePeriod, visibleExpensesForUser } = context.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const expense = (id, changes = {}) => ({ id, date: '2026-09-30', amount: 1000, payer: 'カード', place: 'スーパー', memo: '', category: 'food', visibility: 'public', createdBy: '自分', createdAt: '', updatedAt: '', ...changes });
const filters = { start: '2026-09-01', end: '2026-10-31', query: '', category: '', payer: '', minAmount: '', maxAmount: '' };

test('検索期間は年をまたいで列挙し、日付不正・逆転・13か月を拒否する', () => {
  assert.deepEqual(plain(monthsInRange('2025-12-31', '2026-02-01')), ['2025-12', '2026-01', '2026-02']);
  assert.equal(monthsInRange('2026-01-01', '2026-12-31').length, 12);
  assert.equal(monthsInRange('2024-02-29', '2024-02-29').length, 1);
  for (const [start, end] of [['2026-02-29', '2026-03-01'], ['2026-01-01', '2027-01-01'], ['2026-10-01', '2026-09-30'], ['', '2026-09-30']]) {
    assert.throws(() => monthsInRange(start, end));
  }
});

test('検索は日付・カテゴリ・支払元・金額の境界と利用先・メモの表記揺れを扱う', () => {
  const rows = [expense('期間外', { date: '2026-08-31' }), expense('開始日', { date: filters.start }), expense('終了日', { date: filters.end }), expense('メモ', { place: '', memo: 'ＡＢＣで家電購入', category: 'goods', amount: 3000 }), expense('別支払元', { payer: '現金' })];
  assert.deepEqual(plain(filterExpenses(rows, { ...filters, payer: 'カード', category: 'food', minAmount: '1000', maxAmount: '1000' })).map(row => row.id), ['終了日', '開始日']);
  assert.deepEqual(plain(filterExpenses(rows, { ...filters, query: ' abc ' })).map(row => row.id), ['メモ']);
  assert.equal(filterExpenses(rows, { ...filters, query: 'スーパー' }).length, 3);
});

test('金額の負数・小数・逆転・安全な整数範囲外を拒否する', () => {
  validateAmountRange('', '');
  validateAmountRange('0', '1000');
  for (const [min, max] of [['-1', ''], ['1.5', ''], ['2000', '1000'], ['', '9007199254740992'], ['abc', '']]) assert.throws(() => validateAmountRange(min, max));
});

test('重複候補は日付・金額・支払元をすべて照合し、複数候補を勝手に統合しない', () => {
  const rows = [expense('手入力1'), expense('手入力2'), expense('速報', { importStatus: 'pending' }), expense('詳細', { importStatus: 'complete' }), expense('別日', { date: '2026-10-01' }), expense('別額', { amount: 999 }), expense('別支払元', { payer: '現金' })];
  const candidates = plain(findDuplicateCandidates(rows, '自分'));
  assert.equal(candidates.length, 4);
  assert.deepEqual(candidates.map(pair => [pair.manual.id, pair.imported.id]), [['手入力1', '速報'], ['手入力2', '速報'], ['手入力1', '詳細'], ['手入力2', '詳細']]);
  assert.equal(rows.length, 7);
});

test('他人の非公開・金額のみ公開・支払元未設定は重複候補に使わない', () => {
  const rows = [expense('自分非公開', { visibility: 'private' }), expense('他人非公開', { visibility: 'private', createdBy: '他人' }), expense('他人金額のみ', { visibility: 'summary', createdBy: '他人' }), expense('取込', { importStatus: 'complete' }), expense('支払元なし', { payer: '' }), expense('取込支払元なし', { payer: '', importStatus: 'complete' })];
  assert.deepEqual(plain(findDuplicateCandidates(rows, '自分')).map(pair => pair.manual.id), ['自分非公開']);
});

test('保存直後も他人の非公開を除外し、金額のみ公開の内容を検索対象から除く', () => {
  const rows = [expense('自分', { visibility: 'private' }), expense('他人非公開', { visibility: 'private', createdBy: '他人' }), expense('他人金額のみ', { visibility: 'summary', createdBy: '他人', importStatus: 'pending' })];
  const visible = visibleExpensesForUser(rows, '自分');
  assert.deepEqual(plain(visible).map(row => row.id), ['自分', '他人金額のみ']);
  assert.deepEqual(plain(filterExpenses(visible, { ...filters, query: 'スーパー' })).map(row => row.id), ['自分']);
  assert.equal(visible[1].category, '');
  assert.equal(visible[1].memo, '');
  assert.equal(visible[1].importStatus, undefined);
});

test('期間取得は並列数を3以内にし、開始・終了日で月の明細を絞る', async () => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const result = await loadExpensePeriod('2026-01-15', '2026-04-10', async month => {
    active++;
    maxActive = Math.max(active, maxActive);
    calls.push(month);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return [expense(`${month}-初日`, { date: `${month}-01` }), expense(`${month}-末日`, { date: `${month}-28` })];
  });
  assert.equal(maxActive, 3);
  assert.deepEqual(calls, ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.equal(result.length, 6);
  assert.equal(result.some(row => row.date < '2026-01-15' || row.date > '2026-04-10'), false);
});

test('月の取得に失敗した場合は部分的な検索結果を返さない', async () => {
  await assert.rejects(loadExpensePeriod('2026-01-01', '2026-02-28', async month => {
    if (month === '2026-02') throw new Error('取得失敗');
    return [expense('1月', { date: '2026-01-01' })];
  }), /取得失敗/);
});
