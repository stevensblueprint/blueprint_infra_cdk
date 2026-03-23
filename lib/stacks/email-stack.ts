import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { EmailMapping, EmailToDiscordConstruct } from "../constructs/email-to-discord-construct";

export interface EmailStackProps extends cdk.StackProps {
  readonly domainName: string;
  /** Maps email local parts to their config, e.g. { design: { webhookUrl: "https://...", allowedSenderDomains: ["example.com"] } } */
  readonly mappings: Record<string, EmailMapping>;
}

export class EmailStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);

    new EmailToDiscordConstruct(this, "EmailToDiscordConstruct", {
      domainName: props.domainName,
      mappings: props.mappings,
    });
  }
}
