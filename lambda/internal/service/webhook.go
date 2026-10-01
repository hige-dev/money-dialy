package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strconv"
	"strings"
	"time"

	"money-diary/internal/apperror"
	"money-diary/internal/dynamo"
	"money-diary/internal/model"
	"money-diary/internal/parser"
)

// ProcessGmailWebhook は Gmail Webhook を受けてクレジットカード利用メールを自動登録する
func ProcessGmailWebhook(ctx context.Context, client *dynamo.Client, req *model.WebhookGmailRequest, defaultUserEmail string) ([]model.Expense, error) {
	if req.Body == "" {
		return nil, apperror.New("メール本文(body)が空です")
	}

	// 登録済みのパーサーから自動判定して抽出
	inputs, cardName, err := parser.ParseEmail(req.From, req.Subject, req.Body)
	if err != nil {
		return nil, apperror.Newf("パースエラー (%s): %v", cardName, err)
	}

	if len(inputs) == 0 {
		return nil, apperror.New("利用明細を抽出できませんでした")
	}

	// メールマッピングの適用 (件名・キーワード)
	var activeInputs []model.ExpenseInput
	var activeIndexes []int
	mappings, err := client.ListEmailMappings(ctx)
	if err == nil && len(mappings) > 0 {
		for i := range inputs {
			excluded := false
			for _, m := range mappings {
				matched := false
				if m.Type == "subject" {
					if strings.Contains(req.Subject, m.Identifier) {
						matched = true
					}
				} else if m.Type == "keyword" {
					if strings.Contains(inputs[i].Place, m.Identifier) || strings.Contains(inputs[i].Memo, m.Identifier) {
						matched = true
					}
				}
				if matched {
					if m.Exclude {
						excluded = true
						break
					}
					if m.Payer != nil && *m.Payer != "" {
						inputs[i].Payer = *m.Payer
					}
					if m.Category != nil && *m.Category != "" {
						inputs[i].Category = *m.Category
					}
					if m.Place != nil && *m.Place != "" {
						inputs[i].Place = *m.Place
					}
				}
			}
			if !excluded {
				activeInputs = append(activeInputs, inputs[i])
				activeIndexes = append(activeIndexes, i)
			}
		}
	} else {
		activeInputs = inputs
		for i := range inputs {
			activeIndexes = append(activeIndexes, i)
		}
	}

	if len(activeInputs) == 0 {
		return []model.Expense{}, nil
	}

	if req.MessageID == "" {
		return nil, apperror.New("メールIDがありません")
	}
	catMaps, err := GetCategoryMaps(ctx, client, defaultUserEmail)
	if err != nil {
		return nil, err
	}
	var results []model.Expense
	preliminary := strings.HasPrefix(strings.TrimSpace(req.Subject), "【速報版】")
	for n, input := range activeInputs {
		index := activeIndexes[n]
		if cardName == "楽天カード" {
			if preliminary {
				input.Place = ""
			}
			if input.Date == "" || input.Category == "" || input.Amount <= 0 || !ValidateVisibility(input.Visibility) {
				return nil, apperror.Newf("%d件目の支出データが不正です", index+1)
			}
			saved, err := processRakutenItem(ctx, client, req, input, index, preliminary, defaultUserEmail, catMaps.OwnerEmail)
			if err != nil {
				return nil, err
			}
			if saved != nil {
				results = append(results, *saved)
			}
			continue
		}
		if input.Date == "" || input.Category == "" || input.Amount <= 0 || !ValidateVisibility(input.Visibility) {
			return nil, apperror.Newf("%d件目の支出データが不正です", index+1)
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		visibility := input.Visibility
		if catMaps.OwnerEmail[input.Category] != "" {
			visibility = VisibilityPrivate
		}
		e := &model.Expense{
			ID: "gmail-" + importKey(req.MessageID, index), Date: input.Date, Payer: input.Payer,
			Category: input.Category, Amount: input.Amount, Memo: input.Memo, Place: input.Place,
			Visibility: visibility, CreatedBy: defaultUserEmail, CreatedAt: now, UpdatedAt: now,
			ImportStatus: "complete", ImportCard: cardName, ImportDate: input.Date,
			ImportUser: input.ImportUser, ImportAmount: input.Amount,
			ImportMessageID: req.MessageID, ImportIndex: index,
			DetailMessageID: req.MessageID, DetailIndex: index,
		}
		saved, created, err := client.PutImportedExpense(ctx, e)
		if err != nil {
			return nil, err
		}
		if saved != nil {
			results = append(results, *saved)
		}
		if created {
			refreshSummaryCache(ctx, client, e.Date)
		}
	}
	return results, nil
}

func importKey(messageID string, index int) string {
	sum := sha256.Sum256([]byte(messageID + ":" + strconv.Itoa(index)))
	return hex.EncodeToString(sum[:])
}

func sortPendingCandidates(candidates []model.Expense) {
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].CreatedAt == candidates[j].CreatedAt {
			if candidates[i].ImportMessageID == candidates[j].ImportMessageID {
				return candidates[i].ImportIndex < candidates[j].ImportIndex
			}
			return candidates[i].ImportMessageID < candidates[j].ImportMessageID
		}
		return candidates[i].CreatedAt < candidates[j].CreatedAt
	})
}

func matchesPendingImport(e model.Expense, input model.ExpenseInput, cardName string) bool {
	return e.ImportStatus == "pending" && e.ImportCard == cardName && e.ImportDate == input.Date &&
		e.ImportUser == input.ImportUser && e.ImportAmount == input.Amount
}

func applyRakutenDetail(e *model.Expense, input model.ExpenseInput, messageID string, index int, categoryOwners map[string]string) {
	e.ImportStatus = "complete"
	e.DetailMessageID = messageID
	e.DetailIndex = index
	if e.Place == "" {
		e.Place = input.Place
	}
	if !e.ManualCategory {
		e.Category = input.Category
	}
	if !e.ManualPayer {
		e.Payer = input.Payer
	}
	if !e.ManualMemo {
		e.Memo = input.Memo
	}
	if categoryOwners[e.Category] != "" {
		e.Visibility = VisibilityPrivate
	}
	e.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
}

// processRakutenItem は利用日・利用者・金額ごとに速報と詳細を直列化して取り込む。
func processRakutenItem(ctx context.Context, client *dynamo.Client, req *model.WebhookGmailRequest, input model.ExpenseInput, index int, preliminary bool, userEmail string, categoryOwners map[string]string) (*model.Expense, error) {
	key := importKey(req.MessageID, index)
	group := importGroupKey("楽天カード", input)
	for attempt := 0; attempt < 10; attempt++ {
		linkedID, err := client.GetImportResult(ctx, key)
		if err != nil {
			return nil, err
		}
		if linkedID != "" {
			return client.GetExpense(ctx, linkedID)
		}
		own, err := client.GetExpense(ctx, "gmail-"+key)
		if err != nil {
			return nil, err
		}
		if own != nil {
			return own, nil
		}
		revision, err := client.GetImportGroupRevision(ctx, group)
		if err != nil {
			return nil, err
		}
		if preliminary {
			candidates, err := client.FindUnpairedDetailedExpenses(ctx, "楽天カード", input.Date, input.ImportUser, input.Amount)
			if err != nil {
				return nil, err
			}
			sortPendingCandidates(candidates)
			conflicted := false
			for _, candidate := range candidates {
				current, err := client.GetExpense(ctx, candidate.ID)
				if err != nil {
					return nil, err
				}
				if current == nil || !matchesUnpairedDetail(*current, input, "楽天カード") {
					continue
				}
				previous := current.UpdatedAt
				current.PreliminaryMessageID = req.MessageID
				current.PreliminaryIndex = index
				current.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
				ok, err := client.CommitGroupedImport(ctx, group, revision, key, current, previous, "detail")
				if err != nil {
					return nil, err
				}
				if ok {
					return current, nil
				}
				conflicted = true
				break
			}
			if conflicted {
				continue
			}
			e := newRakutenExpense(req, input, index, "pending", userEmail, categoryOwners)
			ok, err := client.CommitGroupedImport(ctx, group, revision, "", e, "", "new")
			if err != nil {
				return nil, err
			}
			if ok {
				refreshSummaryCache(ctx, client, e.Date)
				return e, nil
			}
			continue
		}
		candidates, err := client.FindPendingImportedExpenses(ctx, "楽天カード", input.Date, input.ImportUser, input.Amount)
		if err != nil {
			return nil, err
		}
		sortPendingCandidates(candidates)
		conflicted := false
		for _, candidate := range candidates {
			current, err := client.GetExpense(ctx, candidate.ID)
			if err != nil {
				return nil, err
			}
			if current == nil || !matchesPendingImport(*current, input, "楽天カード") {
				continue
			}
			previous := current.UpdatedAt
			applyRakutenDetail(current, input, req.MessageID, index, categoryOwners)
			ok, err := client.CommitGroupedImport(ctx, group, revision, key, current, previous, "pending")
			if err != nil {
				return nil, err
			}
			if ok {
				refreshSummaryCache(ctx, client, current.Date)
				return current, nil
			}
			conflicted = true
			break
		}
		if conflicted {
			continue
		}
		e := newRakutenExpense(req, input, index, "complete", userEmail, categoryOwners)
		ok, err := client.CommitGroupedImport(ctx, group, revision, "", e, "", "new")
		if err != nil {
			return nil, err
		}
		if ok {
			refreshSummaryCache(ctx, client, e.Date)
			return e, nil
		}
	}
	return nil, apperror.New("同じ利用明細が同時に更新されました。メールを再送してください")
}

func newRakutenExpense(req *model.WebhookGmailRequest, input model.ExpenseInput, index int, status, userEmail string, categoryOwners map[string]string) *model.Expense {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	visibility := input.Visibility
	if categoryOwners[input.Category] != "" {
		visibility = VisibilityPrivate
	}
	e := &model.Expense{
		ID: "gmail-" + importKey(req.MessageID, index), Date: input.Date, Payer: input.Payer,
		Category: input.Category, Amount: input.Amount, Memo: input.Memo, Place: input.Place,
		Visibility: visibility, CreatedBy: userEmail, CreatedAt: now, UpdatedAt: now,
		ImportStatus: status, ImportCard: "楽天カード", ImportDate: input.Date, ImportUser: input.ImportUser,
		ImportAmount: input.Amount, ImportMessageID: req.MessageID, ImportIndex: index,
	}
	if status == "pending" {
		e.PreliminaryMessageID = req.MessageID
		e.PreliminaryIndex = index
	} else {
		e.DetailMessageID = req.MessageID
		e.DetailIndex = index
	}
	return e
}

func importGroupKey(card string, input model.ExpenseInput) string {
	sum := sha256.Sum256([]byte(card + "\x00" + input.Date + "\x00" + input.ImportUser + "\x00" + strconv.Itoa(input.Amount)))
	return hex.EncodeToString(sum[:])
}

func matchesUnpairedDetail(e model.Expense, input model.ExpenseInput, cardName string) bool {
	return e.ImportStatus == "complete" && e.PreliminaryMessageID == "" && e.ImportCard == cardName &&
		e.ImportDate == input.Date && e.ImportUser == input.ImportUser && e.ImportAmount == input.Amount
}
