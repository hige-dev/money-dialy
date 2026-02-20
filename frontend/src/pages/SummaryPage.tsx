import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title } from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';
import { MonthPicker } from '../components/MonthPicker';
import { summaryApi, payersApi, expensesApi } from '../services/api';
import type { MonthlySummary, YearlySummary, Payer, PayerBalance, CategorySummary, Expense } from '../types';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function formatDiff(diff: number, percent: number): string {
  const sign = diff >= 0 ? '+' : '';
  return `${sign}\u00a5${Math.abs(diff).toLocaleString()} (${sign}${percent.toFixed(1)}%)`;
}

/** 年間データから全カテゴリ（色付き）を収集 */
function collectCategories(yearly: YearlySummary): { name: string; color: string }[] {
  const map = new Map<string, string>();
  for (const m of yearly.months) {
    for (const c of (m.byCategory || [])) {
      if (!map.has(c.category)) {
        map.set(c.category, c.color);
      }
    }
  }
  return Array.from(map.entries()).map(([name, color]) => ({ name, color }));
}

/** カテゴリ別積み上げ棒グラフ用データ生成 */
function buildStackedBarData(yearly: YearlySummary) {
  const categories = collectCategories(yearly);
  const lastMonth = yearly.months[yearly.months.length - 1]?.month || '';
  const lastYear = lastMonth.split('-')[0];
  const labels = yearly.months.map((m) => {
    const [y, mon] = m.month.split('-');
    const monthNum = Number(mon);
    return y !== lastYear ? `${y.slice(2)}/${monthNum}` : `${monthNum}月`;
  });

  const datasets = categories.map((cat) => ({
    label: cat.name,
    data: yearly.months.map((m) => {
      const found = (m.byCategory || []).find((c) => c.category === cat.name);
      return found ? found.amount : 0;
    }),
    backgroundColor: cat.color,
    hoverBackgroundColor: cat.color,
  }));

  return { labels, datasets };
}

/** 元の色を保持するMap（Chart.jsのデータ書き換え後も復元可能にする） */
const originalColors = new Map<string, string>();

function toRgba(hex: string, alpha: number): string {
  if (hex.startsWith('rgba')) return hex.replace(/[\d.]+\)$/, `${alpha})`);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildStackedBarOptions(selectedRef: React.RefObject<Set<number>>, onFilterChange: (count: number) => void): ChartOptions<'bar'> {
  const isFiltered = () => selectedRef.current.size > 0;
  return {
    responsive: true,
    interaction: { mode: 'index' as const },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { font: { size: 11 }, boxWidth: 12 },
        onClick: (_event, legendItem, legend) => {
          const chart = legend.chart;
          const clickedIdx = legendItem.datasetIndex;
          if (clickedIdx == null) return;
          const selected = selectedRef.current;

          if (selected.has(clickedIdx)) {
            // 選択済みをクリック → 解除
            selected.delete(clickedIdx);
          } else {
            // 未選択をクリック → 追加
            selected.add(clickedIdx);
          }

          // 全項目が選択された場合もフィルタ解除
          if (selected.size === 0 || selected.size === chart.data.datasets.length) {
            selected.clear();
            chart.data.datasets.forEach((_ds, i) => {
              chart.setDatasetVisibility(i, true);
            });
          } else {
            chart.data.datasets.forEach((_ds, i) => {
              chart.setDatasetVisibility(i, selected.has(i));
            });
          }
          chart.update();
          onFilterChange(selected.size);
        },
        onHover: (_event, legendItem, legend) => {
          if (isFiltered()) return;
          const chart = legend.chart;
          const idx = legendItem.datasetIndex;
          if (idx == null) return;
          chart.data.datasets.forEach((ds, i) => {
            const key = `ds-${i}`;
            const bg = ds.backgroundColor;
            if (typeof bg !== 'string') return;
            if (!originalColors.has(key)) originalColors.set(key, bg);
            const orig = originalColors.get(key)!;
            ds.backgroundColor = i === idx ? orig : toRgba(orig, 0.15);
          });
          chart.update('none');
        },
        onLeave: (_event, _legendItem, legend) => {
          if (isFiltered()) return;
          const chart = legend.chart;
          chart.data.datasets.forEach((ds, i) => {
            const orig = originalColors.get(`ds-${i}`);
            if (orig) ds.backgroundColor = orig;
          });
          chart.update('none');
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: \u00a5${(ctx.parsed.y ?? 0).toLocaleString()}`,
          footer: (items) => {
            if (items.length <= 1) return '';
            const total = items.reduce((sum, item) => sum + (item.parsed.y ?? 0), 0);
            return `合計: \u00a5${total.toLocaleString()}`;
          },
        },
      },
    },
    scales: {
      x: { stacked: true },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: {
          callback: (value) => `\u00a5${Number(value).toLocaleString()}`,
        },
      },
    },
  };
}

export function SummaryPage() {
  const [date, setDate] = useState(todayString());
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [yearly, setYearly] = useState<YearlySummary | null>(null);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [selectedPayer, setSelectedPayer] = useState('');
  const [payerBalance, setPayerBalance] = useState<PayerBalance | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedChart, setExpandedChart] = useState<'doughnut' | 'bar' | null>(null);
  const [filterCount, setFilterCount] = useState(0);
  const [breakdownTab, setBreakdownTab] = useState<'category' | 'place'>('category');
  const navigate = useNavigate();
  const selectedRef = useRef(new Set<number>());
  const barScrollRef = useRef<HTMLDivElement>(null);
  const barChartRef = useRef<ChartJS<'bar'>>(null);
  const stackedBarOptions = useMemo(() => buildStackedBarOptions(selectedRef, setFilterCount), []);

  const month = getMonth(date);

  // 支払元一覧を取得
  useEffect(() => {
    payersApi.getAll().then(setPayers).catch(console.error);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const payer = selectedPayer || undefined;
      const [m, y, exp] = await Promise.all([
        summaryApi.getMonthly(month, payer),
        summaryApi.getYearly(month, payer),
        expensesApi.getByMonth(month),
      ]);
      setSummary(m);
      setYearly(y);
      setExpenses(exp || []);

      // trackBalance=true の支払元が選択されている場合のみ残額を取得
      const selectedPayerObj = payers.find((p) => p.name === selectedPayer);
      if (selectedPayerObj?.trackBalance) {
        const balance = await payersApi.getBalance(selectedPayer, month);
        setPayerBalance(balance);
      } else {
        setPayerBalance(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [month, selectedPayer, payers]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // カテゴリ別積み上げ棒グラフデータ（yearlyが変わった時だけ再生成＆選択解除）
  const stackedBarData = useMemo(() => {
    selectedRef.current.clear();
    setFilterCount(0);
    return yearly ? buildStackedBarData(yearly) : null;
  }, [yearly]);

  // 場所別集計
  const placeRanking = useMemo(() => {
    const filtered = selectedPayer
      ? expenses.filter((e) => e.payer === selectedPayer)
      : expenses;
    const map = new Map<string, number>();
    for (const e of filtered) {
      const place = e.place || '未設定';
      map.set(place, (map.get(place) || 0) + e.amount);
    }
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0);
    return Array.from(map.entries())
      .map(([place, amount]) => ({ place, amount, percent: total > 0 ? (amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses, selectedPayer]);

  // 拡大/縮小時・データ変更時にChart.jsのレイアウト再計算＆右端スクロール
  useEffect(() => {
    requestAnimationFrame(() => {
      barChartRef.current?.resize();
      if (barScrollRef.current) {
        barScrollRef.current.scrollLeft = barScrollRef.current.scrollWidth;
      }
    });
  }, [expandedChart, stackedBarData]);

  if (loading) {
    return (
      <>
        <MonthPicker value={date} onChange={setDate} mode="month" />
        <div className="loading-spinner"><div className="spinner"></div></div>
      </>
    );
  }

  if (!summary) {
    return (
      <>
        <MonthPicker value={date} onChange={setDate} mode="month" />
        <div className="empty-state"><p>データの取得に失敗しました</p></div>
      </>
    );
  }

  const categories = summary.byCategory || [];

  // 円グラフデータ
  const doughnutData = {
    labels: categories.map((c: CategorySummary) => c.category),
    datasets: [{
      data: categories.map((c: CategorySummary) => c.amount),
      backgroundColor: categories.map((c: CategorySummary) => c.color),
      borderWidth: 1,
      borderColor: '#fff',
    }],
  };

  return (
    <>
      <MonthPicker value={date} onChange={setDate} mode="month" />

      {/* 支払元フィルタ */}
      <div className="payer-filter">
        <button
          className={`payer-filter-btn ${selectedPayer === '' ? 'active' : ''}`}
          onClick={() => setSelectedPayer('')}
        >
          全体
        </button>
        {payers.map((p) => (
          <button
            key={p.id}
            className={`payer-filter-btn ${selectedPayer === p.name ? 'active' : ''}`}
            onClick={() => setSelectedPayer(p.name)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* 残額表示（支払元選択時のみ） */}
      {payerBalance && (payerBalance.carryover !== 0 || payerBalance.monthCharge > 0) && (
        <div className="payer-balance">
          <span className="payer-balance-label">{payerBalance.payer} 残額</span>
          <span className={`payer-balance-amount ${payerBalance.balance < 0 ? 'negative' : ''}`}>
            &yen;{payerBalance.balance.toLocaleString()}
          </span>
          <span className="payer-balance-detail">
            (前月繰越 &yen;{payerBalance.carryover.toLocaleString()}
            {' + '}チャージ &yen;{payerBalance.monthCharge.toLocaleString()}
            {' - '}支出 &yen;{payerBalance.monthSpent.toLocaleString()})
          </span>
        </div>
      )}

      {/* 合計・比較 */}
      <div className="summary-totals">
        <div className="summary-total-amount">
          &yen;{summary.total.toLocaleString()}
        </div>
        <div className="summary-comparison">
          {summary.previousMonth && (
            <div className="summary-comparison-item">
              <span>前月比: </span>
              <span className={summary.previousMonth.diff >= 0 ? 'summary-diff-positive' : 'summary-diff-negative'}>
                {formatDiff(summary.previousMonth.diff, summary.previousMonth.diffPercent)}
              </span>
            </div>
          )}
          {summary.previousYearMonth && (
            <div className="summary-comparison-item">
              <span>前年比: </span>
              <span className={summary.previousYearMonth.diff >= 0 ? 'summary-diff-positive' : 'summary-diff-negative'}>
                {formatDiff(summary.previousYearMonth.diff, summary.previousYearMonth.diffPercent)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 円グラフ */}
      <div className={`summary-chart ${expandedChart === 'doughnut' ? 'expanded' : ''}`}>
        <div className="summary-chart-header">
          <h3>カテゴリ別割合</h3>
          <button
            className="chart-expand-btn"
            onClick={() => setExpandedChart(expandedChart === 'doughnut' ? null : 'doughnut')}
          >
            {expandedChart === 'doughnut' ? '✕' : '⤢'}
          </button>
        </div>
        {categories.length > 0 ? (
          <Doughnut
            data={doughnutData}
            options={{
              responsive: true,
              plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
              },
            }}
          />
        ) : (
          <div className="empty-state"><p>この月のデータはありません</p></div>
        )}
      </div>

      {/* カテゴリ別月推移（積み上げ棒グラフ） */}
      {stackedBarData && (
        <div className={`summary-chart ${expandedChart === 'bar' ? 'expanded' : ''}`}>
          <div className="summary-chart-header">
            <h3>カテゴリ別月推移</h3>
            <div style={{ display: 'flex', gap: 4 }}>
              {filterCount > 0 && selectedRef.current.size > 0 && (
                <button
                  className="chart-expand-btn"
                  style={{ fontSize: '0.75rem' }}
                  onClick={() => {
                    const chart = barChartRef.current;
                    if (!chart) return;
                    selectedRef.current.clear();
                    chart.data.datasets.forEach((_ds, i) => {
                      chart.setDatasetVisibility(i, true);
                    });
                    chart.update();
                    setFilterCount(0);
                  }}
                >
                  リセット
                </button>
              )}
              <button
                className="chart-expand-btn"
                onClick={() => setExpandedChart(expandedChart === 'bar' ? null : 'bar')}
              >
                {expandedChart === 'bar' ? '✕' : '⤢'}
              </button>
            </div>
          </div>
          <div className="chart-scroll-container" ref={barScrollRef}>
            <div className="chart-scroll-inner">
              <Bar ref={barChartRef} data={stackedBarData} options={stackedBarOptions} />
            </div>
          </div>
        </div>
      )}

      {/* 内訳タブ */}
      {(categories.length > 0 || placeRanking.length > 0) && (
        <div className="summary-category-list">
          <div className="summary-breakdown-tabs">
            <button
              className={`summary-breakdown-tab ${breakdownTab === 'category' ? 'active' : ''}`}
              onClick={() => setBreakdownTab('category')}
            >
              カテゴリ別
            </button>
            <button
              className={`summary-breakdown-tab ${breakdownTab === 'place' ? 'active' : ''}`}
              onClick={() => setBreakdownTab('place')}
            >
              場所別
            </button>
          </div>

          {breakdownTab === 'category' && categories.map((cat) => {
            const percent = summary.total > 0
              ? ((cat.amount / summary.total) * 100).toFixed(1)
              : '0.0';
            return (
              <div key={cat.category} className="summary-category-item">
                <div className="summary-category-color" style={{ background: cat.color }} />
                <span className="summary-category-name">{cat.category}</span>
                <span className="summary-category-amount">&yen;{cat.amount.toLocaleString()}</span>
                <span className="summary-category-percent">{percent}%</span>
              </div>
            );
          })}

          {breakdownTab === 'place' && placeRanking.map((item) => (
            <div key={item.place} className="summary-category-item">
              <span className="summary-category-name">{item.place}</span>
              <span className="summary-category-amount">&yen;{item.amount.toLocaleString()}</span>
              <span className="summary-category-percent">{item.percent.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}

      {/* 最下部の月移動 */}
      <MonthPicker value={date} onChange={setDate} mode="month" />

      {/* 定期支出・設定リンク */}
      <div className="summary-recurring-link">
        <button className="recurring-link-btn" onClick={() => navigate('/recurring')}>
          テンプレートを管理
        </button>
        <button className="recurring-link-btn" onClick={() => navigate('/settings')} style={{ marginTop: 8 }}>
          設定（マスタ管理）
        </button>
      </div>
    </>
  );
}
