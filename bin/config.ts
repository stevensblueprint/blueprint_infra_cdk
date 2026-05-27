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

const WebsiteSchema = z.object({
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
  includeRootDomain: z.boolean().optional().default(false),
});

const WebsitesSchema = z
  .any()
  .transform((input, ctx) => {
    if (Array.isArray(input)) return input;
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WEBSITES is required",
        });
        return z.NEVER;
      }

      try {
        const parsed = JSON.parse(trimmed);
        return parsed;
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "WEBSITES must be valid JSON (stringified) or a JSON array value",
        });
        return z.NEVER;
      }
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "WEBSITES must be a JSON array or a JSON string",
    });
    return z.NEVER;
  })
  .pipe(z.array(WebsiteSchema));

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
    WEBSITES: WebsitesSchema,
    EMAIL_DISCORD_MAPPINGS: z
      .string()
      .optional()
      .transform((val, ctx) => {
        if (!val) return undefined;
        let parsed: unknown;
        try {
          parsed = JSON.parse(val);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "EMAIL_DISCORD_MAPPINGS must be valid JSON",
          });
          return z.NEVER;
        }
        if (!Array.isArray(parsed)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'EMAIL_DISCORD_MAPPINGS must be a JSON array e.g. [{"design":{"webhookUrl":"https://discord.com/...","allowedSenderDomains":["example.com"]}}]',
          });
          return z.NEVER;
        }
        const merged: Record<string, { webhookUrl: string; allowedSenderDomains: string[]; forwardEmails?: string[] }> = {};
        for (const item of parsed) {
          if (typeof item !== "object" || item === null || Array.isArray(item)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Each entry in EMAIL_DISCORD_MAPPINGS must be an object",
            });
            return z.NEVER;
          }
          for (const [key, value] of Object.entries(item)) {
            if (
              typeof value !== "object" ||
              value === null ||
              typeof (value as Record<string, unknown>).webhookUrl !== "string"
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `EMAIL_DISCORD_MAPPINGS entry ["${key}"] must be an object with a "webhookUrl" string`,
              });
              return z.NEVER;
            }
            const { webhookUrl, allowedSenderDomains, forwardEmails } = value as Record<string, unknown>;
            if (
              allowedSenderDomains !== undefined &&
              (!Array.isArray(allowedSenderDomains) ||
                (allowedSenderDomains as unknown[]).some((d) => typeof d !== "string"))
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `EMAIL_DISCORD_MAPPINGS entry ["${key}"].allowedSenderDomains must be an array of strings`,
              });
              return z.NEVER;
            }
            if (
              forwardEmails !== undefined &&
              (!Array.isArray(forwardEmails) ||
                (forwardEmails as unknown[]).some((d) => typeof d !== "string"))
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `EMAIL_DISCORD_MAPPINGS entry ["${key}"].forwardEmails must be an array of strings`,
              });
              return z.NEVER;
            }
            merged[key] = {
              webhookUrl: webhookUrl as string,
              allowedSenderDomains: (allowedSenderDomains as string[]) ?? [],
              forwardEmails: forwardEmails as string[] | undefined,
            };
          }
        }
        return merged;
      }),
  })
  .superRefine((env, ctx) => {
    const rootIdxs = env.WEBSITES.map((w, i) => {
      if (w.includeRootDomain) i;
      return -1;
    }).filter((i) => i !== -1);

    if (rootIdxs.length > 1) {
      for (const i of rootIdxs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["WEBSITES", i, "includeRootDomain"],
          message: "Only one website may set includeRootDomain=true",
        });
      }
    }
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
    emailDiscordMappings: env.EMAIL_DISCORD_MAPPINGS,
  }));

export const config = EnvSchema.parse(process.env);
