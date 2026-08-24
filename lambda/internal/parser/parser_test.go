package parser

import (
	"testing"
)

func TestParseEmail_RakutenCard_FamilyMember(t *testing.T) {
	from := "info@mail.rakuten-card.co.jp"
	subject := "カード利用のお知らせ(家族会員ご利用分)"
	body := `
<カードご利用情報>
【ショッピングご利用分】
■利用日: 2026/08/04
■利用先: セブンイレブン
■利用者: 家族
■支払方法: 1回
■利用金額: 993 円
■支払月: 2026/09
`

	expenses, cardName, err := ParseEmail(from, subject, body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cardName != "楽天カード" {
		t.Errorf("expected cardName 楽天カード, got %s", cardName)
	}
	if len(expenses) != 1 {
		t.Fatalf("expected 1 expense, got %d", len(expenses))
	}
	if expenses[0].Payer != "楽天カード" {
		t.Errorf("expected payer 楽天カード, got %s", expenses[0].Payer)
	}
}

func TestParseEmail_RakutenCard_Principal(t *testing.T) {
	from := "info@mail.rakuten-card.co.jp"
	subject := "カード利用のお知らせ(本人ご利用分)"
	body := `
<カードご利用情報>
【ショッピングご利用分】
■利用日: 2026/08/04
■利用先: セブンイレブン
■利用者: 本人
■支払方法: 1回
■利用金額: 993 円
■支払月: 2026/09
`

	expenses, cardName, err := ParseEmail(from, subject, body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cardName != "楽天カード" {
		t.Errorf("expected cardName 楽天カード, got %s", cardName)
	}
	if len(expenses) != 1 {
		t.Fatalf("expected 1 expense, got %d", len(expenses))
	}
	if expenses[0].Payer != "楽天カード" {
		t.Errorf("expected payer 楽天カード, got %s", expenses[0].Payer)
	}
}

func TestParseEmail_UnknownCard(t *testing.T) {
	from := "unknown@example.com"
	subject := "テストメール"
	body := "カード利用はありません"

	_, _, err := ParseEmail(from, subject, body)
	if err == nil {
		t.Fatal("expected error for unknown card, got nil")
	}
}
