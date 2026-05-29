import type { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import { verifyApiKey } from "../../modules/apiKeys/services/verifyApiKey.js";
import { HttpError } from "../errors/HttpError.js";
import { ERROR_MESSAGES } from "../constants/errors.js";

export default async function authenticateApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("ApiKey ")) {
      return next(
        new HttpError(
          "INVALID_API_KEY",
          StatusCodes.UNAUTHORIZED,
          ERROR_MESSAGES.INVALID_API_KEY,
        ),
      );
    }

    const rawKey = authHeader.slice(7);
    const apiClient = await verifyApiKey(rawKey);

    if (!apiClient) {
      return next(
        new HttpError(
          "INVALID_API_KEY",
          StatusCodes.UNAUTHORIZED,
          ERROR_MESSAGES.INVALID_API_KEY,
        ),
      );
    }

    req.apiClient = apiClient;
    next();
  } catch (err) {
    next(err);
  }
}
