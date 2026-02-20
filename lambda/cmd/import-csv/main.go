// CSV → DynamoDB インポートスクリプト
//
// 使い方:
//   go run ./cmd/import-csv -table money-diary-expenses -file ~/Downloads/expenses.csv
package main

import (
	"context"
	"encoding/csv"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func main() {
	tableName := flag.String("table", "money-diary-expenses", "DynamoDB テーブル名")
	filePath := flag.String("file", "", "CSV ファイルパス")
	flag.Parse()

	if *filePath == "" {
		log.Fatal("-file を指定してください")
	}

	f, err := os.Open(*filePath)
	if err != nil {
		log.Fatalf("ファイルオープンエラー: %v", err)
	}
	defer f.Close()

	reader := csv.NewReader(f)
	records, err := reader.ReadAll()
	if err != nil {
		log.Fatalf("CSV 読み込みエラー: %v", err)
	}

	if len(records) < 2 {
		log.Fatal("データがありません")
	}

	// ヘッダー確認
	header := records[0]
	log.Printf("ヘッダー: %v", header)
	log.Printf("データ行数: %d", len(records)-1)

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-northeast-1"))
	if err != nil {
		log.Fatalf("AWS config error: %v", err)
	}
	db := dynamodb.NewFromConfig(cfg)

	// BatchWriteItem（25件ずつ）
	count := 0
	var batch []types.WriteRequest

	for i := 1; i < len(records); i++ {
		row := records[i]
		if len(row) < 5 || row[0] == "" {
			continue
		}

		amount, _ := strconv.Atoi(row[4])
		date := row[1]
		yearMonth := ""
		if len(date) >= 7 {
			yearMonth = date[:7]
		}

		item := map[string]interface{}{
			"id":        row[0],
			"yearMonth": yearMonth,
			"date":      date,
			"payer":     safeGet(row, 2),
			"category":  safeGet(row, 3),
			"amount":    amount,
			"memo":      safeGet(row, 5),
			"place":     safeGet(row, 6),
			"createdBy": safeGet(row, 7),
			"createdAt": safeGet(row, 8),
			"updatedAt": safeGet(row, 9),
		}

		av, err := attributevalue.MarshalMap(item)
		if err != nil {
			log.Printf("[SKIP] row %d: %v", i+1, err)
			continue
		}
		batch = append(batch, types.WriteRequest{
			PutRequest: &types.PutRequest{Item: av},
		})

		if len(batch) == 5 {
			if err := writeBatch(ctx, db, *tableName, batch); err != nil {
				log.Fatalf("row %d 付近で書き込みエラー: %v", i+1, err)
			}
			count += len(batch)
			batch = nil
			if count%50 == 0 {
				fmt.Printf("\r  %d / %d 件完了", count, len(records)-1)
			}
			time.Sleep(1500 * time.Millisecond)
		}
	}

	// 残り
	if len(batch) > 0 {
		if err := writeBatch(ctx, db, *tableName, batch); err != nil {
			log.Fatalf("最終バッチ書き込みエラー: %v", err)
		}
		count += len(batch)
	}

	fmt.Printf("\r  %d 件インポート完了\n", count)
}

func writeBatch(ctx context.Context, db *dynamodb.Client, table string, requests []types.WriteRequest) error {
	_, err := db.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
		RequestItems: map[string][]types.WriteRequest{
			table: requests,
		},
	})
	return err
}

func safeGet(row []string, idx int) string {
	if idx < len(row) {
		return row[idx]
	}
	return ""
}
