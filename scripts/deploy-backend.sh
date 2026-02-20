#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Lambda バックエンドのデプロイ ==="

cd "$PROJECT_ROOT/lambda"

echo "ビルド中..."
make build

echo "デプロイ中..."
sam deploy --no-confirm-changeset

echo "=== デプロイ完了 ==="
