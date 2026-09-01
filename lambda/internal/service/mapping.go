package service

import (
	"context"
	"money-diary/internal/apperror"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
)

// GetAllMappings retrieves all email mappings for the authenticated user (admin only may be enforced elsewhere).
func GetAllMappings(ctx context.Context, client *dynamo.Client) ([]model.EmailMapping, error) {
	return client.ListEmailMappings(ctx)
}

// CreateMapping creates a new email mapping.
func CreateMapping(ctx context.Context, client *dynamo.Client, m *model.EmailMapping) (*model.EmailMapping, error) {
	if m == nil {
		return nil, apperror.New("mapping は必須です")
	}
	if m.Type == "" || m.Identifier == "" {
		return nil, apperror.New("type と identifier は必須です")
	}
	// ID is generated as type#identifier for simplicity.
	m.ID = m.Type + "#" + m.Identifier
	if err := client.PutEmailMapping(ctx, *m); err != nil {
		return nil, err
	}
	return m, nil
}

// UpdateMapping updates an existing mapping (replace).
func UpdateMapping(ctx context.Context, client *dynamo.Client, typ string, identifier string, m *model.EmailMapping) (*model.EmailMapping, error) {
	if typ == "" || identifier == "" {
		return nil, apperror.New("type と identifier は必須です")
	}
	// Ensure the ID matches the path params.
	m.ID = typ + "#" + identifier
	m.Type = typ
	m.Identifier = identifier
	if err := client.PutEmailMapping(ctx, *m); err != nil {
		return nil, err
	}
	return m, nil
}

// DeleteMapping removes a mapping.
func DeleteMapping(ctx context.Context, client *dynamo.Client, typ string, identifier string) error {
	if typ == "" || identifier == "" {
		return apperror.New("type と identifier は必須です")
	}
	return client.DeleteEmailMapping(ctx, typ, identifier)
}
