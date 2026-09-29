#!/usr/bin/env bash
# 日次 Google Sheets バックアップを DynamoDB Local に同期する。
# 引数なしの場合は必要な引数を案内し、終了する。
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$SCRIPT_DIR/../lambda"
exec go run ./cmd/sync-local "$@"
