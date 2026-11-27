import type { Readiness } from "@northstar/protocol";

interface AssistantState {
  connected: boolean;
  working: boolean;
  listening: boolean;
}

export function notListeningNotice(state: Pick<AssistantState, "connected" | "working">): {
  reason: string;
  fix: string;
} {
  if (state.connected && state.working) {
    return {
      reason: "Your AI assistant is working on your comments.",
      fix: "Your new comments are saved. When it finishes, click Copy the line and paste it into the assistant.",
    };
  }
  return state.connected
    ? {
        reason: "Your AI assistant is open in this project but is not running northstar listen.",
        fix: "Click Copy the line and paste it into your AI assistant, or ask it to run northstar listen in the background.",
      }
    : {
        reason: "No AI assistant is connected to this project.",
        fix: "Open your AI assistant in this project. If it is already open, run northstar doctor.",
      };
}

export function readinessFor(state: AssistantState): Readiness {
  if (state.listening) return { ready: true };
  return {
    ready: false,
    working: state.connected && state.working,
    ...notListeningNotice(state),
  };
}
