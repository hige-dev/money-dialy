package dynamo

import (
	"testing"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"money-diary/internal/model"
)

func TestExpenseImportFieldsRoundTrip(t *testing.T) {
	original := &model.Expense{
		ID: "支出1", Date: "2026-09-25", Amount: 11000,
		ImportStatus: "pending", ImportCard: "楽天カード", ImportDate: "2026-09-25",
		ImportUser: "本人", ImportAmount: 11000, ImportMessageID: "速報メール", ImportIndex: 3,
		ManualCategory: true, ManualPayer: true, ManualMemo: true,
		PreliminaryMessageID: "速報メール", PreliminaryIndex: 3,
	}
	av, err := attributevalue.MarshalMap(expenseFromModel(original))
	if err != nil {
		t.Fatal(err)
	}
	var stored expenseItem
	if err := attributevalue.UnmarshalMap(av, &stored); err != nil {
		t.Fatal(err)
	}
	got := stored.toModel()
	if got.ImportStatus != original.ImportStatus || got.ImportDate != original.ImportDate ||
		got.ImportUser != original.ImportUser || got.ImportAmount != original.ImportAmount ||
		got.ImportMessageID != original.ImportMessageID || got.ImportIndex != original.ImportIndex ||
		!got.ManualCategory || !got.ManualPayer || !got.ManualMemo ||
		got.PreliminaryMessageID != original.PreliminaryMessageID || got.PreliminaryIndex != original.PreliminaryIndex {
		t.Fatalf("取込情報の保存・復元が不正です: %+v", got)
	}
}

func TestOldExpenseWithoutImportFields(t *testing.T) {
	av, err := attributevalue.MarshalMap(map[string]any{"id": "既存支出", "date": "2026-09-25", "amount": 100})
	if err != nil {
		t.Fatal(err)
	}
	var stored expenseItem
	if err := attributevalue.UnmarshalMap(av, &stored); err != nil {
		t.Fatal(err)
	}
	got := stored.toModel()
	if got.ID != "既存支出" || got.ImportStatus != "" || got.ManualCategory {
		t.Fatalf("既存支出との互換性がありません: %+v", got)
	}
}
