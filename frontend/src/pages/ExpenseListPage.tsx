import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MonthPicker } from '../components/MonthPicker';
import { expensesApi, categoriesApi, placesApi, payersApi } from '../services/api';
import type { Expense, Category, Place, Payer, Visibility } from '../types';
import { useAuth } from '../contexts/AuthContext';

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
}

// 日付ごとにグルーピング
function groupByDate(expenses: Expense[]): Map<string, Expense[]> {
  const map = new Map<string, Expense[]>();
  for (const e of expenses) {
    const existing = map.get(e.date);
    if (existing) {
      existing.push(e);
    } else {
      map.set(e.date, [e]);
    }
  }
  return map;
}

interface EditModalProps {
  expense: Expense;
  categories: Category[];
  places: Place[];
  payers: Payer[];
  onSave: (id: string, data: { date: string; payer: string; category: string; amount: number; memo: string; place: string; visibility?: Visibility }) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function EditModal({ expense, categories, places, payers, onSave, onDelete, onClose }: EditModalProps) {
  const [date, setDate] = useState(expense.date);
  const [payer, setPayer] = useState(expense.payer);
  const [category, setCategory] = useState(expense.category);
  const [amount, setAmount] = useState(String(expense.amount));
  const [place, setPlace] = useState(expense.place);
  const [memo, setMemo] = useState(expense.memo);
  const [visibility, setVisibility] = useState<Visibility>((expense.visibility || 'public') as Visibility);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>支出を編集</h3>
          <button className="modal-close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-field">
          <label>日付</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>支払元</label>
          <select value={payer} onChange={(e) => setPayer(e.target.value)}>
            <option value="">未選択</option>
            {payers.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="modal-field">
          <label>カテゴリ</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="modal-field">
          <label>金額</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>場所</label>
          <select value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="">未選択</option>
            {places.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="modal-field">
          <label>メモ</label>
          <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>公開設定</label>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            <option value="public">全員に公開</option>
            <option value="summary">金額のみ公開</option>
            <option value="private">自分のみ</option>
          </select>
        </div>
        <div className="modal-actions">
          <button
            className="modal-btn modal-btn-danger"
            onClick={() => { if (confirm('削除しますか？')) onDelete(expense.id); }}
          >
            削除
          </button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={() => onSave(expense.id, { date, payer, category, amount: Number(amount), memo, place, visibility })}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export function ExpenseListPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDate = searchParams.get('date') || todayString();
  const [date, setDate] = useState(initialDate);
  const scrollTargetDate = useRef(searchParams.get('date'));
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<Expense | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<'shared' | 'personal'>('shared');

  const month = getMonth(date);

  const colorMap = new Map(categories.map((c) => [c.id, c.color]));
  const catNameMap = new Map(categories.map((c) => [c.id, c.name]));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [exp, cats, plcs, pays] = await Promise.all([
        expensesApi.getByMonth(month),
        categoriesApi.getAll(),
        placesApi.getAll(),
        payersApi.getAll(),
      ]);
      setExpenses(exp);
      setCategories(cats);
      setPlaces(plcs);
      setPayers(pays);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 日付パラメータでスクロール
  useEffect(() => {
    if (!loading && scrollTargetDate.current) {
      const target = scrollTargetDate.current;
      scrollTargetDate.current = null;
      // searchParams をクリア
      setSearchParams({}, { replace: true });
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-date="${target}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [loading, setSearchParams]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleSave = async (id: string, data: { date: string; payer: string; category: string; amount: number; memo: string; place: string; visibility?: Visibility }) => {
    try {
      await expensesApi.update(id, data);
      setEditTarget(null);
      setToast('更新しました');
      await loadData();
    } catch (e) {
      console.error(e);
      setToast('更新に失敗しました');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await expensesApi.delete(id);
      setEditTarget(null);
      setToast('削除しました');
      await loadData();
    } catch (e) {
      console.error(e);
      setToast('削除に失敗しました');
    }
  };

  const expenseCategories = new Set(categories.filter((c) => c.isExpense).map((c) => c.id));
  const filtered = tab === 'shared'
    ? expenses.filter(e => !e.visibility || e.visibility === 'public')
    : expenses.filter(e =>
        e.createdBy === user?.email &&
        (e.visibility === 'summary' || e.visibility === 'private')
      );
  const total = filtered.filter((e) => expenseCategories.has(e.category)).reduce((sum, e) => sum + e.amount, 0);
  const grouped = groupByDate(filtered);

  return (
    <>
      <MonthPicker value={date} onChange={setDate} mode="month" />
      <div className="summary-breakdown-tabs">
        <button className={`summary-breakdown-tab ${tab === 'shared' ? 'active' : ''}`}
          onClick={() => setTab('shared')}>共有</button>
        <button className={`summary-breakdown-tab ${tab === 'personal' ? 'active' : ''}`}
          onClick={() => setTab('personal')}>個人</button>
      </div>
      <div className="expense-list-total">
        合計: &yen;{total.toLocaleString()}
      </div>

      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>この月のデータはありません</p></div>
      ) : (
        <div className="expense-list">
          {[...grouped.entries()].map(([dateKey, items]) => (
            <div key={dateKey} className="expense-date-group" data-date={dateKey}>
              <div className="expense-date-header">{formatDateShort(dateKey)}</div>
              {items.map((item) => {
                const isMasked = tab === 'shared' && item.visibility === 'summary' && item.createdBy !== user?.email;
                return (
                  <div
                    key={item.id}
                    className="expense-item"
                    style={isMasked ? { opacity: 0.5 } : undefined}
                    onClick={() => { if (!isMasked) setEditTarget(item); }}
                  >
                    <div
                      className="expense-item-color"
                      style={{ background: isMasked ? '#AEB6BF' : (colorMap.get(item.category) || '#AEB6BF') }}
                    />
                    <div className="expense-item-body">
                      <div className="expense-item-top">
                        <span className="expense-item-category">{isMasked ? '個人出費' : (catNameMap.get(item.category) || item.category)}</span>
                        <span className="expense-item-amount">&yen;{item.amount.toLocaleString()}</span>
                      </div>
                      <div className="expense-item-meta">
                        {item.payer && <span className="expense-item-payer">{item.payer}</span>}
                        {!isMasked && (item.place || item.memo) && (
                          <span className="expense-item-memo">
                            {[item.place, item.memo].filter(Boolean).join(' / ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {editTarget && (
        <EditModal
          expense={editTarget}
          categories={categories}
          places={places}
          payers={payers}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditTarget(null)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
