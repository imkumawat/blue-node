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
  try {
    return JSON.parse(response.SecretString);
  } catch {
    // Never surface the raw SecretString: a JSON SyntaxError embeds a snippet
    // of the input (the secret material) in its message, which would otherwise
    // leak into the boot error logs.
    throw new Error(`Secret ${secretName} is not valid JSON`);
  }
}
