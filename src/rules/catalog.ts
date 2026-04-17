import type { RuleDefinition } from "./types.js";
import { TIER_1_RULE_DEFINITIONS } from "./tier1.js";
import { TIER_2_RULE_DEFINITIONS } from "./tier2.js";

export const RULE_DEFINITIONS: RuleDefinition[] = [
  ...TIER_1_RULE_DEFINITIONS,
  ...TIER_2_RULE_DEFINITIONS,
];
