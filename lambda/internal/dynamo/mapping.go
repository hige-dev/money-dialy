package dynamo

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"money-diary/internal/model"
)

// EmailMappingItem represents a DynamoDB item in the master table for email mapping.
type EmailMappingItem struct {
	Type              string  `dynamodbav:"type"` // always "mapping"
	ID                string  `dynamodbav:"id"`   // e.g. "subject#カード利用のお知らせ(本人ご利用分)" or "keyword#交通費"
	MappingType       string  `dynamodbav:"mappingType"`
	MappingIdentifier string  `dynamodbav:"mappingIdentifier"`
	Payer             *string `dynamodbav:"payer,omitempty"`
	Category          *string `dynamodbav:"category,omitempty"`
	Comment           string  `dynamodbav:"comment,omitempty"`
}

// PutEmailMapping creates or updates a mapping item.
func (c *Client) PutEmailMapping(ctx context.Context, m model.EmailMapping) error {
	id := fmt.Sprintf("%s#%s", m.Type, m.Identifier)
	item := EmailMappingItem{
		Type:              "mapping",
		ID:                id,
		MappingType:       m.Type,
		MappingIdentifier: m.Identifier,
		Payer:             m.Payer,
		Category:          m.Category,
		Comment:           m.Comment,
	}
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return fmt.Errorf("email mapping marshal error: %w", err)
	}
	_, err = c.db.PutItem(ctx, &dynamodb.PutItemInput{TableName: &c.masterTable, Item: av})
	if err != nil {
		return fmt.Errorf("put email mapping failed: %w", err)
	}
	return nil
}

// GetEmailMappingBySubject retrieves a mapping by exact email subject.
func (c *Client) GetEmailMappingBySubject(ctx context.Context, subject string) (*model.EmailMapping, error) {
	id := fmt.Sprintf("subject#%s", subject)
	out, err := c.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &c.masterTable,
		Key: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "mapping"},
			"id":   &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get email mapping failed: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}
	var itm EmailMappingItem
	if err := attributevalue.UnmarshalMap(out.Item, &itm); err != nil {
		return nil, fmt.Errorf("unmarshal email mapping: %w", err)
	}
	em := model.EmailMapping{
		ID:         itm.ID,
		Type:       itm.MappingType,
		Identifier: itm.MappingIdentifier,
		Payer:      itm.Payer,
		Category:   itm.Category,
		Comment:    itm.Comment,
	}
	return &em, nil
}

// ListEmailMappings returns all mapping items.
func (c *Client) ListEmailMappings(ctx context.Context) ([]model.EmailMapping, error) {
	items, err := c.queryMaster(ctx, "mapping")
	if err != nil {
		return nil, fmt.Errorf("list email mappings failed: %w", err)
	}
	var dbItems []EmailMappingItem
	if err := attributevalue.UnmarshalListOfMaps(items, &dbItems); err != nil {
		return nil, fmt.Errorf("unmarshal email mapping items: %w", err)
	}
	results := make([]model.EmailMapping, len(dbItems))
	for i, itm := range dbItems {
		results[i] = model.EmailMapping{
			ID:         itm.ID,
			Type:       itm.MappingType,
			Identifier: itm.MappingIdentifier,
			Payer:      itm.Payer,
			Category:   itm.Category,
			Comment:    itm.Comment,
		}
	}
	return results, nil
}

// DeleteEmailMapping removes a mapping by its type and identifier.
func (c *Client) DeleteEmailMapping(ctx context.Context, typ, identifier string) error {
	id := fmt.Sprintf("%s#%s", typ, identifier)
	_, err := c.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &c.masterTable,
		Key: map[string]types.AttributeValue{
			"type": &types.AttributeValueMemberS{Value: "mapping"},
			"id":   &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return fmt.Errorf("delete email mapping failed: %w", err)
	}
	return nil
}

