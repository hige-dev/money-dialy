import { config } from '../config';
import type { Expense, ExpenseInput, Category, Place, Payer, PayerBalance, MonthlySummary, YearlySummary, ApiResponse, Role, RecurringExpense, RecurringExpenseInput, CategoryInput, PlaceInput, PayerInput } from '../types';

// 認証トークン（グローバル）
let authToken: string | null = null;
let onAuthError: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** 認証エラー時に呼ばれるコールバックを登録（ログアウト処理用） */
export function setOnAuthError(callback: (() => void) | null): void {
  onAuthError = callback;
}

// ===== キャッシュ =====
const cache = new Map<string, unknown>();

function cacheGet<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

function cacheSet<T>(key: string, value: T): T {
  cache.set(key, value);
  return value;
}

/** 指定プレフィックスに一致するキャッシュを破棄 */
function cacheInvalidate(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** 支出データ変更時に関連キャッシュを破棄 */
function invalidateExpenseCache(): void {
  cacheInvalidate('expenses:');
  cacheInvalidate('summary:');
  cacheInvalidate('payerBalance:');
}

/**
 * リクエストボディのSHA-256ハッシュを計算
 * CloudFront OACがLambda Function URLへのPOSTリクエストを署名するために必要
 */
async function computeSha256(body: string): Promise<string> {
  const data = new TextEncoder().encode(body);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function callApi<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!authToken) {
    throw new Error('認証が必要です');
  }

  const body = JSON.stringify({ action, ...params });
  const bodyHash = await computeSha256(body);

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': authToken,
      'x-amz-content-sha256': bodyHash,
    },
    body,
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`API error: ${response.status} (non-JSON response)`);
  }

  const data: ApiResponse<T> = await response.json();

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      onAuthError?.();
      throw new Error('AUTH_ERROR:' + (data.error || 'Unauthorized'));
    }
    throw new Error(data.error || `HTTP error: ${response.status}`);
  }

  if (!data.success) {
    if (data.error === 'Unauthorized' || data.error === 'このアカウントでは利用できません') {
      onAuthError?.();
      throw new Error('AUTH_ERROR:' + data.error);
    }
    throw new Error(data.error || 'APIエラーが発生しました');
  }

  return data.data as T;
}

// ユーザーAPI
export const usersApi = {
  async getMyRole(): Promise<Role> {
    const result = await callApi<{ role: Role }>('getMyRole');
    return result.role;
  },
};

// カテゴリAPI（セッション中キャッシュ）
export const categoriesApi = {
  async getAll(): Promise<Category[]> {
    const cached = cacheGet<Category[]>('master:categories');
    if (cached) return cached;
    return cacheSet('master:categories', await callApi<Category[]>('getCategories'));
  },
  async getAllIncludingInactive(): Promise<Category[]> {
    return callApi<Category[]>('getAllCategories');
  },
  async create(input: CategoryInput): Promise<Category> {
    const result = await callApi<Category>('createCategory', { category: input });
    cacheInvalidate('master:categories');
    return result;
  },
  async update(id: string, input: CategoryInput): Promise<Category> {
    const result = await callApi<Category>('updateCategory', { id, category: input });
    cacheInvalidate('master:categories');
    return result;
  },
  async delete(id: string): Promise<void> {
    await callApi<void>('deleteCategory', { id });
    cacheInvalidate('master:categories');
  },
};

// 場所API（セッション中キャッシュ）
export const placesApi = {
  async getAll(): Promise<Place[]> {
    const cached = cacheGet<Place[]>('master:places');
    if (cached) return cached;
    return cacheSet('master:places', await callApi<Place[]>('getPlaces'));
  },
  async getAllIncludingInactive(): Promise<Place[]> {
    return callApi<Place[]>('getAllPlaces');
  },
  async create(input: PlaceInput): Promise<Place> {
    const result = await callApi<Place>('createPlace', { place: input });
    cacheInvalidate('master:places');
    return result;
  },
  async update(id: string, input: PlaceInput): Promise<Place> {
    const result = await callApi<Place>('updatePlace', { id, place: input });
    cacheInvalidate('master:places');
    return result;
  },
  async delete(id: string): Promise<void> {
    await callApi<void>('deletePlace', { id });
    cacheInvalidate('master:places');
  },
};

// 支払元API（セッション中キャッシュ）
export const payersApi = {
  async getAll(): Promise<Payer[]> {
    const cached = cacheGet<Payer[]>('master:payers');
    if (cached) return cached;
    return cacheSet('master:payers', await callApi<Payer[]>('getPayers'));
  },
  async getAllIncludingInactive(): Promise<Payer[]> {
    return callApi<Payer[]>('getAllPayers');
  },
  async getBalance(payer: string, month: string): Promise<PayerBalance> {
    const key = `payerBalance:${payer}:${month}`;
    const cached = cacheGet<PayerBalance>(key);
    if (cached) return cached;
    return cacheSet(key, await callApi<PayerBalance>('getPayerBalance', { payer, month }));
  },
  async create(input: PayerInput): Promise<Payer> {
    const result = await callApi<Payer>('createPayer', { payerData: input });
    cacheInvalidate('master:payers');
    return result;
  },
  async update(id: string, input: PayerInput): Promise<Payer> {
    const result = await callApi<Payer>('updatePayer', { id, payerData: input });
    cacheInvalidate('master:payers');
    return result;
  },
  async delete(id: string): Promise<void> {
    await callApi<void>('deletePayer', { id });
    cacheInvalidate('master:payers');
  },
};

// 支出API（月別キャッシュ、変更時に破棄）
export const expensesApi = {
  async getByMonth(month: string): Promise<Expense[]> {
    const key = `expenses:${month}`;
    const cached = cacheGet<Expense[]>(key);
    if (cached) return cached;
    return cacheSet(key, await callApi<Expense[]>('getExpenses', { month }));
  },

  async create(expense: ExpenseInput): Promise<Expense> {
    const result = await callApi<Expense>('createExpense', { expense });
    invalidateExpenseCache();
    return result;
  },

  async update(id: string, expense: ExpenseInput): Promise<Expense> {
    const result = await callApi<Expense>('updateExpense', { id, expense });
    invalidateExpenseCache();
    return result;
  },

  async delete(id: string): Promise<void> {
    const result = await callApi<void>('deleteExpense', { id });
    invalidateExpenseCache();
    return result;
  },

  async bulkCreate(expenses: ExpenseInput[]): Promise<Expense[]> {
    const result = await callApi<Expense[]>('bulkCreateExpenses', { expenses });
    invalidateExpenseCache();
    return result;
  },
};

// 集計API（月/年+payer別キャッシュ、変更時に破棄）
export const summaryApi = {
  async getMonthly(month: string, payer?: string): Promise<MonthlySummary> {
    const key = `summary:monthly:${month}:${payer || ''}`;
    const cached = cacheGet<MonthlySummary>(key);
    if (cached) return cached;
    return cacheSet(key, await callApi<MonthlySummary>('getMonthlySummary', { month, ...(payer ? { payer } : {}) }));
  },

  async getYearly(month: string, payer?: string): Promise<YearlySummary> {
    const key = `summary:yearly:${month}:${payer || ''}`;
    const cached = cacheGet<YearlySummary>(key);
    if (cached) return cached;
    return cacheSet(key, await callApi<YearlySummary>('getYearlySummary', { month, ...(payer ? { payer } : {}) }));
  },
};

// 定期支出API
export const recurringApi = {
  async getAll(): Promise<RecurringExpense[]> {
    const cached = cacheGet<RecurringExpense[]>('master:recurring');
    if (cached) return cached;
    return cacheSet('master:recurring', await callApi<RecurringExpense[]>('getRecurringExpenses'));
  },

  async create(input: RecurringExpenseInput): Promise<RecurringExpense> {
    const result = await callApi<RecurringExpense>('createRecurringExpense', { recurringExpense: input });
    cacheInvalidate('master:recurring');
    return result;
  },

  async update(id: string, input: RecurringExpenseInput): Promise<RecurringExpense> {
    const result = await callApi<RecurringExpense>('updateRecurringExpense', { id, recurringExpense: input });
    cacheInvalidate('master:recurring');
    return result;
  },

  async delete(id: string): Promise<void> {
    await callApi<void>('deleteRecurringExpense', { id });
    cacheInvalidate('master:recurring');
  },
};
