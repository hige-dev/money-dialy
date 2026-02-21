package service

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"

	"money-diary/internal/apperror"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
)

// GetExpensesByMonth は指定月の支出一覧を返す（新しい日付順、GSI 使用）。
// リクエスト者に応じて visibility フィルタを適用する。
func GetExpensesByMonth(ctx context.Context, client *dynamo.Client, month string, userEmail string) ([]model.Expense, error) {
	expenses, err := client.QueryExpensesByMonth(ctx, month)
	if err != nil {
		return nil, err
	}
	return FilterExpensesForUser(expenses, userEmail), nil
}

// GetAllExpenses は全支出データを返す
func GetAllExpenses(ctx context.Context, client *dynamo.Client) ([]model.Expense, error) {
	return client.ScanAllExpenses(ctx)
}

// CreateExpense は支出を登録する
func CreateExpense(ctx context.Context, client *dynamo.Client, input *model.ExpenseInput, userEmail string) (*model.Expense, error) {
	if input.Date == "" || input.Category == "" || input.Amount <= 0 {
		return nil, apperror.New("日付、カテゴリ、金額（0より大きい値）は必須です")
	}

	if !ValidateVisibility(input.Visibility) {
		return nil, apperror.New("visibility は public, summary, private のいずれかを指定してください")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	expense := model.Expense{
		ID:         uuid.New().String(),
		Date:       input.Date,
		Payer:      input.Payer,
		Category:   input.Category,
		Amount:     input.Amount,
		Memo:       input.Memo,
		Place:      input.Place,
		Visibility: input.Visibility,
		CreatedBy:  userEmail,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	if err := client.PutExpense(ctx, &expense); err != nil {
		return nil, err
	}

	refreshSummaryCache(ctx, client, expense.Date)
	return &expense, nil
}

// BulkCreateExpenses は支出を一括登録する。
// 全件バリデーション後に保存し、影響月のキャッシュをまとめて更新する。
func BulkCreateExpenses(ctx context.Context, client *dynamo.Client, inputs []model.ExpenseInput, userEmail string) ([]model.Expense, error) {
	if len(inputs) == 0 {
		return nil, apperror.New("登録する支出データがありません")
	}

	// 全件バリデーション
	for i, input := range inputs {
		if input.Date == "" || input.Category == "" || input.Amount <= 0 {
			return nil, apperror.Newf("%d件目: 日付、カテゴリ、金額（0より大きい値）は必須です", i+1)
		}
		if !ValidateVisibility(input.Visibility) {
			return nil, apperror.Newf("%d件目: visibility は public, summary, private のいずれかを指定してください", i+1)
		}
	}

	now := time.Now().UTC().Format(time.RFC3339)
	expenses := make([]model.Expense, 0, len(inputs))
	affectedMonths := make(map[string]bool)

	for _, input := range inputs {
		expense := model.Expense{
			ID:         uuid.New().String(),
			Date:       input.Date,
			Payer:      input.Payer,
			Category:   input.Category,
			Amount:     input.Amount,
			Memo:       input.Memo,
			Place:      input.Place,
			Visibility: input.Visibility,
			CreatedBy:  userEmail,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		if err := client.PutExpense(ctx, &expense); err != nil {
			return nil, apperror.Newf("%s の登録に失敗しました: %v", input.Date, err)
		}
		expenses = append(expenses, expense)
		if len(input.Date) >= 7 {
			affectedMonths[input.Date[:7]] = true
		}
	}

	// 影響月のキャッシュをまとめて更新
	for month := range affectedMonths {
		if err := RefreshMonthlySummaryCache(ctx, client, month); err != nil {
			log.Printf("monthlySummary cache refresh failed for %s: %v", month, err)
		}
	}

	return expenses, nil
}

// UpdateExpense は支出を更新する
func UpdateExpense(ctx context.Context, client *dynamo.Client, id string, input *model.ExpenseInput) (*model.Expense, error) {
	if input.Date == "" || input.Category == "" || input.Amount <= 0 {
		return nil, apperror.New("日付、カテゴリ、金額（0より大きい値）は必須です")
	}

	existing, err := client.GetExpense(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, apperror.WithStatus(404, "支出データが見つかりません")
	}

	oldDate := existing.Date

	if !ValidateVisibility(input.Visibility) {
		return nil, apperror.New("visibility は public, summary, private のいずれかを指定してください")
	}

	existing.Date = input.Date
	existing.Payer = input.Payer
	existing.Category = input.Category
	existing.Amount = input.Amount
	existing.Memo = input.Memo
	existing.Place = input.Place
	existing.Visibility = input.Visibility
	existing.UpdatedAt = time.Now().UTC().Format(time.RFC3339)

	if err := client.PutExpense(ctx, existing); err != nil {
		return nil, err
	}

	refreshSummaryCache(ctx, client, existing.Date)
	if len(oldDate) >= 7 && len(existing.Date) >= 7 && oldDate[:7] != existing.Date[:7] {
		refreshSummaryCache(ctx, client, oldDate)
	}
	return existing, nil
}

// DeleteExpense は支出を削除する
func DeleteExpense(ctx context.Context, client *dynamo.Client, id string) error {
	// 削除前にデータ取得して yearMonth を特定
	existing, _ := client.GetExpense(ctx, id)

	if err := client.DeleteExpense(ctx, id); err != nil {
		return err
	}
	if existing != nil {
		refreshSummaryCache(ctx, client, existing.Date)
	}
	return nil
}

// refreshSummaryCache は支出日付から yearMonth を抽出してキャッシュを更新する
func refreshSummaryCache(ctx context.Context, client *dynamo.Client, date string) {
	if len(date) < 7 {
		return
	}
	if err := RefreshMonthlySummaryCache(ctx, client, date[:7]); err != nil {
		log.Printf("monthlySummary cache refresh failed for %s: %v", date[:7], err)
	}
}

// GetPayerBalance は支払元の月別残額を返す。
// trackBalance=true の payer のみ有効。
// チャージ = 現金チャージカテゴリ（isExpense=false かつ収入を除く）の合計
// 支出 = 対象 payer の isExpense=true カテゴリ合計
// 前月繰越 + 月内チャージ - 月内支出 = 残額
func GetPayerBalance(ctx context.Context, client *dynamo.Client, payerName string, month string) (*model.PayerBalance, error) {
	payers, err := GetPayers(ctx, client)
	if err != nil {
		return nil, err
	}
	var trackBalance bool
	for _, p := range payers {
		if p.Name == payerName && p.TrackBalance {
			trackBalance = true
			break
		}
	}
	if !trackBalance {
		return &model.PayerBalance{Payer: payerName}, nil
	}

	expenses, err := GetAllExpenses(ctx, client)
	if err != nil {
		return nil, err
	}

	catMaps, err := GetCategoryMaps(ctx, client)
	if err != nil {
		return nil, err
	}

	// チャージ対象カテゴリを特定（isExpense=false かつ「収入」以外）
	chargeCategories := make(map[string]bool)
	for name, isExp := range catMaps.IsExpense {
		if !isExp && name != "収入" {
			chargeCategories[name] = true
		}
	}

	var carryover, monthCharge, monthSpent int
	for _, e := range expenses {
		ym := ""
		if len(e.Date) >= 7 {
			ym = e.Date[:7]
		}

		if chargeCategories[e.Category] {
			// チャージ（現金チャージ等）
			if ym < month {
				carryover += e.Amount
			} else if ym == month {
				monthCharge += e.Amount
			}
		} else if e.Payer == payerName {
			isExp, ok := catMaps.IsExpense[e.Category]
			if !ok {
				isExp = true
			}
			if isExp {
				// 対象 payer の支出
				if ym < month {
					carryover -= e.Amount
				} else if ym == month {
					monthSpent += e.Amount
				}
			}
		}
	}

	return &model.PayerBalance{
		Payer:       payerName,
		Carryover:   carryover,
		MonthCharge: monthCharge,
		MonthSpent:  monthSpent,
		Balance:     carryover + monthCharge - monthSpent,
	}, nil
}
