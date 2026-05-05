import type { Finding, RuleId } from "../rules/index.js";
import type { ResolvedScannerConfig } from "../config/index.js";
import type { RuleSeverity } from "../rules/index.js";
import type { RuntimeCssLoadingResult } from "../static-analysis-engine/pipeline/runtime-css-loading/index.js";

export type ScanProjectInput = {
  rootDir?: string;
  sourceFilePaths?: string[];
  cssFilePaths?: string[];
  htmlFilePaths?: string[];
  configPath?: string;
  configBaseDir?: string;
  ignore?: Partial<{
    classNames: string[];
    filePaths: string[];
  }>;
  onProgress?: ScanProgressCallback;
  collectPerformance?: boolean;
  includeTraces?: boolean;
  includeDebugRuntimeCss?: boolean;
};

export type ScanProgressStatus = "started" | "completed";

export type ScanProgressEvent = {
  stage: string;
  status: ScanProgressStatus;
  message: string;
  durationMs?: number;
};

export type ScanProgressCallback = (event: ScanProgressEvent) => void;

export type ScanDiagnosticSeverity = "debug" | "info" | "warning" | "error";

export type ScanDiagnosticPhase = "config" | "discovery" | "loading" | "analysis";

export type ScanDiagnostic = {
  code: string;
  severity: ScanDiagnosticSeverity;
  message: string;
  phase: ScanDiagnosticPhase;
  filePath?: string;
  evidence?: string[];
};

export type ProjectFileRecord = {
  filePath: string;
  absolutePath: string;
};

export type SeverityCounts = Record<RuleSeverity, number>;
export type RuleCounts = Record<RuleId, number>;
export type DiagnosticSeverityCounts = Record<ScanDiagnosticSeverity, number>;

export type ScanSummary = {
  sourceFileCount: number;
  cssFileCount: number;
  findingCount: number;
  ignoredFindingCount: number;
  findingsByRule: RuleCounts;
  findingsBySeverity: SeverityCounts;
  diagnosticCount: number;
  diagnosticsBySeverity: DiagnosticSeverityCounts;
  classReferenceCount: number;
  classDefinitionCount: number;
  selectorQueryCount: number;
  failed: boolean;
};

export type ScanPerformanceStage = {
  stage: string;
  message: string;
  durationMs: number;
};

export type ScanPerformance = {
  totalMs: number;
  stages: ScanPerformanceStage[];
};

export type ScanDebugOutput = {
  runtimeCss?: Pick<
    RuntimeCssLoadingResult,
    "bundlerProfiles" | "selectedBundlerProfileId" | "entries" | "chunks"
  >;
};

export type ScanProjectResult = {
  rootDir: string;
  config: ResolvedScannerConfig;
  findings: Finding[];
  diagnostics: ScanDiagnostic[];
  summary: ScanSummary;
  performance?: ScanPerformance;
  debug?: ScanDebugOutput;
  failed: boolean;
  files: {
    sourceFiles: ProjectFileRecord[];
    cssFiles: ProjectFileRecord[];
    htmlFiles: ProjectFileRecord[];
  };
};
