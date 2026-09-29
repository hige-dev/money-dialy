import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { categoriesApi, placesApi, payersApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { Category, Place, Payer, CategoryInput, PlaceInput, PayerInput } from '../types';
import {
  CATEGORY_COLOR_PALETTE,
  categoryColorForIndex,
  categoryDisplayColor,
  categoryPaletteForCount,
  nextAvailableCategoryColor,
} from '../utils/categoryColors';

type Tab = 'categories' | 'places' | 'payers';

// --- カテゴリモーダル ---
function CategoryModal({
  initial,
  categories,
  ownerEmail,
  onSave,
  onDelete,
  onClose,
}: {
  initial?: Category;
  categories: Category[];
  ownerEmail?: string;
  onSave: (input: CategoryInput) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const defaultColor = initial?.color || nextAvailableCategoryColor(categories.map((category) => category.color));

  const [name, setName] = useState(initial?.name || '');
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [color, setColor] = useState(defaultColor);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [isExpense, setIsExpense] = useState(initial?.isExpense ?? true);
  const [excludeFromBreakdown, setExcludeFromBreakdown] = useState(initial?.excludeFromBreakdown ?? false);
  const [excludeFromSummary, setExcludeFromSummary] = useState(initial?.excludeFromSummary ?? false);
  const paletteCandidates = categoryPaletteForCount(Math.max(CATEGORY_COLOR_PALETTE.length, categories.length + 1));
  const displayColor = categoryDisplayColor(color);
  const colorChoices = paletteCandidates.includes(displayColor)
    ? paletteCandidates
    : [...paletteCandidates, displayColor];

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
            {colorChoices.map((c, i) => (
              <button
                key={i}
                className={`settings-color-swatch ${displayColor === c ? 'selected' : ''}`}
                style={{ background: categoryDisplayColor(c) }}
                aria-label={`色 ${i + 1}`}
                title={c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ marginTop: 4, width: '100%', height: 32 }} />
          <div className="category-color-preview">
            <span>画面での表示</span>
            <span className="category-color-preview-swatch" style={{ background: displayColor }} />
            <code>{displayColor}</code>
          </div>
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
            onClick={() => onSave({ name, sortOrder: Number(sortOrder), color, isActive, isExpense, excludeFromBreakdown, excludeFromSummary, ownerEmail: ownerEmail || initial?.ownerEmail })}
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [isApplyingPalette, setIsApplyingPalette] = useState(false);

  // モーダル状態
  const [editCategory, setEditCategory] = useState<Category | null | 'new' | 'new-personal'>(null);
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
      if (editCategory === 'new' || editCategory === 'new-personal') {
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
      <div className="recurring-header settings-page-header">
        <h2>設定</h2>
      </div>

      {tab === null ? (
        <div className="settings-hub">
          <section className="settings-hub-section">
            <h3>入力項目</h3>
            <p>日々の入力や集計で使う項目を設定します。</p>
            <div className="settings-hub-links">
              <button className="settings-hub-link" onClick={() => setTab('categories')}>
                <span>カテゴリ</span><span>共有・個人カテゴリ、色、集計方法</span>
              </button>
              <button className="settings-hub-link" onClick={() => setTab('places')}>
                <span>場所</span><span>支出先の候補</span>
              </button>
              <button className="settings-hub-link" onClick={() => setTab('payers')}>
                <span>支払元</span><span>支払元と残額の追跡設定</span>
              </button>
            </div>
          </section>
          <section className="settings-hub-section">
            <h3>管理</h3>
            <p>入力補助や残高、メール分類の設定を行います。</p>
            <div className="settings-hub-links">
              <button className="settings-hub-link" onClick={() => navigate('/recurring')}>
                <span>定期支出</span><span>繰り返し登録する支出</span>
              </button>
              <button className="settings-hub-link" onClick={() => navigate('/balance')}>
                <span>残高</span><span>カテゴリごとの収入・支出</span>
              </button>
              <button className="settings-hub-link" onClick={() => navigate('/bulk')}>
                <span>一括登録</span><span>複数の支出をまとめて入力</span>
              </button>
              <button className="settings-hub-link" onClick={() => navigate('/mappings')}>
                <span>メール自動分類</span><span>メールからの分類ルール</span>
              </button>
            </div>
          </section>
        </div>
      ) : (
        <>
          <div className="settings-master-detail">
            <button className="settings-back-button" onClick={() => setTab(null)} disabled={isApplyingPalette}>‹ 設定一覧へ戻る</button>
            <div>
              <h3>{tab === 'categories' ? 'カテゴリ' : tab === 'places' ? '場所' : '支払元'}</h3>
              <p>項目を選ぶと編集できます。</p>
            </div>
          </div>

          {/* カテゴリタブ */}
          {tab === 'categories' && (
            <>
              <div className="settings-add-row">
                <button
                  className="recurring-add-btn settings-palette-button"
                  disabled={isApplyingPalette}
                  onClick={async () => {
                    if (!confirm('すべてのカテゴリの保存色を共通テーマ配色に置き換えます。カテゴリ名・並び順・有効状態などは変更しません。適用しますか？')) return;
                    const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
                    setIsApplyingPalette(true);
                    try {
                      const results = await Promise.allSettled(
                        sorted.map((category, i) => categoriesApi.update(category.id, {
                          name: category.name,
                          sortOrder: category.sortOrder,
                          color: categoryColorForIndex(i),
                          isActive: category.isActive,
                          isExpense: category.isExpense,
                          excludeFromBreakdown: category.excludeFromBreakdown,
                          excludeFromSummary: category.excludeFromSummary,
                          ownerEmail: category.ownerEmail,
                        })),
                      );
                      const failedCount = results.filter((result) => result.status === 'rejected').length;
                      results.forEach((result) => {
                        if (result.status === 'rejected') console.error(result.reason);
                      });
                      let refreshed = false;
                      try {
                        setCategories(await categoriesApi.getAllIncludingInactive() || []);
                        refreshed = true;
                      } catch (refreshError) {
                        console.error(refreshError);
                      }
                      if (failedCount > 0) {
                        setToast(refreshed
                          ? `${failedCount}件のカテゴリに適用できませんでした。保存済みの状態を再読み込みしました`
                          : `${failedCount}件のカテゴリに適用できず、保存状態の再読み込みにも失敗しました`);
                      } else if (refreshed) {
                        setToast('テーマ配色を適用しました');
                      } else {
                        setToast('テーマ配色を保存しましたが、画面の再読み込みに失敗しました');
                      }
                    } catch (e) {
                      console.error(e);
                      setToast('テーマ配色を適用できませんでした');
                    } finally {
                      setIsApplyingPalette(false);
                    }
                  }}
                >
                  {isApplyingPalette ? '適用中…' : 'テーマ配色を適用'}
                </button>
                <button className="recurring-add-btn" onClick={() => setEditCategory('new')} disabled={isApplyingPalette}>+ 追加</button>
              </div>
              <p className="settings-palette-help">テーマ配色を適用すると、共有・個人を含む全カテゴリの保存色が置き換わります。</p>
              {/* 共有カテゴリ */}
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-muted)', padding: '8px 16px 0' }}>共有カテゴリ</div>
              <div className="settings-list">
                {categories.filter((c) => !c.ownerEmail).map((cat) => (
                  <div
                    key={cat.id}
                    className={`settings-item ${!cat.isActive ? 'inactive' : ''}`}
                    aria-disabled={isApplyingPalette}
                    onClick={() => { if (!isApplyingPalette) setEditCategory(cat); }}
                  >
                    <div className="settings-item-color" style={{ background: categoryDisplayColor(cat.color) }} />
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
                {categories.filter((c) => !c.ownerEmail).length === 0 && <div className="empty-state"><p>共有カテゴリがありません</p></div>}
              </div>

              {/* 個人カテゴリ */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-muted)' }}>個人カテゴリ</span>
                <button className="recurring-add-btn" onClick={() => setEditCategory('new-personal')} disabled={isApplyingPalette}>+ 追加</button>
              </div>
              <div className="settings-list">
                {categories.filter((c) => !!c.ownerEmail).map((cat) => (
                  <div
                    key={cat.id}
                    className={`settings-item ${!cat.isActive ? 'inactive' : ''}`}
                    aria-disabled={isApplyingPalette}
                    onClick={() => { if (!isApplyingPalette) setEditCategory(cat); }}
                  >
                    <div className="settings-item-color" style={{ background: categoryDisplayColor(cat.color) }} />
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
                {categories.filter((c) => !!c.ownerEmail).length === 0 && <div className="empty-state"><p>個人カテゴリがありません</p></div>}
              </div>
              {editCategory && (
                <CategoryModal
                  initial={editCategory === 'new' || editCategory === 'new-personal' ? undefined : editCategory}
                  categories={categories}
                  ownerEmail={editCategory === 'new-personal' ? user?.email : undefined}
                  onSave={handleSaveCategory}
                  onDelete={editCategory !== 'new' && editCategory !== 'new-personal' ? () => handleDeleteCategory(editCategory.id) : undefined}
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
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
