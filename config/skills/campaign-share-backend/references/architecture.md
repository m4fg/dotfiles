# アーキテクチャの設計理由と選択肢

## 目次
1. なぜこの構成か
2. CloudFront behavior とキャッシュ
3. Lambda Function URL + OAC
4. dev の Basic 認証
5. データ設計（S3 / DynamoDB）
6. 濫用対策とコスト
7. よくある拡張

## 1. なぜこの構成か

- **CloudFront 1 つに全部載せる（ブラウザから見て同一オリジン。裏の origin は S3×2 と Lambda）**: CORS が不要、シェア URL も
  og:image も同じドメインになり、Basic 認証・独自ドメイン・HTTPS が一箇所で済む
- **API Gateway ではなく Lambda Function URL**: エンドポイント数本・低トラフィック前提なら
  構成が軽く安い。ただし素の Function URL は公開されるので **AWS_IAM + OAC** で匿名の直接呼び出しを拒否し、
  CloudFront 経由に揃える（同一アカウントで invoke 権限を持つ IAM 主体は直接呼べる）
- **シェアページを静的 HTML として S3 に保存**: クローラーのアクセスで Lambda を起動しない
  （バズっても S3 + CloudFront で捌ける）。OG 画像も同様
- **設定はコード同梱**（CDK の定数 / Lambda 環境変数）: 実行時に取りに行く設定ファイルを作らない。
  変更は再デプロイで行う（改ざん耐性と単純さ）

## 2. CloudFront behavior とキャッシュ

| パス | オリジン | CDN (CachePolicy) | ブラウザ (Cache-Control) | 補足 |
|---|---|---|---|---|
| default | frontend S3 | 1 秒 | `no-cache`（ResponseHeadersPolicy） | index.html。デプロイがほぼ即時反映 |
| `assets/*` | frontend S3 | CACHING_OPTIMIZED | `public, max-age=31536000, immutable` | ファイル名にハッシュ前提 |
| `api/*` | Lambda URL | CACHING_DISABLED | Lambda が返す（`no-store`） | ALL_VIEWER_EXCEPT_HOST_HEADER・全メソッド |
| `u/*.html` | upload S3 | 最大 60 秒 | S3 メタデータ `max-age=60` | noindex |
| `u/*` | upload S3 | CACHING_OPTIMIZED | S3 メタデータ `immutable` | noindex |

設計上のポイント:

- **CachePolicy は CDN 内部のキャッシュだけ**を決める。S3 はオブジェクトメタデータに設定した Cache-Control しか
  返さず、`s3 sync` で置いたフロント成果物には付いていない。そのためブラウザ向けは ResponseHeadersPolicy
  （`override: true`）で付ける。upload バケットは逆に Lambda がメタデータで付ける
- **ResponseHeadersPolicy のヘッダはエラー応答にも付く**。`assets/*` の欠損パスへアクセスされると
  403 が 1 年キャッシュされ得る → 一度公開したパスは修復・再利用せずファイル名を変えて置き直す。
  中身の差し替えも同じ（immutable なので同一パスの更新はブラウザに届かない）
- `u/*` は Lambda が S3 PutObject 時に `CacheControl` を付ける。CloudFront で上書きしないのは、
  生成直後に誰かが先に叩いて 404 になったとき、その 404 を immutable にしないため
- behavior の並びは**上が優先**。`u/*.html` を `u/*` より先に書く
- **errorResponses（403/404 → index.html）は既定で入れない**。欠損素材が HTML 200 で返ると
  画像やJSON の読み込み失敗を検知できなくなり、`api/*` や `u/*` の 404 まで HTML になる。
  SPA ルーティングが必要なら、default behavior にだけ CloudFront Function で
  「拡張子なしのパスを /index.html に rewrite」する方が安全
- 欠損オブジェクトは OAC の S3 REST オリジンでは 404 ではなく **403 AccessDenied** で返る
  （ListBucket 権限を与えていないため）。検証スクリプトでは 403/404 の両方を「無い」と扱う

## 3. Lambda Function URL + OAC

- `authType: AWS_IAM` + `FunctionUrlOrigin.withOriginAccessControl(functionUrl)`
- **POST/PUT の本文には `x-amz-content-sha256` ヘッダ（SHA-256 hex）が必須**。
  OAC は本文を署名に含めるが CloudFront は本文をハッシュしないため、viewer が付ける必要がある。
  ハッシュを取った文字列と送る文字列が 1 バイトでも違うと 403
- **`lambda:InvokeFunction` の追加付与**（2025-10 以降作成の Function URL で必須）。
  CDK の OAC ヘルパは `lambda:InvokeFunctionUrl` しか付けない → 欠けると全リクエスト
  `{"Message":"Forbidden"}` 403。原因がヘッダや Basic 認証に見えて時間を溶かしやすい
- originRequestPolicy は `ALL_VIEWER_EXCEPT_HOST_HEADER`（Host を転送すると署名先ホストと食い違う）
- CloudFront Function で**ヘッダを追加**して Lambda に情報を渡す方式（例: x-forwarded-host で
  og:image のホストを決める）は避ける。署名と干渉しうるうえ、Host 由来の値は偽装できる。
  **公開ベース URL は `PUBLIC_BASE_URL` 環境変数**で固定する
- CORS / OPTIONS は同一オリジン運用なので持たない。別オリジンから呼ぶ要件が出たら追加
- `@napi-rs/canvas` はネイティブモジュール: `forceDockerBundling: true`・`nodeModules: ['@napi-rs/canvas']`・
  `architecture: ARM_64` 固定（synth 端末の arch で変えると別端末のデプロイで壊れる）。
  アセット（フォント・下地・テンプレート）は `commandHooks.beforeBundling` でバンドル出力へコピーし、
  コード側は `__dirname`（Lambda の CJS）と `import.meta.url`（ローカルの ESM テスト）の両方で探す

## 4. dev の Basic 認証

- CloudFront Function（viewer-request）で `Authorization` を比較。**全 behavior に関連付ける**
  （`u/*` や `api/*` だけ素通しにならないように）
- `api/*` 用は別関数にし、**認証成功後に `Authorization` を削除**する。残すと OAC の SigV4
  `Authorization` と衝突する
- 資格情報は CDK 定数の既定値 + 環境変数上書き。閲覧制限であって機密境界ではない
- 注意: dev の OGP は Basic 認証の向こうなので **SNS のクローラーからは見えない**。
  シェアカードの見た目確認は `/u/{id}.png` を直接開くか、prod（または認証を外した検証環境）で行う
- prod は認証なし。公開前の prod を隠したいなら同じ関数を prod にも付け、公開時に外して再デプロイ

## 5. データ設計

- upload バケットのキー: `u/{uuid}.png` / `u/{uuid}.html`。**UUID v4**（連番だと他人の結果を列挙できる）
- Lambda の IAM は `s3:PutObject` on `upload/u/*` と `dynamodb:PutItem` のみ
- DynamoDB は汎用 pk/sk の 1 テーブル:
  - `pk = SHARE#YYYY-MM-DD`（JST 等、集計したい日付の基準で）/ `sk = {epochMs}#{uuid}`
  - 日次集計が pk 1 つの Query で済む（1MB ごとにページングされるので `LastEvaluatedKey` を辿って全件取る）
  - 当日分の書き込みは同じ pk に集まる。キャンペーン規模（毎秒数十件程度）なら問題ないが、
    毎秒 1,000 書き込みを超える見込みなら `SHARE#日付#0..N` のようにシャードを足す
  - **`requestPayload`（検証前の受信 JSON）も保存** → OG レイアウト変更後に過去分を再生成できる
  - SHARE レコードは「結果画面到達で事前生成された」数。**シェア実行数ではない**
    （実行数が欲しければフロントのクリックを別途計測する）
- 保存期間を決めたら: S3 ライフサイクル（`u/` プレフィックスで expiration）+ DynamoDB TTL
- バケット・テーブルは `RemovalPolicy.RETAIN`。frontend バケットはバージョニング + 非現行 90 日削除

## 6. 濫用対策とコスト

- `reservedConcurrentExecutions`（例 10）は**処理速度の上限**（同時実行数）であって課金総額の上限ではない。
  急激なスパイクで Lambda 課金が膨らむのは防げるが、低速でも継続的に叩かれれば S3・DynamoDB は溜まり続ける。
  超過時は 429（TooManyRequests）になるので、フロントは失敗時にボタンを無効のままにする
  （ゲーム進行は止めない）。キャンペーン規模に応じて上げる
- 継続的な濫用への備え: AWS WAF のレートベースルール（IP 単位）を Distribution に付ける、
  CloudWatch アラーム（Invocations・5xx・Throttles）と Budgets アラート、
  緊急停止手順（Lambda の reserved concurrency を 0 にすれば API だけ即停止できる）を README に書いておく
- ペイロード上限（例 2KB）で 413、スキーマ外で 400
- 未実装でよくある追加候補: idempotency key（同一結果の二重生成防止・部分失敗時の再試行）。
  現状は S3 保存後に DynamoDB が失敗すると記録のないファイルが残るが、UUID パスで参照されないため容量のみの害として許容している
- **スコアはクライアント生成値で改ざん可能**。ランキング・抽選・応募判定には使わない、と README に明記する

## 7. よくある拡張

- **公開日時で出し分ける画像/情報**: Lambda 内の定数 + サーバ時刻で現在公開分だけ返す
  API を足す（未来の情報を応答に含めない。未公開 ID は 404 + `no-store`、公開済みは固有 URL で immutable）。
  リリース日時の変更は再デプロイ
- **サーバ時刻の基準**: index.html への HEAD の `Date` ヘッダを使える（default behavior は CDN 1 秒なので
  ほぼ現在時刻。`Age` が付かないことを確認しておく）
- **LINE / Facebook**: どちらも og:image を読む。LINE は 1200×630 の中央付近が切り取られることがあるので、
  重要な情報は中央寄せ
- **X のカード**: `twitter:card=summary_large_image` 必須。キャッシュが強く、同一 URL の画像更新は
  反映されにくい → 画像を変えるなら URL を変える（UUID 方式ならシェアごとに別 URL なので問題になりにくい）
