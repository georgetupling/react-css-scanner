import type { ExperimentalRuleExecutionInput, ExperimentalRuleResult } from "./types.js";
import {
  runContextualSelectorBranchNeverSatisfiedRule,
  runDuplicateCssClassDefinitionRule,
  runEmptyCssRule,
  runMissingExternalCssClassRule,
  runSelectorAnalysisUnsupportedRule,
  runSelectorNeverSatisfiedRule,
  runSelectorPossiblySatisfiedRule,
  runRedundantCssDeclarationBlockRule,
  runUnusedCompoundSelectorBranchRule,
} from "./rules/index.js";

export function runExperimentalRules(
  input: ExperimentalRuleExecutionInput,
): ExperimentalRuleResult[] {
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
    ...runMissingExternalCssClassRule({
      moduleGraph: input.moduleGraph,
      classExpressions: input.classExpressions,
      cssFiles: input.cssFiles,
      externalCssSummary: input.externalCssSummary,
      reachabilitySummary: input.reachabilitySummary,
    }),
  ];
}
