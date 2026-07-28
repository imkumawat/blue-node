import express, { Router } from "express";

import { getEnvConfig } from "../../../config/env.js";
import {
  getAuthServerMetadata,
  getAuthorize,
  postAuthorize,
  postRegister,
  postToken,
} from "./handlers.js";

/**
 * OAuth 2.1 authorization server endpoints.
 *
 * Mounted at the root, not under /api/v1: these are protocol endpoints whose
 * paths are published in the metadata document, the same reasoning that puts
 * /health and the .well-known documents there. Versioning them would make the
 * discovery document lie the moment a v2 appeared.
 */
export function createOauthRouter(): Router {
  const { oauth } = getEnvConfig();
  const router = Router();

  // The app-wide body parser is application/json ONLY. An HTML form submission
  // and an OAuth token request are both application/x-www-form-urlencoded, so
  // they need this — scoped to these two routes rather than added globally,
  // which would change how every other endpoint parses a body.
  const form = express.urlencoded({ extended: false });

  router.get(oauth.metadataPath, getAuthServerMetadata);

  router.get(oauth.authorizePath, getAuthorize);
  router.post(oauth.authorizePath, form, postAuthorize);

  router.post(oauth.tokenPath, form, postToken);

  // Dynamic client registration is JSON — the global parser already handles it.
  router.post(oauth.registerPath, postRegister);

  return router;
}
