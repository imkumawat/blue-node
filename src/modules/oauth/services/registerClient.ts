import { insertClient } from "../infra/clientQueries.js";
import {
  InvalidClientMetadataError,
  InvalidRedirectUriError,
} from "../errors.js";
import type { RegisterClientInput } from "../schemas.js";
import type { OauthClient } from "../../../models/postgres/oauth/oauthClient.js";

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:"]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.hash) return false;
  if (BLOCKED_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);

  return true;
}

export async function registerClient(
  input: RegisterClientInput,
): Promise<OauthClient> {
  const invalid = input.redirect_uris.filter(
    (uri) => !isAllowedRedirectUri(uri),
  );
  if (invalid.length > 0) {
    throw new InvalidRedirectUriError(
      `Rejected redirect_uris: ${invalid.join(", ")}`,
    );
  }

  if (input.token_endpoint_auth_method !== "none") {
    throw new InvalidClientMetadataError(
      "Only public clients are supported (token_endpoint_auth_method must be 'none')",
    );
  }

  return insertClient({
    clientName: input.client_name,
    redirectUris: input.redirect_uris,
    grantTypes: input.grant_types,
    responseTypes: input.response_types,
    tokenEndpointAuthMethod: input.token_endpoint_auth_method,
    clientSecretHash: null,
    scope: input.scope ?? null,
    clientUri: input.client_uri ?? null,
    logoUri: input.logo_uri ?? null,
    softwareId: input.software_id ?? null,
    softwareVersion: input.software_version ?? null,
  });
}
