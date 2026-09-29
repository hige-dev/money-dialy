package localrestore

import (
	"context"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
	"money-diary/internal/service"
)

var header = []string{"id", "date", "payer", "category", "amount", "memo", "place", "createdBy", "createdAt", "updatedAt", "visibility"}

func TestParseBackup(t *testing.T) {
	rows, err := ReadCSV(strings.NewReader("\ufeffid,date,payer,category,amount,memo,place,createdBy,createdAt,updatedAt,visibility\r\nx,2026-09-29,現金,食費,1234,\"改行\nとカンマ,を含む\",店舗,original@example.test,作成日時,更新日時,private\r\n"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := Parse(rows)
	if err != nil {
		t.Fatal(err)
	}
	want := []model.Expense{{ID: "x", Date: "2026-09-29", Payer: "現金", Category: "食費", Amount: 1234, Memo: "改行\nとカンマ,を含む", Place: "店舗", CreatedBy: "original@example.test", CreatedAt: "作成日時", UpdatedAt: "更新日時", Visibility: "private"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("復元結果が不正: %+v", got)
	}
	legacy := [][]string{header[:10], {"y", "2026-09-29", "現金", "食費", "10", "", "", "", "", ""}}
	if _, err := Parse(legacy); err != nil {
		t.Fatal(err)
	}
}

func TestRejectInvalidBackup(t *testing.T) {
	valid := []string{"x", "2026-09-29", "現金", "食費", "10", "", "", "", "", "", "public"}
	for _, tc := range []struct {
		name  string
		index int
		value string
	}{
		{"ID 不足", 0, ""}, {"日付形式", 1, "2026/09/29"}, {"存在しない日付", 1, "2026-02-30"}, {"金額不正", 4, "abc"}, {"負の金額", 4, "-1"}, {"公開範囲不正", 10, "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			row := append([]string(nil), valid...)
			row[tc.index] = tc.value
			if _, err := Parse([][]string{header, row}); err == nil {
				t.Fatal("不正な行が許可されました")
			}
		})
	}
	if _, err := Parse([][]string{header, valid, valid}); err == nil {
		t.Fatal("重複 ID が許可されました")
	}
	wrongHeader := append([]string(nil), header...)
	wrongHeader[3] = "amount"
	if _, err := Parse([][]string{wrongHeader, valid}); err == nil {
		t.Fatal("誤った列順が許可されました")
	}
}

func TestBuildPlan(t *testing.T) {
	source := []model.Expense{{ID: "same", Date: "2026-09-29", Category: "食費", Payer: "現金", Place: "店舗", CreatedBy: "original@example.test", Visibility: "private"}, {ID: "new", Date: "2026-09-29", Category: "趣味", Payer: "現金", Place: "店舗"}}
	existing := []model.Expense{{ID: "same", Date: "2026-08-01"}, {ID: "local-only", Date: "2026-07-01"}}
	categories := []model.Category{{ID: "food-id", Name: "食費"}}
	plan, err := BuildPlan(source, existing, categories, nil, nil, false, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.DeleteIDs) != 0 || len(plan.Categories) != 1 || len(plan.Payers) != 1 || len(plan.Places) != 1 {
		t.Fatalf("計画が不正: %+v", plan)
	}
	if plan.Expenses[0].Category != "food-id" || plan.Expenses[0].CreatedBy != "original@example.test" || plan.Expenses[0].Visibility != "private" {
		t.Fatalf("既存カテゴリや公開範囲が保持されません: %+v", plan.Expenses[0])
	}
	if !plan.Months["2026-08"] || !plan.Months["2026-09"] || plan.Months["2026-07"] {
		t.Fatal("集計更新月が不正です")
	}
	next, err := BuildPlan(source, existing, append(categories, plan.Categories...), plan.Payers, plan.Places, true, "local@example.test")
	if err != nil {
		t.Fatal(err)
	}
	if len(next.Categories) != 0 || len(next.Payers) != 0 || len(next.Places) != 0 || next.Expenses[1].Category != plan.Expenses[1].Category {
		t.Fatal("再同期時にマスタが重複します")
	}
	if !reflect.DeepEqual(next.DeleteIDs, []string{"local-only"}) || !next.Months["2026-07"] || next.Expenses[0].CreatedBy != "local@example.test" {
		t.Fatalf("置き換え計画が不正: %+v", next)
	}
	if _, err := BuildPlan(source, nil, append(categories, model.Category{ID: "another", Name: "食費"}), nil, nil, false, ""); err == nil {
		t.Fatal("同名カテゴリの曖昧な対応が許可されました")
	}
}

func TestRestoreIntegration(t *testing.T) {
	endpoint := os.Getenv("LOCAL_DYNAMO_TEST_ENDPOINT")
	if endpoint == "" {
		t.Skip("DynamoDB Local の接続先未指定のため統合テストを省略")
	}
	client, err := dynamo.NewLocalClient(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.InitializeLocal(t.Context()); err != nil {
		t.Fatal(err)
	}
	id := uuid.NewString()
	row := []string{id, "2098-12-20", "現金", "食費", "3210", "復元の検証", "", "original@example.test", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", "public"}
	expenses, err := Parse([][]string{header, row})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := service.DeleteExpense(context.Background(), client, id); err != nil {
			t.Error(err)
		}
	})
	categories, err := client.GetAllCategories(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	payers, err := client.GetAllPayers(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	places, err := client.GetAllPlaces(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	var previousTotal int
	before, err := service.GetMonthlySummary(t.Context(), client, "2098-12", "", "local@example.test")
	if err != nil {
		t.Fatal(err)
	}
	previousTotal = before.Total
	for i := 0; i < 2; i++ {
		existing, err := client.ScanAllExpenses(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		plan, err := BuildPlan(expenses, existing, categories, payers, places, false, "")
		if err != nil {
			t.Fatal(err)
		}
		if err := Apply(t.Context(), client, plan); err != nil {
			t.Fatal(err)
		}
	}
	got, err := client.GetExpense(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Amount != 3210 || got.Category != "local-food" || got.CreatedBy != "original@example.test" || got.UpdatedAt != row[9] {
		t.Fatalf("保存結果が不正: %+v", got)
	}
	after, err := service.GetMonthlySummary(t.Context(), client, "2098-12", "", "local@example.test")
	if err != nil {
		t.Fatal(err)
	}
	if after.Total != previousTotal+3210 {
		t.Fatalf("復元後の集計が不正: %d", after.Total)
	}
	saved, err := client.QueryExpensesByMonth(t.Context(), "2098-12")
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, e := range saved {
		if e.ID == id {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("再同期で支出が重複しました: %d", count)
	}
}
