package service

import (
	"testing"

	"money-diary/internal/model"
)

func TestImportKeyPerItemAndRetry(t *testing.T) {
	first := importKey("メール1", 0)
	if first != importKey("メール1", 0) {
		t.Fatal("再送時の明細識別子が変わりました")
	}
	if first == importKey("メール1", 1) || first == importKey("メール2", 0) {
		t.Fatal("異なるメールや明細に同じ識別子を割り当てました")
	}
}

func TestApplyRakutenDetailPreservesManualEdits(t *testing.T) {
	e := &model.Expense{
		ImportStatus: "pending", Category: "食費", Payer: "手動支払元", Memo: "手動メモ",
		ManualPayer: true, ManualMemo: true,
	}
	input := model.ExpenseInput{Category: "日用品", Payer: "自動支払元", Memo: "自動メモ", Place: "店舗"}
	applyRakutenDetail(e, input, "詳細メール", 2, map[string]string{})
	if e.ImportStatus != "complete" || e.DetailMessageID != "詳細メール" || e.DetailIndex != 2 || e.Place != "店舗" {
		t.Fatalf("詳細版の補完結果が不正です: %+v", e)
	}
	if e.Category != "日用品" || e.Payer != "手動支払元" || e.Memo != "手動メモ" {
		t.Fatalf("手動編集の保護または自動分類が不正です: %+v", e)
	}
}

func TestApplyRakutenDetailPreservesManualCategoryAndPlace(t *testing.T) {
	e := &model.Expense{Category: "手動カテゴリ", Place: "手動利用先", ManualCategory: true, Visibility: "public"}
	applyRakutenDetail(e, model.ExpenseInput{Category: "自動カテゴリ", Place: "詳細利用先"}, "詳細", 0,
		map[string]string{"手動カテゴリ": "user@example.com"})
	if e.Category != "手動カテゴリ" || e.Place != "手動利用先" || e.Visibility != VisibilityPrivate {
		t.Fatalf("手動カテゴリまたは利用先の維持が不正です: %+v", e)
	}
}

func TestRecordManualImportEdits(t *testing.T) {
	e := &model.Expense{ImportStatus: "pending", Category: "元カテゴリ", Payer: "元支払元", Memo: "元メモ"}
	recordManualImportEdits(e, &model.ExpenseInput{Category: "変更カテゴリ", Payer: "元支払元", Memo: "元メモ"})
	if !e.ManualCategory || e.ManualPayer || e.ManualMemo {
		t.Fatalf("変更していない項目まで手動変更として記録されました: %+v", e)
	}
	recordManualImportEdits(e, &model.ExpenseInput{Category: "元カテゴリ", Payer: "変更支払元", Memo: "変更メモ"})
	if !e.ManualCategory || !e.ManualPayer || !e.ManualMemo {
		t.Fatalf("手動変更の履歴を保持できませんでした: %+v", e)
	}
}

func TestPendingImportMatchingAndOrder(t *testing.T) {
	input := model.ExpenseInput{Date: "2026-09-25", ImportUser: "本人", Amount: 11000}
	base := model.Expense{ImportStatus: "pending", ImportCard: "楽天カード", ImportDate: input.Date,
		ImportUser: input.ImportUser, ImportAmount: input.Amount, CreatedAt: "2026-09-25T00:00:00Z"}
	first := base
	first.ImportMessageID = "速報メール"
	first.ImportIndex = 2
	second := base
	second.ImportMessageID = "速報メール"
	second.ImportIndex = 3
	candidates := []model.Expense{second, first}
	sortPendingCandidates(candidates)
	if candidates[0].ImportIndex != 2 || candidates[1].ImportIndex != 3 {
		t.Fatalf("同日同額の明細順序が不正です: %+v", candidates)
	}
	if !matchesPendingImport(candidates[0], input, "楽天カード") || !matchesPendingImport(candidates[1], input, "楽天カード") {
		t.Fatal("同日同額の2明細を照合候補として認識できません")
	}
	first.ImportStatus = "complete"
	if matchesPendingImport(first, input, "楽天カード") || !matchesPendingImport(second, input, "楽天カード") {
		t.Fatal("補完済み明細を再度照合する可能性があります")
	}
	wrongAmount := input
	wrongAmount.Amount = 10900
	if matchesPendingImport(second, wrongAmount, "楽天カード") {
		t.Fatal("金額が異なる明細を照合しました")
	}
}

func TestDetailedFirstMatching(t *testing.T) {
	input := model.ExpenseInput{Date: "2026-09-25", ImportUser: "本人", Amount: 11000}
	first := model.Expense{ImportStatus: "complete", ImportCard: "楽天カード", ImportDate: input.Date,
		ImportUser: input.ImportUser, ImportAmount: input.Amount, ImportMessageID: "詳細メール", ImportIndex: 2}
	second := first
	second.ImportIndex = 3
	candidates := []model.Expense{second, first}
	sortPendingCandidates(candidates)
	if candidates[0].ImportIndex != 2 || candidates[1].ImportIndex != 3 {
		t.Fatalf("同日同額の詳細明細の順序が不正です: %+v", candidates)
	}
	if !matchesUnpairedDetail(candidates[0], input, "楽天カード") || !matchesUnpairedDetail(candidates[1], input, "楽天カード") {
		t.Fatal("詳細先着の照合候補を認識できません")
	}
	first.PreliminaryMessageID = "速報メール"
	if matchesUnpairedDetail(first, input, "楽天カード") || !matchesUnpairedDetail(second, input, "楽天カード") {
		t.Fatal("照合済み詳細明細が再度使われます")
	}
	wrong := input
	wrong.Amount = 10900
	if matchesUnpairedDetail(second, wrong, "楽天カード") {
		t.Fatal("金額の違う明細を照合しました")
	}
	if importGroupKey("楽天カード", input) != importGroupKey("楽天カード", input) ||
		importGroupKey("楽天カード", input) == importGroupKey("楽天カード", wrong) {
		t.Fatal("照合グループの識別子が不正です")
	}
}
