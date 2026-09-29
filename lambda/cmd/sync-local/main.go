// 日次 Google Sheets バックアップを DynamoDB Local に同期する。
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"google.golang.org/api/option"
	gsheets "google.golang.org/api/sheets/v4"
	"money-diary/internal/dynamo"
	"money-diary/internal/localrestore"
)

// readSheet は Google 認証情報で読み取り専用の Sheets API を使用する。
// 本番の AWS WIF 認証には依存しない。
func readSheet(ctx context.Context, id, sheet string, extraOptions ...option.ClientOption) ([][]string, error) {
	options := []option.ClientOption{option.WithScopes(gsheets.SpreadsheetsReadonlyScope)}
	if token := os.Getenv("GOOGLE_ACCESS_TOKEN"); token != "" {
		options = append(options, option.WithTokenSource(oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token})))
	}
	options = append(options, extraOptions...)
	svc, err := gsheets.NewService(ctx, options...)
	if err != nil {
		return nil, fmt.Errorf("Google の読み取り認証に失敗。GOOGLE_APPLICATION_CREDENTIALS または GOOGLE_ACCESS_TOKEN を設定してください: %w", err)
	}
	rng := "'" + strings.ReplaceAll(sheet, "'", "''") + "'!A1:K"
	result, err := svc.Spreadsheets.Values.Get(id, rng).ValueRenderOption("UNFORMATTED_VALUE").Context(ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("バックアップの取得に失敗: %w", err)
	}
	rows := make([][]string, len(result.Values))
	for i, row := range result.Values {
		for _, cell := range row {
			rows[i] = append(rows[i], fmt.Sprint(cell))
		}
	}
	return rows, nil
}

func run(ctx context.Context) error {
	file := flag.String("file", "", "バックアップの CSV ファイル")
	spreadsheet := flag.String("spreadsheet-id", "", "日次バックアップのスプレッドシート ID")
	sheet := flag.String("sheet", "expenses", "バックアップのシート名")
	endpoint := flag.String("dynamo-endpoint", "http://127.0.0.1:8000", "DynamoDB Local の接続先")
	dryRun := flag.Bool("dry-run", false, "書き込まずに同期件数を確認する")
	replace := flag.Bool("replace", false, "バックアップにないローカルの支出も削除する")
	createdBy := flag.String("created-by", "", "取込データの作成者を指定値に変更する。空なら元の作成者を保持")
	flag.Parse()
	if (*file == "") == (*spreadsheet == "") {
		return fmt.Errorf("-file または -spreadsheet-id のどちらか一方を指定してください")
	}
	client, err := dynamo.NewLocalClient(*endpoint)
	if err != nil {
		return err
	}
	var rows [][]string
	if *file != "" {
		f, err := os.Open(*file)
		if err != nil {
			return fmt.Errorf("CSV を開けません: %w", err)
		}
		rows, err = localrestore.ReadCSV(f)
		f.Close()
		if err != nil {
			return fmt.Errorf("CSV の読み込みに失敗: %w", err)
		}
	} else {
		rows, err = readSheet(ctx, *spreadsheet, *sheet)
		if err != nil {
			return err
		}
	}
	expenses, err := localrestore.Parse(rows)
	if err != nil {
		return err
	}
	if len(expenses) == 0 {
		return fmt.Errorf("バックアップに支出がありません。空のデータでは同期しません")
	}
	// dry-run ではテーブル作成や初期データ登録も行わない。
	if !*dryRun {
		if err := client.InitializeLocal(ctx); err != nil {
			return err
		}
	}
	categories, err := client.GetAllCategories(ctx)
	if err != nil {
		return fmt.Errorf("ローカル DB を読み込めません。make local で初期化してください: %w", err)
	}
	payers, err := client.GetAllPayers(ctx)
	if err != nil {
		return err
	}
	places, err := client.GetAllPlaces(ctx)
	if err != nil {
		return err
	}
	existing, err := client.ScanAllExpenses(ctx)
	if err != nil {
		return err
	}
	plan, err := localrestore.BuildPlan(expenses, existing, categories, payers, places, *replace, *createdBy)
	if err != nil {
		return err
	}
	log.Printf("同期対象: 支出 %d 件、追加マスタ: カテゴリ %d 件・支払元 %d 件・場所 %d 件、削除対象: 支出 %d 件", len(plan.Expenses), len(plan.Categories), len(plan.Payers), len(plan.Places), len(plan.DeleteIDs))
	if *dryRun {
		log.Print("確認のみで終了しました。ローカル DB への書き込みはありません")
		return nil
	}
	if err := localrestore.Apply(ctx, client, plan); err != nil {
		return fmt.Errorf("同期に失敗しました。途中まで反映されている場合は再実行してください: %w", err)
	}
	log.Print("ローカル DB への同期と集計更新が完了しました")
	return nil
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if err := run(ctx); err != nil {
		log.Fatal(err)
	}
}
