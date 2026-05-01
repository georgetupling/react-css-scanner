import { buildAnalysisEvidenceWithCompatibilityIndexes } from "../../pipeline/analysis-evidence/index.js";
import type { ProjectAnalysisBuildInput } from "../../pipeline/project-analysis/index.js";
import type { AnalysisEvidenceStageResult } from "./types.js";

export function runAnalysisEvidenceStage(
  input: ProjectAnalysisBuildInput,
): AnalysisEvidenceStageResult {
  return buildAnalysisEvidenceWithCompatibilityIndexes(input);
}
