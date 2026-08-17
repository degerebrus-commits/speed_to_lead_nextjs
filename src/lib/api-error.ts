/**
 * Error codes returned to callers. Stable strings - the website form and any
 * future integration branch on these, not on the human-readable message.
 */
export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL_ERROR";

export interface FieldIssue {
  field: string;
  message: string;
}

/**
 * Builds the error envelope required by STANDARDS.md 9. Stack traces and
 * internal detail never cross this boundary - callers get a code they can act
 * on and nothing about how the server is built.
 */
export function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  fields?: FieldIssue[],
): Response {
  return Response.json(
    { error: { code, message, ...(fields && fields.length > 0 ? { fields } : {}) } },
    { status },
  );
}
