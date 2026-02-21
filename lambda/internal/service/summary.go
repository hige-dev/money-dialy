package service

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"money-diary/internal/dynamo"
	"money-diary/internal/model"
)

// RefreshMonthlySummaryCache は指定月の集計キャッシュを再計算して保存する
func RefreshMonthlySummaryCache(ctx context.Context, client *dynamo.Client, yearMonth string) error {
	expenses, err := client.QueryExpensesByMonth(ctx, yearMonth)
	if err != nil {
		return err
	}
	catMaps, err := GetCategoryMaps(ctx, client)
	if err != nil {
		return err
	}
	byCategory := filterExpenseCategories(aggregateByCategory(expenses, yearMonth, "", catMaps), catMaps.IsExpense)
	total := sumCategories(byCategory)
	return client.PutMonthlySummaryCache(ctx, &model.MonthData{
		Month: yearMonth, Total: total, ByCategory: byCategory,
	})
}

// GetMonthlySummary は指定月の集計データを返す（payer指定時はフィルタ）。
// userEmail に応じて visibility フィルタを適用する。
func GetMonthlySummary(ctx context.Context, client *dynamo.Client, month string, payer string, userEmail string) (*model.MonthlySummary, error) {
	catMaps, err := GetCategoryMaps(ctx, client)
	if err != nil {
		return nil, err
	}

	prevMonth := previousMonth(month)
	prevYearMonth := previousYearMonth(month)

	dataMap, err := getMonthDataMap(ctx, client, []string{month, prevMonth, prevYearMonth}, payer, catMaps, userEmail)
	if err != nil {
		return nil, err
	}

	current := dataMap[month]
	prev := dataMap[prevMonth]
	prevYear := dataMap[prevYearMonth]

	summary := &model.MonthlySummary{
		Month:      month,
		Total:      current.Total,
		ByCategory: current.ByCategory,
	}
	if prev.Total > 0 || current.Total > 0 {
		summary.PreviousMonth = makeComparison(current.Total, prev.Total)
	}
	if prevYear.Total > 0 || current.Total > 0 {
		summary.PreviousYearMonth = makeComparison(current.Total, prevYear.Total)
	}

	return summary, nil
}

// GetYearlySummary は指定月を最新とした直近13ヶ月分の集計データを返す（payer指定時はフィルタ）。
// userEmail に応じて visibility フィルタを適用する。
func GetYearlySummary(ctx context.Context, client *dynamo.Client, month string, payer string, userEmail string) (*model.YearlySummary, error) {
	parts := strings.Split(month, "-")
	if len(parts) != 2 {
		return nil, fmt.Errorf("month の形式が不正です: %s", month)
	}
	y, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])
	endDate := time.Date(y, time.Month(m), 1, 0, 0, 0, 0, time.UTC)

	var months []string
	for i := 12; i >= 0; i-- {
		t := endDate.AddDate(0, -i, 0)
		months = append(months, fmt.Sprintf("%04d-%02d", t.Year(), t.Month()))
	}

	catMaps, err := GetCategoryMaps(ctx, client)
	if err != nil {
		return nil, err
	}

	dataMap, err := getMonthDataMap(ctx, client, months, payer, catMaps, userEmail)
	if err != nil {
		return nil, err
	}

	var monthsData []model.MonthData
	for _, ym := range months {
		monthsData = append(monthsData, *dataMap[ym])
	}

	return &model.YearlySummary{
		Year:   parts[0],
		Months: monthsData,
	}, nil
}

// getMonthDataMap は複数月の集計データを取得する。
// visibility フィルタがユーザー依存のため、常に月別クエリで計算する。
func getMonthDataMap(ctx context.Context, client *dynamo.Client, months []string, payer string, catMaps *CategoryMaps, userEmail string) (map[string]*model.MonthData, error) {
	result := make(map[string]*model.MonthData)

	for _, ym := range months {
		data, err := computeMonthData(ctx, client, ym, payer, catMaps, userEmail)
		if err != nil {
			return nil, err
		}
		result[ym] = data
	}

	// データがない月は空の MonthData で埋める
	for _, ym := range months {
		if _, ok := result[ym]; !ok {
			result[ym] = &model.MonthData{Month: ym}
		}
	}

	return result, nil
}

// computeMonthData は月別 GSI クエリから集計を計算する。
// 他人の private 支出は除外する。
func computeMonthData(ctx context.Context, client *dynamo.Client, yearMonth string, payer string, catMaps *CategoryMaps, userEmail string) (*model.MonthData, error) {
	expenses, err := client.QueryExpensesByMonth(ctx, yearMonth)
	if err != nil {
		return nil, err
	}
	filtered := FilterExpensesForSummary(expenses, userEmail)
	byCategory := filterExpenseCategories(aggregateByCategory(filtered, yearMonth, payer, catMaps), catMaps.IsExpense)
	total := sumCategories(byCategory)
	return &model.MonthData{Month: yearMonth, Total: total, ByCategory: byCategory}, nil
}

// aggregateByCategory は指定月(+支払元)の支出をカテゴリ別に集計する（カテゴリマスタの sortOrder 順）
func aggregateByCategory(expenses []model.Expense, month string, payer string, catMaps *CategoryMaps) []model.CategorySummary {
	totals := make(map[string]int)
	for _, e := range expenses {
		if len(e.Date) >= 7 && e.Date[:7] == month {
			if payer != "" && e.Payer != payer {
				continue
			}
			totals[e.Category] += e.Amount
		}
	}

	var result []model.CategorySummary
	for cat, amount := range totals {
		color := catMaps.Color[cat]
		if color == "" {
			color = "#AEB6BF"
		}
		result = append(result, model.CategorySummary{
			Category: cat,
			Amount:   amount,
			Color:    color,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return catMaps.SortOrder[result[i].Category] < catMaps.SortOrder[result[j].Category]
	})

	return result
}

// filterExpenseCategories は isExpense=true のカテゴリのみ返す
func filterExpenseCategories(categories []model.CategorySummary, isExpenseMap map[string]bool) []model.CategorySummary {
	var result []model.CategorySummary
	for _, c := range categories {
		if isExp, ok := isExpenseMap[c.Category]; !ok || isExp {
			result = append(result, c)
		}
	}
	return result
}

// sumCategories はカテゴリ別集計の合計を返す
func sumCategories(categories []model.CategorySummary) int {
	total := 0
	for _, c := range categories {
		total += c.Amount
	}
	return total
}

func makeComparison(current, previous int) *model.MonthComparison {
	diff := current - previous
	var diffPercent float64
	if previous > 0 {
		diffPercent = float64(diff) / float64(previous) * 100
		diffPercent = float64(int(diffPercent*100)) / 100
	}
	return &model.MonthComparison{
		Total:       previous,
		Diff:        diff,
		DiffPercent: diffPercent,
	}
}

// previousMonth は "YYYY-MM" の前月を返す
func previousMonth(month string) string {
	parts := strings.Split(month, "-")
	if len(parts) != 2 {
		return month
	}
	year, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])

	t := time.Date(year, time.Month(m), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -1, 0)
	return fmt.Sprintf("%04d-%02d", t.Year(), t.Month())
}

// previousYearMonth は "YYYY-MM" の前年同月を返す
func previousYearMonth(month string) string {
	parts := strings.Split(month, "-")
	if len(parts) != 2 {
		return month
	}
	year, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])

	t := time.Date(year, time.Month(m), 1, 0, 0, 0, 0, time.UTC).AddDate(-1, 0, 0)
	return fmt.Sprintf("%04d-%02d", t.Year(), t.Month())
}
