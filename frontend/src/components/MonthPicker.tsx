import { useState, useRef, useEffect } from 'react';

interface MonthPickerProps {
  /** YYYY-MM-DD 形式 */
  value: string;
  onChange: (date: string) => void;
  /** 日付単位で選択するモード（デフォルト） */
  mode?: 'date' | 'month';
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = WEEKDAYS[d.getDay()];
  return `${y}年${m}月${day}日 (${w})`;
}

function formatMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  return `${y}年${Number(m)}月`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

function addMonths(dateStr: string, months: number): string {
  const [y, m] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function MonthPicker({ value, onChange, mode = 'date' }: MonthPickerProps) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => Number(value.split('-')[0]));
  const wrapperRef = useRef<HTMLDivElement>(null);

  const currentYear = Number(value.split('-')[0]);
  const currentMonth = Number(value.split('-')[1]);

  // ポップアップ外クリックで閉じる
  useEffect(() => {
    if (!showCalendar) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showCalendar]);

  const handlePrev = () => {
    onChange(mode === 'date' ? addDays(value, -1) : addMonths(value, -1));
  };

  const handleNext = () => {
    onChange(mode === 'date' ? addDays(value, 1) : addMonths(value, 1));
  };

  const handleLabelClick = () => {
    if (mode === 'date') {
      onChange(toDateString(new Date()));
    } else {
      setCalendarYear(currentYear);
      setShowCalendar(!showCalendar);
    }
  };

  const handleSelectMonth = (month: number) => {
    const dateStr = `${calendarYear}-${String(month).padStart(2, '0')}-01`;
    onChange(dateStr);
    setShowCalendar(false);
  };

  const handleToday = () => {
    const now = new Date();
    setCalendarYear(now.getFullYear());
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    onChange(dateStr);
    setShowCalendar(false);
  };

  const todayYear = new Date().getFullYear();
  const todayMonth = new Date().getMonth() + 1;

  return (
    <div className="date-picker" ref={wrapperRef}>
      <button className="date-picker-btn" onClick={handlePrev}>&lt;</button>
      <button className="date-picker-label" onClick={handleLabelClick}>
        {mode === 'date' ? formatDate(value) : formatMonth(value)}
      </button>
      <button className="date-picker-btn" onClick={handleNext}>&gt;</button>

      {showCalendar && (
        <div className="month-calendar-popup">
          <div className="month-calendar-header">
            <button className="date-picker-btn" onClick={() => setCalendarYear(y => y - 1)}>&lt;</button>
            <span className="month-calendar-year">{calendarYear}年</span>
            <button className="date-picker-btn" onClick={() => setCalendarYear(y => y + 1)}>&gt;</button>
          </div>
          <div className="month-calendar-grid">
            {MONTH_LABELS.map((label, i) => {
              const m = i + 1;
              const isSelected = calendarYear === currentYear && m === currentMonth;
              const isToday = calendarYear === todayYear && m === todayMonth;
              return (
                <button
                  key={m}
                  className={`month-calendar-cell${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}`}
                  onClick={() => handleSelectMonth(m)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button className="month-calendar-today-btn" onClick={handleToday}>
            今月に戻る
          </button>
        </div>
      )}
    </div>
  );
}
