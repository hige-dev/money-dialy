import { useState, useEffect } from 'react';
import { recurringApi, categoriesApi, placesApi, payersApi, expensesApi } from '../services/api';
import type { RecurringExpense, RecurringExpenseInput, Category, Place, Payer } from '../types';

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function frequencyLabel(r: RecurringExpense): string {
  if (r.frequency === 'yearly') {
    return `毎年${r.repeatMonth}月${r.dayOfMonth}日`;
  }
  if (r.frequency === 'bimonthly') {
    return `隔月${r.dayOfMonth}日`;
  }
  return `毎月${r.dayOfMonth}日`;
}

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface EditModalProps {
  initial?: RecurringExpense;
  categories: Category[];
  places: Place[];
  payers: Payer[];
  onSave: (input: RecurringExpenseInput) => void;
  onClose: () => void;
}

function RecurringModal({ initial, categories, places, payers, onSave, onClose }: EditModalProps) {
  const [category, setCategory] = useState(initial?.category || (categories[0]?.name ?? ''));
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [payer, setPayer] = useState(initial?.payer || (payers[0]?.name ?? ''));
  const [place, setPlace] = useState(initial?.place || '');
  const [memo, setMemo] = useState(initial?.memo || '');
  const [frequency, setFrequency] = useState<'monthly' | 'bimonthly' | 'yearly'>(initial?.frequency || 'monthly');
  const [dayOfMonth, setDayOfMonth] = useState(initial ? String(initial.dayOfMonth) : '1');
  const [repeatMonth, setRepeatMonth] = useState(initial ? String(initial.repeatMonth) : '1');
  const [startMonth, setStartMonth] = useState(initial?.startMonth || '');
  const [endMonth, setEndMonth] = useState(initial?.endMonth || '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  const handleSubmit = () => {
    onSave({
      category,
      amount: Number(amount),
      payer,
      place,
      memo,
      frequency,
      dayOfMonth: Number(dayOfMonth),
      repeatMonth: frequency === 'yearly' ? Number(repeatMonth) : 0,
      startMonth,
      endMonth,
      isActive,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{initial ? 'テンプレートを編集' : 'テンプレートを追加'}</h3>
          <button className="modal-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-field">
          <label>頻度</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as 'monthly' | 'bimonthly' | 'yearly')}>
            <option value="monthly">毎月</option>
            <option value="bimonthly">隔月</option>
            <option value="yearly">毎年</option>
          </select>
        </div>

        {frequency === 'yearly' && (
          <div className="modal-field">
            <label>月</label>
            <select value={repeatMonth} onChange={(e) => setRepeatMonth(e.target.value)}>
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
        )}

        <div className="modal-field">
          <label>日</label>
          <input
            type="number"
            min="1"
            max="31"
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
          />
        </div>

        <div className="modal-field">
          <label>カテゴリ</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="modal-field">
          <label>金額</label>
          <input
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
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
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="メモ（任意）"
          />
        </div>

        <div className="modal-field-row">
          <div className="modal-field">
            <label>開始月</label>
            <input
              type="month"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
            />
          </div>
          <div className="modal-field">
            <label>終了月</label>
            <input
              type="month"
              value={endMonth}
              onChange={(e) => setEndMonth(e.target.value)}
            />
          </div>
        </div>

        <div className="modal-field">
          <label className="recurring-active-label">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            有効
          </label>
        </div>

        <div className="modal-actions">
          <button className="modal-btn modal-btn-primary" onClick={handleSubmit}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export function RecurringPage() {
  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<RecurringExpense | null | 'new'>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      recurringApi.getAll(),
      categoriesApi.getAll(),
      placesApi.getAll(),
      payersApi.getAll(),
    ]).then(([r, c, p, pay]) => {
      setItems(r);
      setCategories(c);
      setPlaces(p);
      setPayers(pay);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleSave = async (input: RecurringExpenseInput) => {
    try {
      if (editTarget === 'new') {
        await recurringApi.create(input);
        setToast('追加しました');
      } else if (editTarget) {
        await recurringApi.update(editTarget.id, input);
        setToast('更新しました');
      }
      setEditTarget(null);
      setItems(await recurringApi.getAll());
    } catch (e) {
      console.error(e);
      setToast('保存に失敗しました');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return;
    try {
      await recurringApi.delete(id);
      setToast('削除しました');
      setItems(await recurringApi.getAll());
    } catch (e) {
      console.error(e);
      setToast('削除に失敗しました');
    }
  };

  const handleRegister = async (item: RecurringExpense) => {
    try {
      await expensesApi.create({
        date: todayString(),
        payer: item.payer,
        category: item.category,
        amount: item.amount,
        memo: item.memo,
        place: item.place,
      });
      setToast(`${item.category} ¥${item.amount.toLocaleString()} を登録しました`);
    } catch (e) {
      console.error(e);
      setToast('登録に失敗しました');
    }
  };

  if (loading) {
    return <div className="loading-spinner"><div className="spinner"></div></div>;
  }

  return (
    <>
      <div className="recurring-header">
        <h2>テンプレート</h2>
        <button className="recurring-add-btn" onClick={() => setEditTarget('new')}>
          + 追加
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty-state"><p>テンプレートはありません</p></div>
      ) : (
        <div className="recurring-list">
          {items.map((item) => (
            <div
              key={item.id}
              className={`recurring-item ${!item.isActive ? 'inactive' : ''}`}
              onClick={() => setEditTarget(item)}
            >
              <div className="recurring-item-body">
                <div className="recurring-item-top">
                  <span className="recurring-item-category">{item.category}</span>
                  <span className="recurring-item-amount">&yen;{item.amount.toLocaleString()}</span>
                </div>
                <div className="recurring-item-meta">
                  <span className="recurring-item-freq">{frequencyLabel(item)}</span>
                  {(item.startMonth || item.endMonth) && (
                    <span className="recurring-item-period">
                      {item.startMonth || '~'} ~ {item.endMonth || ''}
                    </span>
                  )}
                  {item.payer && <span className="recurring-item-payer">{item.payer}</span>}
                  {item.memo && <span className="recurring-item-memo">{item.memo}</span>}
                  {!item.isActive && <span className="recurring-item-badge">停止中</span>}
                </div>
              </div>
              <button
                className="recurring-register-btn"
                onClick={(e) => { e.stopPropagation(); handleRegister(item); }}
                title="今日の日付で登録"
              >
                登録
              </button>
              <button
                className="recurring-delete-btn"
                onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {editTarget && (
        <RecurringModal
          initial={editTarget === 'new' ? undefined : editTarget}
          categories={categories}
          places={places}
          payers={payers}
          onSave={handleSave}
          onClose={() => setEditTarget(null)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
