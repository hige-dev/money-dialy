#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== CI/CD 初期セットアップ ==="

# ── 設定値 ──────────────────────────────────────────
ROLE_NAME="github-actions-money-diary"
POLICY_NAME="deploy-policy"
S3_BUCKET="money-diary-frontend-025223625993"
CF_DISTRIBUTION_ID="E3373CPSSJATAD"
AWS_REGION="ap-northeast-1"
SAMCONFIG="$PROJECT_ROOT/lambda/samconfig.toml"

# samconfig.toml から GoogleClientId を抽出
GOOGLE_CLIENT_ID=$(grep -oP 'GoogleClientId=\\"?\K[^"\\]+' "$SAMCONFIG")
VITE_API_URL=$(grep -oP 'AllowedOrigin=\\"?\K[^,\\]+' "$SAMCONFIG" | head -1)
VITE_API_URL="${VITE_API_URL}/api"
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query "Role.Arn" --output text)
SAM_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name aws-sam-cli-managed-default \
  --query "Stacks[0].Outputs[?OutputKey=='SourceBucket'].OutputValue" \
  --output text)

echo "  Role ARN:          $ROLE_ARN"
echo "  SAM Bucket:        $SAM_BUCKET"
echo "  S3 Bucket:         $S3_BUCKET"
echo "  CF Distribution:   $CF_DISTRIBUTION_ID"
echo "  Google Client ID:  ${GOOGLE_CLIENT_ID:0:20}..."
echo "  API URL:           $VITE_API_URL"
echo ""

# ── 1. samconfig.toml を S3 にアップロード ──────────
echo ">>> samconfig.toml を S3 にアップロード"
aws s3 cp "$SAMCONFIG" "s3://${S3_BUCKET}/config/samconfig.toml"

# ── 2. IAM ポリシーを設定 ──────────────────────────
echo ">>> IAM ポリシーを設定"
POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormation",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateChangeSet",
        "cloudformation:DeleteChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStacks",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:GetTemplate",
        "cloudformation:GetTemplateSummary",
        "cloudformation:ListStackResources"
      ],
      "Resource": [
        "arn:aws:cloudformation:${AWS_REGION}:025223625993:stack/money-diary/*",
        "arn:aws:cloudformation:${AWS_REGION}:025223625993:stack/aws-sam-cli-managed-default/*"
      ]
    },
    {
      "Sid": "CloudFormationTransform",
      "Effect": "Allow",
      "Action": "cloudformation:CreateChangeSet",
      "Resource": "arn:aws:cloudformation:${AWS_REGION}:aws:transform/Serverless-2016-10-31"
    },
    {
      "Sid": "S3SAM",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:GetBucketLocation", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::${SAM_BUCKET}",
        "arn:aws:s3:::${SAM_BUCKET}/*"
      ]
    },
    {
      "Sid": "FrontendS3",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": [
        "arn:aws:s3:::${S3_BUCKET}",
        "arn:aws:s3:::${S3_BUCKET}/*"
      ]
    },
    {
      "Sid": "Lambda",
      "Effect": "Allow",
      "Action": "lambda:*",
      "Resource": "arn:aws:lambda:${AWS_REGION}:025223625993:function:money-diary-*"
    },
    {
      "Sid": "IAMRole",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:PassRole",
        "iam:AttachRolePolicy", "iam:DetachRolePolicy",
        "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
        "iam:TagRole", "iam:UntagRole"
      ],
      "Resource": "arn:aws:iam::025223625993:role/money-diary-*"
    },
    {
      "Sid": "DynamoDB",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable", "dynamodb:UpdateTable", "dynamodb:DeleteTable",
        "dynamodb:DescribeTable", "dynamodb:DescribeTimeToLive", "dynamodb:UpdateTimeToLive",
        "dynamodb:TagResource", "dynamodb:UntagResource", "dynamodb:ListTagsOfResource"
      ],
      "Resource": "arn:aws:dynamodb:${AWS_REGION}:025223625993:table/money-diary-*"
    },
    {
      "Sid": "CloudFront",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::025223625993:distribution/${CF_DISTRIBUTION_ID}"
    },
    {
      "Sid": "Events",
      "Effect": "Allow",
      "Action": ["events:PutRule", "events:DeleteRule", "events:DescribeRule", "events:PutTargets", "events:RemoveTargets"],
      "Resource": "arn:aws:events:${AWS_REGION}:025223625993:rule/money-diary-*"
    }
  ]
}
EOF
)

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "$POLICY_DOC"

# ── 3. GitHub Secrets を設定 ───────────────────────
echo ">>> GitHub Secrets を設定"
gh secret set AWS_ROLE_ARN      -b "$ROLE_ARN"
gh secret set AWS_REGION        -b "$AWS_REGION"
gh secret set S3_BUCKET         -b "$S3_BUCKET"
gh secret set CF_DISTRIBUTION_ID -b "$CF_DISTRIBUTION_ID"
gh secret set GOOGLE_CLIENT_ID  -b "$GOOGLE_CLIENT_ID"
gh secret set VITE_API_URL      -b "$VITE_API_URL"

echo ""
echo "=== セットアップ完了 ==="
echo "GitHub Secrets:"
gh secret list
