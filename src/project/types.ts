import type { Finding } from "../rules/index.js";
import type { ResolvedScannerConfig } from "../config/index.js";
import type { RuleSeverity } from "../rules/index.js";

export type ScanProjectInput = {
  rootDir?: string;
  focusPath?: string;
  sourceFilePaths?: string[];
  cssFilePaths?: string[];
  configPath?: string;
};

export type ScanDiagnosticSeverity = "debug" | "info" | "warning" | "error";

export type ScanDiagnosticPhase = "config" | "discovery" | "loading" | "analysis";

export type ScanDiagnostic = {
  code: string;
  severity: ScanDiagnosticSeverity;
  message: string;
  phase: ScanDiagnosticPhase;
  filePath?: string;
};

export type ProjectFileRecord = {
  filePath: string;
  absolutePath: string;
};

export type ProjectDiscoveryResult = {
  rootDir: string;
  sourceFiles: ProjectFileRecord[];
  cssFiles: ProjectFileRecord[];
  diagnostics: ScanDiagnostic[];
};

export type SeverityCounts = Record<RuleSeverity, number>;
export type DiagnosticSeverityCounts = Record<ScanDiagnosticSeverity, number>;

export type ScanSummary = {
  sourceFileCount: number;
  cssFileCount: number;
  findingCount: number;
  findingsBySeverity: SeverityCounts;
  diagnosticCount: number;
  diagnosticsBySeverity: DiagnosticSeverityCounts;
  classReferenceCount: number;
  classDefinitionCount: number;
  selectorQueryCount: number;
  failed: boolean;
};

export type ScanProjectResult = {
  rootDir: string;
  focusPath?: string;
  config: ResolvedScannerConfig;
  findings: Finding[];
  diagnostics: ScanDiagnostic[];
  summary: ScanSummary;
  failed: boolean;
  files: {
    sourceFiles: ProjectFileRecord[];
    cssFiles: ProjectFileRecord[];
  };
};
