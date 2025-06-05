import { join } from "path";
import { readFileSync } from "fs";
import { parse } from "yaml";

const configFilePath = join(__dirname, "config.yaml");
const readConfigFile = readFileSync(configFilePath, "utf8");
const config = parse(readConfigFile);

function getEnvironmentConfig() {
  return {
    senderEmail: config.senderEmail,
    recipientEmails: config.recipientEmails,
  };
}

export const props = getEnvironmentConfig();
