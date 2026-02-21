import { useState, useEffect } from 'react';
import { MonthPicker } from '../components/MonthPicker';
import { categoriesApi, expensesApi, placesApi, payersApi } from '../services/api';
import type { Category, Place, Payer, Visibility } from '../types';

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ExpenseInputPage() {
  const [date, setDate] = useState(todayString());
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
      const timer = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const catNameMap = new Map(categories.map((c) => [c.id, c.name]));

  const canSubmit = selectedCategory && selectedPayer && Number(amount) > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setLoading(true);
    try {
      const numAmount = Number(amount);
      await expensesApi.create({
        date,
        payer: selectedPayer,
        category: selectedCategory,
        amount: numAmount,
        memo,
        place: selectedPlace === '__other__' ? customPlace : selectedPlace,
        visibility,
      });
      setToast(`${catNameMap.get(selectedCategory) || selectedCategory} \u00a5${numAmount.toLocaleString()} を登録しました`);
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
      <MonthPicker value={date} onChange={setDate} mode="date" />
      {loadError && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', color: '#dc2626', fontSize: '0.8rem', wordBreak: 'break-all' }}>
          {loadError}
        </div>
      )}
      <div className="input-form">
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
          <label>カテゴリ</label>
          <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
            <option value="">選択してください</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
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
        <button
          className="input-submit-btn"
          onClick={handleSubmit}
          disabled={!canSubmit || loading}
        >
          {loading ? '登録中...' : '登録'}
        </button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
