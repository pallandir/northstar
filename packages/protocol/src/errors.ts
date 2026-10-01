export interface ApiError {
  error: string;
  fix: string;
}

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 426 | 500;

export function apiError(error: string, fix: string): ApiError {
  return { error, fix };
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ApiError).error === "string" &&
    typeof (value as ApiError).fix === "string"
  );
}
