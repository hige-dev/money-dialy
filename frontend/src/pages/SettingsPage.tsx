import { useState, useEffect } from 'react';
import { categoriesApi, placesApi, payersApi } from '../services/api';
import type { Category, Place, Payer, CategoryInput, PlaceInput, PayerInput } from '../types';

type Tab = 'categories' | 'places' | 'payers';

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function generateGradientColors(count: number): string[] {
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const hue = Math.round((360 * i) / count);
    colors.push(hslToHex(hue, 65, 55));
  }
  return colors;
}

// --- カテゴリモーダル ---
function CategoryModal({
  initial,
  categories,
  onSave,
  onDelete,
  onClose,
}: {
  initial?: Category;
  categories: Category[];
  onSave: (input: CategoryInput) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const gradientColors = generateGradientColors(Math.max(categories.length + 1, 8));
  const defaultColor = initial?.color || gradientColors[categories.length % gradientColors.length];

  const [name, setName] = useState(initial?.name || '');
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [color, setColor] = useState(defaultColor);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [isExpense, setIsExpense] = useState(initial?.isExpense ?? true);
  const [excludeFromBreakdown, setExcludeFromBreakdown] = useState(initial?.excludeFromBreakdown ?? false);
  const [excludeFromSummary, setExcludeFromSummary] = useState(initial?.excludeFromSummary ?? false);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{initial ? 'カテゴリを編集' : 'カテゴリを追加'}</h3>
          <button className="modal-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-field">
          <label>名前</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="カテゴリ名" />
        </div>

        <div className="modal-field">
          <label>色</label>
          <div className="settings-color-picker">
            {gradientColors.map((c, i) => (
              <button
                key={i}
                className={`settings-color-swatch ${color === c ? 'selected' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ marginTop: 4, width: '100%', height: 32 }} />
        </div>

        <div className="modal-field">
          <label>並び順</label>
          <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </div>

        <div className="modal-field">
          <label className="recurring-active-label">
            <input type="checkbox" checked={isExpense} onChange={(e) => setIsExpense(e.target.checked)} />
            支出カテゴリ
          </label>
        </div>

        <div className="modal-field">
          <label className="recurring-active-label">
            <input type="checkbox" checked={excludeFromBreakdown} onChange={(e) => setExcludeFromBreakdown(e.target.checked)} />
            内訳から除外（総額には含む）
          </label>
        </div>

        <div className="modal-field">
          <label className="recurring-active-label">
            <input type="checkbox" checked={excludeFromSummary} onChange={(e) => setExcludeFromSummary(e.target.checked)} />
            集計から除外（Balanceのみ表示）
          </label>
        </div>

        <div className="modal-field">
          <label className="recurring-active-label">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            有効
          </label>
        </div>

        <div className="modal-actions">
          <button
            className="modal-btn modal-btn-primary"
            onClick={() => onSave({ name, sortOrder: Number(sortOrder), color, isActive, isExpense, excludeFromBreakdown, excludeFromSummary })}
            disabled={!name.trim()}
          >
            保存
          </button>
          {initial && onDelete && (
            <button className="modal-btn modal-btn-danger" onClick={onDelete}>削除</button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- 場所モーダル ---
function PlaceModal({
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  initial?: Place;
  onSave: (input: PlaceInput) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{initial ? '場所を編集' : '場所を追加'}</h3>
          <button className="modal-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-field">
          <label>名前</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="場所名" />
        </div>

        <div className="modal-field">
          <label>並び順</label>
          <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </div>

        <div className="modal-field">
          <label className="recurring-active-label">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            有効
          </label>
        </div>

        <div className="modal-actions">
          <button
            className="modal-btn modal-btn-primary"
            onClick={() => onSave({ name, sortOrder: Number(sortOrder), isActive })}
            disabled={!name.trim()}
          >
            保存
          </button>
          {initial && onDelete && (
            <button className="modal-btn modal-btn-danger" onClick={onDelete}>削除</button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- 支払元モーダル ---
function PayerModal({
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  initial?: Payer;
  onSave: (input: PayerInput) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [trackBalance, setTrackBalance] = useState(initial?.trackBalance ?? false);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{initial ? '支払元を編集' : '支払元を追加'}</h3>
          <button className="modal-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-field">
          <label>名前</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="支払元名" />
        </div>

        <div className="modal-field">
          <label>並び順</label>
          <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </div>

        <div className="modal-field">
          <label className="recurring-active-label">
            <input type="checkbox" checked={trackBalance} onChange={(e) => setTrackBalance(e.target.checked)} />
            残額を追跡
          </label>
        </div>

        <div className="modal-field">
          <label className="recurring-active-label">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            有効
          </label>
        </div>

        <div className="modal-actions">
          <button
            className="modal-btn modal-btn-primary"
            onClick={() => onSave({ name, sortOrder: Number(sortOrder), isActive, trackBalance })}
            disabled={!name.trim()}
          >
            保存
          </button>
          {initial && onDelete && (
            <button className="modal-btn modal-btn-danger" onClick={onDelete}>削除</button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- メインページ ---
export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('categories');
  const [categories, setCategories] = useState<Category[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // モーダル状態
  const [editCategory, setEditCategory] = useState<Category | null | 'new'>(null);
  const [editPlace, setEditPlace] = useState<Place | null | 'new'>(null);
  const [editPayer, setEditPayer] = useState<Payer | null | 'new'>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [c, p, pay] = await Promise.all([
        categoriesApi.getAllIncludingInactive(),
        placesApi.getAllIncludingInactive(),
        payersApi.getAllIncludingInactive(),
      ]);
      setCategories(c || []);
      setPlaces(p || []);
      setPayers(pay || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // --- カテゴリ CRUD ---
  const handleSaveCategory = async (input: CategoryInput) => {
    try {
      if (editCategory === 'new') {
        await categoriesApi.create(input);
        setToast('カテゴリを追加しました');
      } else if (editCategory) {
        await categoriesApi.update(editCategory.id, input);
        setToast('カテゴリを更新しました');
      }
      setEditCategory(null);
      setCategories(await categoriesApi.getAllIncludingInactive() || []);
    } catch (e) {
      console.error(e);
      setToast('保存に失敗しました');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('このカテゴリを削除しますか？使用中のデータには影響しません。')) return;
    try {
      await categoriesApi.delete(id);
      setEditCategory(null);
      setToast('カテゴリを削除しました');
      setCategories(await categoriesApi.getAllIncludingInactive() || []);
    } catch (e) {
      console.error(e);
      setToast('削除に失敗しました');
    }
  };

  // --- 場所 CRUD ---
  const handleSavePlace = async (input: PlaceInput) => {
    try {
      if (editPlace === 'new') {
        await placesApi.create(input);
        setToast('場所を追加しました');
      } else if (editPlace) {
        await placesApi.update(editPlace.id, input);
        setToast('場所を更新しました');
      }
      setEditPlace(null);
      setPlaces(await placesApi.getAllIncludingInactive() || []);
    } catch (e) {
      console.error(e);
      setToast('保存に失敗しました');
    }
  };

  const handleDeletePlace = async (id: string) => {
    if (!confirm('この場所を削除しますか？使用中のデータには影響しません。')) return;
    try {
      await placesApi.delete(id);
      setEditPlace(null);
      setToast('場所を削除しました');
      setPlaces(await placesApi.getAllIncludingInactive() || []);
    } catch (e) {
      console.error(e);
      setToast('削除に失敗しました');
    }
  };

  // --- 支払元 CRUD ---
  const handleSavePayer = async (input: PayerInput) => {
    try {
      if (editPayer === 'new') {
        await payersApi.create(input);
        setToast('支払元を追加しました');
      } else if (editPayer) {
        await payersApi.update(editPayer.id, input);
        setToast('支払元を更新しました');
      }
      setEditPayer(null);
      setPayers(await payersApi.getAllIncludingInactive() || []);
    } catch (e) {
      console.error(e);
      setToast('保存に失敗しました');
    }
  };

  const handleDeletePayer = async (id: string) => {
    if (!confirm('この支払元を削除しますか？使用中のデータには影響しません。')) return;
    try {
      await payersApi.delete(id);
      setEditPayer(null);
      setToast('支払元を削除しました');
      setPayers(await payersApi.getAllIncludingInactive() || []);
    } catch (e) {
      console.error(e);
      setToast('削除に失敗しました');
    }
  };

  if (loading) {
    return <div className="loading-spinner"><div className="spinner"></div></div>;
  }

  return (
    <>
      <div className="recurring-header">
        <h2>設定</h2>
      </div>

      {/* タブ */}
      <div className="settings-tabs">
        <button className={`settings-tab ${tab === 'categories' ? 'active' : ''}`} onClick={() => setTab('categories')}>
          カテゴリ
        </button>
        <button className={`settings-tab ${tab === 'places' ? 'active' : ''}`} onClick={() => setTab('places')}>
          場所
        </button>
        <button className={`settings-tab ${tab === 'payers' ? 'active' : ''}`} onClick={() => setTab('payers')}>
          支払元
        </button>
      </div>

      {/* カテゴリタブ */}
      {tab === 'categories' && (
        <>
          <div className="settings-add-row">
            <button
              className="recurring-add-btn"
              style={{ fontSize: '0.75rem', padding: '4px 10px', background: '#f3f4f6', color: '#374151' }}
              onClick={async () => {
                if (!confirm('全カテゴリの色を並び順に応じたグラデーションに振り直しますか？')) return;
                const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
                const colors = generateGradientColors(sorted.length);
                try {
                  for (let i = 0; i < sorted.length; i++) {
                    await categoriesApi.update(sorted[i].id, {
                      name: sorted[i].name,
                      sortOrder: sorted[i].sortOrder,
                      color: colors[i],
                      isActive: sorted[i].isActive,
                      isExpense: sorted[i].isExpense,
                      excludeFromBreakdown: sorted[i].excludeFromBreakdown,
                      excludeFromSummary: sorted[i].excludeFromSummary,
                    });
                  }
                  setCategories(await categoriesApi.getAllIncludingInactive() || []);
                  setToast('色を振り直しました');
                } catch (e) {
                  console.error(e);
                  setToast('色の振り直しに失敗しました');
                }
              }}
            >
              色を自動振り分け
            </button>
            <button className="recurring-add-btn" onClick={() => setEditCategory('new')}>+ 追加</button>
          </div>
          <div className="settings-list">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className={`settings-item ${!cat.isActive ? 'inactive' : ''}`}
                onClick={() => setEditCategory(cat)}
              >
                <div className="settings-item-color" style={{ background: cat.color }} />
                <div className="settings-item-body">
                  <span className="settings-item-name">{cat.name}</span>
                  <span className="settings-item-meta">
                    {!cat.isExpense && <span className="settings-item-badge">収入</span>}
                    {!cat.isActive && <span className="settings-item-badge inactive-badge">無効</span>}
                    <span className="settings-item-order">#{cat.sortOrder}</span>
                  </span>
                </div>
              </div>
            ))}
            {categories.length === 0 && <div className="empty-state"><p>カテゴリがありません</p></div>}
          </div>
          {editCategory && (
            <CategoryModal
              initial={editCategory === 'new' ? undefined : editCategory}
              categories={categories}
              onSave={handleSaveCategory}
              onDelete={editCategory !== 'new' ? () => handleDeleteCategory(editCategory.id) : undefined}
              onClose={() => setEditCategory(null)}
            />
          )}
        </>
      )}

      {/* 場所タブ */}
      {tab === 'places' && (
        <>
          <div className="settings-add-row">
            <button className="recurring-add-btn" onClick={() => setEditPlace('new')}>+ 追加</button>
          </div>
          <div className="settings-list">
            {places.map((p) => (
              <div
                key={p.id}
                className={`settings-item ${!p.isActive ? 'inactive' : ''}`}
                onClick={() => setEditPlace(p)}
              >
                <div className="settings-item-body">
                  <span className="settings-item-name">{p.name}</span>
                  <span className="settings-item-meta">
                    {!p.isActive && <span className="settings-item-badge inactive-badge">無効</span>}
                    <span className="settings-item-order">#{p.sortOrder}</span>
                  </span>
                </div>
              </div>
            ))}
            {places.length === 0 && <div className="empty-state"><p>場所がありません</p></div>}
          </div>
          {editPlace && (
            <PlaceModal
              initial={editPlace === 'new' ? undefined : editPlace}
              onSave={handleSavePlace}
              onDelete={editPlace !== 'new' ? () => handleDeletePlace(editPlace.id) : undefined}
              onClose={() => setEditPlace(null)}
            />
          )}
        </>
      )}

      {/* 支払元タブ */}
      {tab === 'payers' && (
        <>
          <div className="settings-add-row">
            <button className="recurring-add-btn" onClick={() => setEditPayer('new')}>+ 追加</button>
          </div>
          <div className="settings-list">
            {payers.map((p) => (
              <div
                key={p.id}
                className={`settings-item ${!p.isActive ? 'inactive' : ''}`}
                onClick={() => setEditPayer(p)}
              >
                <div className="settings-item-body">
                  <span className="settings-item-name">{p.name}</span>
                  <span className="settings-item-meta">
                    {p.trackBalance && <span className="settings-item-badge">残額追跡</span>}
                    {!p.isActive && <span className="settings-item-badge inactive-badge">無効</span>}
                    <span className="settings-item-order">#{p.sortOrder}</span>
                  </span>
                </div>
              </div>
            ))}
            {payers.length === 0 && <div className="empty-state"><p>支払元がありません</p></div>}
          </div>
          {editPayer && (
            <PayerModal
              initial={editPayer === 'new' ? undefined : editPayer}
              onSave={handleSavePayer}
              onDelete={editPayer !== 'new' ? () => handleDeletePayer(editPayer.id) : undefined}
              onClose={() => setEditPayer(null)}
            />
          )}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
