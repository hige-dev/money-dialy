package model

// Expense は支出データ
type Expense struct {
	ID         string `json:"id"`
	Date       string `json:"date"`
	Payer      string `json:"payer"`
	Category   string `json:"category"`
	Amount     int    `json:"amount"`
	Memo       string `json:"memo"`
	Place      string `json:"place"`
	Visibility string `json:"visibility"` // "public" | "summary" | "private"（空="" は "public" 扱い）
	CreatedBy  string `json:"createdBy"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

// ExpenseInput は支出登録・更新のリクエスト
type ExpenseInput struct {
	Date       string `json:"date"`
	Payer      string `json:"payer"`
	Category   string `json:"category"`
	Amount     int    `json:"amount"`
	Memo       string `json:"memo"`
	Place      string `json:"place"`
	Visibility string `json:"visibility"`
}

// Place は場所マスタ
type Place struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sortOrder"`
	IsActive  bool   `json:"isActive"`
}

// Payer は支払元マスタ
type Payer struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	SortOrder    int    `json:"sortOrder"`
	IsActive     bool   `json:"isActive"`
	TrackBalance bool   `json:"trackBalance"`
}

// Category はカテゴリマスタ
type Category struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	SortOrder            int    `json:"sortOrder"`
	Color                string `json:"color"`
	IsActive             bool   `json:"isActive"`
	IsExpense            bool   `json:"isExpense"`
	ExcludeFromBreakdown bool   `json:"excludeFromBreakdown"` // 内訳から除外（総額には含む）
	ExcludeFromSummary   bool   `json:"excludeFromSummary"`   // 集計から完全除外（Balanceのみ表示）
}

// PayerBalance は支払元の残額情報（月別）
type PayerBalance struct {
	Payer       string `json:"payer"`
	Carryover   int    `json:"carryover"`   // 前月繰越
	MonthCharge int    `json:"monthCharge"` // 月内チャージ
	MonthSpent  int    `json:"monthSpent"`  // 月内支出
	Balance     int    `json:"balance"`     // 残額
}

// User は許可ユーザー
type User struct {
	Email     string `json:"email"`
	Role      string `json:"role"`
	CreatedAt string `json:"createdAt"`
}

// AuthUser は認証済みユーザー情報
type AuthUser struct {
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture,omitempty"`
}

// CategorySummary はカテゴリ別集計
type CategorySummary struct {
	CategoryID string `json:"categoryId"`
	Category   string `json:"category"`
	Amount     int    `json:"amount"`
	Color      string `json:"color"`
}

// MonthComparison は月比較データ
type MonthComparison struct {
	Total       int     `json:"total"`
	Diff        int     `json:"diff"`
	DiffPercent float64 `json:"diffPercent"`
}

// MonthlySummary は月別集計
type MonthlySummary struct {
	Month             string           `json:"month"`
	Total             int              `json:"total"`
	ByCategory        []CategorySummary `json:"byCategory"`
	PreviousMonth     *MonthComparison `json:"previousMonth"`
	PreviousYearMonth *MonthComparison `json:"previousYearMonth"`
}

// MonthData は年間集計の月別データ
type MonthData struct {
	Month      string           `json:"month"`
	Total      int              `json:"total"`
	ByCategory []CategorySummary `json:"byCategory"`
}

// YearlySummary は年間集計
type YearlySummary struct {
	Year   string      `json:"year"`
	Months []MonthData `json:"months"`
}

// RecurringExpense は定期支出テンプレート
type RecurringExpense struct {
	ID               string `json:"id"`
	Category         string `json:"category"`
	Amount           int    `json:"amount"`
	Payer            string `json:"payer"`
	Place            string `json:"place"`
	Memo             string `json:"memo"`
	Frequency        string `json:"frequency"`        // "monthly" | "bimonthly" | "yearly"
	DayOfMonth       int    `json:"dayOfMonth"`       // 1-31
	RepeatMonth      int    `json:"repeatMonth"`      // 1-12（yearly のみ）
	StartMonth       string `json:"startMonth"`       // "YYYY-MM"（空=制限なし）
	EndMonth         string `json:"endMonth"`         // "YYYY-MM"（空=制限なし）
	IsActive         bool   `json:"isActive"`
	LastCreatedMonth string `json:"lastCreatedMonth"` // "YYYY-MM"
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

// RecurringExpenseInput は定期支出テンプレートの登録・更新リクエスト
type RecurringExpenseInput struct {
	Category    string `json:"category"`
	Amount      int    `json:"amount"`
	Payer       string `json:"payer"`
	Place       string `json:"place"`
	Memo        string `json:"memo"`
	Frequency   string `json:"frequency"`
	DayOfMonth  int    `json:"dayOfMonth"`
	RepeatMonth int    `json:"repeatMonth"`
	StartMonth  string `json:"startMonth"`
	EndMonth    string `json:"endMonth"`
	IsActive    bool   `json:"isActive"`
}

// CategoryInput はカテゴリ登録・更新のリクエスト
type CategoryInput struct {
	Name                 string `json:"name"`
	SortOrder            int    `json:"sortOrder"`
	Color                string `json:"color"`
	IsActive             bool   `json:"isActive"`
	IsExpense            bool   `json:"isExpense"`
	ExcludeFromBreakdown bool   `json:"excludeFromBreakdown"`
	ExcludeFromSummary   bool   `json:"excludeFromSummary"`
}

// PlaceInput は場所登録・更新のリクエスト
type PlaceInput struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sortOrder"`
	IsActive  bool   `json:"isActive"`
}

// PayerInput は支払元登録・更新のリクエスト
type PayerInput struct {
	Name         string `json:"name"`
	SortOrder    int    `json:"sortOrder"`
	IsActive     bool   `json:"isActive"`
	TrackBalance bool   `json:"trackBalance"`
}

// APIResponse はAPIレスポンス
type APIResponse struct {
	Success bool   `json:"success"`
	Data    any    `json:"data,omitempty"`
	Error   string `json:"error,omitempty"`
}

// ActionRequest はリクエストボディ
type ActionRequest struct {
	Action  string        `json:"action"`
	Month   string        `json:"month,omitempty"`
	Year    string        `json:"year,omitempty"`
	ID      string        `json:"id,omitempty"`
	Payer   string        `json:"payer,omitempty"`
	Expense          *ExpenseInput          `json:"expense,omitempty"`
	Expenses         []ExpenseInput         `json:"expenses,omitempty"`
	RecurringExpense *RecurringExpenseInput `json:"recurringExpense,omitempty"`
	Category         *CategoryInput         `json:"category,omitempty"`
	Place            *PlaceInput            `json:"place,omitempty"`
	PayerData        *PayerInput            `json:"payerData,omitempty"`
}
