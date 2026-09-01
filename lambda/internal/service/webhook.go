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

	// 登録済みのパーサーから自動判定して抽出
	inputs, cardName, err := parser.ParseEmail(req.From, req.Subject, req.Body)
	if err != nil {
		return nil, apperror.Newf("パースエラー (%s): %v", cardName, err)
	}

	if len(inputs) == 0 {
		return []model.Expense{}, nil
	}

	// メールマッピングの適用 (件名・キーワード)
	var activeInputs []model.ExpenseInput
	mappings, err := client.ListEmailMappings(ctx)
	if err == nil && len(mappings) > 0 {
		for i := range inputs {
			excluded := false
			for _, m := range mappings {
				matched := false
				if m.Type == "subject" {
					if strings.Contains(req.Subject, m.Identifier) {
						matched = true
					}
				} else if m.Type == "keyword" {
					if strings.Contains(inputs[i].Place, m.Identifier) || strings.Contains(req.Body, m.Identifier) {
						matched = true
					}
				}
				if matched {
					if m.Exclude {
						excluded = true
						break
					}
					if m.Payer != nil && *m.Payer != "" {
						inputs[i].Payer = *m.Payer
					}
					if m.Category != nil && *m.Category != "" {
						inputs[i].Category = *m.Category
					}
					if m.Place != nil && *m.Place != "" {
						inputs[i].Place = *m.Place
					}
				}
			}
			if !excluded {
				activeInputs = append(activeInputs, inputs[i])
			}
		}
	} else {
		activeInputs = inputs
	}

	if len(activeInputs) == 0 {
		return []model.Expense{}, nil
	}

	// 一括登録
	created, err := BulkCreateExpenses(ctx, client, activeInputs, defaultUserEmail)
	if err != nil {
		return nil, err
	}

	return created, nil
}
