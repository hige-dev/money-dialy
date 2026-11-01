package parser

import (
	"fmt"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"money-diary/internal/model"
)

// CardEmailParser はクレジットカード利用通知メールのパーサーの共通インターフェース
type CardEmailParser interface {
	// Name はカード識別名（例: "楽天カード"）を返す
	Name() string
	// CanParse は送信元、件名、本文を基にこのパーサーで処理できるか判定する
	CanParse(from, subject, body string) bool
	// Parse は件名とメール本文から支出データ一覧を抽出する
	Parse(subject, body string) ([]model.ExpenseInput, error)
}

var registry []CardEmailParser

// RegisterParser は新しいカードパーサーをレジストリに登録する
func RegisterParser(p CardEmailParser) {
	registry = append(registry, p)
}

// ParseEmail は登録されたパーサーから適したものを自動判定し、メール本文をパースする
func ParseEmail(from, subject, body string) ([]model.ExpenseInput, string, error) {
	for _, p := range registry {
		if p.CanParse(from, subject, body) {
			expenses, err := p.Parse(subject, body)
			if err != nil {
				return nil, p.Name(), err
			}
			return expenses, p.Name(), nil
		}
	}
	return nil, "", fmt.Errorf("対応するカードパーサーが見つかりませんでした (from: %s, subject: %s)", from, subject)
}

// normalizePlace は全角英数記号・半角カタカナ・長音を正規化し、前後の空白を除去する。
func normalizePlace(s string) string {
	return normalizeKatakanaLongVowels(strings.TrimSpace(norm.NFKC.String(s)))
}

// normalizeKatakanaLongVowels はカタカナ直後のハイフンを全角の長音に変換する。
func normalizeKatakanaLongVowels(s string) string {
	var previous rune
	return strings.Map(func(r rune) rune {
		if r == '-' && unicode.Is(unicode.Katakana, previous) {
			r = 'ー'
		}
		previous = r
		return r
	}, s)
}
