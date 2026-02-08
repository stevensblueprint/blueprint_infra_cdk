import * as cognito from "aws-cdk-lib/aws-cognito";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface AuthPoolConstructProps {
  readonly domainName: string;
  readonly certificateArn: string;
}

export default class AuthPoolConstruct extends Construct {
  readonly userPool: cognito.UserPool;
  readonly identityPool: cognito.CfnIdentityPool;

  constructor(scope: Construct, id: string, props: AuthPoolConstructProps) {
    super(scope, id);

    this.userPool = new cognito.UserPool(this, "BlueprintUserPool", {
      userPoolName: "blueprint-users",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      email: cognito.UserPoolEmail.withCognito(),
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
        givenName: {
          required: true,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
      },
    });

    const cfnUserPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.userAttributeUpdateSettings = {
      attributesRequireVerificationBeforeUpdate: ["email"],
    };

    cfnUserPool.addPropertyOverride("MfaConfiguration", "OPTIONAL");
    cfnUserPool.addPropertyOverride("EnabledMfas", [
      "SOFTWARE_TOKEN_MFA",
      "WEB_AUTHN",
    ]);

    cfnUserPool.addPropertyOverride("WebAuthnConfiguration", {
      RelyingPartyId: props.domainName,
      UserVerification: "preferred",
    });

    const authCert = acm.Certificate.fromCertificateArn(
      this,
      "AuthCert",
      props.certificateArn,
    );

    const userPoolDomain = this.userPool.addDomain("BlueprintAuthDomain", {
      customDomain: {
        domainName: `auth.${props.domainName}`, // auth.sitblueprint.com
        certificate: authCert,
      },
    });

    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: props.domainName,
    });
    new route53.ARecord(this, "AuthAliasARecord", {
      zone: hostedZone,
      recordName: "auth",
      target: route53.RecordTarget.fromAlias(
        new targets.UserPoolDomainTarget(userPoolDomain),
      ),
    });

    new route53.AaaaRecord(this, "AuthAliasAAAARecord", {
      zone: hostedZone,
      recordName: "auth",
      target: route53.RecordTarget.fromAlias(
        new targets.UserPoolDomainTarget(userPoolDomain),
      ),
    });
    new cdk.CfnOutput(this, "AuthUserPoolId", {
      value: this.userPool.userPoolId,
      description: "ID of the main Cognito User Pool",
    });
  }

  /**
   * Creates a Cognito group for controlling access to a specific website
   * @param siteId - Unique identifier for the website (e.g., "vault", "app")
   * @returns The created Cognito user pool group
   */
  createWebsiteGroup(siteId: string): cognito.CfnUserPoolGroup {
    const groupName = `website-${siteId}-access`;

    const group = new cognito.CfnUserPoolGroup(this, `${siteId}WebsiteGroup`, {
      userPoolId: this.userPool.userPoolId,
      groupName: groupName,
      description: `Access group for website ${siteId}`,
    });

    new cdk.CfnOutput(this, `AuthGroup${siteId}`, {
      value: groupName,
      description: `Cognito Group for ${siteId} website access control`,
    });

    return group;
  }
}
