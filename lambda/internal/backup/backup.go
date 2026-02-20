package backup

import (
	"context"
	"log"
	"os"
	"strconv"

	"money-diary/internal/model"
	"money-diary/internal/sheets"
)

const expensesSheet = "expenses"

// enabled は SPREADSHEET_ID が設定されている場合のみ true
var enabled bool

func init() {
	enabled = os.Getenv("SPREADSHEET_ID") != ""
}

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

// CreateExpense は非同期で Sheets にバックアップ行を追加する
func CreateExpense(ctx context.Context, e *model.Expense) {
	if !enabled {
		return
	}
	go func() {
		bgCtx := context.Background()
		client, err := sheets.NewClient(bgCtx)
		if err != nil {
			log.Printf("[backup] Sheets client error: %v", err)
			return
		}
		if err := client.AppendRow(bgCtx, expensesSheet, expenseToRow(e)); err != nil {
			log.Printf("[backup] CreateExpense error: %v", err)
		}
	}()
}

// UpdateExpense は非同期で Sheets のバックアップ行を更新する
func UpdateExpense(ctx context.Context, e *model.Expense) {
	if !enabled {
		return
	}
	go func() {
		bgCtx := context.Background()
		client, err := sheets.NewClient(bgCtx)
		if err != nil {
			log.Printf("[backup] Sheets client error: %v", err)
			return
		}
		data, err := client.GetSheetData(bgCtx, expensesSheet)
		if err != nil {
			log.Printf("[backup] UpdateExpense read error: %v", err)
			return
		}
		for i := 1; i < len(data); i++ {
			if sheets.CellString(data[i], 0) == e.ID {
				if err := client.UpdateRow(bgCtx, expensesSheet, i+1, expenseToRow(e)); err != nil {
					log.Printf("[backup] UpdateExpense write error: %v", err)
				}
				return
			}
		}
		// ID が見つからない場合は追記
		if err := client.AppendRow(bgCtx, expensesSheet, expenseToRow(e)); err != nil {
			log.Printf("[backup] UpdateExpense append error: %v", err)
		}
	}()
}

// DeleteExpense は非同期で Sheets のバックアップ行を削除する
func DeleteExpense(ctx context.Context, id string) {
	if !enabled {
		return
	}
	go func() {
		bgCtx := context.Background()
		client, err := sheets.NewClient(bgCtx)
		if err != nil {
			log.Printf("[backup] Sheets client error: %v", err)
			return
		}
		data, err := client.GetSheetData(bgCtx, expensesSheet)
		if err != nil {
			log.Printf("[backup] DeleteExpense read error: %v", err)
			return
		}
		for i := 1; i < len(data); i++ {
			if sheets.CellString(data[i], 0) == id {
				if err := client.DeleteRow(bgCtx, expensesSheet, i+1); err != nil {
					log.Printf("[backup] DeleteExpense delete error: %v", err)
				}
				return
			}
		}
		log.Printf("[backup] DeleteExpense: ID %s not found in sheet", id)
	}()
}
