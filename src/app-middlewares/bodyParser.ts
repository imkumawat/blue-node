import express from "express";
import type { IncomingMessage, ServerResponse } from "http";
import { StatusCodes } from "http-status-codes";
import { HttpError } from "../shared/errors/HttpError.js";
import { ERROR_MESSAGES } from "../shared/constants/errors.js";
import { getEnvConfig } from "../config/env.js";

export function createBodyParser() {
  const {
    body: { sizeLimit },
    routes: { webhookPrefix },
  } = getEnvConfig();

  return express.json({
    limit: sizeLimit,
    strict: true,
    type: "application/json",
    verify: (req: IncomingMessage, _res: ServerResponse, buf: Buffer) => {
      if (req.method === "GET" && buf.length > 0) {
        throw new HttpError(
          "GET_BODY_NOT_ALLOWED",
          StatusCodes.BAD_REQUEST,
          ERROR_MESSAGES.GET_BODY_NOT_ALLOWED,
        );
      }

      if (req.url?.startsWith(webhookPrefix)) {
        req.rawBody = buf;
      }
    },
  });
}
