package parser

import (
	"fmt"
	"strconv"
	"strings"
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

func TestRakutenCardPreliminarySevenItems(t *testing.T) {
	p := &RakutenCardParser{}
	if !p.CanParse("楽天カード <info@mail.rakuten-card.co.jp>", "【速報版】カード利用のお知らせ(本人ご利用分)", "") {
		t.Fatal("速報版の送信元と件名を認識できません")
	}
	if p.CanParse("偽装 <info@mail.rakuten-card.co.jp.evil.example>", "【速報版】カード利用のお知らせ(本人ご利用分)", "") {
		t.Fatal("不正な送信元を認識しました")
	}
	amounts := []int{900, 10000, 11000, 11000, 10900, 740, 969}
	var body strings.Builder
	for _, amount := range amounts {
		fmt.Fprintf(&body, "■利用日: 2026/09/25\n■利用者: 本人\n■利用金額: %s 円\n\n", commaAmount(amount))
	}
	items := ParseRakutenCardEmail(body.String(), "楽天カード", "未分類")
	if len(items) != 7 {
		t.Fatalf("7件の速報明細を期待しましたが%d件でした", len(items))
	}
	for i, item := range items {
		if item.Date != "2026-09-25" || item.Amount != amounts[i] || item.ImportUser != "本人" || item.Place != "" {
			t.Errorf("%d件目の抽出結果が不正です: %+v", i+1, item)
		}
	}
}

func commaAmount(amount int) string {
	if amount < 1000 {
		return strconv.Itoa(amount)
	}
	return fmt.Sprintf("%d,%03d", amount/1000, amount%1000)
}
