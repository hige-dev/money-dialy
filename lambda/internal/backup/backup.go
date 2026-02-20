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

func expenseToRow(e *model.Expense) []interface{} {
	return []interface{}{
		e.ID,
		e.Date,
		e.Payer,
		e.Category,
		strconv.Itoa(e.Amount),
		e.Memo,
		e.Place,
		e.CreatedBy,
		e.CreatedAt,
		e.UpdatedAt,
	}
}

// SyncExpenses は DynamoDB の全支出を Google Sheets に全件洗い替えする
func SyncExpenses(ctx context.Context, dynamoClient *dynamo.Client) error {
	expenses, err := dynamoClient.ScanAllExpenses(ctx)
	if err != nil {
		return fmt.Errorf("DynamoDB scan failed: %w", err)
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
		rows[i] = expenseToRow(&expenses[i])
	}

	if err := sheetsClient.BatchUpdateRows(ctx, expensesSheet, rows); err != nil {
		return fmt.Errorf("batch update failed: %w", err)
	}

	log.Printf("[backup] SyncExpenses: %d件書き込み完了", len(expenses))
	return nil
}
