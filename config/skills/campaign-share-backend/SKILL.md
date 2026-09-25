---
name: campaign-share-backend
description: "キャンペーンサイト / ブラウザゲーム / 診断コンテンツ向けの AWS CDK バックエンド（S3 + CloudFront + Lambda Function URL(OAC) + DynamoDB）を構築し、結果に応じた OGP 画像を Lambda で動的生成 → シェア用 HTML（og:image 付き・トップへリダイレクト）を S3 に保存 → シェア URL を返す仕組みを作るスキル。Use this whenever the user wants to build or modify a backend for a campaign/LP/game site on AWS, generate dynamic OG images (@napi-rs/canvas), create share pages / share URLs for X(Twitter)/LINE, set up CloudFront behaviors & cache headers, Basic auth for dev, custom domain with ACM in us-east-1, or deploy a static frontend to S3+CloudFront — even if they only say 'シェア機能を付けたい' 'OGP を結果ごとに変えたい' 'スコアを保存したい' 'CDK でインフラを作って'."
---

# Campaign Share Backend（CDK + 動的 OGP + シェア URL）

静的フロント（Vite 等）を配信しつつ、プレイ結果・診断結果ごとに OGP 画像とシェアページを生成する
小規模バックエンドの定石。実運用で踏んだ落とし穴込みでまとめてある。

## 全体像

```
CloudFront Distribution（1 つ。ブラウザからは同一オリジンなので CORS 不要）
 ├── default        → S3 frontend（index.html 等。CDN 1s / ブラウザ no-cache）
 ├── assets/*       → S3 frontend（ハッシュ付き素材。ブラウザ immutable 60s）
 ├── api/*          → Lambda Function URL（AWS_IAM + OAC。キャッシュ無効・全メソッド）
 ├── u/*.html       → S3 upload（シェアページ。CDN 60s・noindex）
 └── u/*            → S3 upload（OG 画像。immutable・noindex）
S3 frontend / S3 upload（どちらも非公開・OAC）
DynamoDB（pk/sk の 1 テーブル。日付分割 pk）
Lambda（Node 22 / ARM_64 / @napi-rs/canvas）
[prod のみ] ACM 証明書スタック（us-east-1）→ cross-region reference で Distribution へ
[dev のみ]  CloudFront Function の Basic 認証（全 behavior）
```

シェアの流れ:

1. 結果画面の**表示時**にフロントが `POST /api/v1/share-cards` を投げる（事前生成）
2. Lambda がペイロードを厳格検証 → 下地 PNG + 数値/文字を canvas で描画 → `u/{uuid}.png`
3. テンプレート HTML に og:image（**絶対 URL**）を埋めて `u/{uuid}.html` を保存
4. DynamoDB に記録（リクエスト全文も保存し、レイアウト変更後に再生成できるようにする）
5. `{ sharePath, imagePath }` を返す → フロントは `location.origin` で絶対 URL 化
6. シェアボタン押下時は生成済み URL を**同期的に** `x.com/intent/post?url=...` へ渡す
7. SNS クローラーは `u/{id}.html` の OGP を読み、人間はトップへリダイレクトされる

## 作業手順

1. **ヒアリング**（下の「決めること」）。未決は仮決めして README に「仮決め事項」として列挙する
2. `assets/template/` を `backend/` にコピーし（`.gitignore` も含めて `cp -R template/. backend/`）、
   プレースホルダを置換する: `__PREFIX__`（リソース名接頭辞・小文字）/ `__StackPrefix__`（スタック名・PascalCase）/
   `__AWS_PROFILE__` / `__BASIC_USER__` `__BASIC_PASS__` / `__OG_TITLE__` `__OG_DESCRIPTION__` /
   `__FONT_FILE__` `__FONT_FAMILY__`。残りは `grep -rn '__[A-Z][A-Za-z_]*__' backend | grep -v __dirname` で確認。
   `npm install` で package-lock.json を作る（NodejsFunction の `depsLockFilePath` が参照する）
3. `lambda/api/schema.ts` をそのサイトの結果データに合わせて書き換える（許可キー・範囲・相互整合）
4. OG 画像を設計 → [references/og-image.md](references/og-image.md)
   （下地 PNG の用意、`render/layout.ts` の座標、フォント同梱）
5. フロント側: [assets/frontend/](assets/frontend/) の API クライアント・シェアボタン・Vite プロキシを移植
6. `npm test`（ハンドラ/検証/描画の単体テスト）→ `npm run synth:dev` → `npm run deploy:dev`
7. 初回デプロイ後、`stage.ts` の `publicBaseUrl` に**完全な URL**（`https://` + 出力 `DistributionDomainName`、
   独自ドメインがあればそのドメイン）を記入して再デプロイ。dev・prod それぞれ必要（独自ドメイン無しの prod も同様）
8. フロントを deploy スクリプトで配信 → curl チェックリストで検証
   → [references/deploy-and-verify.md](references/deploy-and-verify.md)
9. 本番: 独自ドメインがあれば証明書スタック → DNS 手動登録の順
   （同ファイルの「本番ドメイン」節）

各構成要素の詳しい理由・選択肢は [references/architecture.md](references/architecture.md)。

## 決めること（最初にユーザーへ確認）

| 項目 | 既定案 |
|---|---|
| リソース接頭辞・スタック名・AWS プロファイル・リージョン | `myapp-{stage}` / `MyappDevStack` / ap-northeast-1 |
| シェアに載せる値（スコア・タイプ・名前など）と OG 画像のバリエーション数 | 下地 PNG をバリエーション数だけ用意し、数値だけ描く |
| OG の title / description | index.html と同じ文言（Lambda 環境変数） |
| シェア先 | X の intent URL + URL コピー + 画像 DL。LINE は `https://social-plugins.line.me/lineit/share?url=` |
| 保存期間 | 無期限（期限があれば S3 ライフサイクル + DynamoDB TTL を追加） |
| 独自ドメイン / DNS 管理者 | prod のみ独自ドメイン、DNS は手動（Route53 不使用） |
| スコア送信（テレメトリ）の要否 | `POST /api/v1/runs`。**改ざん可能なので抽選・ランキングには使わない**と明記 |
| SPA ルーティングの有無 | 無し（errorResponses も URI rewrite も入れない） |
| 公開してはいけないファイル（未発表情報など）を配信から即時消す必要があるか | 無し（旧素材は猶予後に掃除）。有りなら deploy.sh で assets も即 `--delete` + invalidation |

## 必ず守る落とし穴（詳細は各 reference）

- **Function URL(AWS_IAM) + OAC では POST に `x-amz-content-sha256`（本文の SHA-256 hex）が必須**。
  フロントで付与する。curl 検証でも必要
- **2025-10 以降作成の Function URL は `lambda:InvokeFunction` 権限も必要**。
  CDK の `FunctionUrlOrigin.withOriginAccessControl` は `InvokeFunctionUrl` しか付けないため
  `addPermission` で明示付与（無いと全リクエスト 403 `{"Message":"Forbidden"}`）
- dev の Basic 認証を `api/*` に掛けるときは、**認証後に `Authorization` ヘッダを削除**する
  （OAC の SigV4 署名と衝突する）。`api/*` の originRequestPolicy は `ALL_VIEWER_EXCEPT_HOST_HEADER`
- CloudFront Function でヘッダを**追加**して Lambda に渡すと OAC 署名が壊れることがある。
  og:image の絶対 URL は `PUBLIC_BASE_URL` 環境変数で渡し、リクエスト由来のホストは信用しない
- og:image / twitter:image は**絶対 URL**（クローラーは相対 URL を解決しない）。index.html の静的 OGP も
  ビルド時に絶対 URL へ置換する
- `@napi-rs/canvas` はネイティブ依存 → `forceDockerBundling` + `nodeModules` で外出し + アーキテクチャ固定
  （ARM_64）。**デプロイ機に Docker 必須**、初回はイメージ取得で 10 分以上かかる
- フォントは Lambda に**同梱して `GlobalFonts.registerFromPath`**。システムフォント前提にしない
  （日本語を描くなら Noto Sans JP 等のサブセットを同梱）
- `u/*` の Cache-Control は **S3 オブジェクトメタデータで付ける**（ResponseHeadersPolicy で上書きすると
  404 にも immutable が付き、後から置いたファイルが見えなくなる）。**immutable なパスは再利用しない**
  （OG 画像を作り直すときも新しいキーにして HTML 側を向け直す。index.html の静的 og 画像もファイル名に版番号）
- シェアボタンでは `await` しない。`window.open` / `navigator.share` はユーザー操作直後
  （transient activation）でないとブロックされるため、結果表示時に事前生成しておく。
  React StrictMode の二重 effect で二重 POST しないよう結果オブジェクト単位でメモ化
- DynamoDB の SHARE レコードは「結果画面到達」の数であって「シェア実行」数ではない（集計時に注意）
- 本番の証明書は **us-east-1**。us-east-1 の `cdk bootstrap` が別途必要。DNS 検証 CNAME は 72 時間以内に登録

## 置いてあるもの

- `assets/template/` … backend 一式（CDK アプリ・スタック・Lambda・テスト・package.json）
- `assets/frontend/` … `api-client.ts`（sha256 付き POST・メモ化）、`share-actions.tsx`（X / コピー / DL）、
  `vite-proxy.snippet.ts`（ローカルから dev API へ中継・OGP 絶対 URL 化）、`deploy.sh`（フロント配信）
- `references/architecture.md` … behavior・キャッシュ・認証・データ設計の理由と選択肢
- `references/og-image.md` … OG 画像の設計・下地の作り方・描画のコツ・テスト
- `references/deploy-and-verify.md` … デプロイ順序・独自ドメイン・curl チェックリスト
