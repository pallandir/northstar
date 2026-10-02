import type { Check } from "../types.js";
import { a11yChecks } from "./a11y.js";
import { colorChecks } from "./color.js";
import { copyChecks } from "./copy.js";
import { finishChecks } from "./finish.js";
import { layoutChecks } from "./layout.js";
import { libraryChecks } from "./library.js";
import { motionChecks } from "./motion.js";
import { slopChecks } from "./slop.js";
import { typeChecks } from "./type.js";

export const ALL_CHECKS: Check[] = [
  ...slopChecks,
  ...typeChecks,
  ...colorChecks,
  ...motionChecks,
  ...a11yChecks,
  ...libraryChecks,
  ...copyChecks,
  ...finishChecks,
  ...layoutChecks,
];
