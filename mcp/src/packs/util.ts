import { MODES } from "@northstar/canon";
import { z } from "zod";

export const modeSchema = z.enum(MODES);

export function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

export function error(value: string) {
  return { ...text(value), isError: true as const };
}
