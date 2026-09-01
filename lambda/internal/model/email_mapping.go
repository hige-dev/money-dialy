package model

// EmailMapping represents a mapping from email subject or keyword to payer/category.
// The primary key is a composite of type and identifier.
// Type can be "subject" or "keyword".
// Identifier is the exact subject string or the keyword.

type EmailMapping struct {
	ID         string  `json:"id"`         // e.g. "subject#カード利用のお知らせ(本人ご利用分)"
	Type       string  `json:"type"`       // "subject" or "keyword"
	Identifier string  `json:"identifier"` // the raw subject or keyword
	Payer      *string `json:"payer,omitempty"`
	Category   *string `json:"category,omitempty"`
	Place      *string `json:"place,omitempty"`
	Comment    string  `json:"comment,omitempty"`
	Exclude    bool    `json:"exclude,omitempty"`
}
