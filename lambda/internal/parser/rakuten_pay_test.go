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

func TestRakutenPayParser_PreservesStoreName(t *testing.T) {
	body := "ご利用店舗\r\n魚米　minanoba相模原店\r\nご利用日時\r\n2026/10/04(日) 18:55\r\n決済総額\r\n¥4,180\r\n"
	expenses, name, err := ParseEmail("楽天ペイ <no-reply@pay.rakuten.co.jp>", "楽天ペイお支払い完了のお知らせ【楽天ペイアプリ】", body)
	if err != nil || name != "楽天ペイ" || len(expenses) != 1 {
		t.Fatalf("楽天ペイの解析に失敗しました: パーサー=%s, 件数=%d, エラー=%v", name, len(expenses), err)
	}
	exp := expenses[0]
	if exp.Place != "魚米　minanoba相模原店" {
		t.Errorf("店舗名が保持されていません: %q", exp.Place)
	}
	if exp.Date != "2026-10-04" || exp.Amount != 4180 {
		t.Errorf("日付・金額が想定と異なります: 日付=%s, 金額=%d", exp.Date, exp.Amount)
	}
	if exp.Payer != "楽天ペイ" || exp.Category != "未分類" {
		t.Errorf("支払元・カテゴリが想定と異なります: 支払元=%s, カテゴリ=%s", exp.Payer, exp.Category)
	}
}
