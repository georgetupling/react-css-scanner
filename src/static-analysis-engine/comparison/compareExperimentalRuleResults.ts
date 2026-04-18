import type { Finding } from "../../runtime/types.js";
import type { ExperimentalRuleResult } from "../pipeline/rule-execution/types.js";
import { compareExperimentalFindings } from "./compareExperimentalFindings.js";
import { summarizeExperimentalComparison } from "./summarizeExperimentalComparison.js";
import { toExperimentalFindings } from "./toExperimentalFindings.js";
import type { ExperimentalRuleComparisonResult } from "./types.js";

export function compareExperimentalRuleResults(input: {
  experimentalRuleResults: ExperimentalRuleResult[];
  baselineFindings: Finding[];
}): ExperimentalRuleComparisonResult {
  const experimentalFindings = toExperimentalFindings(input.experimentalRuleResults);
  const comparison = compareExperimentalFindings({
    experimentalFindings,
    baselineFindings: input.baselineFindings,
  });

  return {
    experimentalFindings,
    comparison,
    summary: summarizeExperimentalComparison(comparison),
  };
}
