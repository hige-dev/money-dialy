package service

import (
	"context"

	"github.com/google/uuid"

	"money-diary/internal/apperror"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
)

// filterCategoriesForUser は共有カテゴリ + 指定ユーザーの個人カテゴリのみ返す
func filterCategoriesForUser(categories []model.Category, userEmail string) []model.Category {
	result := make([]model.Category, 0, len(categories))
	for _, c := range categories {
		if c.OwnerEmail == "" || c.OwnerEmail == userEmail {
			result = append(result, c)
		}
	}
	return result
}

// GetCategories はアクティブなカテゴリ一覧をソート順で返す（共有 + 自分の個人カテゴリ）
func GetCategories(ctx context.Context, client *dynamo.Client, userEmail string) ([]model.Category, error) {
	all, err := client.GetCategories(ctx)
	if err != nil {
		return nil, err
	}
	return filterCategoriesForUser(all, userEmail), nil
}

// GetAllCategories は全カテゴリ一覧を返す（設定画面用、共有 + 自分の個人カテゴリ）
func GetAllCategories(ctx context.Context, client *dynamo.Client, userEmail string) ([]model.Category, error) {
	all, err := client.GetAllCategories(ctx)
	if err != nil {
		return nil, err
	}
	return filterCategoriesForUser(all, userEmail), nil
}

// CreateCategory はカテゴリを作成する
func CreateCategory(ctx context.Context, client *dynamo.Client, input *model.CategoryInput, userEmail string) (*model.Category, error) {
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
		OwnerEmail:           input.OwnerEmail,
	}
	if err := client.PutCategory(ctx, cat); err != nil {
		return nil, err
	}
	return cat, nil
}

// UpdateCategory はカテゴリを更新する（個人カテゴリは所有者のみ更新可能）
func UpdateCategory(ctx context.Context, client *dynamo.Client, id string, input *model.CategoryInput, userEmail string) (*model.Category, error) {
	if input.Name == "" {
		return nil, apperror.New("名前は必須です")
	}

	// 既存カテゴリを取得して権限チェック
	existing, err := client.GetAllCategories(ctx)
	if err != nil {
		return nil, err
	}
	for _, c := range existing {
		if c.ID == id && c.OwnerEmail != "" && c.OwnerEmail != userEmail {
			return nil, apperror.New("他人の個人カテゴリは更新できません")
		}
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
		OwnerEmail:           input.OwnerEmail,
	}
	if err := client.PutCategory(ctx, cat); err != nil {
		return nil, err
	}
	return cat, nil
}

// DeleteCategory はカテゴリを削除する（個人カテゴリは所有者のみ削除可能）
func DeleteCategory(ctx context.Context, client *dynamo.Client, id string, userEmail string) error {
	existing, err := client.GetAllCategories(ctx)
	if err != nil {
		return err
	}
	for _, c := range existing {
		if c.ID == id && c.OwnerEmail != "" && c.OwnerEmail != userEmail {
			return apperror.New("他人の個人カテゴリは削除できません")
		}
	}
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
	OwnerEmail           map[string]string // カテゴリID→ownerEmail
}

// GetCategoryMaps はカテゴリの各種マップをまとめて返す（キーはカテゴリID）。
// userEmail が空の場合は共有カテゴリのみ、値ありの場合は共有+個人カテゴリを含む。
func GetCategoryMaps(ctx context.Context, client *dynamo.Client, userEmail string) (*CategoryMaps, error) {
	all, err := client.GetCategories(ctx)
	if err != nil {
		return nil, err
	}
	categories := filterCategoriesForUser(all, userEmail)

	cm := &CategoryMaps{
		Name:                 make(map[string]string, len(categories)),
		Color:                make(map[string]string, len(categories)),
		IsExpense:            make(map[string]bool, len(categories)),
		SortOrder:            make(map[string]int, len(categories)),
		ExcludeFromBreakdown: make(map[string]bool, len(categories)),
		ExcludeFromSummary:   make(map[string]bool, len(categories)),
		OwnerEmail:           make(map[string]string, len(categories)),
	}
	for _, c := range categories {
		cm.Name[c.ID] = c.Name
		cm.Color[c.ID] = c.Color
		cm.IsExpense[c.ID] = c.IsExpense
		cm.SortOrder[c.ID] = c.SortOrder
		cm.ExcludeFromBreakdown[c.ID] = c.ExcludeFromBreakdown
		cm.ExcludeFromSummary[c.ID] = c.ExcludeFromSummary
		cm.OwnerEmail[c.ID] = c.OwnerEmail
	}
	return cm, nil
}
