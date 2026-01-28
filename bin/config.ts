import { z } from "zod";
import * as dotenv from "dotenv";

dotenv.config();

const arnRegex = /^arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:.+$/i;
const accountIdRegex = /^\d{12}$/;
const hostnameLabel = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;
const domainRegex = new RegExp(
  String.raw`^(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}$`,
);

const csvEmails = z
  .string()
  .min(1, "RECIPIENT_EMAILS is required (comma-separated)")
  .superRefine((val, ctx) => {
    const parts = val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RECIPIENT_EMAILS must contain at least one email",
      });
      return;
    }
    for (const e of parts) {
      const r = z.email().safeParse(e);
      if (!r.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid email in RECIPIENT_EMAILS: "${e}"`,
        });
      }
    }
  });

const EnvSchema = z
  .object({
    ACCOUNT_ID: z
      .string()
      .regex(accountIdRegex, "ACCOUNT_ID must be a 12-digit AWS account ID"),
    AWS_REGION: z.string().default("us-east-1"),
    SENDER_EMAIL: z.email("SENDER_EMAIL must be a valid email"),
    RECIPIENT_EMAILS: csvEmails,
    DOMAIN_NAME: z
      .string()
      .regex(
        domainRegex,
        "DOMAIN_NAME must be a valid domain, e.g. example.com",
      ),
    CERTIFICATE_ARN: z
      .string()
      .regex(arnRegex, "CERTIFICATE_ARN must be a valid AWS ARN"),
    GITHUB_OWNER: z.string().min(1, "GITHUB_OWNER is required"),
    WEBSITES: z
      .string()
      .min(1, "WEBSITES is required")
      .transform((str, ctx) => {
        try {
          return JSON.parse(str);
        } catch (e) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "WEBSITES must be a valid JSON string",
          });
          return z.NEVER;
        }
      })
      .pipe(
        z.array(
          z.object({
            name: z.string().min(1),
            subdomain: z
              .string()
              .refine(
                (s) => hostnameLabel.test(s),
                "subdomain must be a valid DNS label",
              ),
            githubRepositoryName: z.string().optional(),
            githubBranchName: z.string().optional(),
            requiresAuth: z.boolean().optional().default(false),
          }),
        ),
      ),
    NOTION_TOKEN: z.string().min(1, "NOTION_TOKEN is required"),
  })
  .transform((env) => ({
    account: env.ACCOUNT_ID,
    region: env.AWS_REGION,
    senderEmail: env.SENDER_EMAIL,
    recipientEmails: env.RECIPIENT_EMAILS,
    domainName: env.DOMAIN_NAME,
    certificateArn: env.CERTIFICATE_ARN,
    githubOwner: env.GITHUB_OWNER,
    websites: env.WEBSITES,
    notionToken: env.NOTION_TOKEN,
  }));

export const config = EnvSchema.parse(process.env);
