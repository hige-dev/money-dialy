#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== GAS (Google Apps Script) の自動デプロイ ==="

cd "$PROJECT_ROOT/gas"

if [ ! -f ".clasp.json" ]; then
  echo "Error: .clasp.json が存在しません。"
  echo ".clasp.json.example をコピーして scriptId を設定するか、'npx clasp create' を実行してください。"
  exit 1
fi

echo "Google Apps Script へコードをプッシュ中..."
npx @google/clasp push -f

echo "=== GAS プッシュ完了 ==="
