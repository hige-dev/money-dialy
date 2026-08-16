package service

import (
	"context"
	"strings"

	"money-diary/internal/apperror"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
	"money-diary/internal/parser"
)

// ProcessGmailWebhook は Gmail Webhook を受けてクレジットカード利用メールを自動登録する
func ProcessGmailWebhook(ctx context.Context, client *dynamo.Client, req *model.WebhookGmailRequest, defaultUserEmail string) ([]model.Expense, error) {
	if req.Body == "" {
		return nil, apperror.New("メール本文(body)が空です")
	}

	var inputs []model.ExpenseInput

	// 送信元や件名で判定（楽天カード）
	if strings.Contains(req.From, "rakuten-card") || strings.Contains(req.Subject, "楽天カード") || strings.Contains(req.Body, "楽天カード") {
		inputs = parser.ParseRakutenCardEmail(req.Body, "楽天カード", "未分類")
	} else {
		return nil, apperror.New("未対応のカード利用通知メールです")
	}

	if len(inputs) == 0 {
		return []model.Expense{}, nil
	}

	// 一括登録
	created, err := BulkCreateExpenses(ctx, client, inputs, defaultUserEmail)
	if err != nil {
		return nil, err
	}

	return created, nil
}
