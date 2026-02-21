import { useState, useRef, useEffect } from 'react';

interface MonthPickerProps {
  /** YYYY-MM-DD 形式 */
  value: string;
  onChange: (date: string) => void;
  /** 日付単位で選択するモード（デフォルト） */
  mode?: 'date' | 'month';
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const WEEKDAY_HEADERS = ['日', '月', '火', '水', '木', '金', '土'];
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

/** 指定月のカレンダー用日付グリッドを生成 */
function buildDayGrid(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

export function MonthPicker({ value, onChange, mode = 'date' }: MonthPickerProps) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => Number(value.split('-')[0]));
  const [calendarMonth, setCalendarMonth] = useState(() => Number(value.split('-')[1]));
  const wrapperRef = useRef<HTMLDivElement>(null);

  const currentYear = Number(value.split('-')[0]);
  const currentMonth = Number(value.split('-')[1]);
  const currentDay = Number(value.split('-')[2]);

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
    setCalendarYear(currentYear);
    setCalendarMonth(currentMonth);
    setShowCalendar(!showCalendar);
  };

  // --- 月選択カレンダー用 ---
  const handleSelectMonth = (month: number) => {
    const dateStr = `${calendarYear}-${String(month).padStart(2, '0')}-01`;
    onChange(dateStr);
    setShowCalendar(false);
  };

  const handleTodayMonth = () => {
    const now = new Date();
    setCalendarYear(now.getFullYear());
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    onChange(dateStr);
    setShowCalendar(false);
  };

  // --- 日選択カレンダー用 ---
  const handleSelectDay = (day: number) => {
    const dateStr = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onChange(dateStr);
    setShowCalendar(false);
  };

  const handlePrevMonth = () => {
    if (calendarMonth === 1) {
      setCalendarYear((y) => y - 1);
      setCalendarMonth(12);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (calendarMonth === 12) {
      setCalendarYear((y) => y + 1);
      setCalendarMonth(1);
    } else {
      setCalendarMonth((m) => m + 1);
    }
  };

  const handleTodayDate = () => {
    const now = new Date();
    onChange(toDateString(now));
    setShowCalendar(false);
  };

  const todayYear = new Date().getFullYear();
  const todayMonth = new Date().getMonth() + 1;
  const todayDay = new Date().getDate();

  return (
    <div className="date-picker" ref={wrapperRef}>
      <button className="date-picker-btn" onClick={handlePrev}>&lt;</button>
      <button className="date-picker-label" onClick={handleLabelClick}>
        {mode === 'date' ? formatDate(value) : formatMonth(value)}
      </button>
      <button className="date-picker-btn" onClick={handleNext}>&gt;</button>

      {showCalendar && mode === 'month' && (
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
          <button className="month-calendar-today-btn" onClick={handleTodayMonth}>
            今月に戻る
          </button>
        </div>
      )}

      {showCalendar && mode === 'date' && (
        <div className="month-calendar-popup">
          <div className="month-calendar-header">
            <button className="date-picker-btn" onClick={handlePrevMonth}>&lt;</button>
            <span className="month-calendar-year">{calendarYear}年{calendarMonth}月</span>
            <button className="date-picker-btn" onClick={handleNextMonth}>&gt;</button>
          </div>
          <div className="day-calendar-weekdays">
            {WEEKDAY_HEADERS.map((w) => (
              <span key={w} className="day-calendar-weekday">{w}</span>
            ))}
          </div>
          <div className="day-calendar-grid">
            {buildDayGrid(calendarYear, calendarMonth).map((day, i) => {
              if (day === null) return <span key={`empty-${i}`} className="day-calendar-cell empty" />;
              const isSelected = calendarYear === currentYear && calendarMonth === currentMonth && day === currentDay;
              const isToday = calendarYear === todayYear && calendarMonth === todayMonth && day === todayDay;
              return (
                <button
                  key={day}
                  className={`day-calendar-cell${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}`}
                  onClick={() => handleSelectDay(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <button className="month-calendar-today-btn" onClick={handleTodayDate}>
            今日に戻る
          </button>
        </div>
      )}
    </div>
  );
}
