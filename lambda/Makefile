.PHONY: build clean test local dynamo-local

build:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o bootstrap cmd/api/main.go

# SAM build 用ターゲット
build-MoneyDiaryApiFunction:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o $(ARTIFACTS_DIR)/bootstrap cmd/api/main.go

test:
	go test ./...

local:
	go run ./cmd/local

dynamo-local:
	docker compose --project-directory .. -f ../compose.yaml up -d dynamodb-local

clean:
	rm -f bootstrap
