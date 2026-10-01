package dynamo

import (
	"testing"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"money-diary/internal/model"
)

func TestImportGroupRevisionUpdateExpressions(t *testing.T) {
	tests := []struct {
		name       string
		revision   int
		condition  string
		wantValues map[string]string
	}{
		{
			name:      "初回登録",
			revision:  0,
			condition: "attribute_not_exists(revision)",
			wantValues: map[string]string{
				":next": "1",
			},
		},
		{
			name:      "既存リビジョン更新",
			revision:  4,
			condition: "revision = :old",
			wantValues: map[string]string{
				":old":  "4",
				":next": "5",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			update := importGroupRevisionUpdate("master", "group", tt.revision)
			if got := *update.ConditionExpression; got != tt.condition {
				t.Errorf("条件式が不正です: got %q, want %q", got, tt.condition)
			}
			if got := *update.UpdateExpression; got != "SET revision = :next" {
				t.Errorf("更新式が不正です: got %q", got)
			}
			if len(update.ExpressionAttributeValues) != len(tt.wantValues) {
				t.Fatalf("式の値の数が不正です: got %d, want %d", len(update.ExpressionAttributeValues), len(tt.wantValues))
			}
			for key, want := range tt.wantValues {
				value, ok := update.ExpressionAttributeValues[key].(*types.AttributeValueMemberN)
				if !ok {
					t.Errorf("%s の数値が設定されていません", key)
					continue
				}
				if value.Value != want {
					t.Errorf("%s の値が不正です: got %q, want %q", key, value.Value, want)
				}
			}
		})
	}
}

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
