// 支出データ型
export interface Expense {
  id: string;
  date: string;
  payer: string;
  category: string;
  amount: number;
  memo: string;
  place: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// 支出入力型
export interface ExpenseInput {
  date: string;
  payer: string;
  category: string;
  amount: number;
  memo: string;
  place: string;
}

// 支払元マスタ型
export interface Payer {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  trackBalance: boolean;
}

// 場所マスタ型
export interface Place {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

// カテゴリデータ型
export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  color: string;
  isActive: boolean;
  isExpense: boolean;
}

// 支払元残額（月別）
export interface PayerBalance {
  payer: string;
  carryover: number;
  monthCharge: number;
  monthSpent: number;
  balance: number;
}

// カテゴリ別集計
export interface CategorySummary {
  category: string;
  amount: number;
  color: string;
}

// 月比較データ
export interface MonthComparison {
  total: number;
  diff: number;
  diffPercent: number;
}

// 月別集計
export interface MonthlySummary {
  month: string;
  total: number;
  byCategory: CategorySummary[];
  previousMonth: MonthComparison | null;
  previousYearMonth: MonthComparison | null;
}

// 年間集計の月別データ
export interface MonthData {
  month: string;
  total: number;
  byCategory: CategorySummary[];
}

// 年間集計
export interface YearlySummary {
  year: string;
  months: MonthData[];
}

// 定期支出テンプレート
export interface RecurringExpense {
  id: string;
  category: string;
  amount: number;
  payer: string;
  place: string;
  memo: string;
  frequency: 'monthly' | 'bimonthly' | 'yearly';
  dayOfMonth: number;
  repeatMonth: number;
  startMonth: string;
  endMonth: string;
  isActive: boolean;
  lastCreatedMonth: string;
  createdAt: string;
  updatedAt: string;
}

// 定期支出テンプレート入力型
export interface RecurringExpenseInput {
  category: string;
  amount: number;
  payer: string;
  place: string;
  memo: string;
  frequency: 'monthly' | 'bimonthly' | 'yearly';
  dayOfMonth: number;
  repeatMonth: number;
  startMonth: string;
  endMonth: string;
  isActive: boolean;
}

// カテゴリ入力型
export interface CategoryInput {
  name: string;
  sortOrder: number;
  color: string;
  isActive: boolean;
  isExpense: boolean;
}

// 場所入力型
export interface PlaceInput {
  name: string;
  sortOrder: number;
  isActive: boolean;
}

// 支払元入力型
export interface PayerInput {
  name: string;
  sortOrder: number;
  isActive: boolean;
  trackBalance: boolean;
}

// APIレスポンス型
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ユーザー情報型
export type Role = 'admin' | 'user';

export interface User {
  email: string;
  name: string;
  picture?: string;
  role: Role;
}

// 環境設定型
export interface Config {
  googleClientId: string;
  apiUrl: string;
  allowedEmails: string[];
}
