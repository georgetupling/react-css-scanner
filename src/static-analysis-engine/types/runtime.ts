import type { ProjectAnalysis } from "../pipeline/project-analysis/types.js";

export type StaticAnalysisEngineResult = {
  projectAnalysis: ProjectAnalysis;
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
