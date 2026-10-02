export type FailureKind = "offline" | "mismatch" | "choose" | "api" | "input";

export class UserError extends Error {
  constructor(
    message: string,
    readonly fix: string,
    readonly kind: FailureKind = "api",
  ) {
    super(message);
    this.name = "UserError";
  }
}

export interface Failure {
  ok: false;
  error: string;
  fix?: string;
  kind?: FailureKind;
}

export function toFailure(err: unknown): Failure {
  if (err instanceof UserError)
    return { ok: false, error: err.message, fix: err.fix, kind: err.kind };
  console.error("[northstar]", err);
  return {
    ok: false,
    error: "Something went wrong inside Northstar.",
    fix: "Reload the page and try again. Details are in the extension console.",
  };
}
