import { randomBytes, timingSafeEqual } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function northstarHome(): string {
  return process.env.NORTHSTAR_HOME ?? homedir();
}

export function tokenPath(home: string): string {
  return join(home, ".northstar", "token");
}

function readToken(path: string): string {
  const value = readFileSync(path, "utf8").trim();
  if (!TOKEN_PATTERN.test(value)) {
    throw new Error(
      `The Northstar token file ${path} is not a valid token. Delete it and restart your agent to create a new one.`,
    );
  }
  return value;
}

export function loadOrCreateToken(home: string): string {
  const path = tokenPath(home);
  try {
    return readToken(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${token}\n`, { mode: 0o600 });
  try {
    linkSync(staging, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return readToken(path);
  } finally {
    unlinkSync(staging);
  }
  return token;
}

export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
