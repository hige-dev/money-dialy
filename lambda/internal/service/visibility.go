package service

import "money-diary/internal/model"

const (
	VisibilityPublic  = "public"
	VisibilitySummary = "summary"
	VisibilityPrivate = "private"
)

// EffectiveVisibility は空文字列を "public" に正規化する
func EffectiveVisibility(v string) string {
	if v == "" {
		return VisibilityPublic
	}
	return v
}

// FilterExpensesForUser はリクエスト者に応じて支出リストをフィルタする。
// - 自分の支出: そのまま
// - 他人の public: そのまま
// - 他人の summary: カテゴリ="個人出費"、場所・メモを空に（金額・支払元は維持）
// - 他人の private: 除外
func FilterExpensesForUser(expenses []model.Expense, userEmail string) []model.Expense {
	result := make([]model.Expense, 0, len(expenses))
	for _, e := range expenses {
		if e.CreatedBy == userEmail {
			result = append(result, e)
			continue
		}
		switch EffectiveVisibility(e.Visibility) {
		case VisibilityPublic:
			result = append(result, e)
		case VisibilitySummary:
			result = append(result, model.Expense{
				ID:         e.ID,
				Date:       e.Date,
				Payer:      e.Payer,
				Category:   "個人出費",
				Amount:     e.Amount,
				Visibility: e.Visibility,
				CreatedBy:  e.CreatedBy,
				CreatedAt:  e.CreatedAt,
				UpdatedAt:  e.UpdatedAt,
			})
		// private: 除外
		}
	}
	return result
}

// FilterExpensesForSummary は集計用に支出をフィルタする。
// 他人の private は除外、それ以外はそのまま（カテゴリはマスクしない＝正しいカテゴリで集計）。
func FilterExpensesForSummary(expenses []model.Expense, userEmail string) []model.Expense {
	result := make([]model.Expense, 0, len(expenses))
	for _, e := range expenses {
		if EffectiveVisibility(e.Visibility) == VisibilityPrivate && e.CreatedBy != userEmail {
			continue
		}
		result = append(result, e)
	}
	return result
}

// ValidateVisibility は visibility の値を検証する
func ValidateVisibility(v string) bool {
	return v == "" || v == VisibilityPublic || v == VisibilitySummary || v == VisibilityPrivate
}
