// カテゴリ名→ID マイグレーションスクリプト
//
// expenses, recurring の category フィールドを名前→IDに変換する。
// monthlySummary キャッシュは全削除して再構築させる。
//
// 使い方:
//
//	export DYNAMO_EXPENSE_TABLE=money-diary-expenses
//	export DYNAMO_MASTER_TABLE=money-diary-master
//	go run ./cmd/migrate-category-id --dry-run   # 事前確認
//	go run ./cmd/migrate-category-id              # 本番実行
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "変換内容を表示するが実際には更新しない")
	flag.Parse()

	ctx := context.Background()

	expenseTable := os.Getenv("DYNAMO_EXPENSE_TABLE")
	masterTable := os.Getenv("DYNAMO_MASTER_TABLE")
	if expenseTable == "" || masterTable == "" {
		log.Fatal("DYNAMO_EXPENSE_TABLE と DYNAMO_MASTER_TABLE を設定してください")
	}

	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-northeast-1"))
	if err != nil {
		log.Fatalf("AWS config error: %v", err)
	}
	db := dynamodb.NewFromConfig(cfg)

	// 1. カテゴリマスタ取得 → 名前→ID マップ構築
	log.Println("=== カテゴリマスタ取得 ===")
	nameToID, idSet := buildCategoryMaps(ctx, db, masterTable)
	log.Printf("  カテゴリ数: %d", len(nameToID))
	for name, id := range nameToID {
		log.Printf("  %s → %s", name, id)
	}

	// 2. expenses 変換
	log.Println("=== expenses 変換 ===")
	expConverted, expSkipped := migrateExpenses(ctx, db, expenseTable, nameToID, idSet, *dryRun)
	log.Printf("  変換: %d件, スキップ: %d件", expConverted, expSkipped)

	// 3. recurring 変換
	log.Println("=== recurring 変換 ===")
	recConverted, recSkipped := migrateRecurring(ctx, db, masterTable, nameToID, idSet, *dryRun)
	log.Printf("  変換: %d件, スキップ: %d件", recConverted, recSkipped)

	// 4. monthlySummary キャッシュ全削除
	log.Println("=== monthlySummary キャッシュ削除 ===")
	cacheDeleted := deleteMonthlySummaryCache(ctx, db, masterTable, *dryRun)
	log.Printf("  削除: %d件", cacheDeleted)

	fmt.Println()
	if *dryRun {
		log.Println("[DRY-RUN] 実際の更新は行われていません")
	}
	log.Printf("完了: expenses=%d/%d, recurring=%d/%d, cache削除=%d",
		expConverted, expConverted+expSkipped,
		recConverted, recConverted+recSkipped,
		cacheDeleted)
}

// buildCategoryMaps はカテゴリマスタから名前→ID マップとIDセットを返す
func buildCategoryMaps(ctx context.Context, db *dynamodb.Client, masterTable string) (map[string]string, map[string]bool) {
	out, err := db.Query(ctx, &dynamodb.QueryInput{
		TableName:              &masterTable,
		KeyConditionExpression: aws.String("#t = :t"),
		ExpressionAttributeNames: map[string]string{
			"#t": "type",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":t": &types.AttributeValueMemberS{Value: "category"},
		},
	})
	if err != nil {
		log.Fatalf("カテゴリ取得エラー: %v", err)
	}

	type catItem struct {
		ID   string `dynamodbav:"id"`
		Name string `dynamodbav:"name"`
	}

	nameToID := make(map[string]string)
	idSet := make(map[string]bool)
	for _, item := range out.Items {
		var c catItem
		if err := attributevalue.UnmarshalMap(item, &c); err != nil {
			continue
		}
		nameToID[c.Name] = c.ID
		idSet[c.ID] = true
	}
	return nameToID, idSet
}

// migrateExpenses は expenses テーブルの category を名前→IDに変換する
func migrateExpenses(ctx context.Context, db *dynamodb.Client, expenseTable string, nameToID map[string]string, idSet map[string]bool, dryRun bool) (int, int) {
	converted, skipped := 0, 0
	var lastKey map[string]types.AttributeValue

	for {
		out, err := db.Scan(ctx, &dynamodb.ScanInput{
			TableName:         &expenseTable,
			ExclusiveStartKey: lastKey,
		})
		if err != nil {
			log.Fatalf("expenses スキャンエラー: %v", err)
		}

		for _, item := range out.Items {
			id := attrString(item, "id")
			cat := attrString(item, "category")

			// 既にIDの場合はスキップ
			if idSet[cat] {
				skipped++
				continue
			}

			newID, ok := nameToID[cat]
			if !ok {
				log.Printf("  [WARN] 不明なカテゴリ名: %q (expense id=%s)", cat, id)
				skipped++
				continue
			}

			if dryRun {
				log.Printf("  [DRY-RUN] expense %s: %q → %s", id, cat, newID)
			} else {
				_, err := db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
					TableName: &expenseTable,
					Key: map[string]types.AttributeValue{
						"id": &types.AttributeValueMemberS{Value: id},
					},
					UpdateExpression: aws.String("SET category = :c"),
					ExpressionAttributeValues: map[string]types.AttributeValue{
						":c": &types.AttributeValueMemberS{Value: newID},
					},
				})
				if err != nil {
					log.Printf("  [ERROR] expense %s 更新失敗: %v", id, err)
					continue
				}
			}
			converted++
		}

		if out.LastEvaluatedKey == nil {
			break
		}
		lastKey = out.LastEvaluatedKey
	}
	return converted, skipped
}

// migrateRecurring は recurring テンプレートの category を名前→IDに変換する
func migrateRecurring(ctx context.Context, db *dynamodb.Client, masterTable string, nameToID map[string]string, idSet map[string]bool, dryRun bool) (int, int) {
	out, err := db.Query(ctx, &dynamodb.QueryInput{
		TableName:              &masterTable,
		KeyConditionExpression: aws.String("#t = :t"),
		ExpressionAttributeNames: map[string]string{
			"#t": "type",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":t": &types.AttributeValueMemberS{Value: "recurring"},
		},
	})
	if err != nil {
		log.Fatalf("recurring 取得エラー: %v", err)
	}

	converted, skipped := 0, 0
	for _, item := range out.Items {
		id := attrString(item, "id")
		cat := attrString(item, "category")

		if idSet[cat] {
			skipped++
			continue
		}

		newID, ok := nameToID[cat]
		if !ok {
			log.Printf("  [WARN] 不明なカテゴリ名: %q (recurring id=%s)", cat, id)
			skipped++
			continue
		}

		if dryRun {
			log.Printf("  [DRY-RUN] recurring %s: %q → %s", id, cat, newID)
		} else {
			_, err := db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
				TableName: &masterTable,
				Key: map[string]types.AttributeValue{
					"type": &types.AttributeValueMemberS{Value: "recurring"},
					"id":   &types.AttributeValueMemberS{Value: id},
				},
				UpdateExpression: aws.String("SET category = :c"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":c": &types.AttributeValueMemberS{Value: newID},
				},
			})
			if err != nil {
				log.Printf("  [ERROR] recurring %s 更新失敗: %v", id, err)
				continue
			}
		}
		converted++
	}
	return converted, skipped
}

// deleteMonthlySummaryCache は monthlySummary キャッシュを全削除する
func deleteMonthlySummaryCache(ctx context.Context, db *dynamodb.Client, masterTable string, dryRun bool) int {
	out, err := db.Query(ctx, &dynamodb.QueryInput{
		TableName:              &masterTable,
		KeyConditionExpression: aws.String("#t = :t"),
		ExpressionAttributeNames: map[string]string{
			"#t": "type",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":t": &types.AttributeValueMemberS{Value: "monthlySummary"},
		},
	})
	if err != nil {
		log.Fatalf("monthlySummary 取得エラー: %v", err)
	}

	count := 0
	for _, item := range out.Items {
		id := attrString(item, "id")
		if dryRun {
			log.Printf("  [DRY-RUN] 削除: monthlySummary %s", id)
		} else {
			_, err := db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
				TableName: &masterTable,
				Key: map[string]types.AttributeValue{
					"type": &types.AttributeValueMemberS{Value: "monthlySummary"},
					"id":   &types.AttributeValueMemberS{Value: id},
				},
			})
			if err != nil {
				log.Printf("  [ERROR] monthlySummary %s 削除失敗: %v", id, err)
				continue
			}
		}
		count++
	}
	return count
}

func attrString(item map[string]types.AttributeValue, key string) string {
	if v, ok := item[key]; ok {
		if s, ok := v.(*types.AttributeValueMemberS); ok {
			return s.Value
		}
	}
	return ""
}
