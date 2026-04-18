import type { RuleDefinition } from "../types.js";
import { cssClassMissingInSomeContextsRule } from "./cssClassMissingInSomeContexts.js";
import { missingCssClassRule } from "./missingCssClass.js";
import { unreachableCssRule } from "./unreachableCss.js";
import { unusedCssClassRule } from "./unusedCssClass.js";

export const definitionAndUsageIntegrityRules: RuleDefinition[] = [
  cssClassMissingInSomeContextsRule,
  missingCssClassRule,
  unreachableCssRule,
  unusedCssClassRule,
];
