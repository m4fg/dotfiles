#!/usr/bin/env bash
#
# フロントのデプロイ（プロジェクトルートの scripts/deploy.sh に置く）
#
#   scripts/deploy.sh dev
#   scripts/deploy.sh prod
#
#   1. CloudFormation のスタック出力からバケット・Distribution・公開 URL を取得
#   2. PUBLIC_BASE_URL 付きでビルド（index.html の og:image を絶対 URL に）
#   3. S3 へ 2 段階で同期: 素材（assets/）を先に追加 → HTML 等を後から差し替え
#      旧ハッシュの素材はすぐ消さない（開いたままの旧ページが遅延読み込みで 404 にならないように）
#   4. CloudFront invalidation を作成し、完了を待つ
#   5. 実環境を叩いて確認
# 途中で失敗したらそこで止まる。
set -euo pipefail

STAGE="${1:-dev}"
PROFILE="${AWS_PROFILE:-__AWS_PROFILE__}"
# プロファイルに region が無いと describe-stacks が NoRegion で落ちるので明示する
REGION="${AWS_REGION:-ap-northeast-1}"
# dev の Basic 認証（user:pass）。検証用。コミットせず環境変数で渡す
DEPLOY_BASIC_AUTH="${DEPLOY_BASIC_AUTH:-}"

if [[ "$STAGE" == "prod" ]]; then STACK="__StackPrefix__ProdStack"; else STACK="__StackPrefix__DevStack"; fi
AWS="aws --profile ${PROFILE} --region ${REGION}"

output() {
  $AWS cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo "== 1/5 スタック出力の取得 (${STACK}) =="
bucket=$(output FrontendBucketName)
distribution=$(output DistributionId)
baseUrl=$(output PublicBaseUrl)
echo "  bucket=${bucket} distribution=${distribution} base=${baseUrl}"
if [[ -z "$baseUrl" || "$baseUrl" == "None" ]]; then
  echo "PublicBaseUrl がスタック出力にありません" >&2
  exit 1
fi

echo "== 2/5 ビルド =="
PUBLIC_BASE_URL="$baseUrl" npm run build

echo "== 3/5 S3 へ同期 =="
# 3a. 新しい素材を先に置く（削除しない）
$AWS s3 sync dist/assets/ "s3://${bucket}/assets/"
# 3b. index.html 等を差し替え、assets/ 以外の余剰だけ消す
$AWS s3 sync dist/ "s3://${bucket}" --delete --exclude 'assets/*'
# 旧素材の掃除は猶予期間（例: 1 日）後に `s3 sync dist/assets/ s3://.../assets/ --delete` で行う。
# ※ 公開してはいけないファイルを確実に消したい場合（秘匿情報など）は、ここで即 --delete すること

echo "== 4/5 CloudFront invalidation（完了まで待つ）=="
invalidation=$($AWS cloudfront create-invalidation --distribution-id "$distribution" \
  --paths '/*' --query 'Invalidation.Id' --output text)
$AWS cloudfront wait invalidation-completed --distribution-id "$distribution" --id "$invalidation"

echo "== 5/5 実環境の検証 =="
CURL=(curl -sS -o /dev/null -w '%{http_code}')
[[ -n "$DEPLOY_BASIC_AUTH" ]] && CURL+=(-u "$DEPLOY_BASIC_AUTH")
check() {
  local code
  code=$("${CURL[@]}" "$baseUrl$1")
  if [[ "$code" != "$2" ]]; then echo "✗ $1 → $code（期待 $2）" >&2; exit 1; fi
  echo "  ✓ $1 → $code"
}
check / 200
check /api/v1/healthz 200
# index.html の og:image が絶対 URL になっていること
curl -sS ${DEPLOY_BASIC_AUTH:+-u "$DEPLOY_BASIC_AUTH"} "$baseUrl/" | grep -q "og:image\" content=\"${baseUrl}/" \
  || { echo "✗ index.html の og:image が絶対 URL ではありません" >&2; exit 1; }
echo "  ✓ og:image は絶対 URL"

echo "✔ デプロイ完了: ${baseUrl}"
