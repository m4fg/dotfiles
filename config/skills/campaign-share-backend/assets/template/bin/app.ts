import * as cdk from 'aws-cdk-lib'
import { AppStack } from '../lib/stacks/app-stack.js'
import { CertificateStack } from '../lib/stacks/certificate-stack.js'
import { resolveStage } from '../lib/config/stage.js'

const app = new cdk.App()
const stageConfig = resolveStage(app.node.tryGetContext('stage'))
const stackPrefix = `__StackPrefix__${stageConfig.stage === 'prod' ? 'Prod' : 'Dev'}`

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
}

// 独自ドメインを持つ stage のみ: CloudFront 用証明書を us-east-1 の別スタックで作り、
// cross-region reference でメインスタックへ渡す（CloudFront の証明書は us-east-1 にしか置けない）。
const certificateStack = stageConfig.customDomainName
  ? new CertificateStack(app, `${stackPrefix}CertificateStack`, {
      domainName: stageConfig.customDomainName,
      env: { account: env.account, region: 'us-east-1' },
      crossRegionReferences: true,
    })
  : undefined

new AppStack(app, `${stackPrefix}Stack`, {
  stageConfig,
  certificate: certificateStack?.certificate,
  env,
  crossRegionReferences: certificateStack !== undefined,
})
