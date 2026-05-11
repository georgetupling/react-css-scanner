import { missingCssClassRule } from "./rules/missingCssClass.js";
import { cssClassUnreachableRule } from "./rules/cssClassUnreachable.js";
import { compoundSelectorNeverMatchedRule } from "./rules/compoundSelectorNeverMatched.js";
import { dynamicClassReferenceRule } from "./rules/dynamicClassReference.js";
import { declarationAlwaysShadowedRule } from "./rules/declarationAlwaysShadowed.js";
import { componentStyleOverriddenExternallyRule } from "./rules/componentStyleOverriddenExternally.js";
import { duplicateClassDefinitionRule } from "./rules/duplicateClassDefinition.js";
import { cssModuleImportNotUsedRule } from "./rules/cssModuleImportNotUsed.js";
import { missingCssModuleClassRule } from "./rules/missingCssModuleClass.js";
import { orphanCssFileRule } from "./rules/orphanCssFile.js";
import { selectorDeclarationNeverWinsRule } from "./rules/selectorDeclarationNeverWins.js";
import { selectorOnlyMatchesInUnknownContextsRule } from "./rules/selectorOnlyMatchesInUnknownContexts.js";
import { selectorSpecificityConflictRule } from "./rules/selectorSpecificityConflict.js";
import { samePropertyConflictRule } from "./rules/samePropertyConflict.js";
import { singleComponentStyleNotColocatedRule } from "./rules/singleComponentStyleNotColocated.js";
import { styleSharedWithoutSharedOwnerRule } from "./rules/styleSharedWithoutSharedOwner.js";
import { styleUsedOutsideOwnerRule } from "./rules/styleUsedOutsideOwner.js";
import { unsupportedSyntaxAffectingAnalysisRule } from "./rules/unsupportedSyntaxAffectingAnalysis.js";
import { unusedCssClassRule } from "./rules/unusedCssClass.js";
import { unusedCssModuleClassRule } from "./rules/unusedCssModuleClass.js";
import { unusedCompoundSelectorBranchRule } from "./rules/unusedCompoundSelectorBranch.js";
import { unsatisfiableSelectorRule } from "./rules/unsatisfiableSelector.js";
import type { RuleConfigSeverity } from "../config/index.js";
import type { RuleDefinition, RuleId } from "./types.js";

export const RULE_DEFINITIONS: RuleDefinition[] = [
  missingCssClassRule,
  cssClassUnreachableRule,
  unusedCssClassRule,
  missingCssModuleClassRule,
  unusedCssModuleClassRule,
  cssModuleImportNotUsedRule,
  orphanCssFileRule,
  duplicateClassDefinitionRule,
  declarationAlwaysShadowedRule,
  selectorDeclarationNeverWinsRule,
  samePropertyConflictRule,
  selectorSpecificityConflictRule,
  componentStyleOverriddenExternallyRule,
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

export const DEFAULT_RULE_SEVERITIES: Record<RuleId, RuleConfigSeverity> = {
  "missing-css-class": "error",
  "css-class-unreachable": "error",
  "unused-css-class": "warn",
  "missing-css-module-class": "error",
  "unused-css-module-class": "warn",
  "css-module-import-not-used": "warn",
  "orphan-css-file": "warn",
  "duplicate-class-definition": "info",
  "declaration-always-shadowed": "off",
  "selector-declaration-never-wins": "off",
  "same-property-conflict": "off",
  "selector-specificity-conflict": "off",
  "component-style-overridden-externally": "off",
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
