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

■利用日: 2026/08/07
■利用先: ｷｸﾞﾅｽｾｷﾕ　ＡＭＡＺＯＮ店
■利用者: 本人
■支払方法: 1回
■利用金額: 3,500 円
■支払月: 2026/09
`

	expenses := ParseRakutenCardEmail(sampleBody, "家族カード", "食費")

	if len(expenses) != 4 {
		t.Fatalf("expected 4 expenses, got %d", len(expenses))
	}

	// 1件目
	if expenses[0].Date != "2026-08-04" {
		t.Errorf("expected date 2026-08-04, got %s", expenses[0].Date)
	}
	if expenses[0].Payer != "家族カード" {
		t.Errorf("expected payer 家族カード, got %s", expenses[0].Payer)
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

	// 4件目 (半角カタカナ・全角英字の正規化検証)
	if expenses[3].Place != "キグナスセキユ AMAZON店" {
		t.Errorf("expected place 'キグナスセキユ AMAZON店', got '%s'", expenses[3].Place)
	}
	if expenses[3].Amount != 3500 {
		t.Errorf("expected amount 3500, got %d", expenses[3].Amount)
	}
}
