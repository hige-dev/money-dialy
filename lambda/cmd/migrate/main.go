// Sheets → DynamoDB データ移行スクリプト
//
// 使い方:
//   環境変数を設定してから実行:
//     export SPREADSHEET_ID=...
//     export GCP_PROJECT_NUMBER=...
//     export GCP_WIF_POOL_ID=...
//     export GCP_WIF_PROVIDER_ID=...
//     export GCP_SERVICE_ACCOUNT_EMAIL=...
//     export DYNAMO_EXPENSE_TABLE=money-diary-expenses
//     export DYNAMO_MASTER_TABLE=money-diary-master
//     export AWS_REGION=ap-northeast-1
//     go run ./cmd/migrate
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"money-diary/internal/sheets"
)

func main() {
	ctx := context.Background()

	// 環境変数チェック
	expenseTable := os.Getenv("DYNAMO_EXPENSE_TABLE")
	masterTable := os.Getenv("DYNAMO_MASTER_TABLE")
	if expenseTable == "" || masterTable == "" {
		log.Fatal("DYNAMO_EXPENSE_TABLE と DYNAMO_MASTER_TABLE を設定してください")
	}

	// Sheets クライアント
	sheetsClient, err := sheets.NewClient(ctx)
	if err != nil {
		log.Fatalf("Sheets client error: %v", err)
	}

	// DynamoDB クライアント
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-northeast-1"))
	if err != nil {
		log.Fatalf("AWS config error: %v", err)
	}
	db := dynamodb.NewFromConfig(cfg)

	// 1. expenses 移行
	log.Println("=== expenses 移行開始 ===")
	expData, err := sheetsClient.GetSheetData(ctx, "expenses")
	if err != nil {
		log.Fatalf("expenses 読み込みエラー: %v", err)
	}
	expCount := 0
	for i := 1; i < len(expData); i++ {
		row := expData[i]
		id := sheets.CellString(row, 0)
		if id == "" {
			continue
		}
		date := sheets.CellString(row, 1)
		yearMonth := ""
		if len(date) >= 7 {
			yearMonth = date[:7]
		}
		amount, _ := strconv.Atoi(sheets.CellString(row, 4))

		item := map[string]any{
			"id":        id,
			"yearMonth": yearMonth,
			"date":      date,
			"payer":     sheets.CellString(row, 2),
			"category":  sheets.CellString(row, 3),
			"amount":    amount,
			"memo":      sheets.CellString(row, 5),
			"place":     sheets.CellString(row, 6),
			"createdBy": sheets.CellString(row, 7),
			"createdAt": sheets.CellString(row, 8),
			"updatedAt": sheets.CellString(row, 9),
		}
		av, err := attributevalue.MarshalMap(item)
		if err != nil {
			log.Printf("  [SKIP] row %d marshal error: %v", i+1, err)
			continue
		}
		_, err = db.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: &expenseTable,
			Item:      av,
		})
		if err != nil {
			log.Printf("  [ERROR] row %d put error: %v", i+1, err)
			continue
		}
		expCount++
	}
	log.Printf("  expenses: %d 件移行完了", expCount)

	// 2. categories 移行
	log.Println("=== categories 移行開始 ===")
	catCount := migrateMaster(ctx, db, sheetsClient, masterTable, "categories", func(row []interface{}) map[string]any {
		sortOrder, _ := strconv.Atoi(sheets.CellString(row, 2))
		return map[string]any{
			"type":      "category",
			"id":        sheets.CellString(row, 0),
			"name":      sheets.CellString(row, 1),
			"sortOrder": sortOrder,
			"color":     sheets.CellString(row, 3),
			"isActive":  sheets.CellBool(row, 4, true),
			"isExpense": sheets.CellBool(row, 5, true),
		}
	})
	log.Printf("  categories: %d 件移行完了", catCount)

	// 3. places 移行
	log.Println("=== places 移行開始 ===")
	plcCount := migrateMaster(ctx, db, sheetsClient, masterTable, "places", func(row []interface{}) map[string]any {
		sortOrder, _ := strconv.Atoi(sheets.CellString(row, 2))
		return map[string]any{
			"type":      "place",
			"id":        sheets.CellString(row, 0),
			"name":      sheets.CellString(row, 1),
			"sortOrder": sortOrder,
			"isActive":  sheets.CellBool(row, 3, true),
		}
	})
	log.Printf("  places: %d 件移行完了", plcCount)

	// 4. payers 移行
	log.Println("=== payers 移行開始 ===")
	payCount := migrateMaster(ctx, db, sheetsClient, masterTable, "payers", func(row []interface{}) map[string]any {
		sortOrder, _ := strconv.Atoi(sheets.CellString(row, 2))
		return map[string]any{
			"type":         "payer",
			"id":           sheets.CellString(row, 0),
			"name":         sheets.CellString(row, 1),
			"sortOrder":    sortOrder,
			"isActive":     sheets.CellBool(row, 3, true),
			"trackBalance": sheets.CellBool(row, 4, false),
		}
	})
	log.Printf("  payers: %d 件移行完了", payCount)

	// 5. users 移行
	log.Println("=== users 移行開始 ===")
	usrCount := migrateMaster(ctx, db, sheetsClient, masterTable, "users", func(row []interface{}) map[string]any {
		return map[string]any{
			"type":      "user",
			"id":        sheets.CellString(row, 0),
			"role":      sheets.CellString(row, 1),
			"createdAt": sheets.CellString(row, 2),
		}
	})
	log.Printf("  users: %d 件移行完了", usrCount)

	fmt.Println()
	log.Printf("移行完了: expenses=%d, categories=%d, places=%d, payers=%d, users=%d",
		expCount, catCount, plcCount, payCount, usrCount)
}

func migrateMaster(
	ctx context.Context,
	db *dynamodb.Client,
	sheetsClient *sheets.Client,
	tableName string,
	sheetName string,
	rowToItem func([]interface{}) map[string]any,
) int {
	data, err := sheetsClient.GetSheetData(ctx, sheetName)
	if err != nil {
		log.Printf("  [ERROR] %s 読み込みエラー: %v", sheetName, err)
		return 0
	}

	count := 0
	for i := 1; i < len(data); i++ {
		row := data[i]
		id := sheets.CellString(row, 0)
		if id == "" {
			continue
		}

		item := rowToItem(row)
		av, err := attributevalue.MarshalMap(item)
		if err != nil {
			log.Printf("  [SKIP] %s row %d marshal error: %v", sheetName, i+1, err)
			continue
		}
		_, err = db.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: &tableName,
			Item:      av,
		})
		if err != nil {
			log.Printf("  [ERROR] %s row %d put error: %v", sheetName, i+1, err)
			continue
		}
		count++
	}
	return count
}
