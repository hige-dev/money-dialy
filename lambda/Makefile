.PHONY: build clean

build:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o bootstrap cmd/api/main.go

# SAM build 用ターゲット
build-MoneyDiaryApiFunction:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o $(ARTIFACTS_DIR)/bootstrap cmd/api/main.go

clean:
	rm -f bootstrap
