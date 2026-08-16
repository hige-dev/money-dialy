package parser

import (
	"regexp"
	"strconv"
	"strings"

	"money-diary/internal/model"
)

// RakutenCardItem は楽天カードメールから抽出した単一明細
type RakutenCardItem struct {
	Date   string `json:"date"`   // YYYY-MM-DD
	Place  string `json:"place"`  // 利用先
	User   string `json:"user"`   // 利用者（本人/家族など）
	Amount int    `json:"amount"` // 金額
}

var (
	reDate   = regexp.MustCompile(`■利用日:\s*(\d{4}/\d{2}/\d{2})`)
	rePlace  = regexp.MustCompile(`■利用先:\s*([^\r\n]+)`)
	reUser   = regexp.MustCompile(`■利用者:\s*([^\r\n]+)`)
	reAmount = regexp.MustCompile(`■利用金額:\s*([\d,]+)\s*円`)
)

// ParseRakutenCardEmail は楽天カードの利用通知メール本文をパースして支出データ一覧を返す
func ParseRakutenCardEmail(body string, defaultPayer string, defaultCategory string) []model.ExpenseInput {
	blocks := splitEmailBlocks(body)
	var result []model.ExpenseInput

	for _, block := range blocks {
		item, ok := parseSingleBlock(block)
		if !ok {
			continue
		}

		memo := "楽天カード"
		if item.User != "" {
			memo += " (" + item.User + ")"
		}

		payer := defaultPayer
		if payer == "" {
			payer = "楽天カード"
		}

		category := defaultCategory
		if category == "" {
			category = "未分類"
		}

		result = append(result, model.ExpenseInput{
			Date:       item.Date,
			Payer:      payer,
			Category:   category,
			Amount:     item.Amount,
			Place:      strings.TrimSpace(item.Place),
			Memo:       memo,
			Visibility: "public",
		})
	}

	return result
}

func splitEmailBlocks(body string) []string {
	lines := strings.Split(body, "\n")
	var blocks []string
	var currentBlock []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "■利用日:") {
			if len(currentBlock) > 0 {
				blocks = append(blocks, strings.Join(currentBlock, "\n"))
				currentBlock = nil
			}
		}
		if len(currentBlock) > 0 || strings.HasPrefix(trimmed, "■利用日:") {
			currentBlock = append(currentBlock, line)
		}
	}
	if len(currentBlock) > 0 {
		blocks = append(blocks, strings.Join(currentBlock, "\n"))
	}
	return blocks
}

func parseSingleBlock(block string) (RakutenCardItem, bool) {
	dateMatch := reDate.FindStringSubmatch(block)
	amountMatch := reAmount.FindStringSubmatch(block)
	if len(dateMatch) < 2 || len(amountMatch) < 2 {
		return RakutenCardItem{}, false
	}

	dateStr := strings.ReplaceAll(dateMatch[1], "/", "-") // 2026/08/04 -> 2026-08-04

	amountClean := strings.ReplaceAll(amountMatch[1], ",", "")
	amount, err := strconv.Atoi(amountClean)
	if err != nil || amount <= 0 {
		return RakutenCardItem{}, false
	}

	placeStr := ""
	if match := rePlace.FindStringSubmatch(block); len(match) >= 2 {
		placeStr = strings.TrimSpace(match[1])
	}

	userStr := ""
	if match := reUser.FindStringSubmatch(block); len(match) >= 2 {
		userStr = strings.TrimSpace(match[1])
	}

	return RakutenCardItem{
		Date:   dateStr,
		Place:  placeStr,
		User:   userStr,
		Amount: amount,
	}, true
}
