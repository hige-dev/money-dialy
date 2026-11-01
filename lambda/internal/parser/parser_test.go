package parser

import (
	"strings"
	"testing"
)

func TestNormalizePlace(t *testing.T) {
	for _, tt := range []struct {
		name string
		in   string
		want string
	}{
		{name: "末尾の長音", in: "サッカ-", want: "サッカー"},
		{name: "途中と末尾の長音", in: "ス-パ-", want: "スーパー"},
		{name: "店舗名の途中の長音", in: "イト-ヨ-カド-", want: "イトーヨーカドー"},
		{name: "半角カタカナとハイフン", in: "ｻｯｶ-", want: "サッカー"},
		{name: "半角の長音", in: "ｻｯｶｰ", want: "サッカー"},
		{name: "全角ハイフン", in: "サッカ－", want: "サッカー"},
		{name: "濁点と半濁点", in: "ﾊﾞ-ﾍﾞｷｭ- ﾊﾟ-ｸ", want: "バーベキュー パーク"},
		{name: "全角の長音", in: "サッカー", want: "サッカー"},
		{name: "英数字のハイフン", in: "ABC-123 1-2-3 03-0000-0000", want: "ABC-123 1-2-3 03-0000-0000"},
		{name: "全角英数字と空白", in: "　ＡＢＣ－１２３　サッカ-　", want: "ABC-123 サッカー"},
		{name: "長音の後の区切り", in: "ダミー-コンビニ", want: "ダミー-コンビニ"},
		{name: "空文字", in: "", want: ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizePlace(tt.in); got != tt.want {
				t.Errorf("店舗名の正規化が想定と異なります: 取得=%q, 期待=%q", got, tt.want)
			}
		})
	}
}

func TestParseEmail_NormalizesKatakanaLongVowels(t *testing.T) {
	for _, tt := range []struct {
		name    string
		from    string
		subject string
		body    string
	}{
		{
			name:    "楽天カード",
			from:    "info@mail.rakuten-card.co.jp",
			subject: "カード利用のお知らせ(本人ご利用分)",
			body:    "■利用日: 2026/10/16\n■利用先: %s\n■利用者: 本人\n■利用金額: 100 円\n",
		},
		{
			name:    "三井住友カード",
			from:    "info@vpass.ne.jp",
			subject: "ご利用のお知らせ【三井住友カード】",
			body:    "◇利用日：2026/10/16\n◇利用先：%s\n◇利用金額：100円\n",
		},
		{
			name:    "楽天ペイ",
			from:    "no-reply@pay.rakuten.co.jp",
			subject: "楽天ペイお支払い完了のお知らせ",
			body:    "ご利用日時\n2026/10/16\nご利用店舗\n%s\n決済総額\n¥100\n",
		},
		{
			name:    "au PAY",
			from:    "info@wallet.auone.jp",
			subject: auPaySubject,
			body:    strings.ReplaceAll(auPayBody, "J118078", "%s"),
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			for _, place := range []string{"サッカ- ABC-123", "ｻｯｶ- ＡＢＣ－１２３", "ｻｯｶｰ ABC-123"} {
				t.Run(place, func(t *testing.T) {
					body := strings.ReplaceAll(tt.body, "%s", place)
					expenses, cardName, err := ParseEmail(tt.from, tt.subject, body)
					if err != nil || cardName != tt.name || len(expenses) != 1 {
						t.Fatalf("メールの解析に失敗しました: パーサー=%s, 件数=%d, エラー=%v", cardName, len(expenses), err)
					}
					wantPlace := "サッカー ABC-123"
					if tt.name == "楽天ペイ" {
						wantPlace = "サッカー　ABC-123"
					}
					expense := expenses[0]
					if expense.Place != wantPlace || expense.Date != "2026-10-16" || expense.Amount != 100 {
						t.Errorf("利用明細が想定と異なります: 店舗=%q, 日付=%s, 金額=%d", expense.Place, expense.Date, expense.Amount)
					}
				})
			}
		})
	}
}

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
