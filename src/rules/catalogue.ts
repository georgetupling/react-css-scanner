import { missingCssClassRule } from "./rules/missingCssClass.js";
import { cssClassUnreachableRule } from "./rules/cssClassUnreachable.js";
import { compoundSelectorNeverMatchedRule } from "./rules/compoundSelectorNeverMatched.js";
import { dynamicClassReferenceRule } from "./rules/dynamicClassReference.js";
import { missingCssModuleClassRule } from "./rules/missingCssModuleClass.js";
import { selectorOnlyMatchesInUnknownContextsRule } from "./rules/selectorOnlyMatchesInUnknownContexts.js";
import { singleComponentStyleNotColocatedRule } from "./rules/singleComponentStyleNotColocated.js";
import { styleSharedWithoutSharedOwnerRule } from "./rules/styleSharedWithoutSharedOwner.js";
import { styleUsedOutsideOwnerRule } from "./rules/styleUsedOutsideOwner.js";
import { unsupportedSyntaxAffectingAnalysisRule } from "./rules/unsupportedSyntaxAffectingAnalysis.js";
import { unusedCssClassRule } from "./rules/unusedCssClass.js";
import { unusedCssModuleClassRule } from "./rules/unusedCssModuleClass.js";
import { unusedCompoundSelectorBranchRule } from "./rules/unusedCompoundSelectorBranch.js";
import { unsatisfiableSelectorRule } from "./rules/unsatisfiableSelector.js";
import type { RuleDefinition, RuleId, RuleSeverity } from "./types.js";

export const RULE_DEFINITIONS: RuleDefinition[] = [
  missingCssClassRule,
  cssClassUnreachableRule,
  unusedCssClassRule,
  missingCssModuleClassRule,
  unusedCssModuleClassRule,
  unsatisfiableSelectorRule,
  compoundSelectorNeverMatchedRule,
  unusedCompoundSelectorBranchRule,
  selectorOnlyMatchesInUnknownContextsRule,
  singleComponentStyleNotColocatedRule,
  styleUsedOutsideOwnerRule,
  styleSharedWithoutSharedOwnerRule,
  dynamicClassReferenceRule,
  unsupportedSyntaxAffectingAnalysisRule,
];

export const DEFAULT_RULE_SEVERITIES: Record<RuleId, RuleSeverity> = {
  "missing-css-class": "error",
  "css-class-unreachable": "error",
  "unused-css-class": "warn",
  "missing-css-module-class": "error",
  "unused-css-module-class": "warn",
  "unsatisfiable-selector": "warn",
  "compound-selector-never-matched": "warn",
  "unused-compound-selector-branch": "warn",
  "selector-only-matches-in-unknown-contexts": "debug",
  "single-component-style-not-colocated": "off",
  "style-used-outside-owner": "off",
  "style-shared-without-shared-owner": "off",
  "dynamic-class-reference": "debug",
  "unsupported-syntax-affecting-analysis": "debug",
};
