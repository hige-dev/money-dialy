package parser

import (
	"testing"
)

func TestParseRakutenPayEmail(t *testing.T) {
	sampleBody := `
テスト 太郎様

いつも楽天ペイアプリをご利用いただき、誠にありがとうございます。
以下のお支払いが完了いたしましたので、お知らせいたします。

━━━━━━━━━━━━━━
ご利用明細
──────────────
▼ご利用店舗
ダミー-コンビニ　テスト駅前

▼電話番号
 

──────────────
▼ご利用日時
2026/08/24(月) 17:55

▼伝票番号
TEST-SLIP-12345678

──────────────
▼決済総額
￥183

▽楽天ポイント
9

▽楽天ペイ残高
￥174
`

	expenses := ParseRakutenPayEmail(sampleBody, "楽天ペイ", "未分類")
	if len(expenses) != 1 {
		t.Fatalf("expected 1 expense, got %d", len(expenses))
	}

	exp := expenses[0]
	if exp.Date != "2026-08-24" {
		t.Errorf("expected date 2026-08-24, got %s", exp.Date)
	}
	if exp.Place != "ダミー-コンビニ　テスト駅前" {
		t.Errorf("expected place 'ダミー-コンビニ　テスト駅前', got '%s'", exp.Place)
	}
	if exp.Amount != 183 {
		t.Errorf("expected amount 183, got %d", exp.Amount)
	}
	if exp.Payer != "楽天ペイ" {
		t.Errorf("expected payer '楽天ペイ', got '%s'", exp.Payer)
	}
	if exp.Category != "未分類" {
		t.Errorf("expected category '未分類', got '%s'", exp.Category)
	}
	if exp.Memo != "楽天ペイ" {
		t.Errorf("expected memo '楽天ペイ', got '%s'", exp.Memo)
	}
}

func TestParseRakutenPayEmail_WithoutTriangleMarker(t *testing.T) {
	sampleBody := `
[楽天ペイ]

楽天ペイお支払い完了のお知らせ

テスト 太郎 様
いつも楽天ペイアプリをご利用いただき、誠にありがとうございます。
以下のお支払いが完了いたしましたので、お知らせいたします。

ご利用明細
ご利用店舗
テストストア　テスト駅前
電話番号
03-0000-0000<tel:03-0000-0000>
ご利用日時
2026/09/11(金) 21:04
伝票番号
TEST-SLIP-87654321
決済総額
¥4,782
楽天ポイント
0
`
	expenses := ParseRakutenPayEmail(sampleBody, "楽天ペイ", "未分類")
	if len(expenses) != 1 {
		t.Fatalf("expected 1 expense, got %d", len(expenses))
	}

	exp := expenses[0]
	if exp.Date != "2026-09-11" {
		t.Errorf("expected date 2026-09-11, got %s", exp.Date)
	}
	if exp.Place != "テストストア　テスト駅前" {
		t.Errorf("expected place 'テストストア　テスト駅前', got '%s'", exp.Place)
	}
	if exp.Amount != 4782 {
		t.Errorf("expected amount 4782, got %d", exp.Amount)
	}
}

func TestRakutenPayParser_CanParse(t *testing.T) {
	p := &RakutenPayParser{}

	from := "楽天ペイ <no-reply@pay.rakuten.co.jp>"
	subject := "楽天ペイお支払い完了のお知らせ【楽天ペイアプリ】"

	if !p.CanParse(from, subject, "") {
		t.Errorf("expected CanParse to return true")
	}

	if p.CanParse("other@example.com", subject, "") {
		t.Errorf("expected CanParse to return false for wrong from")
	}

	if p.CanParse(from, "全く別の件名", "") {
		t.Errorf("expected CanParse to return false for wrong subject")
	}
}
