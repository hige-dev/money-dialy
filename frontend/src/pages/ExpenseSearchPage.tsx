import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExpenseEditModal } from '../components/ExpenseEditModal';
import { useAuth } from '../contexts/AuthContext';
import { categoriesApi, expensesApi, payersApi, placesApi } from '../services/api';
import type { Category, Expense, ExpenseInput, Payer, Place } from '../types';
import { canViewExpenseDetails, filterExpenses, findDuplicateCandidates, isImportedExpense, monthsInRange, validateAmountRange, visibleExpensesForUser } from '../utils/expenseReview';
import type { ExpenseSearchFilters } from '../utils/expenseReview';

function defaultFilters(): ExpenseSearchFilters {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const end = `${year}-${month}-${String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
  return { start: `${year}-${month}-01`, end, query: '', category: '', payer: '', minAmount: '', maxAmount: '' };
}

const PAGE_SIZE = 50;

export function ExpenseSearchPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(defaultFilters);
  const [applied, setApplied] = useState<ExpenseSearchFilters | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [masterReady, setMasterReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(0);
  const [duplicatePage, setDuplicatePage] = useState(0);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [editTarget, setEditTarget] = useState<Expense | null>(null);
  const requestID = useRef(0);

  useEffect(() => {
    let active = true;
    const request = requestID;
    Promise.all([categoriesApi.getAll(), payersApi.getAll(), placesApi.getAll()]).then(([cats, pays, plcs]) => {
      if (!active) return;
      setCategories(cats);
      setPayers(pays);
      setPlaces(plcs);
      setMasterReady(true);
    }).catch(() => { if (active) setError('入力項目の読み込みに失敗しました。ページを再読み込みしてください'); });
    return () => { active = false; request.current++; };
  }, []);

  const setFilter = (name: keyof ExpenseSearchFilters, value: string) => setFilters(current => ({ ...current, [name]: value }));
  const search = async () => {
    setError('');
    setNotice('');
    try {
      monthsInRange(filters.start, filters.end);
      validateAmountRange(filters.minAmount, filters.maxAmount);
    } catch (error) {
      setError(error instanceof Error ? error.message : '検索条件を確認してください');
      return;
    }
    const id = ++requestID.current;
    const snapshot = { ...filters };
    setLoading(true);
    setApplied(null);
    try {
      const result = await expensesApi.getByPeriod(snapshot.start, snapshot.end);
      if (id !== requestID.current) return;
      setExpenses(visibleExpensesForUser(result, user?.email || ''));
      setApplied(snapshot);
      setPage(0);
      setDuplicatePage(0);
    } catch {
      if (id === requestID.current) setError('支出の取得に失敗しました。再度検索してください');
    } finally {
      if (id === requestID.current) setLoading(false);
    }
  };

  const results = applied ? filterExpenses(expenses, applied) : [];
  const catNames = new Map(categories.map(category => [category.id, category.name]));
  const total = results.reduce((sum, expense) => sum + expense.amount, 0);
  // 候補は検索文字列などで片方が隠れないよう、指定期間内の全明細から探す。
  const duplicates = applied ? findDuplicateCandidates(expenses, user?.email || '') : [];

  const save = async (id: string, input: ExpenseInput): Promise<boolean> => {
    try {
      const saved = await expensesApi.update(id, input);
      setExpenses(current => visibleExpensesForUser(current.map(expense => expense.id === id ? saved : expense), user?.email || ''));
      setEditTarget(null);
      setNotice('支出を更新しました');
      return true;
    } catch {
      setError('支出の更新に失敗しました');
      return false;
    }
  };

  const remove = async (id: string) => {
    try {
      await expensesApi.delete(id);
      setExpenses(current => current.filter(expense => expense.id !== id));
      setEditTarget(null);
      setNotice('支出を削除しました');
    } catch {
      setError('支出の削除に失敗しました');
    }
  };

  const expenseCard = (expense: Expense, label?: string) => {
    const detailed = canViewExpenseDetails(expense, user?.email || '');
    return <button type="button" className="review-expense" disabled={!detailed} onClick={() => setEditTarget(expense)}>
      <span>{label || expense.date} · {expense.payer || '支払元未設定'}</span>
      <strong>{detailed ? (catNames.get(expense.category) || expense.category || '未分類') : '個人出費'} · ¥{expense.amount.toLocaleString()}</strong>
      {detailed && <span>{[expense.place, expense.memo].filter(Boolean).join(' / ') || '利用先・メモなし'}</span>}
      {detailed && isImportedExpense(expense) && <small>{expense.importStatus === 'pending' ? '自動取込・詳細待ち' : '自動取込'}</small>}
    </button>;
  };

  const lastPage = Math.max(0, Math.ceil(results.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const lastDuplicatePage = Math.max(0, Math.ceil(duplicates.length / PAGE_SIZE) - 1);
  const currentDuplicatePage = Math.min(duplicatePage, lastDuplicatePage);

  return <>
    <div className="recurring-header"><h2>支出検索・重複確認</h2><Link to="/calendar">カレンダーへ</Link></div>
    <form className="expense-search-form" onSubmit={event => { event.preventDefault(); if (!loading && masterReady) void search(); }}>
      <div className="search-field-pair">
        <label>開始日<input type="date" value={filters.start} onChange={event => setFilter('start', event.target.value)} required /></label>
        <label>終了日<input type="date" value={filters.end} onChange={event => setFilter('end', event.target.value)} required /></label>
      </div>
      <p className="review-note">月をまたいで最大12か月を検索できます。</p>
      <label>利用先・メモ<input type="search" value={filters.query} onChange={event => setFilter('query', event.target.value)} placeholder="例: スーパー、家電" /></label>
      <div className="search-field-pair">
        <label>カテゴリ<select value={filters.category} onChange={event => setFilter('category', event.target.value)}><option value="">すべて</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>支払元<select value={filters.payer} onChange={event => setFilter('payer', event.target.value)}><option value="">すべて</option>{payers.map(payer => <option key={payer.id} value={payer.name}>{payer.name}</option>)}</select></label>
      </div>
      <div className="search-field-pair">
        <label>下限額<input type="number" min="0" step="1" value={filters.minAmount} onChange={event => setFilter('minAmount', event.target.value)} /></label>
        <label>上限額<input type="number" min="0" step="1" value={filters.maxAmount} onChange={event => setFilter('maxAmount', event.target.value)} /></label>
      </div>
      <button className="modal-btn modal-btn-primary" disabled={loading || !masterReady}>{loading ? '検索中…' : '検索・重複候補を確認'}</button>
    </form>
    {error && <p role="alert" className="review-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {applied && <>
      <p className="review-note">検索対象: {applied.start} 〜 {applied.end}{applied.query && ` / ${applied.query}`}</p>
      <section className="duplicate-review">
        <button type="button" className="recent-imports-toggle" aria-expanded={showDuplicates} onClick={() => setShowDuplicates(value => !value)}>重複候補 {duplicates.length}組 {showDuplicates ? '▲' : '▼'}</button>
        {showDuplicates && <>
          <p className="review-note">指定期間全体で日付・金額・支払元が一致する、手入力などの支出と自動取込を表示します。同日同額の別の買い物も含みます。自動的な統合や削除は行いません。同じ支出の場合は内容を確認し、手入力側を編集・削除できます。自動取込側を残すと、後から届く詳細通知を補完できます。</p>
          {duplicates.length === 0 && <p>重複候補はありません。</p>}
          {duplicates.slice(currentDuplicatePage * PAGE_SIZE, (currentDuplicatePage + 1) * PAGE_SIZE).map(({ manual, imported }) => <div className="duplicate-pair" key={`${manual.id}:${imported.id}`}>
            <p>{manual.date} · ¥{manual.amount.toLocaleString()} · {manual.payer}</p>
            {expenseCard(manual, '手入力などを確認')}
            {expenseCard(imported, '自動取込を確認')}
          </div>)}
          {duplicates.length > PAGE_SIZE && <div className="review-pagination">
            <button disabled={currentDuplicatePage === 0} onClick={() => setDuplicatePage(currentDuplicatePage - 1)}>候補の前へ</button>
            <span>{currentDuplicatePage + 1} / {lastDuplicatePage + 1}</span>
            <button disabled={currentDuplicatePage === lastDuplicatePage} onClick={() => setDuplicatePage(currentDuplicatePage + 1)}>候補の次へ</button>
          </div>}
        </>}
      </section>
      <div className="expense-list-total">検索結果 {results.length}件 · 金額合計 ¥{total.toLocaleString()}</div>
      <p className="review-note">合計は検索結果の金額で、収入なども含みます。金額のみ公開の支出は詳細を表示しません。</p>
      {results.length === 0 && <div className="empty-state"><p>条件に一致する支出はありません。</p></div>}
      <div className="review-results">{results.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(expense => <div key={expense.id}>{expenseCard(expense)}</div>)}</div>
      {results.length > PAGE_SIZE && <div className="review-pagination">
        <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>前へ</button>
        <span>{currentPage + 1} / {lastPage + 1}</span>
        <button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>次へ</button>
      </div>}
    </>}
    {editTarget && <ExpenseEditModal key={editTarget.id} expense={editTarget} categories={categories} payers={payers} places={places} onSave={save} onDelete={remove} onClose={() => setEditTarget(null)} />}
  </>;
}
