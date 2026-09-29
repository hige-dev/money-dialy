package dynamo

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"money-diary/internal/model"
)

// NewLocalClient はループバック上の DynamoDB Local だけに接続する。
// AWS の設定ファイルや認証情報は読み込まない。
func NewLocalClient(endpoint string) (*Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, fmt.Errorf("DynamoDB Local の URL は http のループバックアドレスを指定してください")
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || !ip.IsLoopback() {
		return nil, fmt.Errorf("DynamoDB Local の接続先は 127.0.0.1 または ::1 を指定してください")
	}
	cfg := aws.Config{Region: "ap-northeast-1", Credentials: credentials.NewStaticCredentialsProvider("local", "local", "")}
	return &Client{
		db:           dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) { o.BaseEndpoint = aws.String(endpoint) }),
		expenseTable: "money-diary-local-expenses", masterTable: "money-diary-local-master",
	}, nil
}

// InitializeLocal はローカル用テーブルを作成し、空のマスタに初期データを登録する。
func (c *Client) InitializeLocal(ctx context.Context) error {
	if c.expenseTable != "money-diary-local-expenses" || c.masterTable != "money-diary-local-master" {
		return fmt.Errorf("ローカル専用のテーブル以外は初期化できません")
	}
	definitions := []*dynamodb.CreateTableInput{
		{
			TableName: &c.expenseTable, BillingMode: types.BillingModePayPerRequest,
			AttributeDefinitions:   []types.AttributeDefinition{{AttributeName: aws.String("id"), AttributeType: types.ScalarAttributeTypeS}, {AttributeName: aws.String("yearMonth"), AttributeType: types.ScalarAttributeTypeS}, {AttributeName: aws.String("date"), AttributeType: types.ScalarAttributeTypeS}},
			KeySchema:              []types.KeySchemaElement{{AttributeName: aws.String("id"), KeyType: types.KeyTypeHash}},
			GlobalSecondaryIndexes: []types.GlobalSecondaryIndex{{IndexName: aws.String("yearMonth-date-index"), KeySchema: []types.KeySchemaElement{{AttributeName: aws.String("yearMonth"), KeyType: types.KeyTypeHash}, {AttributeName: aws.String("date"), KeyType: types.KeyTypeRange}}, Projection: &types.Projection{ProjectionType: types.ProjectionTypeAll}}},
		},
		{
			TableName: &c.masterTable, BillingMode: types.BillingModePayPerRequest,
			AttributeDefinitions: []types.AttributeDefinition{{AttributeName: aws.String("type"), AttributeType: types.ScalarAttributeTypeS}, {AttributeName: aws.String("id"), AttributeType: types.ScalarAttributeTypeS}},
			KeySchema:            []types.KeySchemaElement{{AttributeName: aws.String("type"), KeyType: types.KeyTypeHash}, {AttributeName: aws.String("id"), KeyType: types.KeyTypeRange}},
		},
	}
	for _, input := range definitions {
		_, err := c.db.CreateTable(ctx, input)
		var exists *types.ResourceInUseException
		if err != nil && !errors.As(err, &exists) {
			return fmt.Errorf("ローカルテーブルの作成に失敗: %w", err)
		}
		if err := dynamodb.NewTableExistsWaiter(c.db).Wait(ctx, &dynamodb.DescribeTableInput{TableName: input.TableName}, time.Minute); err != nil {
			return err
		}
	}
	user, err := c.GetUser(ctx, "local@example.test")
	if err != nil {
		return err
	}
	if user == nil {
		_, err := c.db.PutItem(ctx, &dynamodb.PutItemInput{TableName: &c.masterTable, Item: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "user"}, "id": &types.AttributeValueMemberS{Value: "local@example.test"}, "role": &types.AttributeValueMemberS{Value: "admin"},
		}})
		if err != nil {
			return err
		}
	}
	categories, err := c.GetAllCategories(ctx)
	if err != nil {
		return err
	}
	if len(categories) == 0 {
		if err := c.PutCategory(ctx, &model.Category{ID: "local-food", Name: "食費", Color: "#FF6384", SortOrder: 1, IsActive: true, IsExpense: true}); err != nil {
			return err
		}
	}
	payers, err := c.GetAllPayers(ctx)
	if err != nil {
		return err
	}
	if len(payers) == 0 {
		return c.PutPayer(ctx, &model.Payer{ID: "local-cash", Name: "現金", SortOrder: 1, IsActive: true})
	}
	return nil
}
