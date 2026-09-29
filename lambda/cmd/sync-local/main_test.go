package main

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"google.golang.org/api/option"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestReadSheet(t *testing.T) {
	client := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != "GET" || !strings.HasSuffix(r.URL.Path, "/values/'支出''一覧'!A1:K") || r.URL.Query().Get("valueRenderOption") != "UNFORMATTED_VALUE" {
			t.Fatalf("読み取りリクエストが不正: %s %s", r.Method, r.URL.String())
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"values":[["id","date","amount"],["test","2026-09-29",1234]]}`))}, nil
	})}
	rows, err := readSheet(t.Context(), "test-sheet", "支出'一覧", option.WithHTTPClient(client))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[1][2] != "1234" {
		t.Fatalf("セルの変換結果が不正: %+v", rows)
	}
}
