package service

import (
	"context"

	"money-diary/internal/apperror"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
)

// GetPayers はアクティブな支払元一覧をソート順で返す
func GetPayers(ctx context.Context, client *dynamo.Client) ([]model.Payer, error) {
	return client.GetPayers(ctx)
}

// GetAllPayers は全支払元一覧を返す（設定画面用）
func GetAllPayers(ctx context.Context, client *dynamo.Client) ([]model.Payer, error) {
	return client.GetAllPayers(ctx)
}

// CreatePayer は支払元を作成する
func CreatePayer(ctx context.Context, client *dynamo.Client, input *model.PayerInput) (*model.Payer, error) {
	if input.Name == "" {
		return nil, apperror.New("名前は必須です")
	}
	p := &model.Payer{
		ID:           input.Name,
		Name:         input.Name,
		SortOrder:    input.SortOrder,
		IsActive:     input.IsActive,
		TrackBalance: input.TrackBalance,
	}
	if err := client.PutPayer(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// UpdatePayer は支払元を更新する
func UpdatePayer(ctx context.Context, client *dynamo.Client, id string, input *model.PayerInput) (*model.Payer, error) {
	if input.Name == "" {
		return nil, apperror.New("名前は必須です")
	}
	p := &model.Payer{
		ID:           id,
		Name:         input.Name,
		SortOrder:    input.SortOrder,
		IsActive:     input.IsActive,
		TrackBalance: input.TrackBalance,
	}
	if err := client.PutPayer(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// DeletePayer は支払元を削除する
func DeletePayer(ctx context.Context, client *dynamo.Client, id string) error {
	return client.DeletePayer(ctx, id)
}
