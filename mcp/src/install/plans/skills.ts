export const CORE_SKILL = "northstar";
export const WORKFLOW_SKILLS = [
  "northstar-build",
  "northstar-refine",
  "northstar-finish",
  "northstar-review",
] as const;
export const SKILL_NAMES: readonly string[] = [CORE_SKILL, ...WORKFLOW_SKILLS];
export const SKILLS_DIR = "plugin/skills";
