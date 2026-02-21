import { useState, useEffect } from 'react';
import { categoriesApi, expensesApi, placesApi, payersApi } from '../services/api';
import type { Category, Place, Payer, Visibility, ExpenseInput } from '../types';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM 形式の月を n ヶ月進める */
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const date = new Date(y, m - 1 + n, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** startMonth から endMonth までの YYYY-MM リストを生成 */
function monthRange(start: string, end: string): string[] {
  const months: string[] = [];
  let current = start;
  while (current <= end) {
    months.push(current);
    current = addMonths(current, 1);
  }
  return months;
}

export function BulkExpensePage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedPayer, setSelectedPayer] = useState('');
  const [selectedPlace, setSelectedPlace] = useState('');
  const [customPlace, setCustomPlace] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [day, setDay] = useState('1');
  const [startMonth, setStartMonth] = useState(currentMonth());
  const [endMonth, setEndMonth] = useState(addMonths(currentMonth(), 11));
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      categoriesApi.getAll().then(setCategories),
      placesApi.getAll().then(setPlaces),
      payersApi.getAll().then(setPayers),
    ]).catch((e) => {
      console.error(e);
      setLoadError(String(e));
    });
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const catNameMap = new Map(categories.map((c) => [c.id, c.name]));
  const place = selectedPlace === '__other__' ? customPlace : selectedPlace;
  const numAmount = Number(amount);
  const numDay = Number(day);
  const canSubmit = selectedCategory && selectedPayer && numAmount > 0
    && numDay >= 1 && numDay <= 31
    && startMonth && endMonth && startMonth <= endMonth;

  const months = canSubmit ? monthRange(startMonth, endMonth) : [];

  const buildExpenses = (): ExpenseInput[] => {
    const d = String(numDay).padStart(2, '0');
    return months.map((ym) => ({
      date: `${ym}-${d}`,
      payer: selectedPayer,
      category: selectedCategory,
      amount: numAmount,
      memo,
      place,
      visibility,
    }));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    const expenses = buildExpenses();
    if (!confirm(`${expenses.length}件の支出を一括登録します。よろしいですか？`)) return;

    setLoading(true);
    try {
      await expensesApi.bulkCreate(expenses);
      setToast(`${expenses.length}件を登録しました`);
      setAmount('');
      setMemo('');
    } catch (e) {
      console.error(e);
      setToast('登録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="recurring-header">
        <h2>一括登録</h2>
      </div>
      {loadError && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', color: '#dc2626', fontSize: '0.8rem', wordBreak: 'break-all' }}>
          {loadError}
        </div>
      )}
      <div className="input-form">
        <div className="input-field">
          <label>カテゴリ</label>
          <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
            <option value="">選択してください</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="input-field">
          <label>支払元</label>
          <select value={selectedPayer} onChange={(e) => setSelectedPayer(e.target.value)}>
            <option value="">選択してください</option>
            {payers.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="input-field">
          <label>金額</label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="input-field">
          <label>場所</label>
          <select value={selectedPlace} onChange={(e) => { setSelectedPlace(e.target.value); if (e.target.value !== '__other__') setCustomPlace(''); }}>
            <option value="">未選択</option>
            {places.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
            <option value="__other__">その他</option>
          </select>
          {selectedPlace === '__other__' && (
            <input
              type="text"
              placeholder="場所を入力"
              value={customPlace}
              onChange={(e) => setCustomPlace(e.target.value)}
              style={{ marginTop: '6px' }}
            />
          )}
        </div>
        <div className="input-field">
          <label>メモ</label>
          <input
            type="text"
            placeholder="任意"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
        <div className="input-field">
          <label>公開設定</label>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            <option value="public">全員に公開</option>
            <option value="summary">金額のみ公開</option>
            <option value="private">自分のみ</option>
          </select>
        </div>

        <div className="input-field">
          <label>毎月の日付（1〜31）</label>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="31"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div className="input-field" style={{ flex: 1 }}>
            <label>開始月</label>
            <input
              type="month"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
            />
          </div>
          <div className="input-field" style={{ flex: 1 }}>
            <label>終了月</label>
            <input
              type="month"
              value={endMonth}
              onChange={(e) => setEndMonth(e.target.value)}
            />
          </div>
        </div>

        {/* プレビュー */}
        {canSubmit && (
          <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '12px', fontSize: '0.85rem', color: '#374151' }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
              {catNameMap.get(selectedCategory) || selectedCategory} &yen;{numAmount.toLocaleString()} &times; {months.length}件
              = &yen;{(numAmount * months.length).toLocaleString()}
            </div>
            <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>
              {months[0]} 〜 {months[months.length - 1]}（毎月{numDay}日）
            </div>
          </div>
        )}

        <button
          className="input-submit-btn"
          onClick={handleSubmit}
          disabled={!canSubmit || loading}
        >
          {loading ? '登録中...' : `一括登録${canSubmit ? `（${months.length}件）` : ''}`}
        </button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
