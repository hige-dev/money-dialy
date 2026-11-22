package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"slices"
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
	inputs, cardName, err := parser.ParseEmail(gmailSender(req), req.Subject, req.Body)
	if err != nil {
		return nil, apperror.Newf("パースエラー (%s): %v", cardName, err)
	}

	if len(inputs) == 0 {
		return nil, apperror.New("利用明細を抽出できませんでした")
	}

	preliminary := strings.HasPrefix(strings.TrimSpace(req.Subject), "【速報版】")

	// メールマッピングの適用 (件名・キーワード)
	var activeInputs []model.ExpenseInput
	var activeIndexes []int
	// 除外設定に一致した楽天カードの詳細明細。先に届いた速報明細を打ち消すのに使う。
	var excludedDetails []int
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
			} else if cardName == "楽天カード" && !preliminary {
				excludedDetails = append(excludedDetails, i)
			}
		}
	} else {
		activeInputs = inputs
		for i := range inputs {
			activeIndexes = append(activeIndexes, i)
		}
	}

	if len(activeInputs) == 0 && len(excludedDetails) == 0 {
		return []model.Expense{}, nil
	}

	if req.MessageID == "" {
		return nil, apperror.New("メールIDがありません")
	}
	for _, index := range excludedDetails {
		if err := processRakutenExcludedDetail(ctx, client, req, inputs[index], index); err != nil {
			return nil, err
		}
	}
	if len(activeInputs) == 0 {
		return []model.Expense{}, nil
	}
	catMaps, err := GetCategoryMaps(ctx, client, defaultUserEmail)
	if err != nil {
		return nil, err
	}
	var results []model.Expense
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
		}
	}
	return results, nil
}

// gmailSender はパーサー判定に使う送信元を返す。転送メールでは元の送信元を優先する。
func gmailSender(req *model.WebhookGmailRequest) string {
	if forwardedFrom := strings.TrimSpace(req.ForwardedFrom); forwardedFrom != "" {
		return forwardedFrom
	}
	return req.From
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
	return e.ImportStatus == "pending" && e.ImportCard == cardName && slices.Contains(pendingDatesForDetail(input.Date), e.ImportDate) &&
		e.ImportUser == input.ImportUser && e.ImportAmount == input.Amount
}

// 楽天カードの速報版には利用日、詳細版には売上日が載るため、詳細版の日付が1日遅れることがある
// (月末の利用が翌月1日の明細になるなど)。照合は同日を優先し、1日差まで認める。

// pendingDatesForDetail は詳細明細と照合してよい速報明細の利用日を優先順に返す。
func pendingDatesForDetail(detailDate string) []string {
	return shiftedDates(detailDate, -1)
}

// detailDatesForPending は速報明細と照合してよい詳細明細の利用日を優先順に返す。
func detailDatesForPending(pendingDate string) []string {
	return shiftedDates(pendingDate, 1)
}

func shiftedDates(date string, days int) []string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return []string{date}
	}
	return []string{date, t.AddDate(0, 0, days).Format("2006-01-02")}
}

// sortCandidatesByDate は照合候補を日付の優先順、同じ日付なら取込順に並べる。
func sortCandidatesByDate(candidates []model.Expense, dates []string) {
	sortPendingCandidates(candidates)
	sort.SliceStable(candidates, func(i, j int) bool {
		return slices.Index(dates, candidates[i].ImportDate) < slices.Index(dates, candidates[j].ImportDate)
	})
}

func sortExcludedImports(records []dynamo.ExcludedImport, dates []string) {
	sort.SliceStable(records, func(i, j int) bool {
		ri, rj := slices.Index(dates, records[i].Date), slices.Index(dates, records[j].Date)
		if ri != rj {
			return ri < rj
		}
		if records[i].CreatedAt != records[j].CreatedAt {
			return records[i].CreatedAt < records[j].CreatedAt
		}
		return records[i].ID < records[j].ID
	})
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
		if linkedID == dynamo.ExcludedImportResult {
			return nil, nil
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
			detailDates := detailDatesForPending(input.Date)
			candidates, err := client.FindUnpairedDetailedExpenses(ctx, "楽天カード", detailDates, input.ImportUser, input.Amount)
			if err != nil {
				return nil, err
			}
			sortCandidatesByDate(candidates, detailDates)
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
			// 詳細版が除外設定で取り込まれていなければ、速報明細も登録しない
			excluded, err := client.FindExcludedImports(ctx, "楽天カード", detailDates, input.ImportUser, input.Amount)
			if err != nil {
				return nil, err
			}
			if len(excluded) > 0 {
				sortExcludedImports(excluded, detailDates)
				ok, err := client.ConsumeExcludedImport(ctx, group, revision, key, excluded[0].ID)
				if err != nil {
					return nil, err
				}
				if ok {
					return nil, nil
				}
				continue
			}
			e := newRakutenExpense(req, input, index, "pending", userEmail, categoryOwners)
			ok, err := client.CommitGroupedImport(ctx, group, revision, "", e, "", "new")
			if err != nil {
				return nil, err
			}
			if ok {
				return e, nil
			}
			continue
		}
		pendingDates := pendingDatesForDetail(input.Date)
		candidates, err := client.FindPendingImportedExpenses(ctx, "楽天カード", pendingDates, input.ImportUser, input.Amount)
		if err != nil {
			return nil, err
		}
		sortCandidatesByDate(candidates, pendingDates)
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

// importGroupKey は速報と詳細の照合を直列化する単位を返す。
// 速報と詳細で利用日がずれることがあるため、利用日は含めない。
func importGroupKey(card string, input model.ExpenseInput) string {
	sum := sha256.Sum256([]byte(card + "\x00" + input.ImportUser + "\x00" + strconv.Itoa(input.Amount)))
	return hex.EncodeToString(sum[:])
}

func matchesUnpairedDetail(e model.Expense, input model.ExpenseInput, cardName string) bool {
	return e.ImportStatus == "complete" && e.PreliminaryMessageID == "" && e.ImportCard == cardName &&
		slices.Contains(detailDatesForPending(input.Date), e.ImportDate) && e.ImportUser == input.ImportUser && e.ImportAmount == input.Amount
}

// processRakutenExcludedDetail は除外設定に一致した楽天カードの詳細明細を処理する。
// 速報明細が登録済みなら削除し、まだ無ければ後から届く速報明細を打ち消すために記録する。
func processRakutenExcludedDetail(ctx context.Context, client *dynamo.Client, req *model.WebhookGmailRequest, input model.ExpenseInput, index int) error {
	if input.Date == "" || input.Amount <= 0 {
		return nil
	}
	key := importKey(req.MessageID, index)
	group := importGroupKey("楽天カード", input)
	pendingDates := pendingDatesForDetail(input.Date)
	for attempt := 0; attempt < 10; attempt++ {
		linkedID, err := client.GetImportResult(ctx, key)
		if err != nil {
			return err
		}
		if linkedID != "" {
			return nil
		}
		// 除外設定を作る前に取り込んだ明細の再送は、そのまま残す
		own, err := client.GetExpense(ctx, "gmail-"+key)
		if err != nil {
			return err
		}
		if own != nil {
			return nil
		}
		revision, err := client.GetImportGroupRevision(ctx, group)
		if err != nil {
			return err
		}
		candidates, err := client.FindPendingImportedExpenses(ctx, "楽天カード", pendingDates, input.ImportUser, input.Amount)
		if err != nil {
			return err
		}
		sortCandidatesByDate(candidates, pendingDates)
		conflicted := false
		for _, candidate := range candidates {
			current, err := client.GetExpense(ctx, candidate.ID)
			if err != nil {
				return err
			}
			if current == nil || !matchesPendingImport(*current, input, "楽天カード") {
				continue
			}
			pendingKey := importKey(current.ImportMessageID, current.ImportIndex)
			ok, err := client.DeletePendingForExcludedImport(ctx, group, revision, key, pendingKey, current.ID, current.UpdatedAt)
			if err != nil {
				return err
			}
			if ok {
				return nil
			}
			conflicted = true
			break
		}
		if conflicted {
			continue
		}
		ok, err := client.RecordExcludedImport(ctx, group, revision, key, dynamo.ExcludedImport{
			ID: key, Card: "楽天カード", Date: input.Date, User: input.ImportUser, Amount: input.Amount,
			CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		})
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
	}
	return apperror.New("同じ利用明細が同時に更新されました。メールを再送してください")
}
