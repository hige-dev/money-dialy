package parser

import (
	"mime"
	"net/mail"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"

	"money-diary/internal/model"
)

const auPaySubject = "【au PAY】ご利用のお知らせ [メールコードP1001]"

func init() {
	RegisterParser(&AUPayParser{})
}

// AUPayParser はau PAYの支払通知メールのパーサー。
type AUPayParser struct{}

func (p *AUPayParser) Name() string {
	return "au PAY"
}

func (p *AUPayParser) CanParse(from, subject, body string) bool {
	address, err := mail.ParseAddress(strings.TrimSpace(from))
	if err != nil || !strings.EqualFold(address.Address, "info@wallet.auone.jp") {
		return false
	}
	if decoded, err := new(mime.WordDecoder).DecodeHeader(subject); err == nil {
		subject = decoded
	}
	return strings.Contains(subject, auPaySubject)
}

func (p *AUPayParser) Parse(subject, body string) ([]model.ExpenseInput, error) {
	return ParseAUPayEmail(body, "au PAY", "未分類"), nil
}

var (
	reAUPayDate   = regexp.MustCompile(`^([0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日)`)
	reAUPayAmount = regexp.MustCompile(`^([0-9]+(?:,[0-9]{3})*)[ \t]*円$`)
)

// ParseAUPayEmail は利用日時・利用店舗・支払金額から支出を抽出する。
func ParseAUPayEmail(body, defaultPayer, defaultCategory string) []model.ExpenseInput {
	fields := make(map[string]string)
	lines := strings.Split(norm.NFKC.String(body), "\n")
	for i := 0; i+1 < len(lines); i++ {
		heading := strings.TrimSpace(lines[i])
		switch heading {
		case "■利用店舗", "■種別", "■利用日時", "■支払金額":
			value := strings.TrimSpace(lines[i+1])
			if strings.HasPrefix(value, "■") {
				return nil
			}
			fields[heading] = value
		}
	}
	if fields["■種別"] != "支払" || fields["■利用店舗"] == "" {
		return nil
	}
	dateMatch := reAUPayDate.FindStringSubmatch(fields["■利用日時"])
	amountMatch := reAUPayAmount.FindStringSubmatch(fields["■支払金額"])
	if len(dateMatch) < 2 || len(amountMatch) < 2 {
		return nil
	}
	date, err := time.Parse("2006年1月2日", dateMatch[1])
	if err != nil {
		return nil
	}
	amount, err := strconv.Atoi(strings.ReplaceAll(amountMatch[1], ",", ""))
	if err != nil || amount <= 0 {
		return nil
	}
	if defaultPayer == "" {
		defaultPayer = "au PAY"
	}
	if defaultCategory == "" {
		defaultCategory = "未分類"
	}
	return []model.ExpenseInput{{
		Date:       date.Format("2006-01-02"),
		Payer:      defaultPayer,
		Category:   defaultCategory,
		Amount:     amount,
		Place:      normalizePlace(fields["■利用店舗"]),
		Memo:       "au PAY",
		Visibility: "public",
	}}
}
