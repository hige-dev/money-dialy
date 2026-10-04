package dynamo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"money-diary/internal/model"
)

// Client は DynamoDB クライアント
type Client struct {
	db           *dynamodb.Client
	expenseTable string
	masterTable  string
}

var (
	instance *Client
	once     sync.Once
	initErr  error
)

// GetClient は実行環境内で共有する DynamoDB クライアントを取得する。
// 初期化は sync.Once で一度だけ行う。
func GetClient(ctx context.Context) (*Client, error) {
	once.Do(func() {
		cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-northeast-1"))
		if err != nil {
			initErr = fmt.Errorf("AWS config の読み込みに失敗: %w", err)
			return
		}
		instance = &Client{
			db:           dynamodb.NewFromConfig(cfg),
			expenseTable: os.Getenv("DYNAMO_EXPENSE_TABLE"),
			masterTable:  os.Getenv("DYNAMO_MASTER_TABLE"),
		}
	})
	if initErr != nil {
		return nil, initErr
	}
	return instance, nil
}

// --- DynamoDB 内部アイテム型 ---

// expenseItem は DynamoDB expenses テーブルのアイテム
type expenseItem struct {
	ID                   string `dynamodbav:"id"`
	YearMonth            string `dynamodbav:"yearMonth"`
	Date                 string `dynamodbav:"date"`
	Payer                string `dynamodbav:"payer"`
	Category             string `dynamodbav:"category"`
	Amount               int    `dynamodbav:"amount"`
	Memo                 string `dynamodbav:"memo"`
	Place                string `dynamodbav:"place"`
	Visibility           string `dynamodbav:"visibility,omitempty"`
	CreatedBy            string `dynamodbav:"createdBy"`
	CreatedAt            string `dynamodbav:"createdAt"`
	UpdatedAt            string `dynamodbav:"updatedAt"`
	ImportStatus         string `dynamodbav:"importStatus,omitempty"`
	ImportCard           string `dynamodbav:"importCard,omitempty"`
	ImportDate           string `dynamodbav:"importDate,omitempty"`
	ImportUser           string `dynamodbav:"importUser,omitempty"`
	ImportAmount         int    `dynamodbav:"importAmount,omitempty"`
	ImportMessageID      string `dynamodbav:"importMessageId,omitempty"`
	ImportIndex          int    `dynamodbav:"importIndex,omitempty"`
	DetailMessageID      string `dynamodbav:"detailMessageId,omitempty"`
	DetailIndex          int    `dynamodbav:"detailIndex,omitempty"`
	PreliminaryMessageID string `dynamodbav:"preliminaryMessageId,omitempty"`
	PreliminaryIndex     int    `dynamodbav:"preliminaryIndex,omitempty"`
	ManualCategory       bool   `dynamodbav:"manualCategory,omitempty"`
	ManualPayer          bool   `dynamodbav:"manualPayer,omitempty"`
	ManualMemo           bool   `dynamodbav:"manualMemo,omitempty"`
}

func (item *expenseItem) toModel() model.Expense {
	return model.Expense{
		ID:                   item.ID,
		Date:                 item.Date,
		Payer:                item.Payer,
		Category:             item.Category,
		Amount:               item.Amount,
		Memo:                 item.Memo,
		Place:                item.Place,
		Visibility:           item.Visibility,
		CreatedBy:            item.CreatedBy,
		CreatedAt:            item.CreatedAt,
		UpdatedAt:            item.UpdatedAt,
		ImportStatus:         item.ImportStatus,
		ImportCard:           item.ImportCard,
		ImportDate:           item.ImportDate,
		ImportUser:           item.ImportUser,
		ImportAmount:         item.ImportAmount,
		ImportMessageID:      item.ImportMessageID,
		ImportIndex:          item.ImportIndex,
		DetailMessageID:      item.DetailMessageID,
		DetailIndex:          item.DetailIndex,
		PreliminaryMessageID: item.PreliminaryMessageID,
		PreliminaryIndex:     item.PreliminaryIndex,
		ManualCategory:       item.ManualCategory,
		ManualPayer:          item.ManualPayer,
		ManualMemo:           item.ManualMemo,
	}
}

func expenseFromModel(e *model.Expense) expenseItem {
	ym := ""
	if len(e.Date) >= 7 {
		ym = e.Date[:7]
	}
	return expenseItem{
		ID:                   e.ID,
		YearMonth:            ym,
		Date:                 e.Date,
		Payer:                e.Payer,
		Category:             e.Category,
		Amount:               e.Amount,
		Memo:                 e.Memo,
		Place:                e.Place,
		Visibility:           e.Visibility,
		CreatedBy:            e.CreatedBy,
		CreatedAt:            e.CreatedAt,
		UpdatedAt:            e.UpdatedAt,
		ImportStatus:         e.ImportStatus,
		ImportCard:           e.ImportCard,
		ImportDate:           e.ImportDate,
		ImportUser:           e.ImportUser,
		ImportAmount:         e.ImportAmount,
		ImportMessageID:      e.ImportMessageID,
		ImportIndex:          e.ImportIndex,
		DetailMessageID:      e.DetailMessageID,
		DetailIndex:          e.DetailIndex,
		PreliminaryMessageID: e.PreliminaryMessageID,
		PreliminaryIndex:     e.PreliminaryIndex,
		ManualCategory:       e.ManualCategory,
		ManualPayer:          e.ManualPayer,
		ManualMemo:           e.ManualMemo,
	}
}

// categoryItem は DynamoDB master テーブルのカテゴリアイテム
type categoryItem struct {
	Type                 string `dynamodbav:"type"`
	ID                   string `dynamodbav:"id"`
	Name                 string `dynamodbav:"name"`
	SortOrder            int    `dynamodbav:"sortOrder"`
	Color                string `dynamodbav:"color"`
	IsActive             bool   `dynamodbav:"isActive"`
	IsExpense            bool   `dynamodbav:"isExpense"`
	ExcludeFromBreakdown bool   `dynamodbav:"excludeFromBreakdown"`
	ExcludeFromSummary   bool   `dynamodbav:"excludeFromSummary"`
	OwnerEmail           string `dynamodbav:"ownerEmail,omitempty"`
}

// placeItem は DynamoDB master テーブルの場所アイテム
type placeItem struct {
	Type      string `dynamodbav:"type"`
	ID        string `dynamodbav:"id"`
	Name      string `dynamodbav:"name"`
	SortOrder int    `dynamodbav:"sortOrder"`
	IsActive  bool   `dynamodbav:"isActive"`
}

// payerItem は DynamoDB master テーブルの支払元アイテム
type payerItem struct {
	Type         string `dynamodbav:"type"`
	ID           string `dynamodbav:"id"`
	Name         string `dynamodbav:"name"`
	SortOrder    int    `dynamodbav:"sortOrder"`
	IsActive     bool   `dynamodbav:"isActive"`
	TrackBalance bool   `dynamodbav:"trackBalance"`
}

// userItem は DynamoDB master テーブルのユーザーアイテム
type userItem struct {
	Type      string `dynamodbav:"type"`
	ID        string `dynamodbav:"id"`
	Role      string `dynamodbav:"role"`
	CreatedAt string `dynamodbav:"createdAt"`
}

// --- Expense 操作 ---

// PutExpense は支出を DynamoDB に保存する（作成・更新兼用）
func (c *Client) PutExpense(ctx context.Context, e *model.Expense) error {
	item := expenseFromModel(e)
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return fmt.Errorf("expense のマーシャルに失敗: %w", err)
	}
	_, err = c.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &c.expenseTable,
		Item:      av,
	})
	if err != nil {
		return fmt.Errorf("expense の保存に失敗: %w", err)
	}
	return nil
}

// GetExpense は ID で支出を1件取得する
func (c *Client) GetExpense(ctx context.Context, id string) (*model.Expense, error) {
	out, err := c.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &c.expenseTable,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("expense の取得に失敗: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}
	var item expenseItem
	if err := attributevalue.UnmarshalMap(out.Item, &item); err != nil {
		return nil, fmt.Errorf("expense のアンマーシャルに失敗: %w", err)
	}
	e := item.toModel()
	return &e, nil
}

// QueryExpensesByMonth は指定月の支出一覧を取得する（GSI: yearMonth-date-index、新しい日付順）
func (c *Client) QueryExpensesByMonth(ctx context.Context, yearMonth string) ([]model.Expense, error) {
	var all []model.Expense
	var lastKey map[string]types.AttributeValue
	for {
		out, err := c.db.Query(ctx, &dynamodb.QueryInput{
			TableName:                 &c.expenseTable,
			IndexName:                 aws.String("yearMonth-date-index"),
			KeyConditionExpression:    aws.String("yearMonth = :ym"),
			ExpressionAttributeValues: map[string]types.AttributeValue{":ym": &types.AttributeValueMemberS{Value: yearMonth}},
			ScanIndexForward:          aws.Bool(false),
			ExclusiveStartKey:         lastKey,
		})
		if err != nil {
			return nil, fmt.Errorf("expense の月別クエリに失敗: %w", err)
		}
		page, err := unmarshalExpenses(out.Items)
		if err != nil {
			return nil, err
		}
		all = append(all, page...)
		if len(out.LastEvaluatedKey) == 0 {
			return all, nil
		}
		lastKey = out.LastEvaluatedKey
	}
}

// ScanAllExpenses は全支出データを取得する
func (c *Client) ScanAllExpenses(ctx context.Context) ([]model.Expense, error) {
	var allItems []map[string]types.AttributeValue
	var lastKey map[string]types.AttributeValue

	for {
		input := &dynamodb.ScanInput{
			TableName:         &c.expenseTable,
			ExclusiveStartKey: lastKey,
		}
		out, err := c.db.Scan(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("expense の全件スキャンに失敗: %w", err)
		}
		allItems = append(allItems, out.Items...)
		if out.LastEvaluatedKey == nil {
			break
		}
		lastKey = out.LastEvaluatedKey
	}

	return unmarshalExpenses(allItems)
}

// DeleteExpense は支出を削除する
func (c *Client) DeleteExpense(ctx context.Context, id string) error {
	_, err := c.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &c.expenseTable,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return fmt.Errorf("expense の削除に失敗: %w", err)
	}
	return nil
}

func unmarshalExpenses(items []map[string]types.AttributeValue) ([]model.Expense, error) {
	var dbItems []expenseItem
	if err := attributevalue.UnmarshalListOfMaps(items, &dbItems); err != nil {
		return nil, fmt.Errorf("expense のアンマーシャルに失敗: %w", err)
	}
	expenses := make([]model.Expense, len(dbItems))
	for i, item := range dbItems {
		expenses[i] = item.toModel()
	}
	return expenses, nil
}

// --- Master 操作 ---

// queryMaster は master テーブルから指定 type のアイテムを取得する
func (c *Client) queryMaster(ctx context.Context, typeName string) ([]map[string]types.AttributeValue, error) {
	out, err := c.db.Query(ctx, &dynamodb.QueryInput{
		TableName:              &c.masterTable,
		KeyConditionExpression: aws.String("#t = :t"),
		ExpressionAttributeNames: map[string]string{
			"#t": "type",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":t": &types.AttributeValueMemberS{Value: typeName},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("master(%s) のクエリに失敗: %w", typeName, err)
	}
	return out.Items, nil
}

// GetCategories はアクティブなカテゴリ一覧をソート順で返す
func (c *Client) GetCategories(ctx context.Context) ([]model.Category, error) {
	items, err := c.queryMaster(ctx, "category")
	if err != nil {
		return nil, err
	}
	var dbItems []categoryItem
	if err := attributevalue.UnmarshalListOfMaps(items, &dbItems); err != nil {
		return nil, fmt.Errorf("category のアンマーシャルに失敗: %w", err)
	}
	categories := make([]model.Category, 0)
	for _, item := range dbItems {
		if item.IsActive {
			categories = append(categories, model.Category{
				ID:                   item.ID,
				Name:                 item.Name,
				SortOrder:            item.SortOrder,
				Color:                item.Color,
				IsActive:             item.IsActive,
				IsExpense:            item.IsExpense,
				ExcludeFromBreakdown: item.ExcludeFromBreakdown,
				ExcludeFromSummary:   item.ExcludeFromSummary,
				OwnerEmail:           item.OwnerEmail,
			})
		}
	}
	sort.Slice(categories, func(i, j int) bool {
		return categories[i].SortOrder < categories[j].SortOrder
	})
	return categories, nil
}

// GetPlaces はアクティブな場所一覧をソート順で返す
func (c *Client) GetPlaces(ctx context.Context) ([]model.Place, error) {
	items, err := c.queryMaster(ctx, "place")
	if err != nil {
		return nil, err
	}
	var dbItems []placeItem
	if err := attributevalue.UnmarshalListOfMaps(items, &dbItems); err != nil {
		return nil, fmt.Errorf("place のアンマーシャルに失敗: %w", err)
	}
	places := make([]model.Place, 0)
	for _, item := range dbItems {
		if item.IsActive {
			places = append(places, model.Place{
				ID:        item.ID,
				Name:      item.Name,
				SortOrder: item.SortOrder,
				IsActive:  item.IsActive,
			})
		}
	}
	sort.Slice(places, func(i, j int) bool {
		return places[i].SortOrder < places[j].SortOrder
	})
	return places, nil
}

// GetPayers はアクティブな支払元一覧をソート順で返す
func (c *Client) GetPayers(ctx context.Context) ([]model.Payer, error) {
	items, err := c.queryMaster(ctx, "payer")
	if err != nil {
		return nil, err
	}
	var dbItems []payerItem
	if err := attributevalue.UnmarshalListOfMaps(items, &dbItems); err != nil {
		return nil, fmt.Errorf("payer のアンマーシャルに失敗: %w", err)
	}
	payers := make([]model.Payer, 0)
	for _, item := range dbItems {
		if item.IsActive {
			payers = append(payers, model.Payer{
				ID:           item.ID,
				Name:         item.Name,
				SortOrder:    item.SortOrder,
				IsActive:     item.IsActive,
				TrackBalance: item.TrackBalance,
			})
		}
	}
	sort.Slice(payers, func(i, j int) bool {
		return payers[i].SortOrder < payers[j].SortOrder
	})
	return payers, nil
}

// GetAllCategories は全カテゴリ一覧をソート順で返す（isActive 問わず）
func (c *Client) GetAllCategories(ctx context.Context) ([]model.Category, error) {
	items, err := c.queryMaster(ctx, "category")
	if err != nil {
		return nil, err
	}
	var dbItems []categoryItem
	if err := attributevalue.UnmarshalListOfMaps(items, &dbItems); err != nil {
		return nil, fmt.Errorf("category のアンマーシャルに失敗: %w", err)
	}
	categories := make([]model.Category, len(dbItems))
	for i, item := range dbItems {
		categories[i] = model.Category{
			ID: item.ID, Name: item.Name, SortOrder: item.SortOrder,
			Color: item.Color, IsActive: item.IsActive, IsExpense: item.IsExpense,
			ExcludeFromBreakdown: item.ExcludeFromBreakdown,
			ExcludeFromSummary:   item.ExcludeFromSummary,
			OwnerEmail:           item.OwnerEmail,
		}
	}
	sort.Slice(categories, func(i, j int) bool {
		return categories[i].SortOrder < categories[j].SortOrder
	})
	return categories, nil
}

// PutCategory はカテゴリを保存する
func (c *Client) PutCategory(ctx context.Context, cat *model.Category) error {
	item := categoryItem{
		Type: "category", ID: cat.ID, Name: cat.Name, SortOrder: cat.SortOrder,
		Color: cat.Color, IsActive: cat.IsActive, IsExpense: cat.IsExpense,
		ExcludeFromBreakdown: cat.ExcludeFromBreakdown,
		ExcludeFromSummary:   cat.ExcludeFromSummary,
		OwnerEmail:           cat.OwnerEmail,
	}
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return fmt.Errorf("category のマーシャルに失敗: %w", err)
	}
	_, err = c.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &c.masterTable,
		Item:      av,
	})
	if err != nil {
		return fmt.Errorf("category の保存に失敗: %w", err)
	}
	return nil
}

// DeleteCategory はカテゴリを削除する
func (c *Client) DeleteCategory(ctx context.Context, id string) error {
	_, err := c.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &c.masterTable,
		Key: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "category"},
			"id":   &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return fmt.Errorf("category の削除に失敗: %w", err)
	}
	return nil
}

// GetAllPlaces は全場所一覧をソート順で返す（isActive 問わず）
func (c *Client) GetAllPlaces(ctx context.Context) ([]model.Place, error) {
	items, err := c.queryMaster(ctx, "place")
	if err != nil {
		return nil, err
	}
	var dbItems []placeItem
	if err := attributevalue.UnmarshalListOfMaps(items, &dbItems); err != nil {
		return nil, fmt.Errorf("place のアンマーシャルに失敗: %w", err)
	}
	places := make([]model.Place, len(dbItems))
	for i, item := range dbItems {
		places[i] = model.Place{
			ID: item.ID, Name: item.Name, SortOrder: item.SortOrder, IsActive: item.IsActive,
		}
	}
	sort.Slice(places, func(i, j int) bool {
		return places[i].SortOrder < places[j].SortOrder
	})
	return places, nil
}

// PutPlace は場所を保存する
func (c *Client) PutPlace(ctx context.Context, p *model.Place) error {
	item := placeItem{
		Type: "place", ID: p.ID, Name: p.Name, SortOrder: p.SortOrder, IsActive: p.IsActive,
	}
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return fmt.Errorf("place のマーシャルに失敗: %w", err)
	}
	_, err = c.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &c.masterTable,
		Item:      av,
	})
	if err != nil {
		return fmt.Errorf("place の保存に失敗: %w", err)
	}
	return nil
}

// DeletePlace は場所を削除する
func (c *Client) DeletePlace(ctx context.Context, id string) error {
	_, err := c.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &c.masterTable,
		Key: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "place"},
			"id":   &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return fmt.Errorf("place の削除に失敗: %w", err)
	}
	return nil
}

// GetAllPayers は全支払元一覧をソート順で返す（isActive 問わず）
func (c *Client) GetAllPayers(ctx context.Context) ([]model.Payer, error) {
	items, err := c.queryMaster(ctx, "payer")
	if err != nil {
		return nil, err
	}
	var dbItems []payerItem
	if err := attributevalue.UnmarshalListOfMaps(items, &dbItems); err != nil {
		return nil, fmt.Errorf("payer のアンマーシャルに失敗: %w", err)
	}
	payers := make([]model.Payer, len(dbItems))
	for i, item := range dbItems {
		payers[i] = model.Payer{
			ID: item.ID, Name: item.Name, SortOrder: item.SortOrder,
			IsActive: item.IsActive, TrackBalance: item.TrackBalance,
		}
	}
	sort.Slice(payers, func(i, j int) bool {
		return payers[i].SortOrder < payers[j].SortOrder
	})
	return payers, nil
}

// PutPayer は支払元を保存する
func (c *Client) PutPayer(ctx context.Context, p *model.Payer) error {
	item := payerItem{
		Type: "payer", ID: p.ID, Name: p.Name, SortOrder: p.SortOrder,
		IsActive: p.IsActive, TrackBalance: p.TrackBalance,
	}
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return fmt.Errorf("payer のマーシャルに失敗: %w", err)
	}
	_, err = c.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &c.masterTable,
		Item:      av,
	})
	if err != nil {
		return fmt.Errorf("payer の保存に失敗: %w", err)
	}
	return nil
}

// DeletePayer は支払元を削除する
func (c *Client) DeletePayer(ctx context.Context, id string) error {
	_, err := c.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &c.masterTable,
		Key: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "payer"},
			"id":   &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return fmt.Errorf("payer の削除に失敗: %w", err)
	}
	return nil
}

// GetUser は指定メールアドレスのユーザーを取得する（nil = 未登録）
func (c *Client) GetUser(ctx context.Context, email string) (*model.User, error) {
	out, err := c.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &c.masterTable,
		Key: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "user"},
			"id":   &types.AttributeValueMemberS{Value: email},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("user の取得に失敗: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}
	var item userItem
	if err := attributevalue.UnmarshalMap(out.Item, &item); err != nil {
		return nil, fmt.Errorf("user のアンマーシャルに失敗: %w", err)
	}
	return &model.User{
		Email:     item.ID,
		Role:      item.Role,
		CreatedAt: item.CreatedAt,
	}, nil
}

// --- Recurring 操作 ---

// recurringItem は DynamoDB master テーブルの定期支出アイテム
type recurringItem struct {
	Type             string `dynamodbav:"type"`
	ID               string `dynamodbav:"id"`
	Category         string `dynamodbav:"category"`
	Amount           int    `dynamodbav:"amount"`
	Payer            string `dynamodbav:"payer"`
	Place            string `dynamodbav:"place"`
	Memo             string `dynamodbav:"memo"`
	Visibility       string `dynamodbav:"visibility"`
	Frequency        string `dynamodbav:"frequency"`
	DayOfMonth       int    `dynamodbav:"dayOfMonth"`
	RepeatMonth      int    `dynamodbav:"repeatMonth"`
	StartMonth       string `dynamodbav:"startMonth"`
	EndMonth         string `dynamodbav:"endMonth"`
	IsActive         bool   `dynamodbav:"isActive"`
	LastCreatedMonth string `dynamodbav:"lastCreatedMonth"`
	CreatedAt        string `dynamodbav:"createdAt"`
	UpdatedAt        string `dynamodbav:"updatedAt"`
}

func (item *recurringItem) toModel() model.RecurringExpense {
	return model.RecurringExpense{
		ID:               item.ID,
		Category:         item.Category,
		Amount:           item.Amount,
		Payer:            item.Payer,
		Place:            item.Place,
		Memo:             item.Memo,
		Visibility:       item.Visibility,
		Frequency:        item.Frequency,
		DayOfMonth:       item.DayOfMonth,
		RepeatMonth:      item.RepeatMonth,
		StartMonth:       item.StartMonth,
		EndMonth:         item.EndMonth,
		IsActive:         item.IsActive,
		LastCreatedMonth: item.LastCreatedMonth,
		CreatedAt:        item.CreatedAt,
		UpdatedAt:        item.UpdatedAt,
	}
}

// GetRecurringExpenses は定期支出テンプレート一覧を返す
func (c *Client) GetRecurringExpenses(ctx context.Context) ([]model.RecurringExpense, error) {
	items, err := c.queryMaster(ctx, "recurring")
	if err != nil {
		return nil, err
	}
	var dbItems []recurringItem
	if err := attributevalue.UnmarshalListOfMaps(items, &dbItems); err != nil {
		return nil, fmt.Errorf("recurring のアンマーシャルに失敗: %w", err)
	}
	result := make([]model.RecurringExpense, len(dbItems))
	for i, item := range dbItems {
		result[i] = item.toModel()
	}
	return result, nil
}

// PutRecurringExpense は定期支出テンプレートを保存する
func (c *Client) PutRecurringExpense(ctx context.Context, r *model.RecurringExpense) error {
	item := recurringItem{
		Type:             "recurring",
		ID:               r.ID,
		Category:         r.Category,
		Amount:           r.Amount,
		Payer:            r.Payer,
		Place:            r.Place,
		Memo:             r.Memo,
		Visibility:       r.Visibility,
		Frequency:        r.Frequency,
		DayOfMonth:       r.DayOfMonth,
		RepeatMonth:      r.RepeatMonth,
		StartMonth:       r.StartMonth,
		EndMonth:         r.EndMonth,
		IsActive:         r.IsActive,
		LastCreatedMonth: r.LastCreatedMonth,
		CreatedAt:        r.CreatedAt,
		UpdatedAt:        r.UpdatedAt,
	}
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return fmt.Errorf("recurring のマーシャルに失敗: %w", err)
	}
	_, err = c.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &c.masterTable,
		Item:      av,
	})
	if err != nil {
		return fmt.Errorf("recurring の保存に失敗: %w", err)
	}
	return nil
}

// DeleteRecurringExpense は定期支出テンプレートを削除する
func (c *Client) DeleteRecurringExpense(ctx context.Context, id string) error {
	_, err := c.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &c.masterTable,
		Key: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "recurring"},
			"id":   &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return fmt.Errorf("recurring の削除に失敗: %w", err)
	}
	return nil
}

// UpdateRecurringLastCreated は lastCreatedMonth を更新する
func (c *Client) UpdateRecurringLastCreated(ctx context.Context, id string, month string) error {
	_, err := c.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &c.masterTable,
		Key: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "recurring"},
			"id":   &types.AttributeValueMemberS{Value: id},
		},
		UpdateExpression: aws.String("SET lastCreatedMonth = :m"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":m": &types.AttributeValueMemberS{Value: month},
		},
	})
	if err != nil {
		return fmt.Errorf("recurring の lastCreatedMonth 更新に失敗: %w", err)
	}
	return nil
}

// --- 月別集計キャッシュ ---

// categorySumItem は DynamoDB 内のカテゴリ別集計
type categorySumItem struct {
	CategoryID string `dynamodbav:"categoryId"`
	Category   string `dynamodbav:"category"`
	Amount     int    `dynamodbav:"amount"`
	Color      string `dynamodbav:"color"`
}

// monthlySumCacheItem は DynamoDB 内の月別集計キャッシュ
type monthlySumCacheItem struct {
	Type       string            `dynamodbav:"type"`
	ID         string            `dynamodbav:"id"`
	Total      int               `dynamodbav:"total"`
	ByCategory []categorySumItem `dynamodbav:"byCategory"`
	UpdatedAt  string            `dynamodbav:"updatedAt"`
}

// GetMonthlySummaryCache は月別集計キャッシュを取得する（nil = 未キャッシュ）
func (c *Client) GetMonthlySummaryCache(ctx context.Context, yearMonth string) (*model.MonthData, error) {
	out, err := c.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &c.masterTable,
		Key: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "monthlySummary"},
			"id":   &types.AttributeValueMemberS{Value: yearMonth},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("monthlySummary の取得に失敗: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}
	var item monthlySumCacheItem
	if err := attributevalue.UnmarshalMap(out.Item, &item); err != nil {
		return nil, fmt.Errorf("monthlySummary のアンマーシャルに失敗: %w", err)
	}
	return monthlySumCacheToModel(&item), nil
}

// PutMonthlySummaryCache は月別集計キャッシュを保存する
func (c *Client) PutMonthlySummaryCache(ctx context.Context, data *model.MonthData) error {
	var cats []categorySumItem
	for _, cs := range data.ByCategory {
		cats = append(cats, categorySumItem{
			CategoryID: cs.CategoryID, Category: cs.Category, Amount: cs.Amount, Color: cs.Color,
		})
	}
	item := monthlySumCacheItem{
		Type:       "monthlySummary",
		ID:         data.Month,
		Total:      data.Total,
		ByCategory: cats,
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return fmt.Errorf("monthlySummary のマーシャルに失敗: %w", err)
	}
	_, err = c.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &c.masterTable,
		Item:      av,
	})
	if err != nil {
		return fmt.Errorf("monthlySummary の保存に失敗: %w", err)
	}
	return nil
}

// BatchGetMonthlySummaryCache は複数月の集計キャッシュを一括取得する
func (c *Client) BatchGetMonthlySummaryCache(ctx context.Context, months []string) (map[string]*model.MonthData, error) {
	if len(months) == 0 {
		return make(map[string]*model.MonthData), nil
	}
	keys := make([]map[string]types.AttributeValue, len(months))
	for i, m := range months {
		keys[i] = map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "monthlySummary"},
			"id":   &types.AttributeValueMemberS{Value: m},
		}
	}
	out, err := c.db.BatchGetItem(ctx, &dynamodb.BatchGetItemInput{
		RequestItems: map[string]types.KeysAndAttributes{
			c.masterTable: {Keys: keys},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("monthlySummary の一括取得に失敗: %w", err)
	}
	result := make(map[string]*model.MonthData)
	for _, raw := range out.Responses[c.masterTable] {
		var item monthlySumCacheItem
		if err := attributevalue.UnmarshalMap(raw, &item); err != nil {
			continue
		}
		result[item.ID] = monthlySumCacheToModel(&item)
	}
	return result, nil
}

func monthlySumCacheToModel(item *monthlySumCacheItem) *model.MonthData {
	data := &model.MonthData{
		Month: item.ID,
		Total: item.Total,
	}
	for _, c := range item.ByCategory {
		data.ByCategory = append(data.ByCategory, model.CategorySummary{
			CategoryID: c.CategoryID, Category: c.Category, Amount: c.Amount, Color: c.Color,
		})
	}
	return data
}

// PutMasterItem は master テーブルにアイテムを保存する（移行用）
func (c *Client) PutMasterItem(ctx context.Context, item map[string]interface{}) error {
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return fmt.Errorf("master item のマーシャルに失敗: %w", err)
	}
	_, err = c.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &c.masterTable,
		Item:      av,
	})
	if err != nil {
		return fmt.Errorf("master item の保存に失敗: %w", err)
	}
	return nil
}

// BatchPutExpenses は expenses を最大25件ずつ BatchWriteItem で保存する（移行用）
func (c *Client) BatchPutExpenses(ctx context.Context, expenses []*model.Expense) (int, error) {
	count := 0
	for i := 0; i < len(expenses); i += 25 {
		end := i + 25
		if end > len(expenses) {
			end = len(expenses)
		}
		var requests []types.WriteRequest
		for _, e := range expenses[i:end] {
			item := expenseFromModel(e)
			av, err := attributevalue.MarshalMap(item)
			if err != nil {
				return count, fmt.Errorf("expense のマーシャルに失敗: %w", err)
			}
			requests = append(requests, types.WriteRequest{
				PutRequest: &types.PutRequest{Item: av},
			})
		}
		_, err := c.db.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]types.WriteRequest{
				c.expenseTable: requests,
			},
		})
		if err != nil {
			return count, fmt.Errorf("expense の一括保存に失敗: %w", err)
		}
		count += len(requests)
	}
	return count, nil
}

// BatchPutMasterItems は master アイテムを最大25件ずつ BatchWriteItem で保存する（移行用）
func (c *Client) BatchPutMasterItems(ctx context.Context, items []map[string]interface{}) (int, error) {
	count := 0
	for i := 0; i < len(items); i += 25 {
		end := i + 25
		if end > len(items) {
			end = len(items)
		}
		var requests []types.WriteRequest
		for _, item := range items[i:end] {
			av, err := attributevalue.MarshalMap(item)
			if err != nil {
				return count, fmt.Errorf("master item のマーシャルに失敗: %w", err)
			}
			requests = append(requests, types.WriteRequest{
				PutRequest: &types.PutRequest{Item: av},
			})
		}
		_, err := c.db.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]types.WriteRequest{
				c.masterTable: requests,
			},
		})
		if err != nil {
			return count, fmt.Errorf("master item の一括保存に失敗: %w", err)
		}
		count += len(requests)
	}
	return count, nil
}

// PutImportedExpense は同じ取込識別子の支出があれば既存データを返す。
func (c *Client) PutImportedExpense(ctx context.Context, e *model.Expense) (*model.Expense, bool, error) {
	av, err := attributevalue.MarshalMap(expenseFromModel(e))
	if err != nil {
		return nil, false, err
	}
	_, err = c.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &c.expenseTable, Item: av,
		ConditionExpression: aws.String("attribute_not_exists(id)"),
	})
	if err == nil {
		return e, true, nil
	}
	var condition *types.ConditionalCheckFailedException
	if !errors.As(err, &condition) {
		return nil, false, err
	}
	old, err := c.GetExpense(ctx, e.ID)
	if err != nil {
		return nil, false, err
	}
	if old == nil {
		return nil, false, fmt.Errorf("同じ取込明細の取得に失敗しました")
	}
	return old, false, nil
}

// GetImportResult は詳細明細の照合済み支出IDを取得する。
func (c *Client) GetImportResult(ctx context.Context, key string) (string, error) {
	out, err := c.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      &c.masterTable,
		Key:            map[string]types.AttributeValue{"type": &types.AttributeValueMemberS{Value: "expenseImport"}, "id": &types.AttributeValueMemberS{Value: key}},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return "", err
	}
	if v, ok := out.Item["expenseId"].(*types.AttributeValueMemberS); ok {
		return v.Value, nil
	}
	return "", nil
}

// FindPendingImportedExpenses は元の利用日などで速報明細を強い整合性で検索する。
func (c *Client) FindPendingImportedExpenses(ctx context.Context, card, date, user string, amount int) ([]model.Expense, error) {
	var result []model.Expense
	var lastKey map[string]types.AttributeValue
	for {
		out, err := c.db.Scan(ctx, &dynamodb.ScanInput{
			TableName:        &c.expenseTable,
			ConsistentRead:   aws.Bool(true),
			FilterExpression: aws.String("importStatus = :status AND importCard = :card AND importDate = :date AND importUser = :user AND importAmount = :amount"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":status": &types.AttributeValueMemberS{Value: "pending"},
				":card":   &types.AttributeValueMemberS{Value: card},
				":date":   &types.AttributeValueMemberS{Value: date},
				":user":   &types.AttributeValueMemberS{Value: user},
				":amount": &types.AttributeValueMemberN{Value: strconv.Itoa(amount)},
			},
			ExclusiveStartKey: lastKey,
		})
		if err != nil {
			return nil, fmt.Errorf("速報明細の検索に失敗: %w", err)
		}
		page, err := unmarshalExpenses(out.Items)
		if err != nil {
			return nil, err
		}
		result = append(result, page...)
		if len(out.LastEvaluatedKey) == 0 {
			return result, nil
		}
		lastKey = out.LastEvaluatedKey
	}
}

// PutImportedExpenseIfUnchanged は取込支出の手動編集を同時照合と競合しない形で保存する。
func (c *Client) PutImportedExpenseIfUnchanged(ctx context.Context, e *model.Expense, previousUpdatedAt string, previousStatus string) (bool, error) {
	av, err := attributevalue.MarshalMap(expenseFromModel(e))
	if err != nil {
		return false, err
	}
	_, err = c.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &c.expenseTable, Item: av,
		ConditionExpression: aws.String("importStatus = :status AND updatedAt = :updated"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":status":  &types.AttributeValueMemberS{Value: previousStatus},
			":updated": &types.AttributeValueMemberS{Value: previousUpdatedAt},
		},
	})
	if err == nil {
		return true, nil
	}
	var condition *types.ConditionalCheckFailedException
	if errors.As(err, &condition) {
		return false, nil
	}
	return false, err
}

// GetImportGroupRevision は同じ利用日・利用者・金額の取込更新番号を取得する。
func (c *Client) GetImportGroupRevision(ctx context.Context, key string) (int, error) {
	out, err := c.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &c.masterTable,
		Key: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "expenseImportGroup"},
			"id":   &types.AttributeValueMemberS{Value: key},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return 0, err
	}
	if v, ok := out.Item["revision"].(*types.AttributeValueMemberN); ok {
		return strconv.Atoi(v.Value)
	}
	return 0, nil
}

func importGroupRevisionUpdate(tableName string, groupKey string, revision int) *types.Update {
	condition := "revision = :old"
	values := map[string]types.AttributeValue{
		":next": &types.AttributeValueMemberN{Value: strconv.Itoa(revision + 1)},
	}
	if revision == 0 {
		condition = "attribute_not_exists(revision)"
	} else {
		values[":old"] = &types.AttributeValueMemberN{Value: strconv.Itoa(revision)}
	}

	return &types.Update{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "expenseImportGroup"},
			"id":   &types.AttributeValueMemberS{Value: groupKey},
		},
		UpdateExpression:          aws.String("SET revision = :next"),
		ConditionExpression:       aws.String(condition),
		ExpressionAttributeValues: values,
	}
}

// CommitGroupedImport は照合キー単位の更新と支出・取込記録を一括確定する。
// mode は new、pending、detail のいずれかを指定する。
func (c *Client) CommitGroupedImport(ctx context.Context, groupKey string, revision int, markerKey string, e *model.Expense, previousUpdatedAt string, mode string) (bool, error) {
	av, err := attributevalue.MarshalMap(expenseFromModel(e))
	if err != nil {
		return false, err
	}
	group := types.TransactWriteItem{Update: importGroupRevisionUpdate(c.masterTable, groupKey, revision)}
	items := []types.TransactWriteItem{group}
	if markerKey != "" {
		items = append(items, types.TransactWriteItem{Put: &types.Put{
			TableName: &c.masterTable,
			Item: map[string]types.AttributeValue{
				"type":      &types.AttributeValueMemberS{Value: "expenseImport"},
				"id":        &types.AttributeValueMemberS{Value: markerKey},
				"expenseId": &types.AttributeValueMemberS{Value: e.ID},
			},
			ConditionExpression: aws.String("attribute_not_exists(id)"),
		}})
	}
	put := &types.Put{TableName: &c.expenseTable, Item: av}
	switch mode {
	case "new":
		put.ConditionExpression = aws.String("attribute_not_exists(id)")
	case "pending":
		put.ConditionExpression = aws.String("importStatus = :status AND updatedAt = :updated")
		put.ExpressionAttributeValues = map[string]types.AttributeValue{
			":status":  &types.AttributeValueMemberS{Value: "pending"},
			":updated": &types.AttributeValueMemberS{Value: previousUpdatedAt},
		}
	case "detail":
		put.ConditionExpression = aws.String("importStatus = :status AND attribute_not_exists(preliminaryMessageId) AND updatedAt = :updated")
		put.ExpressionAttributeValues = map[string]types.AttributeValue{
			":status":  &types.AttributeValueMemberS{Value: "complete"},
			":updated": &types.AttributeValueMemberS{Value: previousUpdatedAt},
		}
	default:
		return false, fmt.Errorf("取込更新の種類が不正です")
	}
	items = append(items, types.TransactWriteItem{Put: put})
	_, err = c.db.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: items})
	if err == nil {
		return true, nil
	}
	var canceled *types.TransactionCanceledException
	if errors.As(err, &canceled) {
		return false, nil
	}
	return false, err
}

// FindUnpairedDetailedExpenses は速報明細と未照合の詳細版を強い整合性で探す。
func (c *Client) FindUnpairedDetailedExpenses(ctx context.Context, card, date, user string, amount int) ([]model.Expense, error) {
	var result []model.Expense
	var lastKey map[string]types.AttributeValue
	for {
		out, err := c.db.Scan(ctx, &dynamodb.ScanInput{
			TableName:        &c.expenseTable,
			ConsistentRead:   aws.Bool(true),
			FilterExpression: aws.String("importStatus = :status AND importCard = :card AND importDate = :date AND importUser = :user AND importAmount = :amount AND attribute_not_exists(preliminaryMessageId)"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":status": &types.AttributeValueMemberS{Value: "complete"},
				":card":   &types.AttributeValueMemberS{Value: card},
				":date":   &types.AttributeValueMemberS{Value: date},
				":user":   &types.AttributeValueMemberS{Value: user},
				":amount": &types.AttributeValueMemberN{Value: strconv.Itoa(amount)},
			},
			ExclusiveStartKey: lastKey,
		})
		if err != nil {
			return nil, fmt.Errorf("未照合の詳細明細の検索に失敗: %w", err)
		}
		page, err := unmarshalExpenses(out.Items)
		if err != nil {
			return nil, err
		}
		result = append(result, page...)
		if len(out.LastEvaluatedKey) == 0 {
			return result, nil
		}
		lastKey = out.LastEvaluatedKey
	}
}
