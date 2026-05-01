import type { AnalysisEvidence } from "../pipeline/analysis-evidence/index.js";
import type { ProjectAnalysis } from "../pipeline/project-analysis/types.js";
import type { SymbolicEvaluationResult } from "../pipeline/symbolic-evaluation/index.js";

export type StaticAnalysisEngineResult = {
  analysisEvidence: AnalysisEvidence;
  projectAnalysis: ProjectAnalysis;
  symbolicEvaluation?: SymbolicEvaluationResult;
};

export type AnalysisProgressStatus = "started" | "completed";

export type AnalysisProgressEvent = {
  stage: string;
  status: AnalysisProgressStatus;
  message: string;
  durationMs?: number;
};

export type AnalysisProgressCallback = (event: AnalysisProgressEvent) => void;

export type AnalysisRuntimeOptions = {
  includeTraces?: boolean;
};
