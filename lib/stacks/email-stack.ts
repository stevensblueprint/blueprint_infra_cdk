import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { EmailToDiscordConstruct } from "../constructs/email-to-discord-construct";

export interface EmailStackProps extends cdk.StackProps {
  readonly domainName: string;
  /** Maps email local parts to Discord webhook URLs, e.g. { design: "https://..." } */
  readonly mappings: Record<string, string>;
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
