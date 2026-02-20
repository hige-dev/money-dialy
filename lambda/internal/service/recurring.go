package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"money-diary/internal/apperror"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
)

// GetRecurringExpenses は定期支出テンプレート一覧を返す
func GetRecurringExpenses(ctx context.Context, client *dynamo.Client) ([]model.RecurringExpense, error) {
	return client.GetRecurringExpenses(ctx)
}

// CreateRecurringExpense は定期支出テンプレートを作成する
func CreateRecurringExpense(ctx context.Context, client *dynamo.Client, input *model.RecurringExpenseInput) (*model.RecurringExpense, error) {
	if input.Category == "" || input.Amount <= 0 || input.DayOfMonth < 1 || input.DayOfMonth > 31 {
		return nil, apperror.New("カテゴリ、金額（正の数）、日（1-31）は必須です")
	}
	if input.Frequency != "monthly" && input.Frequency != "bimonthly" && input.Frequency != "yearly" {
		return nil, apperror.New("頻度は monthly, bimonthly, yearly のいずれかを指定してください")
	}
	if input.Frequency == "yearly" && (input.RepeatMonth < 1 || input.RepeatMonth > 12) {
		return nil, apperror.New("年間定期支出の場合、月（1-12）は必須です")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	r := &model.RecurringExpense{
		ID:          uuid.New().String(),
		Category:    input.Category,
		Amount:      input.Amount,
		Payer:       input.Payer,
		Place:       input.Place,
		Memo:        input.Memo,
		Frequency:   input.Frequency,
		DayOfMonth:  input.DayOfMonth,
		RepeatMonth: input.RepeatMonth,
		StartMonth:  input.StartMonth,
		EndMonth:    input.EndMonth,
		IsActive:    input.IsActive,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := client.PutRecurringExpense(ctx, r); err != nil {
		return nil, err
	}
	return r, nil
}

// UpdateRecurringExpense は定期支出テンプレートを更新する
func UpdateRecurringExpense(ctx context.Context, client *dynamo.Client, id string, input *model.RecurringExpenseInput) (*model.RecurringExpense, error) {
	if input.Category == "" || input.Amount <= 0 || input.DayOfMonth < 1 || input.DayOfMonth > 31 {
		return nil, apperror.New("カテゴリ、金額（正の数）、日（1-31）は必須です")
	}
	if input.Frequency != "monthly" && input.Frequency != "bimonthly" && input.Frequency != "yearly" {
		return nil, apperror.New("頻度は monthly, bimonthly, yearly のいずれかを指定してください")
	}

	existing, err := client.GetRecurringExpenses(ctx)
	if err != nil {
		return nil, err
	}
	var found *model.RecurringExpense
	for _, r := range existing {
		if r.ID == id {
			found = &r
			break
		}
	}
	if found == nil {
		return nil, apperror.WithStatus(404, "定期支出テンプレートが見つかりません")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	found.Category = input.Category
	found.Amount = input.Amount
	found.Payer = input.Payer
	found.Place = input.Place
	found.Memo = input.Memo
	found.Frequency = input.Frequency
	found.DayOfMonth = input.DayOfMonth
	found.RepeatMonth = input.RepeatMonth
	found.StartMonth = input.StartMonth
	found.EndMonth = input.EndMonth
	found.IsActive = input.IsActive
	found.UpdatedAt = now

	if err := client.PutRecurringExpense(ctx, found); err != nil {
		return nil, err
	}
	return found, nil
}

// DeleteRecurringExpense は定期支出テンプレートを削除する
func DeleteRecurringExpense(ctx context.Context, client *dynamo.Client, id string) error {
	return client.DeleteRecurringExpense(ctx, id)
}

// ProcessRecurringExpenses は当月の定期支出を自動登録する
func ProcessRecurringExpenses(ctx context.Context, client *dynamo.Client, userEmail string) (int, error) {
	now := time.Now()
	currentMonth := fmt.Sprintf("%04d-%02d", now.Year(), now.Month())

	templates, err := client.GetRecurringExpenses(ctx)
	if err != nil {
		return 0, err
	}

	created := 0
	for _, t := range templates {
		if !t.IsActive {
			continue
		}
		if t.LastCreatedMonth >= currentMonth {
			continue
		}

		// yearly の場合は対象月チェック
		if t.Frequency == "yearly" {
			parts := strings.Split(currentMonth, "-")
			if len(parts) == 2 {
				m, _ := strconv.Atoi(parts[1])
				if m != t.RepeatMonth {
					continue
				}
			}
		}

		// 日付を決定（月末日に丸め）
		y := now.Year()
		m := now.Month()
		lastDay := time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
		day := t.DayOfMonth
		if day > lastDay {
			day = lastDay
		}
		date := fmt.Sprintf("%04d-%02d-%02d", y, m, day)

		// 支出を作成（CreateExpense 内でバックアップも実行される）
		_, err := CreateExpense(ctx, client, &model.ExpenseInput{
			Date:     date,
			Payer:    t.Payer,
			Category: t.Category,
			Amount:   t.Amount,
			Memo:     t.Memo,
			Place:    t.Place,
		}, userEmail)
		if err != nil {
			return created, fmt.Errorf("定期支出 %s の作成に失敗: %w", t.ID, err)
		}

		// lastCreatedMonth を更新
		if err := client.UpdateRecurringLastCreated(ctx, t.ID, currentMonth); err != nil {
			return created, fmt.Errorf("lastCreatedMonth の更新に失敗: %w", err)
		}
		created++
	}

	return created, nil
}
