import type { Category, Expense } from '../types';

export interface ExpenseSearchFilters {
  start: string;
  end: string;
  query: string;
  category: string;
  payer: string;
  minAmount: string;
  maxAmount: string;
}

export function isImportedExpense(expense: Expense): boolean {
  return expense.importStatus === 'pending' || expense.importStatus === 'complete';
}

export function canViewExpenseDetails(expense: Expense, userEmail: string): boolean {
  return expense.createdBy === userEmail || !expense.visibility || expense.visibility === 'public';
}

/** 保存応答にも一覧取得時と同じ公開範囲を適用する。 */
export function visibleExpensesForUser(expenses: Expense[], userEmail: string): Expense[] {
  return expenses.flatMap(expense => {
    if (canViewExpenseDetails(expense, userEmail)) return [expense];
    if (expense.visibility !== 'summary') return [];
    return [{
      id: expense.id, date: expense.date, payer: expense.payer, amount: expense.amount,
      category: '', place: '', memo: '', visibility: expense.visibility,
      createdBy: expense.createdBy, createdAt: expense.createdAt, updatedAt: expense.updatedAt,
    }];
  });
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 月別APIの検索範囲を最大12か月に制限する。 */
export function monthsInRange(start: string, end: string): string[] {
  if (!validDate(start) || !validDate(end)) throw new Error('開始日と終了日を正しい日付で指定してください');
  if (start > end) throw new Error('終了日は開始日以降にしてください');
  const startIndex = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1;
  const endIndex = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7)) - 1;
  if (endIndex - startIndex >= 12) throw new Error('検索期間は最大12か月にしてください');
  return Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => {
    const index = startIndex + offset;
    return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
  });
}

/** すべての月を取得できた場合だけ、指定期間の明細を返す。 */
export async function loadExpensePeriod(start: string, end: string, getMonth: (month: string) => Promise<Expense[]>): Promise<Expense[]> {
  const months = monthsInRange(start, end);
  const expenses: Expense[] = [];
  for (let index = 0; index < months.length; index += 3) {
    const pages = await Promise.all(months.slice(index, index + 3).map(getMonth));
    expenses.push(...pages.flat());
  }
  return expenses.filter(expense => expense.date >= start && expense.date <= end);
}

export function validateAmountRange(min: string, max: string): void {
  for (const value of [min, max]) {
    if (value !== '' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
      throw new Error('金額は0以上の整数で指定してください');
    }
  }
  if (min !== '' && max !== '' && Number(min) > Number(max)) throw new Error('上限額は下限額以上にしてください');
}

export function filterExpenses(expenses: Expense[], filters: ExpenseSearchFilters): Expense[] {
  const query = filters.query.trim().normalize('NFKC').toLocaleLowerCase('ja');
  return expenses.filter(expense =>
    expense.date >= filters.start && expense.date <= filters.end &&
    (!query || [expense.place, expense.memo].some(value => value.normalize('NFKC').toLocaleLowerCase('ja').includes(query))) &&
    (!filters.category || expense.category === filters.category) &&
    (!filters.payer || expense.payer === filters.payer) &&
    (filters.minAmount === '' || expense.amount >= Number(filters.minAmount)) &&
    (filters.maxAmount === '' || expense.amount <= Number(filters.maxAmount))
  ).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export interface DuplicateCandidate {
  manual: Expense;
  imported: Expense;
}

/** 詳細を閲覧できる明細だけを比較し、同日同額の別の買い物も候補として残す。 */
export function findDuplicateCandidates(expenses: Expense[], userEmail: string): DuplicateCandidate[] {
  const manualByKey = new Map<string, Expense[]>();
  const key = (expense: Expense) => JSON.stringify([expense.date, expense.amount, expense.payer]);
  const visible = expenses.filter(expense => canViewExpenseDetails(expense, userEmail) && expense.payer.trim() !== '');
  for (const expense of visible) {
    if (isImportedExpense(expense)) continue;
    const group = manualByKey.get(key(expense)) || [];
    group.push(expense);
    manualByKey.set(key(expense), group);
  }
  const result: DuplicateCandidate[] = [];
  for (const imported of visible) {
    if (!isImportedExpense(imported)) continue;
    for (const manual of manualByKey.get(key(imported)) || []) result.push({ manual, imported });
  }
  return result;
}

export const PENDING_REVIEW_DAYS = 14;

export interface ReviewPeriod {
  start: string;
  end: string;
}

/** 当日までの直近3か月を初期表示する。 */
export function defaultReviewPeriod(now = new Date()): ReviewPeriod {
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { start: format(new Date(now.getFullYear(), now.getMonth() - 2, 1)), end: format(now) };
}

/** 詳細を確認できる明細だけを、分類と取込後の経過時間で振り分ける。 */
export function buildExpenseReviewQueue(expenses: Expense[], categories: Category[], userEmail: string, now: Date) {
  const categoryNames = new Map(categories.map(category => [category.id, category.name]));
  const detailed = expenses.filter(expense => canViewExpenseDetails(expense, userEmail));
  const uncategorized = detailed.filter(expense =>
    !expense.category || expense.category === '未分類' || categoryNames.get(expense.category) === '未分類' || !categoryNames.has(expense.category)
  ).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const importedAt = (expense: Expense) => {
    const created = Date.parse(expense.createdAt);
    return Number.isFinite(created) ? created : validDate(expense.date) ? Date.parse(`${expense.date}T00:00:00+09:00`) : NaN;
  };
  const pending = detailed.filter(expense =>
    expense.importStatus === 'pending' && now.getTime() - importedAt(expense) >= PENDING_REVIEW_DAYS * 24 * 60 * 60 * 1000
  ).sort((a, b) => importedAt(a) - importedAt(b) || a.id.localeCompare(b.id));
  const duplicates = findDuplicateCandidates(detailed, userEmail)
    .sort((a, b) => b.manual.date.localeCompare(a.manual.date) || a.manual.id.localeCompare(b.manual.id) || a.imported.id.localeCompare(b.imported.id));
  return { uncategorized, pending, duplicates };
}

/** 明細の更新や速報の補完後には、同じ組み合わせでも再確認する。 */
export function duplicateReviewKey({ manual, imported }: DuplicateCandidate): string {
  return JSON.stringify([manual.id, manual.updatedAt, imported.id, imported.updatedAt, imported.importStatus]);
}

export function reviewedDuplicatesStorageKey(userEmail: string): string {
  return `money_diary_reviewed_duplicates:${encodeURIComponent(userEmail)}`;
}

type ReviewStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readReviewedDuplicates(storage: ReviewStorage, userEmail: string): Set<string> {
  const value = storage.getItem(reviewedDuplicatesStorageKey(userEmail));
  if (value === null) return new Set();
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    throw new Error('確認済みの情報を読み込めませんでした');
  }
  return new Set(parsed);
}

/** 別タブで保存された確認結果も読み直してから、対象の組だけを変更する。 */
export function setDuplicateReviewed(storage: ReviewStorage, userEmail: string, candidate: DuplicateCandidate, reviewed: boolean): Set<string> {
  const keys = readReviewedDuplicates(storage, userEmail);
  const key = duplicateReviewKey(candidate);
  if (reviewed) keys.add(key);
  else keys.delete(key);
  storage.setItem(reviewedDuplicatesStorageKey(userEmail), JSON.stringify([...keys]));
  return keys;
}
