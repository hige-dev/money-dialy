#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

QUICK_MODE=false
if [[ "${1:-}" == "--quick" || "${1:-}" == "-q" ]]; then
  QUICK_MODE=true
fi

# 変更ファイルの取得（Working TreeおよびStagingの差分）
CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || true)

# 1. Frontend Check
HAS_FE_CHANGES=true
if [ "$QUICK_MODE" = true ] && [ -n "$CHANGED_FILES" ]; then
  if ! echo "$CHANGED_FILES" | grep -q "^frontend/"; then
    HAS_FE_CHANGES=false
  fi
fi

if [ "$HAS_FE_CHANGES" = true ]; then
  echo "=== [1/2] Frontend CI Check ==="
  cd "${REPO_ROOT}/frontend"

  echo "-> Auto-fix lint issues..."
  npx eslint --fix "src/**/*.{ts,tsx}" 2>/dev/null || true

  echo "-> Type check (tsc)..."
  npx tsc -b --noEmit

  echo "-> Lint check..."
  npm run lint
else
  echo "=== [1/2] Frontend CI Check (Skipped: No changes) ==="
fi

# 2. Backend Check
HAS_BE_CHANGES=true
if [ "$QUICK_MODE" = true ] && [ -n "$CHANGED_FILES" ]; then
  if ! echo "$CHANGED_FILES" | grep -q "^lambda/"; then
    HAS_BE_CHANGES=false
  fi
fi

if [ "$HAS_BE_CHANGES" = true ]; then
  echo "=== [2/2] Backend CI Check ==="
  cd "${REPO_ROOT}/lambda"

  echo "-> Formatting (gofmt)..."
  gofmt -w .

  echo "-> Build..."
  go build ./...

  echo "-> Vet..."
  go vet ./...

  echo "-> Test..."
  go test ./...
else
  echo "=== [2/2] Backend CI Check (Skipped: No changes) ==="
fi

echo "======================================"
echo " All local CI checks passed!"
echo "======================================"
