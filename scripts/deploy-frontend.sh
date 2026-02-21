#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -lt 2 ]; then
  echo "使用法: $0 <S3バケット名> <CloudFront Distribution ID> [S3プレフィックス]"
  echo "例:     $0 my-bucket E246297E36J1WW frontend"
  exit 1
fi

S3_BUCKET="$1"
CF_DISTRIBUTION_ID="$2"
S3_PREFIX="${3:-frontend}"

echo "=== フロントエンドのデプロイ ==="

cd "$PROJECT_ROOT/frontend"

echo "ビルド中..."
npm run build

if [ -n "$S3_PREFIX" ]; then
  S3_DEST="s3://${S3_BUCKET}/${S3_PREFIX}"
else
  S3_DEST="s3://${S3_BUCKET}"
fi

echo "S3にアップロード中... (${S3_DEST})"
aws s3 sync dist/ "$S3_DEST" --delete \
  --exclude "index.html" \
  --cache-control "public, max-age=31536000, immutable"

aws s3 cp dist/index.html "$S3_DEST/index.html" \
  --cache-control "no-cache, no-store, must-revalidate"

echo "CloudFrontキャッシュを無効化中..."
aws cloudfront create-invalidation \
  --distribution-id "$CF_DISTRIBUTION_ID" \
  --paths "/index.html" | cat

echo "=== デプロイ完了 ==="
