# デプロイと検証

## 目次
1. 前提
2. 初回デプロイ（dev）
3. フロントのデプロイ
4. 本番ドメイン（ACM us-east-1 + 手動 DNS）
5. curl チェックリスト
6. トラブルシュート

## 1. 前提

- Node 22+、AWS CLI のプロファイル（region もスクリプト側で明示する）
- **Docker**（`@napi-rs/canvas` を Linux ARM64 向けにバンドル）。初回はビルドイメージの取得で 10 分以上
- `npx cdk bootstrap --profile <profile>`（メインリージョン）。
  独自ドメインを使うなら **us-east-1 も bootstrap**: `npx cdk bootstrap aws://<account>/us-east-1 --profile <profile>`

## 2. 初回デプロイ（dev）

```bash
cd backend
npm install
npm test
npm run synth:dev
npm run deploy:dev
```

初回は `publicBaseUrl` が空なので share-cards だけ 500 を返す（他 API は動く）。

1. `lib/config/stage.ts` の dev `publicBaseUrl` に `https://<出力 DistributionDomainName>` を記入
   （ホスト名だけだと synth 時にエラーになる。独自ドメインの無い prod も初回デプロイ後に同様に記入）
2. もう一度 `npm run deploy:dev`
3. Basic 認証は `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` 環境変数で上書き可。ローテーションは値を変えて再デプロイ

## 3. フロントのデプロイ

`assets/frontend/deploy.sh` を `scripts/deploy.sh` に置き、

```bash
DEPLOY_BASIC_AUTH=user:pass scripts/deploy.sh dev
```

- スタック出力 → `PUBLIC_BASE_URL` 付きビルド → 素材を先に sync → HTML 等を sync（assets 以外 --delete）
  → invalidation 完了待ち → 検証
- 旧ハッシュの素材はすぐ消さない（開いたままのページが遅延読み込みで失敗する）。猶予を置いて掃除する。
  逆に、**公開してはいけないファイルを消す目的なら即 `--delete` + invalidation**（エッジに残るため省略不可）
- 公開してはいけないファイルが成果物に混ざる懸念があるなら、ビルド後に禁止語・禁止パスを走査する検証を挟む

## 4. 本番ドメイン

`stage.ts` の `CUSTOM_DOMAIN_NAME.prod` を設定すると、us-east-1 に証明書スタックができ、
cross-region reference で Distribution に付く。Route53 を使わない前提の手順:

1. DNS 担当と日程を合わせる（検証 CNAME は**要求から 72 時間以内**に登録しないと失敗→ロールバック）
2. `npm run deploy:prod` → 証明書スタックが CREATE_IN_PROGRESS で待機（CLI は Ctrl-C で抜けてよい）
3. 検証用 CNAME を取得して DNS 担当に渡す:

   ```bash
   aws acm list-certificates --profile <profile> --region us-east-1 \
     --query 'CertificateSummaryList[?DomainName==`<domain>`].CertificateArn' --output text
   aws acm describe-certificate --profile <profile> --region us-east-1 --certificate-arn <arn> \
     --query 'Certificate.DomainValidationOptions[].ResourceRecord' --output table
   ```

4. 検証が通ると証明書スタック完了 → メインスタック作成（Ctrl-C で抜けていたら、
   証明書が CREATE_COMPLETE になってから `npm run deploy:prod` を再実行。IN_PROGRESS 中の再実行は失敗する）
5. 出力 `DistributionDomainName` を CNAME 先として本番ドメインを DNS に登録
6. `curl -sI https://<domain>/` で証明書と応答を確認
7. 検証用 CNAME は削除しない（ACM の自動更新に使う）

- `PublicBaseUrl` 出力・Lambda の `PUBLIC_BASE_URL`・フロントの og:image はすべて独自ドメインになる。
  **DNS 反映前にフロントの deploy.sh を流すと検証ステップが失敗**する（独自ドメインを叩くため）
- `*.cloudfront.net` でも引き続きアクセスできる（DNS 反映前の疎通確認用）

## 5. curl チェックリスト

`BASE=https://<PublicBaseUrl>`、dev は `-u user:pass` を付ける。

```bash
# index.html: no-cache、Date が現在時刻
curl -sI "$BASE/" | grep -i 'cache-control\|content-type\|^date\|^age'

# 素材: immutable
curl -sI "$BASE/assets/<実ファイル>" | grep -i cache-control

# 存在しないパスが HTML 200 にフォールバックしないこと（403/404 のまま）
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/assets/not-exist.png"

curl -s "$BASE/api/v1/healthz"   # → {"ok":true}

# シェアカード生成（x-amz-content-sha256 必須）
BODY='{"result":{"score":100,"items":{"item1":1,"item2":2,"item3":3},"variantId":"default"}}'
HASH=$(printf '%s' "$BODY" | shasum -a 256 | cut -d' ' -f1)
curl -s -X POST "$BASE/api/v1/share-cards" \
  -H 'Content-Type: application/json' -H "x-amz-content-sha256: $HASH" -d "$BODY"
# → {"ok":true,"id":"…","sharePath":"/u/….html","imagePath":"/u/….png"}

# 返ったパスを確認: html に og:image の絶対 URL、png が 1200x630、どちらも X-Robots-Tag: noindex
curl -s "$BASE/u/<id>.html" | grep og:image
curl -sI "$BASE/u/<id>.png" | grep -i 'cache-control\|x-robots-tag\|content-type'

# dev のみ: 認証なしで全 behavior が 401
for p in / /assets/x.png /api/v1/healthz /u/x.html; do
  curl -s -o /dev/null -w "%{http_code} $p\n" "$BASE$p"
done
```

本番公開後は各 SNS のカード確認ツール（Facebook Sharing Debugger 等）や、実際に非公開アカウントで
投稿してカードの表示を確認する。

## 6. トラブルシュート

| 症状 | 原因 |
|---|---|
| api/* が全部 403 `{"Message":"Forbidden"}` | `lambda:InvokeFunction` 権限の付与漏れ（app-stack.ts の addPermission） |
| GET は通るが POST だけ 403 | `x-amz-content-sha256` が無い／本文とハッシュが不一致 |
| dev の api/* だけ 403 | Basic 認証後に `Authorization` を削除していない |
| share-cards が 500 `PUBLIC_BASE_URL is not configured` | stage.ts の publicBaseUrl 未記入 |
| share-cards が 500（ログに font / asset） | フォント・下地の未配置、`commandHooks` のコピー漏れ |
| Lambda 起動時に `invalid ELF header` 等 | canvas のアーキテクチャ不一致（ARM_64 固定と Docker バンドルを確認） |
| SNS でカードが出ない | og:image が相対 URL／dev の Basic 認証／`twitter:card` 欠落／画像が大きすぎ |
| 429 が出る | reserved concurrency に到達。上限を上げる |
| cdk deploy で証明書スタックが終わらない | 検証用 CNAME 未登録（72 時間でタイムアウト） |
