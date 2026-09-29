// Package localrestore は日次バックアップをローカル検証用に復元する。
package localrestore

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
	"money-diary/internal/service"
)

// ReadCSV はスプレッドシートからダウンロードした CSV を読み込む。
func ReadCSV(r io.Reader) ([][]string, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1
	return reader.ReadAll()
}

// Parse は日次バックアップの列順を検証し、書き込み前に全データを検査する。
func Parse(rows [][]string) ([]model.Expense, error) {
	expected := []string{"id", "date", "payer", "category", "amount", "memo", "place", "createdBy", "createdAt", "updatedAt"}
	if len(rows) == 0 || len(rows[0]) < len(expected) {
		return nil, fmt.Errorf("バックアップのヘッダーがありません")
	}
	for i, name := range expected {
		actual := strings.TrimSpace(strings.TrimPrefix(rows[0][i], "\ufeff"))
		if actual != name {
			return nil, fmt.Errorf("ヘッダーの %d 列目は %s を指定してください", i+1, name)
		}
	}
	if len(rows[0]) > 10 && rows[0][10] != "visibility" {
		return nil, fmt.Errorf("11 列目は visibility を指定してください")
	}
	seen := map[string]bool{}
	var expenses []model.Expense
	for i, row := range rows[1:] {
		if strings.TrimSpace(strings.Join(row, "")) == "" {
			continue
		}
		if len(row) < 5 || row[0] == "" {
			return nil, fmt.Errorf("%d 行目の ID または必須列が不足しています", i+2)
		}
		if seen[row[0]] {
			return nil, fmt.Errorf("%d 行目の ID が重複しています", i+2)
		}
		seen[row[0]] = true
		if _, err := time.Parse("2006-01-02", row[1]); err != nil {
			return nil, fmt.Errorf("%d 行目の日付は YYYY-MM-DD を指定してください", i+2)
		}
		amount, err := strconv.Atoi(row[4])
		if err != nil || amount <= 0 {
			return nil, fmt.Errorf("%d 行目の金額は正の整数を指定してください", i+2)
		}
		cell := func(n int) string {
			if n < len(row) {
				return row[n]
			}
			return ""
		}
		visibility := cell(10)
		if !service.ValidateVisibility(visibility) {
			return nil, fmt.Errorf("%d 行目の visibility が不正です", i+2)
		}
		expenses = append(expenses, model.Expense{ID: row[0], Date: row[1], Payer: row[2], Category: row[3], Amount: amount, Memo: cell(5), Place: cell(6), CreatedBy: cell(7), CreatedAt: cell(8), UpdatedAt: cell(9), Visibility: visibility})
	}
	return expenses, nil
}

type Plan struct {
	Expenses   []model.Expense
	Categories []model.Category
	Payers     []model.Payer
	Places     []model.Place
	DeleteIDs  []string
	Months     map[string]bool
}

// BuildPlan は名前で保存されたカテゴリをローカル ID に対応付ける。
// マスタがない場合は決定的な ID で補完し、再取込による重複を防ぐ。
func BuildPlan(source, existing []model.Expense, categories []model.Category, payers []model.Payer, places []model.Place, replace bool, createdBy string) (*Plan, error) {
	plan := &Plan{Months: map[string]bool{}}
	categoryNames, categoryIDs := map[string]string{}, map[string]bool{}
	for _, cat := range categories {
		if id, exists := categoryNames[cat.Name]; exists && id != cat.ID {
			return nil, fmt.Errorf("同名カテゴリが複数あります。ローカルのカテゴリ名を一意にしてください")
		}
		categoryNames[cat.Name] = cat.ID
		categoryIDs[cat.ID] = true
	}
	payerNames, placeNames := map[string]bool{}, map[string]bool{}
	for _, p := range payers {
		payerNames[p.Name] = true
	}
	for _, p := range places {
		placeNames[p.Name] = true
	}
	localID := func(kind, name string) string {
		return uuid.NewSHA1(uuid.NameSpaceOID, []byte("local-backup:"+kind+":"+name)).String()
	}
	ids := map[string]bool{}
	for _, e := range source {
		if e.Category != "" {
			if id, ok := categoryNames[e.Category]; ok {
				e.Category = id
			} else if !categoryIDs[e.Category] {
				name := e.Category
				id := localID("category", name)
				plan.Categories = append(plan.Categories, model.Category{ID: id, Name: name, SortOrder: len(categories) + len(plan.Categories) + 1, Color: "#AEB6BF", IsActive: true, IsExpense: name != "収入"})
				categoryNames[name] = id
				categoryIDs[id] = true
				e.Category = id
			}
		}
		if e.Payer != "" && !payerNames[e.Payer] {
			plan.Payers = append(plan.Payers, model.Payer{ID: localID("payer", e.Payer), Name: e.Payer, SortOrder: len(payers) + len(plan.Payers) + 1, IsActive: true})
			payerNames[e.Payer] = true
		}
		if e.Place != "" && !placeNames[e.Place] {
			plan.Places = append(plan.Places, model.Place{ID: localID("place", e.Place), Name: e.Place, SortOrder: len(places) + len(plan.Places) + 1, IsActive: true})
			placeNames[e.Place] = true
		}
		if createdBy != "" {
			e.CreatedBy = createdBy
		}
		ids[e.ID] = true
		plan.Months[e.Date[:7]] = true
		plan.Expenses = append(plan.Expenses, e)
	}
	for _, e := range existing {
		if ids[e.ID] || replace {
			if len(e.Date) >= 7 {
				plan.Months[e.Date[:7]] = true
			}
		}
		if replace && !ids[e.ID] {
			plan.DeleteIDs = append(plan.DeleteIDs, e.ID)
		}
	}
	return plan, nil
}

// Apply はローカルへの書き込みと集計キャッシュの再計算を行う。
// 書き込み失敗時には終了し、再実行で同じ ID のデータを再同期できる。
func Apply(ctx context.Context, client *dynamo.Client, plan *Plan) error {
	for _, c := range plan.Categories {
		if err := client.PutCategory(ctx, &c); err != nil {
			return err
		}
	}
	for _, p := range plan.Payers {
		if err := client.PutPayer(ctx, &p); err != nil {
			return err
		}
	}
	for _, p := range plan.Places {
		if err := client.PutPlace(ctx, &p); err != nil {
			return err
		}
	}
	for _, e := range plan.Expenses {
		if err := client.PutExpense(ctx, &e); err != nil {
			return err
		}
	}
	for _, id := range plan.DeleteIDs {
		if err := client.DeleteExpense(ctx, id); err != nil {
			return err
		}
	}
	for month := range plan.Months {
		if err := service.RefreshMonthlySummaryCache(ctx, client, month); err != nil {
			return fmt.Errorf("%s の集計更新に失敗: %w", month, err)
		}
	}
	return nil
}
