import type { RawReactCssScannerConfig, ResolvedReactCssScannerConfig } from "../config/types.js";
import type { ResolvedConfigSource } from "../config/load.js";

export type FindingSeverity = "info" | "warning" | "error";

export type FindingConfidence = "low" | "medium" | "high";

export type FindingLocation = {
  filePath: string;
  line?: number;
  column?: number;
  context?: string;
};

export type FindingSubject = {
  className?: string;
  cssFilePath?: string;
  sourceFilePath?: string;
};

export type Finding = {
  ruleId: string;
  family: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  message: string;
  primaryLocation?: FindingLocation;
  relatedLocations: FindingLocation[];
  subject?: FindingSubject;
  metadata: Record<string, unknown>;
};

export type ScanInput = {
  targetPath?: string;
  configPath?: string;
  config?: RawReactCssScannerConfig;
};

export type ScanSummary = {
  fileCount: number;
  sourceFileCount: number;
  cssFileCount: number;
  findingCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
};

export type ScanResult = {
  config: ResolvedReactCssScannerConfig;
  configSource?: ResolvedConfigSource;
  operationalWarnings?: string[];
  findings: Finding[];
  summary: ScanSummary;
};
