import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Expense, Category, Place, Payer, Visibility } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { isImportedExpense } from '../utils/expenseReview';

interface EditModalProps {
  expense: Expense;
  categories: Category[];
  places: Place[];
  payers: Payer[];
  onSave: (id: string, data: { date: string; payer: string; category: string; amount: number; memo: string; place: string; visibility?: Visibility }) => Promise<boolean>;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function ExpenseEditModal({ expense, categories, places, payers, onSave, onDelete, onClose }: EditModalProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [createRule, setCreateRule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(expense.date);
  const [payer, setPayer] = useState(expense.payer);
  const [category, setCategory] = useState(expense.category);
  const [amount, setAmount] = useState(String(expense.amount));
  const isPredefinedPlace = places.some((p) => p.name === expense.place);
  const [place, setPlace] = useState(!expense.place ? '' : isPredefinedPlace ? expense.place : '__other__');
  const [customPlace, setCustomPlace] = useState(!expense.place || isPredefinedPlace ? '' : expense.place);
  const [memo, setMemo] = useState(expense.memo);
  const [visibility, setVisibility] = useState<Visibility>((expense.visibility || 'public') as Visibility);
  const selectedCategory = categories.find(c => c.id === category);
  const canCreateRule = user?.role === 'admin' && isImportedExpense(expense) && category !== expense.category && !!selectedCategory && !selectedCategory.ownerEmail;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await onSave(expense.id, { date, payer, category, amount: Number(amount), memo, place: place === '__other__' ? customPlace : place, visibility });
      if (saved && canCreateRule && createRule) {
        navigate('/mappings', { state: { mappingDraft: { type: 'keyword', identifier: expense.place.trim(), category } } });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => { if (!saving) onClose(); }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>支出を編集</h3>
          <button className="modal-close-btn" onClick={() => { if (!saving) onClose(); }}>&times;</button>
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
            <option value="">未選択</option>
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
          <select value={place} onChange={(e) => { setPlace(e.target.value); if (e.target.value !== '__other__') setCustomPlace(''); }}>
            <option value="">未選択</option>
            {places.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
            <option value="__other__">その他</option>
          </select>
          {place === '__other__' && (
            <input
              type="text"
              placeholder="場所を入力"
              value={customPlace}
              onChange={(e) => setCustomPlace(e.target.value)}
              style={{ marginTop: '6px' }}
            />
          )}
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
        {canCreateRule && (
          <label className="rule-option">
            <input type="checkbox" checked={createRule} onChange={e => setCreateRule(e.target.checked)} />
            保存後、この利用先の分類ルールを作る
            <small>次回の自動取込に適用します。条件は次の画面で確認できます。</small>
          </label>
        )}
        <div className="modal-actions">
          <button
            className="modal-btn modal-btn-danger"
            disabled={saving}
            onClick={() => { if (confirm('削除しますか？')) onDelete(expense.id); }}
          >
            削除
          </button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={save}
            disabled={saving || !date || !category || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
