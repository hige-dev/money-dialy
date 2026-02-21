package service

import (
	"testing"

	"money-diary/internal/model"
)

func TestEffectiveVisibility(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"", "public"},
		{"public", "public"},
		{"summary", "summary"},
		{"private", "private"},
	}
	for _, tt := range tests {
		got := EffectiveVisibility(tt.input)
		if got != tt.want {
			t.Errorf("EffectiveVisibility(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestValidateVisibility(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"", true},
		{"public", true},
		{"summary", true},
		{"private", true},
		{"invalid", false},
		{"PUBLIC", false},
	}
	for _, tt := range tests {
		got := ValidateVisibility(tt.input)
		if got != tt.want {
			t.Errorf("ValidateVisibility(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestFilterExpensesForUser(t *testing.T) {
	me := "me@example.com"
	other := "other@example.com"

	expenses := []model.Expense{
		{ID: "1", Category: "食費", Amount: 1000, Memo: "ランチ", Place: "コンビニ", Visibility: "public", CreatedBy: other},
		{ID: "2", Category: "趣味", Amount: 2000, Memo: "本", Place: "本屋", Visibility: "summary", CreatedBy: other},
		{ID: "3", Category: "収入", Amount: 300000, Memo: "給与", Place: "会社", Visibility: "private", CreatedBy: other},
		{ID: "4", Category: "趣味", Amount: 5000, Memo: "ゲーム", Place: "Steam", Visibility: "private", CreatedBy: me},
		{ID: "5", Category: "食費", Amount: 500, Memo: "お菓子", Place: "スーパー", Visibility: "", CreatedBy: other},
	}

	result := FilterExpensesForUser(expenses, me)

	if len(result) != 4 {
		t.Fatalf("expected 4 expenses, got %d", len(result))
	}

	// 他人の public → そのまま
	if result[0].ID != "1" || result[0].Category != "食費" || result[0].Memo != "ランチ" {
		t.Errorf("public expense should be unchanged: %+v", result[0])
	}

	// 他人の summary → カテゴリ=""（空文字）、場所・メモ空
	if result[1].ID != "2" || result[1].Category != "" || result[1].Amount != 2000 {
		t.Errorf("summary expense should be masked: %+v", result[1])
	}
	if result[1].Memo != "" || result[1].Place != "" {
		t.Errorf("summary expense memo/place should be empty: %+v", result[1])
	}
	if result[1].Payer != "" {
		// Payer は元が空なので空のまま
	}

	// 他人の private → 除外されて、自分の private が含まれる
	if result[2].ID != "4" || result[2].Category != "趣味" || result[2].Memo != "ゲーム" {
		t.Errorf("own private expense should be unchanged: %+v", result[2])
	}

	// 他人の visibility 未設定 → public 扱い
	if result[3].ID != "5" || result[3].Category != "食費" || result[3].Memo != "お菓子" {
		t.Errorf("empty visibility should be treated as public: %+v", result[3])
	}
}

func TestFilterExpensesForSummary(t *testing.T) {
	me := "me@example.com"
	other := "other@example.com"

	expenses := []model.Expense{
		{ID: "1", Category: "食費", Amount: 1000, Visibility: "public", CreatedBy: other},
		{ID: "2", Category: "趣味", Amount: 2000, Visibility: "summary", CreatedBy: other},
		{ID: "3", Category: "収入", Amount: 300000, Visibility: "private", CreatedBy: other},
		{ID: "4", Category: "趣味", Amount: 5000, Visibility: "private", CreatedBy: me},
		{ID: "5", Category: "食費", Amount: 500, Visibility: "", CreatedBy: other},
	}

	result := FilterExpensesForSummary(expenses, me)

	if len(result) != 4 {
		t.Fatalf("expected 4 expenses, got %d", len(result))
	}

	// 他人の private が除外される
	ids := make([]string, len(result))
	for i, e := range result {
		ids[i] = e.ID
	}
	for _, id := range ids {
		if id == "3" {
			t.Errorf("other's private expense should be excluded")
		}
	}

	// 自分の private は含まれる
	found := false
	for _, e := range result {
		if e.ID == "4" {
			found = true
			// カテゴリはマスクされない
			if e.Category != "趣味" {
				t.Errorf("own private expense category should not be masked: %+v", e)
			}
		}
	}
	if !found {
		t.Errorf("own private expense should be included")
	}

	// 他人の summary はカテゴリそのままで含まれる
	for _, e := range result {
		if e.ID == "2" && e.Category != "趣味" {
			t.Errorf("summary expense category should not be masked in summary filter: %+v", e)
		}
	}
}
