package service

import (
	"context"
	"fmt"
	"log"
	"strconv"

	"money-diary/internal/dynamo"
	"money-diary/internal/model"
	"money-diary/internal/sheets"
)

// MigrateResult は移行結果
type MigrateResult struct {
	Expenses   int `json:"expenses"`
	Categories int `json:"categories"`
	Places     int `json:"places"`
	Payers     int `json:"payers"`
	Users      int `json:"users"`
}

// MigrateFromSheets は Google Sheets のデータを DynamoDB に移行する
func MigrateFromSheets(ctx context.Context, dynamoClient *dynamo.Client) (*MigrateResult, error) {
	sheetsClient, err := sheets.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("Sheets client error: %w", err)
	}

	result := &MigrateResult{}

	// expenses（BatchWriteItem で高速化）
	log.Println("[migrate] expenses 移行開始")
	expData, err := sheetsClient.GetSheetData(ctx, "expenses")
	if err != nil {
		return nil, fmt.Errorf("expenses 読み込みエラー: %w", err)
	}
	var expenses []*model.Expense
	for i := 1; i < len(expData); i++ {
		row := expData[i]
		id := sheets.CellString(row, 0)
		if id == "" {
			continue
		}
		amount, _ := strconv.Atoi(sheets.CellString(row, 4))
		expenses = append(expenses, &model.Expense{
			ID:        id,
			Date:      sheets.CellString(row, 1),
			Payer:     sheets.CellString(row, 2),
			Category:  sheets.CellString(row, 3),
			Amount:    amount,
			Memo:      sheets.CellString(row, 5),
			Place:     sheets.CellString(row, 6),
			CreatedBy: sheets.CellString(row, 7),
			CreatedAt: sheets.CellString(row, 8),
			UpdatedAt: sheets.CellString(row, 9),
		})
	}
	result.Expenses, err = dynamoClient.BatchPutExpenses(ctx, expenses)
	if err != nil {
		return result, fmt.Errorf("expenses 書き込みエラー: %w", err)
	}
	log.Printf("[migrate] expenses: %d 件移行完了", result.Expenses)

	// categories
	log.Println("[migrate] categories 移行開始")
	result.Categories, err = migrateMasterBatch(ctx, sheetsClient, dynamoClient, "categories", func(row []interface{}) map[string]interface{} {
		sortOrder, _ := strconv.Atoi(sheets.CellString(row, 2))
		return map[string]interface{}{
			"type":      "category",
			"id":        sheets.CellString(row, 0),
			"name":      sheets.CellString(row, 1),
			"sortOrder": sortOrder,
			"color":     sheets.CellString(row, 3),
			"isActive":  sheets.CellBool(row, 4, true),
			"isExpense": sheets.CellBool(row, 5, true),
		}
	})
	if err != nil {
		return result, err
	}

	// places
	log.Println("[migrate] places 移行開始")
	result.Places, err = migrateMasterBatch(ctx, sheetsClient, dynamoClient, "places", func(row []interface{}) map[string]interface{} {
		sortOrder, _ := strconv.Atoi(sheets.CellString(row, 2))
		return map[string]interface{}{
			"type":      "place",
			"id":        sheets.CellString(row, 0),
			"name":      sheets.CellString(row, 1),
			"sortOrder": sortOrder,
			"isActive":  sheets.CellBool(row, 3, true),
		}
	})
	if err != nil {
		return result, err
	}

	// payers
	log.Println("[migrate] payers 移行開始")
	result.Payers, err = migrateMasterBatch(ctx, sheetsClient, dynamoClient, "payers", func(row []interface{}) map[string]interface{} {
		sortOrder, _ := strconv.Atoi(sheets.CellString(row, 2))
		return map[string]interface{}{
			"type":         "payer",
			"id":           sheets.CellString(row, 0),
			"name":         sheets.CellString(row, 1),
			"sortOrder":    sortOrder,
			"isActive":     sheets.CellBool(row, 3, true),
			"trackBalance": sheets.CellBool(row, 4, false),
		}
	})
	if err != nil {
		return result, err
	}

	// users
	log.Println("[migrate] users 移行開始")
	result.Users, err = migrateMasterBatch(ctx, sheetsClient, dynamoClient, "users", func(row []interface{}) map[string]interface{} {
		return map[string]interface{}{
			"type":      "user",
			"id":        sheets.CellString(row, 0),
			"role":      sheets.CellString(row, 1),
			"createdAt": sheets.CellString(row, 2),
		}
	})
	if err != nil {
		return result, err
	}

	log.Printf("[migrate] 完了: expenses=%d, categories=%d, places=%d, payers=%d, users=%d",
		result.Expenses, result.Categories, result.Places, result.Payers, result.Users)

	return result, nil
}

func migrateMasterBatch(
	ctx context.Context,
	sheetsClient *sheets.Client,
	dynamoClient *dynamo.Client,
	sheetName string,
	rowToItem func([]interface{}) map[string]interface{},
) (int, error) {
	data, err := sheetsClient.GetSheetData(ctx, sheetName)
	if err != nil {
		return 0, fmt.Errorf("%s 読み込みエラー: %w", sheetName, err)
	}

	var items []map[string]interface{}
	for i := 1; i < len(data); i++ {
		row := data[i]
		id := sheets.CellString(row, 0)
		if id == "" {
			continue
		}
		items = append(items, rowToItem(row))
	}

	count, err := dynamoClient.BatchPutMasterItems(ctx, items)
	if err != nil {
		return count, fmt.Errorf("%s 書き込みエラー: %w", sheetName, err)
	}
	log.Printf("[migrate] %s: %d 件移行完了", sheetName, count)
	return count, nil
}
