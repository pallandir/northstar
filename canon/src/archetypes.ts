import type { Canon } from "./load.js";
import type { Archetype, BlendPart, Seeds } from "./schema.js";

export interface ResolvedStyle {
  primary: Archetype;
  secondary?: Archetype;
  takes: BlendPart[];
  seeds: Seeds;
  fonts: Archetype["fonts"];
}

export function findArchetype(canon: Canon, id: string): Archetype {
  const found = canon.archetypes.archetypes.find((a) => a.id === id);
  if (!found) {
    const known = canon.archetypes.archetypes.map((a) => a.id).join(", ");
    throw new Error(`unknown archetype "${id}", choose one of ${known}`);
  }
  return found;
}

export function resolveStyle(
  canon: Canon,
  primaryId: string,
  secondaryId?: string,
  takes: BlendPart[] = [],
): ResolvedStyle {
  const primary = findArchetype(canon, primaryId);
  if (!secondaryId) {
    if (takes.length) {
      throw new Error("takes was given without a secondary archetype, name the secondary one");
    }
    return { primary, takes: [], seeds: { ...primary.seeds }, fonts: { ...primary.fonts } };
  }
  const secondary = findArchetype(canon, secondaryId);
  if (secondary.id === primary.id) {
    throw new Error("a blend needs two different archetypes, the secondary matches the primary");
  }
  if (!takes.length) {
    throw new Error(
      `a blend must say what the secondary contributes, pass takes with ${canon.archetypes.blend.takes.join(", ")}`,
    );
  }
  const allowed: readonly string[] = canon.archetypes.blend.takes;
  const refused = takes.filter((part) => !allowed.includes(part));
  if (refused.length) {
    throw new Error(
      `${refused.join(", ")} cannot come from a secondary archetype, it may only contribute ${allowed.join(", ")}`,
    );
  }
  const seeds: Seeds = { ...primary.seeds };
  const fonts = { ...primary.fonts };
  if (takes.includes("surface")) seeds.shape = secondary.seeds.shape;
  if (takes.includes("motion")) seeds.feel = secondary.seeds.feel;
  if (takes.includes("type")) Object.assign(fonts, secondary.fonts);
  return { primary, secondary, takes, seeds, fonts };
}
