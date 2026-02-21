package service

import (
	"context"

	"github.com/google/uuid"

	"money-diary/internal/apperror"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
)

// GetPlaces はアクティブな場所一覧をソート順で返す
func GetPlaces(ctx context.Context, client *dynamo.Client) ([]model.Place, error) {
	return client.GetPlaces(ctx)
}

// GetAllPlaces は全場所一覧を返す（設定画面用）
func GetAllPlaces(ctx context.Context, client *dynamo.Client) ([]model.Place, error) {
	return client.GetAllPlaces(ctx)
}

// CreatePlace は場所を作成する
func CreatePlace(ctx context.Context, client *dynamo.Client, input *model.PlaceInput) (*model.Place, error) {
	if input.Name == "" {
		return nil, apperror.New("名前は必須です")
	}
	p := &model.Place{
		ID:        uuid.New().String(),
		Name:      input.Name,
		SortOrder: input.SortOrder,
		IsActive:  input.IsActive,
	}
	if err := client.PutPlace(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// UpdatePlace は場所を更新する
func UpdatePlace(ctx context.Context, client *dynamo.Client, id string, input *model.PlaceInput) (*model.Place, error) {
	if input.Name == "" {
		return nil, apperror.New("名前は必須です")
	}
	p := &model.Place{
		ID:        id,
		Name:      input.Name,
		SortOrder: input.SortOrder,
		IsActive:  input.IsActive,
	}
	if err := client.PutPlace(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// DeletePlace は場所を削除する
func DeletePlace(ctx context.Context, client *dynamo.Client, id string) error {
	return client.DeletePlace(ctx, id)
}
