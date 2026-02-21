import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 月のカレンダーグリッドを生成（null = 空セル） */
function buildCalendarDays(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  return days;
}

/** 日別合計を集計（isExpense=true のカテゴリのみ） */
function aggregateByDay(expenses: Expense[], expenseCategories: Set<string>): Map<number, number> {
  const map = new Map<number, number>();
  for (const e of expenses) {
    if (!expenseCategories.has(e.category)) continue;
    const day = parseInt(e.date.slice(8, 10), 10);
    map.set(day, (map.get(day) || 0) + e.amount);
  }
  return map;
}

/** 支出額に応じた背景色の濃さ（0.0〜0.5） */
function intensityColor(amount: number, maxAmount: number): string {
  if (amount === 0 || maxAmount === 0) return 'transparent';
  const ratio = Math.min(amount / maxAmount, 1);
  const alpha = 0.1 + ratio * 0.4;
  return `rgba(239, 68, 68, ${alpha})`;
}

export function CalendarPage() {
  const [date, setDate] = useState(todayString());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const month = getMonth(date);
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [exp, cats] = await Promise.all([
        expensesApi.getByMonth(month),
        categoriesApi.getAll(),
      ]);
      setExpenses(exp);
      setCategories(cats);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const expenseCategories = new Set(categories.filter((c) => c.isExpense).map((c) => c.id));
  const days = buildCalendarDays(year, monthNum);
  const dailyTotals = aggregateByDay(expenses, expenseCategories);
  const maxAmount = Math.max(...dailyTotals.values(), 0);
  const monthTotal = [...dailyTotals.values()].reduce((sum, v) => sum + v, 0);

  const today = todayString();
  const todayDay = month === getMonth(today) ? parseInt(today.slice(8, 10), 10) : -1;

  const handleDayClick = (day: number) => {
    const d = `${yearStr}-${monthStr}-${String(day).padStart(2, '0')}`;
    navigate(`/list?date=${d}`);
  };

  return (
    <>
      <MonthPicker value={date} onChange={setDate} mode="month" />
      <div className="calendar-total">
        月合計: &yen;{monthTotal.toLocaleString()}
      </div>

      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : (
        <div className="calendar-grid">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`calendar-header ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>
              {w}
            </div>
          ))}
          {days.map((day, i) => {
            if (day === null) {
              return <div key={`empty-${i}`} className="calendar-cell empty" />;
            }
            const total = dailyTotals.get(day) || 0;
            const isToday = day === todayDay;
            const dow = i % 7;

            return (
              <div
                key={day}
                className={`calendar-cell ${isToday ? 'today' : ''} ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}`}
                style={{ backgroundColor: intensityColor(total, maxAmount) }}
                onClick={() => handleDayClick(day)}
              >
                <span className="calendar-day">{day}</span>
                {total > 0 && (
                  <span className="calendar-amount">
                    &yen;{total >= 10000 ? `${Math.floor(total / 1000)}k` : total.toLocaleString()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
