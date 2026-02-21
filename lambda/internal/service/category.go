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

// CategoryMaps はカテゴリの各種マップをまとめて保持する
type CategoryMaps struct {
	Color                map[string]string // カテゴリ名→色
	IsExpense            map[string]bool   // カテゴリ名→isExpense
	SortOrder            map[string]int    // カテゴリ名→sortOrder
	ExcludeFromBreakdown map[string]bool   // カテゴリ名→内訳から除外
}

// GetCategoryMaps はカテゴリの色・isExpense・sortOrder マップをまとめて返す
func GetCategoryMaps(ctx context.Context, client *dynamo.Client) (*CategoryMaps, error) {
	categories, err := client.GetCategories(ctx)
	if err != nil {
		return nil, err
	}

	cm := &CategoryMaps{
		Color:                make(map[string]string, len(categories)),
		IsExpense:            make(map[string]bool, len(categories)),
		SortOrder:            make(map[string]int, len(categories)),
		ExcludeFromBreakdown: make(map[string]bool, len(categories)),
	}
	for _, c := range categories {
		cm.Color[c.Name] = c.Color
		cm.IsExpense[c.Name] = c.IsExpense
		cm.SortOrder[c.Name] = c.SortOrder
		cm.ExcludeFromBreakdown[c.Name] = c.ExcludeFromBreakdown
	}
	return cm, nil
}
