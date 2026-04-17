import type { ScanInput, ScanResult } from "./runtime/types.js";
import { buildScanSummary } from "./runtime/findings.js";
import { runRules } from "./rules/engine.js";
import { loadReactCssScannerConfig } from "./config/load.js";
import { extractProjectFacts } from "./facts/extractProjectFacts.js";
import { buildProjectModel } from "./model/buildProjectModel.js";

export {
  ReactCssScannerConfigError,
  loadReactCssScannerConfig,
  normalizeReactCssScannerConfig,
} from "./config/load.js";
export { extractProjectFacts } from "./facts/extractProjectFacts.js";
export { buildProjectModel } from "./model/buildProjectModel.js";
export { buildScanSummary, createFinding, sortFindings } from "./runtime/findings.js";
export { runRules } from "./rules/engine.js";
export { RULE_DEFINITIONS } from "./rules/catalog.js";
export type {
  ConfidenceLevel,
  ExternalCssMode,
  OwnershipNamingConvention,
  RawReactCssScannerConfig,
  ResolvedReactCssScannerConfig,
  RuleConfigValue,
  RuleSeverity,
} from "./config/types.js";
export type {
  ConfigSourceKind,
  LoadedReactCssScannerConfig,
  LoadReactCssScannerConfigOptions,
  ResolvedConfigSource,
} from "./config/load.js";
export { DEFAULT_CONFIG } from "./config/types.js";
export { discoverProjectFiles } from "./files/discoverFiles.js";
export type {
  ClassReferenceFact,
  CssClassDefinitionFact,
  CssFileFact,
  CssImportFact,
  CssModuleImportFact,
  ProjectFactExtractionResult,
  SourceFileFact,
  SourceImportFact,
} from "./facts/types.js";
export type { DiscoveredProjectFile, FileDiscoveryResult, ProjectFileKind } from "./files/types.js";
export type {
  BuildProjectModelInput,
  CssFileNode,
  CssOwnership,
  CssResourceCategory,
  ExternalCssResourceNode,
  ProjectGraph,
  ProjectGraphEdge,
  ProjectGraphEdgeType,
  ProjectIndexes,
  ProjectModel,
  ReachabilityInfo,
  SourceFileNode,
} from "./model/types.js";
export type {
  Finding,
  FindingConfidence,
  FindingLocation,
  FindingSeverity,
  FindingSubject,
  ScanInput,
  ScanResult,
  ScanSummary,
} from "./runtime/types.js";
export type {
  CreateFindingInput,
  RuleContext,
  RuleDefinition,
  RuleEngineResult,
  RuleFamily,
} from "./rules/types.js";

export async function scanReactCss(input: ScanInput = {}): Promise<ScanResult> {
  const cwd = input.targetPath ?? process.cwd();
  const loadedConfig = await loadReactCssScannerConfig({
    cwd,
    configPath: input.configPath,
    config: input.config,
  });
  const facts = await extractProjectFacts(loadedConfig.config, cwd);
  const model = buildProjectModel({
    config: loadedConfig.config,
    facts,
  });
  const ruleResult = runRules(model);
  const summary = buildScanSummary({
    sourceFileCount: model.graph.sourceFiles.length,
    cssFileCount: model.graph.cssFiles.length,
    findings: ruleResult.findings,
  });

  return {
    config: loadedConfig.config,
    configSource: loadedConfig.source,
    operationalWarnings: loadedConfig.warnings,
    findings: ruleResult.findings,
    summary,
  };
}

export const scan = scanReactCss;
