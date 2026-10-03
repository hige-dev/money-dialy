import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { mappingsApi, categoriesApi, payersApi, placesApi } from '../services/api';
import type { EmailMapping, EmailMappingInput, Category, Payer, Place } from '../types';

interface MappingModalProps {
  initial?: EmailMapping;
  categories: Category[];
  payers: Payer[];
  places: Place[];
  onSave: (input: EmailMappingInput) => void;
  onDelete?: () => void;
  onClose: () => void;
  defaultType?: 'subject' | 'keyword';
  draft?: EmailMappingInput;
  saving: boolean;
}

function MappingModal({
  initial,
  categories,
  payers,
  places,
  onSave,
  onDelete,
  onClose,
  defaultType,
  draft,
  saving,
}: MappingModalProps) {
  const [type, setType] = useState<'subject' | 'keyword'>((initial?.type ?? draft?.type ?? defaultType ?? 'subject') as 'subject' | 'keyword');
  const [identifier, setIdentifier] = useState(initial?.identifier ?? draft?.identifier ?? '');
  const [payer, setPayer] = useState(initial?.payer ?? '');
  const [category, setCategory] = useState(initial?.category ?? draft?.category ?? '');
  const [place, setPlace] = useState(initial?.place ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [exclude, setExclude] = useState(initial?.exclude ?? false);

  // 分類ルールの補足を入力する。
  const commentField = (
    <div className="modal-field">
      <label>メモ / コメント (任意)</label>
      <input
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="説明など"
      />
    </div>
  );

  return (
    <div className="modal-overlay" onClick={() => { if (!saving) onClose(); }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{initial ? 'マッピングを編集' : 'マッピングを追加'}</h3>
          <button className="modal-close-btn" onClick={() => { if (!saving) onClose(); }}>&times;</button>
        </div>

        {draft && <p className="review-note">支出は保存済みです。このルールは今後のメール取込全体に適用されます。メール内の利用先・メモに含まれるキーワードを確認してください。登録済みの支出は変更しません。</p>}
        <div className="modal-field">
          <label>一致条件</label>
          <select value={type} onChange={(e) => setType(e.target.value as 'subject' | 'keyword')} disabled={!!initial}>
            <option value="subject">件名 (部分一致)</option>
            <option value="keyword">利用先・メモのキーワード (部分一致)</option>
          </select>
        </div>

        <div className="modal-field">
          <label>条件テキスト（件名 / キーワード）</label>
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="例: Amazon.co.jp または セブン-イレブン"
            disabled={!!initial}
          />
        </div>

        <div className="modal-field">
          <label>適用する支払元</label>
          <select value={payer} onChange={(e) => setPayer(e.target.value)}>
            <option value="">(指定なし)</option>
            {payers.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="modal-field">
          <label>適用するカテゴリ</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">(未選択)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="modal-field">
          <label>適用する場所</label>
          <select value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="">(指定なし)</option>
            {places.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>

        {commentField}
        <div className="modal-field">
          <label>除外</label>
          <input
            type="checkbox"
            checked={exclude}
            onChange={e => setExclude(e.target.checked)}
          />
        </div>


        <div className="modal-actions">
          <button
            className="modal-btn modal-btn-primary"
            onClick={() => onSave({
              type,
              identifier,
              payer: payer || undefined,
              category: category || undefined,
              place: place || undefined,
              comment: comment || undefined,
              exclude,
            })}
            disabled={saving || !identifier.trim() || (!!draft && !category)}
          >
            {saving ? '保存中…' : '保存'}
          </button>
          {initial && onDelete && (
            <button className="modal-btn modal-btn-danger" disabled={saving} onClick={onDelete}>
              削除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminMappingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<EmailMappingInput | undefined>(() => {
    const value = location.state?.mappingDraft;
    if (value?.type === 'keyword' && typeof value.identifier === 'string' && typeof value.category === 'string') {
      return { type: 'keyword', identifier: value.identifier, category: value.category };
    }
    return undefined;
  });
  const [saving, setSaving] = useState(false);

  const [mappings, setMappings] = useState<EmailMapping[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<EmailMapping | null | 'new'>(draft ? 'new' : null);
  const [toast, setToast] = useState<string | null>(null);
  const [newMappingType, setNewMappingType] = useState<'subject' | 'keyword'>(draft ? 'keyword' : 'subject');

  const loadData = async () => {
    try {
      const [mList, cList, pList, plList] = await Promise.all([
        mappingsApi.getAll(),
        categoriesApi.getAll(),
        payersApi.getAll(),
        placesApi.getAll(),
      ]);
      setMappings(mList || []);
      setCategories(cList || []);
      setPayers(pList || []);
      setPlaces(plList || []);
    } catch (e) {
      console.error(e);
      setToast('データの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (location.state?.mappingDraft) navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  const handleSave = async (input: EmailMappingInput) => {
    if (saving) return;
    setSaving(true);
    try {
      if (editTarget === 'new') {
        const existing = await mappingsApi.getAll();
        if (existing.some(mapping => mapping.type === input.type && mapping.identifier === input.identifier.trim())) {
          setToast('同じ条件のルールがあります。一覧から既存ルールを確認してください');
          setMappings(existing);
          return;
        }
        await mappingsApi.create({ ...input, identifier: input.identifier.trim() });
        setToast('マッピングを追加しました');
      } else if (editTarget) {
        await mappingsApi.update(editTarget.type, editTarget.identifier, input);
        setToast('マッピングを更新しました');
      }
      setEditTarget(null);
      setDraft(undefined);
      await loadData();
    } catch (e) {
      console.error(e);
      setToast('マッピングの保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (m: EmailMapping) => {
    if (!confirm(`「${m.identifier}」のマッピングを削除しますか？`)) return;
    try {
      await mappingsApi.delete(m.type, m.identifier);
      setToast('削除しました');
      setEditTarget(null);
      setDraft(undefined);
      await loadData();
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
      <h2>メール自動分類マッピング</h2>
      <button className="recurring-add-btn" onClick={() => { setDraft(undefined); setNewMappingType('subject'); setEditTarget('new'); }}>
        + 追加
      </button>

    </div>
      {mappings.length === 0 ? (
        <div className="empty-state"><p>マッピング設定はありません</p></div>
      ) : (
        <div className="settings-list">
          {mappings.map((m) => {
            const catName = m.category ? (catMap.get(m.category) || m.category) : null;
            return (
              <div
                key={`${m.type}#${m.identifier}`}
                className="settings-item"
                onClick={() => setEditTarget(m)}
              >
                <div className="settings-item-body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                    <span className="settings-item-badge" style={{ backgroundColor: m.type === 'subject' ? 'var(--color-green-soft)' : '#f7eee0', color: m.type === 'subject' ? 'var(--color-green)' : '#8d6c3f' }}>
                      {m.type === 'subject' ? '件名' : 'キーワード'}
                    </span>
                    {m.exclude && (
                      <span className="settings-item-badge" style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>
                        除外
                      </span>
                    )}
                    <span className="settings-item-name" style={{ fontWeight: 600 }}>{m.identifier}</span>
                  </div>
                  <span className="settings-item-meta">
                    {m.payer && <span>支払元: <strong>{m.payer}</strong></span>}
                    {catName && <span>カテゴリ: <strong>{catName}</strong></span>}
                    {m.place && <span>場所: <strong>{m.place}</strong></span>}
                    {m.comment && <span style={{ color: 'var(--color-faint)' }}>({m.comment})</span>}
                  </span>
                </div>
                <button
                  className="recurring-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(m);
                  }}
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editTarget && (
        <MappingModal
          key={editTarget === 'new' ? 'new' : `${editTarget?.type}#${editTarget?.identifier}`}
          initial={editTarget === 'new' ? undefined : editTarget}
          categories={draft && editTarget === 'new' ? categories.filter(category => !category.ownerEmail) : categories}
          payers={payers}
          places={places}
          defaultType={newMappingType}
          draft={editTarget === 'new' && draft ? draft : undefined}
          saving={saving}
          onSave={handleSave}
          onDelete={editTarget !== 'new' ? () => handleDelete(editTarget) : undefined}
          onClose={() => { setEditTarget(null); setDraft(undefined); }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
