package service

import (
	"context"

	"github.com/google/uuid"

	"money-diary/internal/apperror"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
)

// GetCategories はアクティブなカテゴリ一覧をソート順で返す
func GetCategories(ctx context.Context, client *dynamo.Client) ([]model.Category, error) {
	return client.GetCategories(ctx)
}

// GetAllCategories は全カテゴリ一覧を返す（設定画面用）
func GetAllCategories(ctx context.Context, client *dynamo.Client) ([]model.Category, error) {
	return client.GetAllCategories(ctx)
}

// CreateCategory はカテゴリを作成する
func CreateCategory(ctx context.Context, client *dynamo.Client, input *model.CategoryInput) (*model.Category, error) {
	if input.Name == "" {
		return nil, apperror.New("名前は必須です")
	}
	cat := &model.Category{
		ID:                   uuid.New().String(),
		Name:                 input.Name,
		SortOrder:            input.SortOrder,
		Color:                input.Color,
		IsActive:             input.IsActive,
		IsExpense:            input.IsExpense,
		ExcludeFromBreakdown: input.ExcludeFromBreakdown,
		ExcludeFromSummary:   input.ExcludeFromSummary,
	}
	if err := client.PutCategory(ctx, cat); err != nil {
		return nil, err
	}
	return cat, nil
}

// UpdateCategory はカテゴリを更新する
func UpdateCategory(ctx context.Context, client *dynamo.Client, id string, input *model.CategoryInput) (*model.Category, error) {
	if input.Name == "" {
		return nil, apperror.New("名前は必須です")
	}
	cat := &model.Category{
		ID:                   id,
		Name:                 input.Name,
		SortOrder:            input.SortOrder,
		Color:                input.Color,
		IsActive:             input.IsActive,
		IsExpense:            input.IsExpense,
		ExcludeFromBreakdown: input.ExcludeFromBreakdown,
		ExcludeFromSummary:   input.ExcludeFromSummary,
	}
	if err := client.PutCategory(ctx, cat); err != nil {
		return nil, err
	}
	return cat, nil
}

// DeleteCategory はカテゴリを削除する
func DeleteCategory(ctx context.Context, client *dynamo.Client, id string) error {
	return client.DeleteCategory(ctx, id)
}

// CategoryMaps はカテゴリの各種マップをまとめて保持する（キーはカテゴリID）
type CategoryMaps struct {
	Name                 map[string]string // カテゴリID→名前
	Color                map[string]string // カテゴリID→色
	IsExpense            map[string]bool   // カテゴリID→isExpense
	SortOrder            map[string]int    // カテゴリID→sortOrder
	ExcludeFromBreakdown map[string]bool   // カテゴリID→内訳から除外
	ExcludeFromSummary   map[string]bool   // カテゴリID→集計から完全除外
}

// GetCategoryMaps はカテゴリの各種マップをまとめて返す（キーはカテゴリID）
func GetCategoryMaps(ctx context.Context, client *dynamo.Client) (*CategoryMaps, error) {
	categories, err := client.GetCategories(ctx)
	if err != nil {
		return nil, err
	}

	cm := &CategoryMaps{
		Name:                 make(map[string]string, len(categories)),
		Color:                make(map[string]string, len(categories)),
		IsExpense:            make(map[string]bool, len(categories)),
		SortOrder:            make(map[string]int, len(categories)),
		ExcludeFromBreakdown: make(map[string]bool, len(categories)),
		ExcludeFromSummary:   make(map[string]bool, len(categories)),
	}
	for _, c := range categories {
		cm.Name[c.ID] = c.Name
		cm.Color[c.ID] = c.Color
		cm.IsExpense[c.ID] = c.IsExpense
		cm.SortOrder[c.ID] = c.SortOrder
		cm.ExcludeFromBreakdown[c.ID] = c.ExcludeFromBreakdown
		cm.ExcludeFromSummary[c.ID] = c.ExcludeFromSummary
	}
	return cm, nil
}
