package parser

import (
	"testing"
)

func TestParseRakutenCardEmail(t *testing.T) {
	sampleBody := `
<カードご利用情報>
【ショッピングご利用分】
■利用日: 2026/08/04
■利用先: セブンイレブン
■利用者: 家族
■支払方法: 1回
■利用金額: 993 円
■支払月: 2026/09

■利用日: 2026/08/06
■利用先: ローソン
■利用者: 本人
■支払方法: 1回
■利用金額: 1,620 円
■支払月: 2026/09

■利用日: 2026/08/06
■利用先: ファミリーマート
■利用者: 家族
■支払方法: 1回
■利用金額: 680 円
■支払月: 2026/09
`

	expenses := ParseRakutenCardEmail(sampleBody, "楽天カード", "食費")

	if len(expenses) != 3 {
		t.Fatalf("expected 3 expenses, got %d", len(expenses))
	}

	// 1件目
	if expenses[0].Date != "2026-08-04" {
		t.Errorf("expected date 2026-08-04, got %s", expenses[0].Date)
	}
	if expenses[0].Place != "セブンイレブン" {
		t.Errorf("expected place セブンイレブン, got %s", expenses[0].Place)
	}
	if expenses[0].Amount != 993 {
		t.Errorf("expected amount 993, got %d", expenses[0].Amount)
	}
	if expenses[0].Memo != "楽天カード (家族)" {
		t.Errorf("expected memo 楽天カード (家族), got %s", expenses[0].Memo)
	}

	// 2件目
	if expenses[1].Date != "2026-08-06" {
		t.Errorf("expected date 2026-08-06, got %s", expenses[1].Date)
	}
	if expenses[1].Amount != 1620 {
		t.Errorf("expected amount 1620, got %d", expenses[1].Amount)
	}

	// 3件目
	if expenses[2].Amount != 680 {
		t.Errorf("expected amount 680, got %d", expenses[2].Amount)
	}
}
