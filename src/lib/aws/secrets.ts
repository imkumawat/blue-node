import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { secretsClient } from "./client.js";

export async function fetchSecrets(
  secretName: string,
): Promise<Record<string, string>> {
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretName }),
  );
  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} has no SecretString`);
  }
  return JSON.parse(response.SecretString);
}
