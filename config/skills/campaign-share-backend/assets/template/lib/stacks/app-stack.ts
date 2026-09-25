import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cdk from 'aws-cdk-lib'
import type { aws_certificatemanager as acm } from 'aws-cdk-lib'
import { aws_cloudfront as cloudfront } from 'aws-cdk-lib'
import { aws_cloudfront_origins as origins } from 'aws-cdk-lib'
import { aws_dynamodb as dynamodb } from 'aws-cdk-lib'
import { aws_iam as iam } from 'aws-cdk-lib'
import { aws_lambda as lambda } from 'aws-cdk-lib'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { aws_s3 as s3 } from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import type { StageConfig } from '../config/stage.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type AppStackProps = cdk.StackProps & {
  stageConfig: StageConfig
  /** 独自ドメイン用 ACM 証明書（us-east-1。bin/app.ts の CertificateStack から受け取る） */
  certificate?: acm.ICertificate
}

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props)

    const { stageConfig, certificate } = props
    const { resourcePrefix, stage, customDomainName } = stageConfig

    if (customDomainName && !certificate) {
      throw new Error(`customDomainName "${customDomainName}" には証明書が必要です（bin/app.ts の CertificateStack）`)
    }

    // ---------------------------------------------------------------- Storage

    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `${resourcePrefix}-frontend-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      // sync --delete の誤操作・同名上書きからの復旧手段
      versioned: true,
      lifecycleRules: [{ id: 'expire-noncurrent-versions', noncurrentVersionExpiration: cdk.Duration.days(90) }],
    })

    // シェアページ・OG 画像の保存先。保存期間が決まったら lifecycleRules を追加する
    const uploadBucket = new s3.Bucket(this, 'UploadBucket', {
      bucketName: `${resourcePrefix}-upload-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    })

    // 1 テーブル・pk/sk 汎用キー。pk は `SHARE#YYYY-MM-DD` のような日付分割（ホットパーティション回避・日次集計用）
    const recordsTable = new dynamodb.Table(this, 'RecordsTable', {
      tableName: `${resourcePrefix}-records`,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // 保存期間を設けるなら: timeToLiveAttribute: 'expiresAt',
    })

    // ---------------------------------------------------------------- Lambda

    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      functionName: `${resourcePrefix}-api`,
      runtime: lambda.Runtime.NODEJS_22_X,
      // @napi-rs/canvas のネイティブバイナリと一致させるため固定（synth 端末の arch で変えない）
      architecture: lambda.Architecture.ARM_64,
      depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
      entry: path.join(__dirname, '../../lambda/api/handler.ts'),
      handler: 'handler',
      // canvas 描画は CPU 依存。メモリを増やすと CPU も増える（1536MB で 1200x630 PNG が数百 ms 程度）
      memorySize: 1536,
      timeout: cdk.Duration.seconds(20),
      // コスト暴走ガード（要調整値。バズ時に 429 が出るなら上げる）
      reservedConcurrentExecutions: 10,
      environment: {
        UPLOAD_BUCKET_NAME: uploadBucket.bucketName,
        RECORDS_TABLE_NAME: recordsTable.tableName,
        // シェアページの og:title / og:description。フロントの index.html と同じ文言にする
        OG_TITLE: '__OG_TITLE__',
        OG_DESCRIPTION: '__OG_DESCRIPTION__',
        // og:image の絶対 URL のベース。リクエストの Host からは組み立てない
        PUBLIC_BASE_URL: stageConfig.publicBaseUrl,
        // シェアページからのリダイレクト先（サイトのトップ）
        SITE_TOP_PATH: '/',
      },
      bundling: {
        target: 'node22',
        // ネイティブモジュールを Lambda（Linux ARM64）向けに入れるため Docker で固める
        forceDockerBundling: true,
        nodeModules: ['@napi-rs/canvas'],
        commandHooks: {
          beforeInstall() {
            return []
          },
          // フォント・下地 PNG・HTML テンプレートをバンドル出力へコピー（handler と同階層に置かれる）
          beforeBundling(inputDir: string, outputDir: string) {
            return [
              `mkdir -p ${outputDir}/assets ${outputDir}/templates`,
              `cp -R ${inputDir}/lambda/api/assets/. ${outputDir}/assets/`,
              `cp -R ${inputDir}/lambda/api/templates/. ${outputDir}/templates/`,
            ]
          },
          afterBundling() {
            return []
          },
        },
      },
    })

    // 最小権限: u/ 配下への PutObject と PutItem のみ
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [`${uploadBucket.bucketArn}/u/*`],
      }),
    )
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [recordsTable.tableArn],
      }),
    )

    // AWS_IAM + OAC: CloudFront の SigV4 署名付きリクエストのみ受け付ける（Function URL 直叩き不可）。
    // 制約: POST / PUT には viewer 側で x-amz-content-sha256（本文の SHA-256 hex）が必須
    const functionUrl = apiFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    })

    // ---------------------------------------------------------------- CloudFront Functions

    // dev のみ Basic 認証（閲覧制限用途）。全 behavior に関連付けて未認証を 401 にする。
    const basicAuthToken = Buffer.from(
      `${stageConfig.basicAuthUsername}:${stageConfig.basicAuthPassword}`,
    ).toString('base64')
    const basicAuthCheckSnippet = `
  var authorization = request.headers.authorization;
  var expectedAuthorization = "Basic ${basicAuthToken}";
  if (!authorization || authorization.value !== expectedAuthorization) {
    return {
      statusCode: 401,
      statusDescription: "Unauthorized",
      headers: {
        "www-authenticate": { value: "Basic realm=\\"Protected\\"" },
        "cache-control": { value: "no-store" }
      }
    };
  }
`
    const useBasicAuth = stage !== 'prod'

    const basicAuthFunction = useBasicAuth
      ? new cloudfront.Function(this, 'BasicAuthFunction', {
          functionName: `${resourcePrefix}-basic-auth`,
          code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
${basicAuthCheckSnippet}
  return request;
}
`),
        })
      : undefined

    // api/* 用: 認証後に Authorization を削除する。
    // 残すと OAC が付ける SigV4 の Authorization と衝突して Lambda 側で 403 になる。
    // ※ ここでヘッダを「追加」するのも避ける（署名対象が変わり OAC が壊れることがある）
    const apiViewerRequestFunction = useBasicAuth
      ? new cloudfront.Function(this, 'ApiViewerRequestFunction', {
          functionName: `${resourcePrefix}-api-viewer-request`,
          code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
${basicAuthCheckSnippet}
  delete request.headers.authorization;
  return request;
}
`),
        })
      : undefined

    const functionAssociations = basicAuthFunction
      ? [{ eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: basicAuthFunction }]
      : undefined
    const apiFunctionAssociations = apiViewerRequestFunction
      ? [{ eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: apiViewerRequestFunction }]
      : undefined

    // ---------------------------------------------------------------- Cache / Response headers
    // CachePolicy は CDN 内部のキャッシュだけを制御する。S3 オリジンは Cache-Control を返さないため、
    // ブラウザ向けのヘッダは ResponseHeadersPolicy（override: true）で付ける。

    // default（index.html 等）: CDN には 1 秒だけ載せる → デプロイ直後の反映が速い
    const frontendCachePolicy = new cloudfront.CachePolicy(this, 'FrontendCachePolicy', {
      cachePolicyName: `${resourcePrefix}-frontend-1s`,
      defaultTtl: cdk.Duration.seconds(1),
      minTtl: cdk.Duration.seconds(1),
      maxTtl: cdk.Duration.seconds(1),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    })

    // u/*.html: シェアページ。テンプレート修正を再生成なしで反映しやすいよう CDN は 60 秒
    const uploadHtmlCachePolicy = new cloudfront.CachePolicy(this, 'UploadHtmlCachePolicy', {
      cachePolicyName: `${resourcePrefix}-upload-html-60s`,
      defaultTtl: cdk.Duration.seconds(60),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(60),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
    })

    const securityHeadersBehavior: cloudfront.ResponseSecurityHeadersBehavior = {
      contentTypeOptions: { override: true },
      strictTransportSecurity: {
        accessControlMaxAge: cdk.Duration.days(365),
        includeSubdomains: false,
        override: true,
      },
    }

    const noCachePolicy = new cloudfront.ResponseHeadersPolicy(this, 'NoCachePolicy', {
      responseHeadersPolicyName: `${resourcePrefix}-no-cache`,
      customHeadersBehavior: {
        customHeaders: [{ header: 'Cache-Control', value: 'no-cache', override: true }],
      },
      securityHeadersBehavior,
    })

    // assets/*: ファイル名にハッシュが入る前提。⚠ 403/404 にも付くので、公開したパスは再利用しない
    const immutablePolicy = new cloudfront.ResponseHeadersPolicy(this, 'ImmutablePolicy', {
      responseHeadersPolicyName: `${resourcePrefix}-immutable`,
      customHeadersBehavior: {
        customHeaders: [{ header: 'Cache-Control', value: 'public, max-age=31536000, immutable', override: true }],
      },
      securityHeadersBehavior,
    })

    // u/*: Cache-Control は Lambda が S3 メタデータで付けるので上書きしない
    // （上書きすると欠損パスの 404 に immutable が付く）。noindex とセキュリティヘッダのみ
    const uploadHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'UploadHeadersPolicy', {
      responseHeadersPolicyName: `${resourcePrefix}-upload-headers`,
      customHeadersBehavior: {
        customHeaders: [{ header: 'X-Robots-Tag', value: 'noindex', override: true }],
      },
      securityHeadersBehavior,
    })

    // ---------------------------------------------------------------- Distribution

    const frontendOrigin = origins.S3BucketOrigin.withOriginAccessControl(frontendBucket)
    const uploadOrigin = origins.S3BucketOrigin.withOriginAccessControl(uploadBucket)
    const apiOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl)

    const s3Behavior = (
      origin: cloudfront.IOrigin,
      cachePolicy: cloudfront.ICachePolicy,
      responseHeadersPolicy: cloudfront.IResponseHeadersPolicy,
    ): cloudfront.BehaviorOptions => ({
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy,
      responseHeadersPolicy,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      functionAssociations,
    })

    // errorResponses（403/404 → index.html）は設定しない。欠損素材が HTML 200 で返ると
    // フロントの読み込みエラー検知が壊れるため。SPA ルートが必要なサイトだけ追加を検討する
    // （その場合も api/* と u/* に効かないよう CloudFront Function の URI rewrite で限定する方が安全）。
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${resourcePrefix} distribution`,
      defaultRootObject: 'index.html',
      ...(customDomainName && certificate ? { domainNames: [customDomainName], certificate } : {}),
      defaultBehavior: s3Behavior(frontendOrigin, frontendCachePolicy, noCachePolicy),
      additionalBehaviors: {
        'assets/*': s3Behavior(frontendOrigin, cloudfront.CachePolicy.CACHING_OPTIMIZED, immutablePolicy),
        'api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Host を転送すると Function URL のホストと食い違い署名検証に失敗する
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          functionAssociations: apiFunctionAssociations,
        },
        // 順序に意味がある（先に書いた方が優先）。*.html を先に
        'u/*.html': s3Behavior(uploadOrigin, uploadHtmlCachePolicy, uploadHeadersPolicy),
        'u/*': s3Behavior(uploadOrigin, cloudfront.CachePolicy.CACHING_OPTIMIZED, uploadHeadersPolicy),
      },
    })

    // ⚠ 必須: 2025 年 10 月以降に作成された Function URL は、CloudFront からの呼び出しに
    // lambda:InvokeFunctionUrl に加えて lambda:InvokeFunction も要求する。
    // FunctionUrlOrigin.withOriginAccessControl は前者しか付与しないため、欠けると全リクエスト 403。
    // https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html
    apiFunction.addPermission('AllowCloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:cloudfront::${cdk.Aws.ACCOUNT_ID}:distribution/${distribution.distributionId}`,
    })

    // ---------------------------------------------------------------- Outputs（deploy.sh が参照）

    new cdk.CfnOutput(this, 'FrontendBucketName', { value: frontendBucket.bucketName })
    new cdk.CfnOutput(this, 'UploadBucketName', { value: uploadBucket.bucketName })
    new cdk.CfnOutput(this, 'RecordsTableName', { value: recordsTable.tableName })
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId })
    // 独自ドメイン運用時は DNS の CNAME 先
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: distribution.distributionDomainName })
    // フロントのビルド（index.html の og:image 絶対 URL）とデプロイ後検証に使う
    new cdk.CfnOutput(this, 'PublicBaseUrl', {
      value: customDomainName ? stageConfig.publicBaseUrl : `https://${distribution.distributionDomainName}`,
    })
  }
}
