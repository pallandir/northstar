import type { RuleContext } from "../context.js";
import type { RawFinding } from "../finding.js";
import { focusVisible, semantics, targetSize } from "./access.js";
import { accents, contrast, greyOnColour } from "./color.js";
import { primaryActions } from "./hierarchy.js";
import { alignment, cardGrid, centred, nestedCards, overflow } from "./layout.js";
import { genericHero, gradients, iconSquares } from "./slop.js";
import { headingOrder, lineLength, smallText, typeScale } from "./type.js";

export type PageRule = (ctx: RuleContext) => RawFinding[];

export const PAGE_RULES: readonly PageRule[] = [
  primaryActions,
  overflow,
  nestedCards,
  cardGrid,
  alignment,
  centred,
  typeScale,
  lineLength,
  headingOrder,
  smallText,
  contrast,
  greyOnColour,
  accents,
  focusVisible,
  targetSize,
  semantics,
  genericHero,
  iconSquares,
  gradients,
];
