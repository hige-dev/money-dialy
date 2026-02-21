import { useState, useEffect, useCallback, useMemo } from 'react';
import { MonthPicker } from '../components/MonthPicker';
import { expensesApi, categoriesApi } from '../services/api';
import type { Expense, Category } from '../types';

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function BalancePage() {
  const [date, setDate] = useState(todayString());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const month = getMonth(date);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [exp, cats] = await Promise.all([
        expensesApi.getByMonth(month),
        categoriesApi.getAll(),
      ]);
      setExpenses(exp || []);
      setCategories(cats || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const expenseCategorySet = useMemo(
    () => new Set(categories.filter((c) => c.isExpense).map((c) => c.id)),
    [categories],
  );

  const colorMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.color])),
    [categories],
  );

  const catNameMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const { incomeItems, expenseItems, incomeTotal, expenseTotal } = useMemo(() => {
    const incMap = new Map<string, number>();
    const expMap = new Map<string, number>();

    for (const e of expenses) {
      if (expenseCategorySet.has(e.category)) {
        expMap.set(e.category, (expMap.get(e.category) || 0) + e.amount);
      } else {
        incMap.set(e.category, (incMap.get(e.category) || 0) + e.amount);
      }
    }

    const inc = Array.from(incMap, ([categoryId, amount]) => ({ categoryId, name: catNameMap.get(categoryId) || categoryId, amount }))
      .sort((a, b) => b.amount - a.amount);
    const exp = Array.from(expMap, ([categoryId, amount]) => ({ categoryId, name: catNameMap.get(categoryId) || categoryId, amount }))
      .sort((a, b) => b.amount - a.amount);

    return {
      incomeItems: inc,
      expenseItems: exp,
      incomeTotal: inc.reduce((s, i) => s + i.amount, 0),
      expenseTotal: exp.reduce((s, i) => s + i.amount, 0),
    };
  }, [expenses, expenseCategorySet, catNameMap]);

  const balance = incomeTotal - expenseTotal;

  return (
    <>
      <MonthPicker value={date} onChange={setDate} mode="month" />

      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : (
        <>
          {/* 収支サマリー */}
          <div className="summary-totals">
            <div className="summary-total-amount" style={{ color: balance >= 0 ? '#059669' : '#dc2626' }}>
              {balance >= 0 ? '+' : ''}&yen;{balance.toLocaleString()}
            </div>
            <div className="summary-comparison">
              <div className="summary-comparison-item">
                <span>収入: </span>
                <span style={{ color: '#059669' }}>&yen;{incomeTotal.toLocaleString()}</span>
              </div>
              <div className="summary-comparison-item">
                <span>支出: </span>
                <span style={{ color: '#dc2626' }}>&yen;{expenseTotal.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* 収入内訳 */}
          {incomeItems.length > 0 && (
            <div className="summary-category-list">
              <div className="summary-breakdown-tabs">
                <button className="summary-breakdown-tab active">収入</button>
              </div>
              {incomeItems.map((item) => (
                <div key={item.categoryId} className="summary-category-item">
                  <div className="summary-category-color" style={{ background: colorMap.get(item.categoryId) || '#059669' }} />
                  <span className="summary-category-name">{item.name}</span>
                  <span className="summary-category-amount">&yen;{item.amount.toLocaleString()}</span>
                  <span className="summary-category-percent">
                    {incomeTotal > 0 ? ((item.amount / incomeTotal) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 支出内訳 */}
          {expenseItems.length > 0 && (
            <div className="summary-category-list">
              <div className="summary-breakdown-tabs">
                <button className="summary-breakdown-tab active">支出</button>
              </div>
              {expenseItems.map((item) => (
                <div key={item.categoryId} className="summary-category-item">
                  <div className="summary-category-color" style={{ background: colorMap.get(item.categoryId) || '#dc2626' }} />
                  <span className="summary-category-name">{item.name}</span>
                  <span className="summary-category-amount">&yen;{item.amount.toLocaleString()}</span>
                  <span className="summary-category-percent">
                    {expenseTotal > 0 ? ((item.amount / expenseTotal) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {incomeItems.length === 0 && expenseItems.length === 0 && (
            <div className="empty-state"><p>この月のデータはありません</p></div>
          )}
        </>
      )}
    </>
  );
}
