/** Domain error mapped to RFC 9457 problem+json by the API. */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new AppError(400, "bad_request", m, d);
export const unauthorized = (m = "Authentication required") => new AppError(401, "unauthorized", m);
export const forbidden = (m = "Missing permission") => new AppError(403, "forbidden", m);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const conflict = (m: string) => new AppError(409, "conflict", m);
