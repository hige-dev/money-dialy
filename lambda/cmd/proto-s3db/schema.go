package main

import (
	"database/sql"
	"fmt"
	"strings"

	"money-diary/internal/model"
)

// schemaSQL は家計簿向けの SQLite スキーマ（試作）。
//
//   - expenses.year_month は date から作る生成列（DynamoDB の yearMonth 属性と GSI の代わり）。
//   - 月別一覧・月別集計は (year_month, date) / (year_month, category_id) の索引で引く。
//   - 楽天カード照合（webhook の FindPendingImportedExpenses 等）は
//     import_card, import_user, import_amount, import_date の部分索引で引く（取込データだけが載る）。
//   - 任意項目は空文字ではなく NULL にする（部分索引を小さくするため）。
//   - visibility は "" を "public" に正規化して保存する（service.EffectiveVisibility と同じ意味）。
//   - category_id は外部キーにしない（削除済みカテゴリを参照する過去データがあり得るため）。
const schemaSQL = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE categories (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  color                  TEXT NOT NULL DEFAULT '',
  is_active              INTEGER NOT NULL DEFAULT 1,
  is_expense             INTEGER NOT NULL DEFAULT 1,
  exclude_from_breakdown INTEGER NOT NULL DEFAULT 0,
  exclude_from_summary   INTEGER NOT NULL DEFAULT 0,
  owner_email            TEXT          -- NULL = 共有カテゴリ
) STRICT;

CREATE TABLE payers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  track_balance INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE places (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE expenses (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL CHECK (length(date) >= 7),   -- YYYY-MM-DD
  year_month  TEXT GENERATED ALWAYS AS (substr(date, 1, 7)) STORED,
  payer       TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL DEFAULT '',
  amount      INTEGER NOT NULL,
  memo        TEXT NOT NULL DEFAULT '',
  place       TEXT NOT NULL DEFAULT '',
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'summary', 'private')),
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT '',
  -- メール取込（楽天カード等）
  import_status          TEXT,
  import_card            TEXT,
  import_date            TEXT,
  import_user            TEXT,
  import_amount          INTEGER,
  import_message_id      TEXT,
  import_index           INTEGER,
  detail_message_id      TEXT,
  detail_index           INTEGER,
  preliminary_message_id TEXT,
  preliminary_index      INTEGER,
  manual_category        INTEGER NOT NULL DEFAULT 0,
  manual_payer           INTEGER NOT NULL DEFAULT 0,
  manual_memo            INTEGER NOT NULL DEFAULT 0
) STRICT;

-- 月別一覧（新しい日付順）
CREATE INDEX idx_expenses_month_date ON expenses (year_month, date);
-- 月別・カテゴリ別集計
CREATE INDEX idx_expenses_month_category ON expenses (year_month, category_id, amount);
-- 楽天カード照合（カード・利用者・金額が一致し、日付が候補のどれか）
CREATE INDEX idx_expenses_card_match ON expenses (import_card, import_user, import_amount, import_date)
  WHERE import_card IS NOT NULL;
`

func createSchema(tx *sql.Tx) error {
	if _, err := tx.Exec(schemaSQL); err != nil {
		return fmt.Errorf("スキーマ作成に失敗: %w", err)
	}
	_, err := tx.Exec(`INSERT INTO meta (key, value) VALUES ('schema_version', '1')`)
	return err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullInt(n int) any {
	if n == 0 {
		return nil
	}
	return n
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func visibility(v string) string {
	if v == "" {
		return "public"
	}
	return v
}

const insertExpenseSQL = `INSERT INTO expenses (
  id, date, payer, category_id, amount, memo, place, visibility, created_by, created_at, updated_at,
  import_status, import_card, import_date, import_user, import_amount, import_message_id, import_index,
  detail_message_id, detail_index, preliminary_message_id, preliminary_index,
  manual_category, manual_payer, manual_memo
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

func expenseArgs(e *model.Expense) []any {
	return []any{
		e.ID, e.Date, e.Payer, e.Category, e.Amount, e.Memo, e.Place, visibility(e.Visibility),
		e.CreatedBy, e.CreatedAt, e.UpdatedAt,
		nullStr(e.ImportStatus), nullStr(e.ImportCard), nullStr(e.ImportDate), nullStr(e.ImportUser),
		nullInt(e.ImportAmount), nullStr(e.ImportMessageID), nullInt(e.ImportIndex),
		nullStr(e.DetailMessageID), nullInt(e.DetailIndex),
		nullStr(e.PreliminaryMessageID), nullInt(e.PreliminaryIndex),
		boolInt(e.ManualCategory), boolInt(e.ManualPayer), boolInt(e.ManualMemo),
	}
}

// insertAll は支出とマスタを入れる。中身はログに出さない（件数だけ返す）。
func insertAll(tx *sql.Tx, expenses []model.Expense, cats []model.Category, payers []model.Payer, places []model.Place) (inserted, skipped int, err error) {
	for _, c := range cats {
		if _, err := tx.Exec(`INSERT INTO categories (id, name, sort_order, color, is_active, is_expense, exclude_from_breakdown, exclude_from_summary, owner_email)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			c.ID, c.Name, c.SortOrder, c.Color, boolInt(c.IsActive), boolInt(c.IsExpense),
			boolInt(c.ExcludeFromBreakdown), boolInt(c.ExcludeFromSummary), nullStr(c.OwnerEmail)); err != nil {
			return 0, 0, fmt.Errorf("categories の投入に失敗: %w", err)
		}
	}
	for _, p := range payers {
		if _, err := tx.Exec(`INSERT INTO payers (id, name, sort_order, is_active, track_balance) VALUES (?, ?, ?, ?, ?)`,
			p.ID, p.Name, p.SortOrder, boolInt(p.IsActive), boolInt(p.TrackBalance)); err != nil {
			return 0, 0, fmt.Errorf("payers の投入に失敗: %w", err)
		}
	}
	for _, p := range places {
		if _, err := tx.Exec(`INSERT INTO places (id, name, sort_order, is_active) VALUES (?, ?, ?, ?)`,
			p.ID, p.Name, p.SortOrder, boolInt(p.IsActive)); err != nil {
			return 0, 0, fmt.Errorf("places の投入に失敗: %w", err)
		}
	}
	stmt, err := tx.Prepare(insertExpenseSQL)
	if err != nil {
		return 0, 0, err
	}
	defer stmt.Close()
	for i := range expenses {
		e := &expenses[i]
		// 支出でないアイテム（日付なし）は入れない
		if e.ID == "" || len(e.Date) < 7 || strings.TrimSpace(e.Date) == "" {
			skipped++
			continue
		}
		if _, err := stmt.Exec(expenseArgs(e)...); err != nil {
			// 値は出さない（個人情報）。何件目かだけ
			return 0, 0, fmt.Errorf("expenses の %d 件目の投入に失敗: %w", i+1, err)
		}
		inserted++
	}
	return inserted, skipped, nil
}

// monthlyCategorySQL は 13 か月分の月別・カテゴリ別集計を 1 本で出す。
// service.computeMonthData と同じく、他人の private を除外し、支出カテゴリかつ集計除外でないものに絞る。
const monthlyCategorySQL = `
SELECT e.year_month, e.category_id, SUM(e.amount) AS amount
FROM expenses e
JOIN categories c ON c.id = e.category_id
WHERE e.year_month BETWEEN ? AND ?
  AND c.is_expense = 1
  AND c.exclude_from_summary = 0
  AND (e.visibility <> 'private' OR e.created_by = ?)
GROUP BY e.year_month, e.category_id
ORDER BY e.year_month, MIN(c.sort_order)`
