import express, { Router } from "express";

import { registerClientInput } from "../schemas.js";
import { validate } from "../../../shared/middlewares/validate.js";
import { getEnvConfig } from "../../../config/env.js";
import {
  getAuthServerMetadata,
  getAuthorize,
  getJwks,
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
  const { jwt, oauth } = getEnvConfig();
  const router = Router();

  const form = express.urlencoded({ extended: false });

  router.get(oauth.metadataPath, getAuthServerMetadata);

  router.get(jwt.jwksPath, getJwks);

  router.post(oauth.registerPath, validate(registerClientInput), postRegister);

  router.get(oauth.authorizePath, getAuthorize);
  router.post(oauth.authorizePath, form, postAuthorize);

  router.post(oauth.tokenPath, form, postToken);

  return router;
}
