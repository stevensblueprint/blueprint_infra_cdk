import { z } from "zod";
import * as dotenv from "dotenv";

dotenv.config();

const ConfigSchema = z.object({
  ACCOUNT_ID: z.string().min(1, "ACCOUNT_ID is required"),
  AWS_REGION: z.string().default("us-east-1"),
  SENDER_EMAIL: z.string().email("SENDER_EMAIL must be a valid email"),
  RECIPIENT_EMAILS: z.string().min(1, "RECIPIENT_EMAILS is required"),
  DOMAIN_NAME: z.string().min(1, "DOMAIN_NAME is required"),
  SUBDOMAIN_NAME: z.string().min(1, "SUBDOMAIN_NAME is required"),
  CERTIFICATE_ARN: z.string().min(1, "CERTIFICATE_ARN is required"),
});

export const config = ConfigSchema.parse(process.env);
