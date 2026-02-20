package service

import (
	"context"

	"money-diary/internal/dynamo"
)

// IsUserRegistered はユーザーが登録されているか確認する
func IsUserRegistered(ctx context.Context, client *dynamo.Client, email string) (bool, error) {
	user, err := client.GetUser(ctx, email)
	if err != nil {
		return false, err
	}
	return user != nil, nil
}

// GetUserRole はユーザーのロールを取得する
func GetUserRole(ctx context.Context, client *dynamo.Client, email string) (string, error) {
	user, err := client.GetUser(ctx, email)
	if err != nil {
		return "user", err
	}
	if user == nil || user.Role == "" {
		return "user", nil
	}
	return user.Role, nil
}
