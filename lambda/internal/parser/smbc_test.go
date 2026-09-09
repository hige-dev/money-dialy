package parser

import (
	"testing"
)

func TestParseSMBCCardEmail(t *testing.T) {
	sampleBody := `
テスト 太郎　様

いつも三井住友カードをご利用頂きありがとうございます。
お客様のカードご利用内容をお知らせいたします。'

ご利用カード：Ａｍａｚｏｎマスター

◇利用日：2026/09/02 19:11
◇利用先：ＡＭＡＺＯＮ．ＣＯ．ＪＰ
◇利用取引：買物
◇利用金額：2,849円

ご利用内容について、万が一身に覚えのない場合は、以下URLにてお問い合わせ先のご案内をしております。
`

	expenses := ParseSMBCCardEmail(sampleBody, "三井住友カード", "未分類")
	if len(expenses) != 1 {
		t.Fatalf("expected 1 expense, got %d", len(expenses))
	}

	exp := expenses[0]
	if exp.Date != "2026-09-02" {
		t.Errorf("expected date 2026-09-02, got %s", exp.Date)
	}
	if exp.Place != "AMAZON.CO.JP" {
		t.Errorf("expected place 'AMAZON.CO.JP', got '%s'", exp.Place)
	}
	if exp.Amount != 2849 {
		t.Errorf("expected amount 2849, got %d", exp.Amount)
	}
	if exp.Payer != "三井住友カード" {
		t.Errorf("expected payer '三井住友カード', got '%s'", exp.Payer)
	}
	if exp.Category != "未分類" {
		t.Errorf("expected category '未分類', got '%s'", exp.Category)
	}
	if exp.Memo != "三井住友カード (Amazonマスター)" {
		t.Errorf("expected memo '三井住友カード (Amazonマスター)', got '%s'", exp.Memo)
	}
}

func TestParseSMBCCardEmail_SingleLineFormat(t *testing.T) {
	sampleBody := `
テスト 太郎 様

いつも三井住友カードをご利用いただきありがとうございます。
Ａｍａｚｏｎマスターについてカードの利用内容をお知らせします。

ご利用内容


ご利用日時：2026/09/09 12:52
ＡＭＡＺＯＮ．ＣＯ．ＪＰ（買物）        1,375円




本メールはカードご利用の承認照会に基づく通知であり、カードのご利用及びご請求を確定するものではございません。
`

	expenses := ParseSMBCCardEmail(sampleBody, "三井住友カード", "未分類")
	if len(expenses) != 1 {
		t.Fatalf("expected 1 expense, got %d", len(expenses))
	}

	exp := expenses[0]
	if exp.Date != "2026-09-09" {
		t.Errorf("expected date 2026-09-09, got %s", exp.Date)
	}
	if exp.Place != "AMAZON.CO.JP" {
		t.Errorf("expected place 'AMAZON.CO.JP', got '%s'", exp.Place)
	}
	if exp.Amount != 1375 {
		t.Errorf("expected amount 1375, got %d", exp.Amount)
	}
	if exp.Memo != "三井住友カード (Amazonマスター)" {
		t.Errorf("expected memo '三井住友カード (Amazonマスター)', got '%s'", exp.Memo)
	}
}

func TestSMBCCardParser_CanParse(t *testing.T) {
	p := &SMBCCardParser{}

	from := "三井住友カード <statement@vpass.ne.jp>"
	subject := "ご利用のお知らせ【三井住友カード】"

	if !p.CanParse(from, subject, "") {
		t.Errorf("expected CanParse to return true")
	}

	if p.CanParse("other@example.com", subject, "") {
		t.Errorf("expected CanParse to return false for wrong from when body has no smbc reference")
	}

	if !p.CanParse("test-user <test@example.com>", "FW: ご利用のお知らせ【三井住友カード】", "いつも三井住友カードをご利用頂きありがとうございます。") {
		t.Errorf("expected CanParse to return true for forwarded email with SMBC in body")
	}

	if p.CanParse(from, "全く別の件名", "") {
		t.Errorf("expected CanParse to return false for wrong subject")
	}
}
