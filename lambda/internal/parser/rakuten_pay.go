package parser

import (
	"mime"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/text/unicode/norm"

	"money-diary/internal/model"
)

func init() {
	RegisterParser(&RakutenPayParser{})
}

// RakutenPayParser は楽天ペイアプリの決済完了メールパーサー
type RakutenPayParser struct{}

func (p *RakutenPayParser) Name() string {
	return "楽天ペイ"
}

func (p *RakutenPayParser) CanParse(from, subject, body string) bool {
	trimmedSubject := strings.TrimSpace(subject)
	// Decode possible MIME encoded-word subject (e.g., "=?utf-8?B?...?=")
	if decoded, err := new(mime.WordDecoder).DecodeHeader(trimmedSubject); err == nil {
		trimmedSubject = decoded
	}
	return (strings.Contains(from, "no-reply@pay.rakuten.co.jp") || strings.Contains(from, "pay.rakuten.co.jp")) &&
		(strings.Contains(trimmedSubject, "楽天ペイお支払い完了のお知らせ") || strings.Contains(trimmedSubject, "楽天ペイアプリ"))
}

func (p *RakutenPayParser) Parse(subject, body string) ([]model.ExpenseInput, error) {
	return ParseRakutenPayEmail(body, "楽天ペイ", "未分類"), nil
}

var (
	rePayDate   = regexp.MustCompile(`(?:▼)?ご利用日時\s*[\r\n]+([0-9]{4}/[0-9]{2}/[0-9]{2})`)
	rePayPlace  = regexp.MustCompile(`(?:▼)?ご利用店舗\s*[\r\n]+([^\r\n]+)`)
	rePayAmount = regexp.MustCompile(`(?:▼)?決済総額\s*[\r\n]+[￥¥]([0-9,]+)`)
)

func normalizeFullHalf(s string) string {
	var sb strings.Builder
	for _, r := range s {
		if r >= 0xFF01 && r <= 0xFF5E {
			r = r - 0xFEE0
		}
		sb.WriteRune(r)
	}
	// Use Unicode NFKC to convert half-width Katakana to full-width Katakana
	converted := norm.NFKC.String(sb.String())
	// Preserve full-width spaces: replace regular spaces with IDEOGRAPHIC SPACE (U+3000)
	return strings.ReplaceAll(converted, " ", "\u3000")
}

// ParseRakutenPayEmail は楽天ペイの決済メール本文をパースして支出データ一覧を返す
func ParseRakutenPayEmail(body string, defaultPayer string, defaultCategory string) []model.ExpenseInput {
	body = normalizeFullHalf(body)
	dateMatch := rePayDate.FindStringSubmatch(body)
	placeMatch := rePayPlace.FindStringSubmatch(body)
	amountMatch := rePayAmount.FindStringSubmatch(body)

	if len(dateMatch) < 2 || len(placeMatch) < 2 || len(amountMatch) < 2 {
		return nil
	}

	dateStr := strings.ReplaceAll(dateMatch[1], "/", "-")
	placeStr := strings.TrimSpace(placeMatch[1])

	amountClean := strings.ReplaceAll(amountMatch[1], ",", "")
	amount, err := strconv.Atoi(amountClean)
	if err != nil || amount <= 0 {
		return nil
	}

	payer := defaultPayer
	if payer == "" {
		payer = "楽天ペイ"
	}

	category := defaultCategory
	if category == "" {
		category = "未分類"
	}

	// Known places (dummy list). In production could be loaded from DB/config.
	knownPlaces := []string{"ダミー-コンビニ　テスト駅前", "テストストア　テスト駅前"}
	isOther := true
	for _, kp := range knownPlaces {
		if kp == placeStr {
			isOther = false
			break
		}
	}
	if isOther {
		placeStr = "その他"
	}

	return []model.ExpenseInput{{
		Date:         dateStr,
		Payer:        payer,
		Category:     category,
		Amount:       amount,
		Place:        placeStr,
		Memo:         "楽天ペイ",
		Visibility:   "public",
		IsOtherPlace: isOther,
	}}
}
