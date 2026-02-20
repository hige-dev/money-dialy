package sheets

import (
	"context"
	"fmt"
	"os"
	"strings"

	"google.golang.org/api/sheets/v4"

	"money-diary/internal/auth"
)

// Client は Google Sheets API のラッパー
type Client struct {
	service       *sheets.Service
	spreadsheetID string
}

// NewClient は Sheets API クライアントを生成する
func NewClient(ctx context.Context) (*Client, error) {
	svc, err := auth.GetSheetsService(ctx)
	if err != nil {
		return nil, err
	}

	id := os.Getenv("SPREADSHEET_ID")
	if id == "" {
		return nil, fmt.Errorf("SPREADSHEET_ID が設定されていません")
	}

	return &Client{service: svc, spreadsheetID: id}, nil
}

// GetSheetData はシートの全データを取得する（ヘッダー含む）
func (c *Client) GetSheetData(ctx context.Context, sheetName string) ([][]interface{}, error) {
	resp, err := c.service.Spreadsheets.Values.Get(c.spreadsheetID, sheetName).Context(ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("シート %q の読み込みに失敗: %w", sheetName, err)
	}
	return resp.Values, nil
}

// AppendRow はシートに1行追加する
func (c *Client) AppendRow(ctx context.Context, sheetName string, values []interface{}) error {
	vr := &sheets.ValueRange{
		Values: [][]interface{}{values},
	}
	_, err := c.service.Spreadsheets.Values.
		Append(c.spreadsheetID, sheetName, vr).
		ValueInputOption("RAW").
		Context(ctx).
		Do()
	if err != nil {
		return fmt.Errorf("シート %q への行追加に失敗: %w", sheetName, err)
	}
	return nil
}

// UpdateRow はシートの特定行を更新する（rowIndex: 1始まり）
func (c *Client) UpdateRow(ctx context.Context, sheetName string, rowIndex int, values []interface{}) error {
	rng := fmt.Sprintf("%s!A%d", sheetName, rowIndex)
	vr := &sheets.ValueRange{
		Values: [][]interface{}{values},
	}
	_, err := c.service.Spreadsheets.Values.
		Update(c.spreadsheetID, rng, vr).
		ValueInputOption("RAW").
		Context(ctx).
		Do()
	if err != nil {
		return fmt.Errorf("シート %q の行 %d の更新に失敗: %w", sheetName, rowIndex, err)
	}
	return nil
}

// DeleteRow はシートの特定行を削除する（rowIndex: 1始まり）
func (c *Client) DeleteRow(ctx context.Context, sheetName string, rowIndex int) error {
	// シートIDを取得
	meta, err := c.service.Spreadsheets.Get(c.spreadsheetID).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("スプレッドシートのメタデータ取得に失敗: %w", err)
	}

	var sheetID int64
	found := false
	for _, s := range meta.Sheets {
		if s.Properties.Title == sheetName {
			sheetID = s.Properties.SheetId
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("シート %q が見つかりません", sheetName)
	}

	req := &sheets.BatchUpdateSpreadsheetRequest{
		Requests: []*sheets.Request{
			{
				DeleteDimension: &sheets.DeleteDimensionRequest{
					Range: &sheets.DimensionRange{
						SheetId:    sheetID,
						Dimension:  "ROWS",
						StartIndex: int64(rowIndex - 1), // 0始まり
						EndIndex:   int64(rowIndex),
					},
				},
			},
		},
	}

	_, err = c.service.Spreadsheets.BatchUpdate(c.spreadsheetID, req).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("シート %q の行 %d の削除に失敗: %w", sheetName, rowIndex, err)
	}
	return nil
}

// CellString はセル値を文字列として安全に取得する
func CellString(row []interface{}, index int) string {
	if index >= len(row) {
		return ""
	}
	s, ok := row[index].(string)
	if !ok {
		return fmt.Sprintf("%v", row[index])
	}
	return s
}

// CellBool はセル値を bool として取得する（"true"/"TRUE"/true → true、それ以外 → defaultVal）
func CellBool(row []interface{}, index int, defaultVal bool) bool {
	if index >= len(row) {
		return defaultVal
	}
	switch v := row[index].(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(v, "true")
	default:
		return defaultVal
	}
}
