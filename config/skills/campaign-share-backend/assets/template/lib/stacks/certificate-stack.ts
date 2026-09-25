import * as cdk from 'aws-cdk-lib'
import { aws_certificatemanager as acm } from 'aws-cdk-lib'
import type { Construct } from 'constructs'

type CertificateStackProps = cdk.StackProps & {
  domainName: string
}

/**
 * CloudFront 用 ACM 証明書（CloudFront の制約により us-east-1 に置く）。
 *
 * DNS 検証・ホストゾーン指定なし（Route53 を使わず DNS を手動管理する前提）。
 * 検証用 CNAME を DNS に登録するまで CloudFormation は CREATE_IN_PROGRESS のまま待つ。
 * Route53 で管理しているなら CertificateValidation.fromDns(hostedZone) にすれば自動化できる。
 */
export class CertificateStack extends cdk.Stack {
  readonly certificate: acm.ICertificate

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props)

    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(),
    })

    new cdk.CfnOutput(this, 'CertificateArn', {
      value: this.certificate.certificateArn,
    })
  }
}
