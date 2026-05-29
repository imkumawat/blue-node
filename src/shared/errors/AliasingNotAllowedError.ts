import { HttpError } from "./HttpError.js";

export class AliasingNotAllowedError extends HttpError {
  constructor(fieldName: string) {
    super(
      "ALIASING_NOT_ALLOWED",
      400,
      `Aliasing not allowed on '${fieldName}' mutation`,
      { fieldName },
    );
  }
}
