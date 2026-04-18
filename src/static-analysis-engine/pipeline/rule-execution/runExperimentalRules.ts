import type { ExperimentalCssFileAnalysis } from "../css-analysis/types.js";
import type { SelectorQueryResult } from "../selector-analysis/types.js";
import type { ExperimentalRuleResult } from "./types.js";
import {
  runContextualSelectorBranchNeverSatisfiedRule,
  runDuplicateCssClassDefinitionRule,
  runEmptyCssRule,
  runSelectorAnalysisUnsupportedRule,
  runSelectorNeverSatisfiedRule,
  runSelectorPossiblySatisfiedRule,
  runRedundantCssDeclarationBlockRule,
  runUnusedCompoundSelectorBranchRule,
} from "./rules/index.js";

export function runExperimentalRules(input: {
  cssFiles: ExperimentalCssFileAnalysis[];
  selectorQueryResults: SelectorQueryResult[];
}): ExperimentalRuleResult[] {
  const selectorRuleResults = input.selectorQueryResults.flatMap((selectorQueryResult) => {
    const ruleResults = [
      runSelectorNeverSatisfiedRule(selectorQueryResult),
      runSelectorPossiblySatisfiedRule(selectorQueryResult),
      runSelectorAnalysisUnsupportedRule(selectorQueryResult),
      runUnusedCompoundSelectorBranchRule(selectorQueryResult),
      runContextualSelectorBranchNeverSatisfiedRule(selectorQueryResult),
    ];
    return ruleResults.filter((ruleResult): ruleResult is ExperimentalRuleResult =>
      Boolean(ruleResult),
    );
  });
  const cssRuleResults = input.cssFiles.flatMap((cssFile) => [
    ...runEmptyCssRule(cssFile),
    ...runRedundantCssDeclarationBlockRule(cssFile),
  ]);

  return [
    ...selectorRuleResults,
    ...cssRuleResults,
    ...runDuplicateCssClassDefinitionRule(input.cssFiles),
  ];
}
