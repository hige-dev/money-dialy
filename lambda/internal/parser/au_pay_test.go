package parser

import (
	"mime"
	"strings"
	"testing"

	"money-diary/internal/model"
)

const auPayBody = "いつもau PAYをご利用いただきありがとうございます。\r\n" +
	"au PAYのご利用内容をお知らせいたします。\r\n\r\n" +
	"■利用店舗\r\n　J118078\r\n　問合先：03-0000-0000\r\n" +
	"■種別\r\n　支払\r\n" +
	"■利用日時\r\n　2026年10月16日(金) 13:34:01\r\n" +
	"■支払金額\r\n　100円\r\n" +
	"■決済後残高\r\n　4,601円\r\n" +
	"■伝票番号\r\n　TEST-SLIP-12345678\r\n"

func TestParseEmail_AUPay(t *testing.T) {
	expenses, name, err := ParseEmail("info@wallet.auone.jp", auPaySubject, auPayBody)
	if err != nil || name != "au PAY" || len(expenses) != 1 {
		t.Fatalf("au PAYの解析に失敗しました: パーサー=%s, 件数=%d, エラー=%v", name, len(expenses), err)
	}
	want := model.ExpenseInput{
		Date: "2026-10-16", Payer: "au PAY", Category: "未分類", Amount: 100,
		Place: "J118078", Memo: "au PAY", Visibility: "public",
	}
	if expenses[0] != want {
		t.Fatalf("支出が想定と異なります: 取得=%+v, 期待=%+v", expenses[0], want)
	}
}

func TestAUPayParser_CanParse(t *testing.T) {
	p := &AUPayParser{}
	for _, tt := range []struct {
		name    string
		from    string
		subject string
		want    bool
	}{
		{name: "通常", from: "info@wallet.auone.jp", subject: auPaySubject, want: true},
		{name: "表示名付き", from: "au PAY <info@wallet.auone.jp>", subject: auPaySubject, want: true},
		{name: "大文字の送信元", from: "INFO@WALLET.AUONE.JP", subject: auPaySubject, want: true},
		{name: "転送件名", from: "info@wallet.auone.jp", subject: "FW: " + auPaySubject, want: true},
		{name: "MIME件名", from: "info@wallet.auone.jp", subject: mime.BEncoding.Encode("UTF-8", auPaySubject), want: true},
		{name: "送信元不一致", from: "other@example.com", subject: auPaySubject},
		{name: "送信元ドメイン偽装", from: "au PAY <info@wallet.auone.jp.evil.example>", subject: auPaySubject},
		{name: "表示名での偽装", from: `"info@wallet.auone.jp" <other@example.com>`, subject: auPaySubject},
		{name: "不正な送信元", from: "info@wallet.auone.jp <", subject: auPaySubject},
		{name: "件名不一致", from: "info@wallet.auone.jp", subject: "【au PAY】チャージのお知らせ"},
		{name: "メールコード不一致", from: "info@wallet.auone.jp", subject: strings.ReplaceAll(auPaySubject, "P1001", "P1002")},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := p.CanParse(tt.from, tt.subject, auPayBody); got != tt.want {
				t.Errorf("解析対象の判定が想定と異なります: 取得=%t, 期待=%t", got, tt.want)
			}
		})
	}
}

func TestParseAUPayEmail_NormalizationAndDefaults(t *testing.T) {
	body := strings.NewReplacer(
		"\r\n", "\n",
		"J118078", "ﾃｽﾄ店　ＡＢＣ１２３",
		"2026年10月16日", "２０２６年１月６日",
		"100円", "１２，３４５円",
	).Replace(auPayBody)
	for _, tt := range []struct {
		name     string
		payer    string
		category string
		want     model.ExpenseInput
	}{
		{name: "既定値", want: model.ExpenseInput{
			Date: "2026-01-06", Payer: "au PAY", Category: "未分類", Amount: 12345,
			Place: "テスト店 ABC123", Memo: "au PAY", Visibility: "public",
		}},
		{name: "指定値", payer: "自分", category: "食費", want: model.ExpenseInput{
			Date: "2026-01-06", Payer: "自分", Category: "食費", Amount: 12345,
			Place: "テスト店 ABC123", Memo: "au PAY", Visibility: "public",
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			expenses := ParseAUPayEmail(body, tt.payer, tt.category)
			if len(expenses) != 1 || expenses[0] != tt.want {
				t.Fatalf("正規化または既定値が想定と異なります: 取得=%+v, 期待=%+v", expenses, tt.want)
			}
		})
	}
}

func TestParseAUPayEmail_InvalidDetails(t *testing.T) {
	for _, tt := range []struct {
		name string
		old  string
		new  string
	}{
		{name: "種別なし", old: "■種別\r\n　支払\r\n"},
		{name: "支払以外", old: "　支払\r\n", new: "　チャージ\r\n"},
		{name: "店舗見出しなし", old: "■利用店舗", new: "■店舗情報"},
		{name: "店舗空欄", old: "　J118078", new: "　"},
		{name: "次の見出しを店舗にしない", old: "　J118078\r\n　問合先：03-0000-0000\r\n"},
		{name: "日付なし", old: "　2026年10月16日(金) 13:34:01"},
		{name: "存在しない日付", old: "2026年10月16日", new: "2026年2月30日"},
		{name: "金額見出しなし", old: "■支払金額", new: "■金額情報"},
		{name: "金額空欄", old: "　100円", new: "　"},
		{name: "金額ゼロ", old: "100円", new: "0円"},
		{name: "負の金額", old: "100円", new: "-100円"},
		{name: "桁区切り不正", old: "100円", new: "1,00円"},
		{name: "金額の桁あふれ", old: "100円", new: "999999999999999999999999円"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			body := strings.ReplaceAll(auPayBody, tt.old, tt.new)
			if expenses := ParseAUPayEmail(body, "", ""); len(expenses) != 0 {
				t.Fatalf("不正な明細から支出が抽出されました: %+v", expenses)
			}
		})
	}
	if expenses := ParseAUPayEmail("", "", ""); len(expenses) != 0 {
		t.Fatalf("空の本文から支出が抽出されました: %+v", expenses)
	}
}
