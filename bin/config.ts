import { z } from "zod";
import * as dotenv from "dotenv";

dotenv.config();

const arnRegex = /^arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:.+$/i;
const accountIdRegex = /^\d{12}$/;
const hostnameLabel = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;
const domainRegex = new RegExp(
  String.raw`^(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}$`
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

const EnvSchema = z.object({
  ACCOUNT_ID: z
    .string()
    .regex(accountIdRegex, "ACCOUNT_ID must be a 12-digit AWS account ID"),
  AWS_REGION: z.string().default("us-east-1"),
  SENDER_EMAIL: z.email("SENDER_EMAIL must be a valid email"),
  RECIPIENT_EMAILS: csvEmails,
  DOMAIN_NAME: z
    .string()
    .regex(domainRegex, "DOMAIN_NAME must be a valid domain, e.g. example.com"),
  SUBDOMAIN_NAME: z
    .string()
    .refine(
      (s) => hostnameLabel.test(s),
      "SUBDOMAIN_NAME must be a valid DNS label"
    ),
  CERTIFICATE_ARN: z
    .string()
    .regex(arnRegex, "CERTIFICATE_ARN must be a valid AWS ARN"),
  GITHUB_OWNER: z.string().min(1, "GITHUB_OWNER is required"),
  GITHUB_REPOSITORY_NAME: z
    .string()
    .min(1, "GITHUB_REPOSITORY_NAME is required"),
  GITHUB_BRANCH_NAME: z.string().min(1).default("main"),
});

export const config = EnvSchema.parse(process.env);
