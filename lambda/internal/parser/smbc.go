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
	if !strings.Contains(trimmedSubject, "ご利用のお知らせ【三井住友カード】") {
		return false
	}
	isFromSMBC := strings.Contains(from, "vpass.ne.jp") || strings.Contains(from, "smbc-card.com") || strings.Contains(from, "smbc.co.jp")
	isBodySMBC := strings.Contains(body, "三井住友カード")
	return isFromSMBC || isBodySMBC
}

func (p *SMBCCardParser) Parse(subject, body string) ([]model.ExpenseInput, error) {
	return ParseSMBCCardEmail(body, "三井住友カード", "未分類"), nil
}

var (
	reSmbcCard        = regexp.MustCompile(`(?:ご利用カード|ご利用のカード|カード名称)[：:]\s*([^\r\n]+)`)
	reSmbcCardAbout   = regexp.MustCompile(`([^\r\n]+?)についてカードの利用内容をお知らせします`)
	reSmbcDate        = regexp.MustCompile(`[◇◆■▼]?\s*(?:ご利用日時|利用日)[：:]\s*([0-9]{4}/[0-9]{2}/[0-9]{2})`)
	reSmbcPlace       = regexp.MustCompile(`[◇◆■▼]?\s*利用先[：:]\s*([^\r\n]+)`)
	reSmbcAmount      = regexp.MustCompile(`[◇◆■▼]?\s*利用金額[：:]\s*([0-9,]+)\s*円`)
	reSmbcSingleLine  = regexp.MustCompile(`([^\r\n]+?)\s+([0-9,]+)\s*円`)
	reSmbcTransaction = regexp.MustCompile(`[（\(](?:買物|ショッピング|キャッシング)[）\)]`)
)

// ParseSMBCCardEmail は三井住友カードの通知メール本文をパースして支出データ一覧を返す
func ParseSMBCCardEmail(body string, defaultPayer string, defaultCategory string) []model.ExpenseInput {
	dateMatch := reSmbcDate.FindStringSubmatch(body)
	if len(dateMatch) < 2 {
		return nil
	}
	dateStr := strings.ReplaceAll(dateMatch[1], "/", "-")

	var rawPlace string
	var rawAmount string

	placeMatch := reSmbcPlace.FindStringSubmatch(body)
	amountMatch := reSmbcAmount.FindStringSubmatch(body)

	if len(placeMatch) >= 2 && len(amountMatch) >= 2 {
		rawPlace = placeMatch[1]
		rawAmount = amountMatch[1]
	} else {
		// 日時行の直後にある「利用先 金額円」の行を探す
		lines := strings.Split(body, "\n")
		foundDate := false
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			if !foundDate {
				if reSmbcDate.MatchString(line) {
					foundDate = true
				}
				continue
			}
			// 日時行の次の非空行をチェック
			if match := reSmbcSingleLine.FindStringSubmatch(line); len(match) >= 3 {
				rawPlace = match[1]
				rawAmount = match[2]
				break
			}
		}
	}

	if rawPlace == "" || rawAmount == "" {
		return nil
	}

	// （買物）等の取引種別を除去
	rawPlace = reSmbcTransaction.ReplaceAllString(rawPlace, "")
	placeStr := strings.TrimSpace(width.Fold.String(rawPlace))

	amountClean := strings.ReplaceAll(rawAmount, ",", "")
	amount, err := strconv.Atoi(amountClean)
	if err != nil || amount <= 0 {
		return nil
	}

	cardName := ""
	if cardMatch := reSmbcCard.FindStringSubmatch(body); len(cardMatch) >= 2 {
		cardName = strings.TrimSpace(width.Fold.String(cardMatch[1]))
	} else if cardMatch := reSmbcCardAbout.FindStringSubmatch(body); len(cardMatch) >= 2 {
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
