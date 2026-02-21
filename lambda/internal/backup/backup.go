package backup

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strconv"

	"money-diary/internal/dynamo"
	"money-diary/internal/model"
	"money-diary/internal/sheets"
)

const expensesSheet = "expenses"

// expenseToRow はスプレッドシート行に変換する。catNameMap でカテゴリID→名前変換を行う。
func expenseToRow(e *model.Expense, catNameMap map[string]string) []interface{} {
	categoryName := catNameMap[e.Category]
	if categoryName == "" {
		categoryName = e.Category
	}
	return []interface{}{
		e.ID,
		e.Date,
		e.Payer,
		categoryName,
		strconv.Itoa(e.Amount),
		e.Memo,
		e.Place,
		e.CreatedBy,
		e.CreatedAt,
		e.UpdatedAt,
		e.Visibility,
	}
}

// SyncExpenses は DynamoDB の全支出を Google Sheets に全件洗い替えする
func SyncExpenses(ctx context.Context, dynamoClient *dynamo.Client) error {
	expenses, err := dynamoClient.ScanAllExpenses(ctx)
	if err != nil {
		return fmt.Errorf("DynamoDB scan failed: %w", err)
	}

	// カテゴリID→名前マップを構築
	categories, err := dynamoClient.GetCategories(ctx)
	if err != nil {
		return fmt.Errorf("categories fetch failed: %w", err)
	}
	catNameMap := make(map[string]string, len(categories))
	for _, c := range categories {
		catNameMap[c.ID] = c.Name
	}

	sort.Slice(expenses, func(i, j int) bool {
		return expenses[i].Date > expenses[j].Date
	})

	sheetsClient, err := sheets.NewClient(ctx)
	if err != nil {
		return fmt.Errorf("Sheets client init failed: %w", err)
	}

	if err := sheetsClient.ClearSheet(ctx, expensesSheet); err != nil {
		return fmt.Errorf("sheet clear failed: %w", err)
	}

	rows := make([][]interface{}, len(expenses))
	for i := range expenses {
		rows[i] = expenseToRow(&expenses[i], catNameMap)
	}

	if err := sheetsClient.BatchUpdateRows(ctx, expensesSheet, rows); err != nil {
		return fmt.Errorf("batch update failed: %w", err)
	}

	log.Printf("[backup] SyncExpenses: %d件書き込み完了", len(expenses))
	return nil
}
