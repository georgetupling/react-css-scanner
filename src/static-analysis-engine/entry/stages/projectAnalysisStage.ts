import type { ExternalCssSummary } from "../../pipeline/external-css/index.js";
import type { AnalysisEvidence } from "../../pipeline/analysis-evidence/index.js";
import { buildProjectAnalysisFromEvidence } from "../../pipeline/project-analysis/index.js";
import type { SelectorReachabilityResult } from "../../pipeline/selector-reachability/index.js";
import type { AnalysisEvidenceStageResult, ProjectAnalysisStageResult } from "./types.js";

export function runProjectAnalysisStage(input: {
  analysisEvidence: AnalysisEvidence;
  projectAnalysisIndexes?: AnalysisEvidenceStageResult["projectAnalysisIndexes"];
  externalCssSummary: ExternalCssSummary;
  selectorReachability?: SelectorReachabilityResult;
}): ProjectAnalysisStageResult {
  return {
    projectAnalysis: buildProjectAnalysisFromEvidence(
      input,
      input.analysisEvidence,
      input.projectAnalysisIndexes,
    ),
  };
}
