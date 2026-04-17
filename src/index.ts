import path from "node:path";
import type { ScanInput, ScanResult } from "./runtime/types.js";
import { buildScanSummary } from "./runtime/findings.js";
import { runRules } from "./rules/engine.js";
import { loadReactCssScannerConfig } from "./config/load.js";
import { extractProjectFacts } from "./facts/extractProjectFacts.js";
import { normalizePathForMatch } from "./files/pathUtils.js";
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
  const callerCwd = input.cwd ?? process.cwd();
  const cwd = input.targetPath ? path.resolve(callerCwd, input.targetPath) : callerCwd;
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
  const { findings, focusWarning } = filterFindingsForFocus({
    findings: ruleResult.findings,
    rootDir: facts.rootDir,
    cwd,
    targetPath: input.targetPath,
    focusPath: input.focusPath,
  });
  const summary = buildScanSummary({
    sourceFileCount: model.graph.sourceFiles.length,
    cssFileCount: model.graph.cssFiles.length,
    findings,
  });

  return {
    config: loadedConfig.config,
    configSource: loadedConfig.source,
    operationalWarnings: focusWarning
      ? [...loadedConfig.warnings, focusWarning]
      : loadedConfig.warnings,
    findings,
    summary,
  };
}

export const scan = scanReactCss;

function filterFindingsForFocus(input: {
  findings: ScanResult["findings"];
  rootDir: string;
  cwd: string;
  targetPath?: string;
  focusPath?: string;
}): { findings: ScanResult["findings"]; focusWarning?: string } {
  if (!input.focusPath) {
    return {
      findings: input.findings,
    };
  }

  const focusBasePath = input.targetPath
    ? path.resolve(input.cwd ?? process.cwd(), input.targetPath)
    : (input.cwd ?? process.cwd());
  const absoluteFocusPath = path.resolve(focusBasePath, input.focusPath);
  const relativeFocusPath = normalizePathForMatch(path.relative(input.rootDir, absoluteFocusPath));

  if (
    !relativeFocusPath ||
    relativeFocusPath.startsWith("..") ||
    path.isAbsolute(relativeFocusPath)
  ) {
    return {
      findings: [],
      focusWarning: `Focus path is outside the resolved scan root and no findings were emitted: ${absoluteFocusPath}`,
    };
  }

  return {
    findings: input.findings.filter((finding) =>
      findingTouchesFocusPath(finding, relativeFocusPath),
    ),
  };
}

function findingTouchesFocusPath(
  finding: ScanResult["findings"][number],
  focusPath: string,
): boolean {
  const candidatePaths = [
    finding.primaryLocation?.filePath,
    ...finding.relatedLocations.map((location) => location.filePath),
    finding.subject?.sourceFilePath,
    finding.subject?.cssFilePath,
  ];

  return candidatePaths.some((candidatePath) =>
    typeof candidatePath === "string" ? matchesFocusPath(candidatePath, focusPath) : false,
  );
}

function matchesFocusPath(candidatePath: string, focusPath: string): boolean {
  const normalizedCandidate = normalizePathForMatch(candidatePath);
  return normalizedCandidate === focusPath || normalizedCandidate.startsWith(`${focusPath}/`);
}
