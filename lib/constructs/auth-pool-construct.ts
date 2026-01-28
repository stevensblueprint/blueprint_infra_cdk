import * as iam from "aws-cdk-lib/aws-iam";
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
  constructor(scope: Construct, id: string, props: AuthPoolConstructProps) {
    super(scope, id);
    const smsRoleExternalId = "blueprint-cognito-sms";

    const cognitoSmsRole = new iam.Role(this, "CognitoSmsRole", {
      assumedBy: new iam.ServicePrincipal("cognito-idp.amazonaws.com", {
        conditions: {
          StringEquals: {
            "sts:ExternalId": smsRoleExternalId,
          },
        },
      }),
    });

    cognitoSmsRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sns:Publish"],
        resources: ["*"],
      }),
    );

    this.userPool = new cognito.UserPool(this, "BlueprintUserPool", {
      userPoolName: "blueprint-users",
      selfSignUpEnabled: false,
      signInAliases: { email: true },

      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: true, otp: true },

      smsRole: cognitoSmsRole,
      smsRoleExternalId,

      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });

    this.userPool.node.addDependency(cognitoSmsRole);

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
    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
    });
  }

  addClientApp(
    appName: string,
    callbackUrls: string[],
    logoutUrls: string[],
  ): cognito.UserPoolClient {
    const client = this.userPool.addClient(appName, {
      userPoolClientName: appName,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: callbackUrls,
        logoutUrls: logoutUrls,
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });
    new cdk.CfnOutput(this, `${appName}ClientId`, {
      value: client.userPoolClientId,
    });
    return client;
  }
}
