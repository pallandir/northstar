import type { Readiness, SessionInfo } from "@northstar/protocol";

type Route =
  | { kind: "target"; session: SessionInfo }
  | { kind: "none" }
  | { kind: "pick"; candidates: SessionInfo[] }
  | { kind: "missing" };

interface RouteRequest {
  root: string;
  sessionId?: string;
  preferredAgent: string | null;
}

export function routeSend(all: readonly SessionInfo[], request: RouteRequest): Route {
  const candidates = all.filter((s) => s.root === request.root && s.kind === "interactive");
  if (request.sessionId !== undefined) {
    const chosen = candidates.find((s) => s.id === request.sessionId);
    return chosen ? { kind: "target", session: chosen } : { kind: "missing" };
  }
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "target", session: candidates[0] as SessionInfo };
  const preferred = candidates.filter((s) => s.agent === request.preferredAgent);
  if (preferred.length === 1) return { kind: "target", session: preferred[0] as SessionInfo };
  return { kind: "pick", candidates };
}

export const NO_SESSION_FIX =
  "Install an AI assistant such as Claude Code or Codex, or open one in a new terminal tab in this project.";

export function readinessFor(
  all: readonly SessionInfo[],
  request: Omit<RouteRequest, "sessionId">,
): Readiness {
  const sessions = all.filter((s) => s.root === request.root && s.kind === "interactive");
  const route = routeSend(all, request);
  if (route.kind === "target") {
    return { ready: true, sessions, target: route.session.id, needsPick: false };
  }
  if (route.kind === "pick") {
    return {
      ready: true,
      sessions,
      target: null,
      needsPick: true,
      reason: "More than one agent session is running in this project.",
      fix: "Pick the session to send to.",
    };
  }
  return {
    ready: false,
    sessions,
    target: null,
    needsPick: false,
    reason: "No agent session is running in this project.",
    fix: NO_SESSION_FIX,
  };
}
