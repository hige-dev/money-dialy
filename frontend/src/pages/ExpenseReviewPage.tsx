import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExpenseEditModal } from '../components/ExpenseEditModal';
import { useAuth } from '../contexts/AuthContext';
import { categoriesApi, expensesApi, payersApi, placesApi } from '../services/api';
import type { Category, Expense, ExpenseInput, Payer, Place } from '../types';
import {
  buildExpenseReviewQueue, defaultReviewPeriod, duplicateReviewKey, isImportedExpense,
  monthsInRange, PENDING_REVIEW_DAYS, readReviewedDuplicates, reviewedDuplicatesStorageKey,
  setDuplicateReviewed, visibleExpensesForUser,
} from '../utils/expenseReview';
import type { DuplicateCandidate, ReviewPeriod } from '../utils/expenseReview';

interface ReviewData {
  period: ReviewPeriod;
  expenses: Expense[];
  categories: Category[];
  payers: Payer[];
  places: Place[];
  checkedAt: Date;
}

type ReviewKind = 'uncategorized' | 'pending' | 'duplicates';
const PAGE_SIZE = 20;

function loadReviewedState(email: string) {
  try {
    return { keys: readReviewedDuplicates(localStorage, email), error: '' };
  } catch {
    return { keys: new Set<string>(), error: '確認済みの情報を読み込めませんでした。重複候補を確認待ちとして表示します。' };
  }
}

export function ExpenseReviewPage() {
  const { user } = useAuth();
  const email = user?.email || '';
  const initialPeriod = useRef(defaultReviewPeriod());
  const [period, setPeriod] = useState(initialPeriod.current);
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [kind, setKind] = useState<ReviewKind>('uncategorized');
  const [page, setPage] = useState(0);
  const [showReviewed, setShowReviewed] = useState(false);
  const [reviewedState, setReviewedState] = useState(() => loadReviewedState(email));
  const [editTarget, setEditTarget] = useState<Expense | null>(null);
  const requestID = useRef(0);

  const loadData = useCallback(async (target: ReviewPeriod) => {
    const id = ++requestID.current;
    setLoading(true);
    setError('');
    setNotice('');
    setData(null);
    try {
      const [expenses, categories, payers, places] = await Promise.all([
        expensesApi.getByPeriod(target.start, target.end, true),
        categoriesApi.getAllIncludingInactive(), payersApi.getAll(), placesApi.getAll(),
      ]);
      if (id !== requestID.current) return;
      setData({ period: { ...target }, expenses: visibleExpensesForUser(expenses, email), categories, payers, places, checkedAt: new Date() });
      setPage(0);
    } catch {
      if (id === requestID.current) setError('確認待ちの取得に失敗しました。期間を確認して、もう一度表示してください。');
    } finally {
      if (id === requestID.current) setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    const request = requestID;
    void loadData(initialPeriod.current);
    return () => { request.current++; };
  }, [loadData]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === null || event.key === reviewedDuplicatesStorageKey(email))) {
        setReviewedState(loadReviewedState(email));
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [email]);

  const refresh = () => {
    try {
      monthsInRange(period.start, period.end);
      void loadData({ ...period });
    } catch (error) {
      setError(error instanceof Error ? error.message : '対象期間を確認してください');
    }
  };

  const queue = data ? buildExpenseReviewQueue(data.expenses, data.categories, email, data.checkedAt) : null;
  const duplicates = queue?.duplicates.filter(candidate => !reviewedState.keys.has(duplicateReviewKey(candidate))) || [];
  const reviewed = queue?.duplicates.filter(candidate => reviewedState.keys.has(duplicateReviewKey(candidate))) || [];
  const duplicateRows = showReviewed ? reviewed : duplicates;
  const expenseRows = kind === 'pending' ? queue?.pending || [] : queue?.uncategorized || [];
  const rowCount = kind === 'duplicates' ? duplicateRows.length : expenseRows.length;
  const lastPage = Math.max(0, Math.ceil(rowCount / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const names = new Map(data?.categories.map(category => [category.id, category.name]));

  const selectKind = (value: ReviewKind) => {
    setKind(value);
    setPage(0);
    setShowReviewed(false);
  };

  const save = async (id: string, input: ExpenseInput): Promise<boolean> => {
    setError('');
    setNotice('');
    try {
      const saved = await expensesApi.update(id, input);
      setData(current => current && {
        ...current,
        expenses: visibleExpensesForUser(current.expenses.map(expense => expense.id === id ? saved : expense), email)
          .filter(expense => expense.date >= current.period.start && expense.date <= current.period.end),
      });
      setEditTarget(null);
      setNotice('支出を更新しました。確認待ちの件数に反映しました。');
      return true;
    } catch {
      setError('支出の更新に失敗しました');
      return false;
    }
  };

  const remove = async (id: string) => {
    setError('');
    setNotice('');
    try {
      await expensesApi.delete(id);
      setData(current => current && { ...current, expenses: current.expenses.filter(expense => expense.id !== id) });
      setEditTarget(null);
      setNotice('支出を削除しました。確認待ちの件数に反映しました。');
    } catch {
      setError('支出の削除に失敗しました');
    }
  };

  const markReviewed = (candidate: DuplicateCandidate, value: boolean) => {
    setNotice('');
    try {
      const keys = setDuplicateReviewed(localStorage, email, candidate, value);
      setReviewedState({ keys, error: '' });
      setNotice(value ? '別の支出として確認済みにしました。「確認済みを表示」から取り消せます。' : '重複候補を確認待ちに戻しました。');
    } catch {
      setReviewedState(current => ({ ...current, error: '確認結果を保存できませんでした。ブラウザーの保存設定や空き容量を確認してください。' }));
    }
  };

  const expenseCard = (expense: Expense, label?: string) => <button type="button" className="review-expense" onClick={() => setEditTarget(expense)}>
    <span>{label && `${label} · `}{expense.date} · {expense.payer || '支払元未設定'}</span>
    <strong>{names.get(expense.category) || expense.category || '未分類'} · ¥{expense.amount.toLocaleString()}</strong>
    <span>{[expense.place, expense.memo].filter(Boolean).join(' / ') || '利用先・メモなし'}</span>
    {isImportedExpense(expense) && <small>{expense.importStatus === 'pending' ? '自動取込・詳細待ち' : '自動取込'}</small>}
  </button>;

  return <div className="expense-review-page">
    <div className="recurring-header"><h2>確認待ち</h2><Link to="/search">支出を検索</Link></div>
    <p className="review-note">未分類・長期間の詳細待ち・重複候補をまとめて確認できます。</p>
    <form className="expense-search-form" onSubmit={event => { event.preventDefault(); if (!loading) refresh(); }}>
      <div className="search-field-pair">
        <label>開始日<input type="date" required value={period.start} onChange={event => setPeriod(current => ({ ...current, start: event.target.value }))} /></label>
        <label>終了日<input type="date" required value={period.end} onChange={event => setPeriod(current => ({ ...current, end: event.target.value }))} /></label>
      </div>
      <p className="review-note">初期表示は当日までの直近3か月です。最大12か月を指定できます。</p>
      <button className="modal-btn modal-btn-primary" disabled={loading}>{loading ? '読み込み中…' : 'この期間を最新の情報で表示'}</button>
    </form>
    {error && <p role="alert" className="review-error">{error}</p>}
    {reviewedState.error && <p role="alert" className="review-error">{reviewedState.error}</p>}
    {notice && <p role="status" className="review-note">{notice}</p>}
    {loading && <p role="status" className="review-note">確認待ちを読み込んでいます…</p>}
    {data && queue && <>
      <p className="review-note">対象: {data.period.start} 〜 {data.period.end} · 取得時刻: {data.checkedAt.toLocaleTimeString('ja-JP')}</p>
      <div className="review-queue-tabs" role="group" aria-label="確認待ちの種類">
        <button type="button" aria-pressed={kind === 'uncategorized'} onClick={() => selectKind('uncategorized')}>未分類<strong>{queue.uncategorized.length}<small>件</small></strong></button>
        <button type="button" aria-pressed={kind === 'pending'} onClick={() => selectKind('pending')}>詳細待ち<strong>{queue.pending.length}<small>件</small></strong></button>
        <button type="button" aria-pressed={kind === 'duplicates'} onClick={() => selectKind('duplicates')}>重複候補<strong>{duplicates.length}<small>組</small></strong></button>
      </div>
      <p className="review-note">詳細待ちは取込から{PENDING_REVIEW_DAYS}日以上の明細です。同じ支出が複数の種類に含まれる場合があります。</p>
      {kind !== 'duplicates' ? <section aria-label={kind === 'pending' ? '長期間の詳細待ち' : '未分類の支出'}>
        <p className="review-note">{kind === 'pending'
          ? '利用日・金額・利用先を確認してください。別の支出として詳細通知が登録されていないか、支出検索でも確認できます。'
          : '明細を選んでカテゴリを設定してください。管理者は自動取込の分類修正後に、今後の分類ルールも作成できます。'}</p>
        {expenseRows.length === 0 && <div className="empty-state"><p>{kind === 'pending' ? '長期間の詳細待ちはありません。' : '未分類の支出はありません。'}</p></div>}
        <div className="review-results">{expenseRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(expense => <div key={expense.id}>{expenseCard(expense)}</div>)}</div>
      </section> : <section aria-label="重複候補の確認">
        <p className="review-note">日付・金額・支払元が一致する手入力などの支出と、自動取込を並べています。同じ支出なら手入力側を編集・削除し、自動取込側を残すと後日の詳細通知を補完できます。別の買い物なら確認済みにしてください。</p>
        <p className="review-note">確認済みの状態は、このブラウザーに利用者ごとに保存します。別の端末には同期されません。明細が更新されると、再び確認待ちになります。</p>
        <label className="review-confirmed-toggle"><input type="checkbox" checked={showReviewed} onChange={event => { setShowReviewed(event.target.checked); setPage(0); }} />確認済みを表示（{reviewed.length}組）</label>
        {duplicateRows.length === 0 && <div className="empty-state"><p>{showReviewed ? '確認済みの候補はありません。' : '確認待ちの重複候補はありません。'}</p></div>}
        {duplicateRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(candidate => <div className="duplicate-pair" key={duplicateReviewKey(candidate)}>
          {expenseCard(candidate.manual, '手入力など')}
          {expenseCard(candidate.imported, '自動取込')}
          <button type="button" className="review-confirm-button" onClick={() => markReviewed(candidate, !showReviewed)}>{showReviewed ? '確認待ちに戻す' : '別の支出として確認'}</button>
        </div>)}
      </section>}
      {rowCount > PAGE_SIZE && <div className="review-pagination">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>前へ</button>
        <span>{currentPage + 1} / {lastPage + 1}</span>
        <button type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>次へ</button>
      </div>}
    </>}
    {editTarget && data && <ExpenseEditModal key={editTarget.id} expense={editTarget} categories={data.categories.filter(category => category.isActive || category.id === editTarget.category)} payers={data.payers} places={data.places} onSave={save} onDelete={remove} onClose={() => setEditTarget(null)} />}
  </div>;
}
