package parser

import (
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/text/width"
	"money-diary/internal/model"
)

func init() {
	RegisterParser(&SMBCCardParser{})
}

// SMBCCardParser は三井住友カードのご利用通知メールパーサー
type SMBCCardParser struct{}

func (p *SMBCCardParser) Name() string {
	return "三井住友カード"
}

func (p *SMBCCardParser) CanParse(from, subject, body string) bool {
	trimmedSubject := strings.TrimSpace(subject)
	return (strings.Contains(from, "vpass.ne.jp") || strings.Contains(from, "smbc-card.com") || strings.Contains(from, "smbc.co.jp")) &&
		strings.Contains(trimmedSubject, "ご利用のお知らせ【三井住友カード】")
}

func (p *SMBCCardParser) Parse(subject, body string) ([]model.ExpenseInput, error) {
	return ParseSMBCCardEmail(body, "三井住友カード", "未分類"), nil
}

var (
	reSmbcCard   = regexp.MustCompile(`(?:ご利用カード|ご利用のカード|カード名称)[：:]\s*([^\r\n]+)`)
	reSmbcDate   = regexp.MustCompile(`[◇◆■▼]?\s*利用日[：:]\s*([0-9]{4}/[0-9]{2}/[0-9]{2})`)
	reSmbcPlace  = regexp.MustCompile(`[◇◆■▼]?\s*利用先[：:]\s*([^\r\n]+)`)
	reSmbcAmount = regexp.MustCompile(`[◇◆■▼]?\s*利用金額[：:]\s*([0-9,]+)\s*円`)
)

// ParseSMBCCardEmail は三井住友カードの通知メール本文をパースして支出データ一覧を返す
func ParseSMBCCardEmail(body string, defaultPayer string, defaultCategory string) []model.ExpenseInput {
	dateMatch := reSmbcDate.FindStringSubmatch(body)
	placeMatch := reSmbcPlace.FindStringSubmatch(body)
	amountMatch := reSmbcAmount.FindStringSubmatch(body)

	if len(dateMatch) < 2 || len(placeMatch) < 2 || len(amountMatch) < 2 {
		return nil
	}

	dateStr := strings.ReplaceAll(dateMatch[1], "/", "-")
	rawPlace := strings.TrimSpace(placeMatch[1])
	placeStr := strings.TrimSpace(width.Fold.String(rawPlace))

	amountClean := strings.ReplaceAll(amountMatch[1], ",", "")
	amount, err := strconv.Atoi(amountClean)
	if err != nil || amount <= 0 {
		return nil
	}

	cardName := ""
	if cardMatch := reSmbcCard.FindStringSubmatch(body); len(cardMatch) >= 2 {
		cardName = strings.TrimSpace(width.Fold.String(cardMatch[1]))
	}

	payer := defaultPayer
	if payer == "" {
		payer = "三井住友カード"
	}

	category := defaultCategory
	if category == "" {
		category = "未分類"
	}

	memo := "三井住友カード"
	if cardName != "" {
		memo += " (" + cardName + ")"
	}

	return []model.ExpenseInput{
		{
			Date:       dateStr,
			Payer:      payer,
			Category:   category,
			Amount:     amount,
			Place:      placeStr,
			Memo:       memo,
			Visibility: "public",
		},
	}
}
