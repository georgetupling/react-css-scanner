import { runRules } from "../rules/index.js";
import { severityMeetsThreshold } from "../rules/severity.js";
import { analyzeProjectSourceTexts } from "../static-analysis-engine/index.js";
import { applyIgnoreFilter, mergeIgnoreConfig } from "./ignoreFilter.js";
import { resolveRootDir } from "./pathUtils.js";
import { countFindingsByRule, countFindingsBySeverity } from "./summaryCounts.js";
import type {
  ScanDiagnostic,
  ScanPerformance,
  ScanPerformanceStage,
  ScanProjectInput,
  ScanProjectResult,
  ScanProgressCallback,
  ScanSummary,
} from "./types.js";
import { buildProjectSnapshot } from "../static-analysis-engine/pipeline/workspace-discovery/index.js";
import { runFactGraphStage } from "../static-analysis-engine/entry/stages/factGraphStage.js";
import { runLanguageFrontendsStage } from "../static-analysis-engine/entry/stages/languageFrontendsStage.js";

export async function scanProject(input: ScanProjectInput = {}): Promise<ScanProjectResult> {
  const totalStartedAt = performance.now();
  const performanceStages: ScanPerformanceStage[] = [];
  const rootDir = resolveRootDir(input.rootDir);
  const progress = createScanProgressReporter({
    onProgress: input.onProgress,
    performanceStages: input.collectPerformance ? performanceStages : undefined,
  });
  const snapshot = await buildProjectSnapshot({
    scanInput: input,
    rootDir,
    runStage: (stage, message, run) => runScanStage(progress, stage, message, run),
  });
  const languageFrontends = runLanguageFrontendsStage({ snapshot });
  const factGraph = runFactGraphStage({
    snapshot,
    frontends: languageFrontends,
    includeTraces: input.includeTraces ?? true,
  });

  const engineResult = analyzeProjectSourceTexts({
    sourceFiles: languageFrontends.source.files.map((file) => ({
      filePath: file.filePath,
      sourceText: file.sourceText,
    })),
    projectRoot: snapshot.rootDir,
    source: languageFrontends.source,
    css: languageFrontends.css,
    stylesheets: languageFrontends.css.files.map((file) => ({
      filePath: file.filePath,
      cssKind: file.cssKind,
      origin: file.origin,
    })),
    boundaries: snapshot.boundaries,
    resourceEdges: snapshot.edges,
    cssModules: snapshot.config.cssModules,
    externalCss: {
      fetchRemote: snapshot.externalCss.fetchRemote,
      globalProviders: snapshot.externalCss.globalProviders,
    },
    factGraph,
    includeTraces: input.includeTraces ?? true,
    onProgress: (event) => progress(event.stage, event.status, event.message, event.durationMs),
  });
  const ruleResult = await runScanStage(progress, "run-rules", "Running rules", () =>
    runRules({
      analysis: engineResult.projectAnalysis,
      analysisEvidence: engineResult.analysisEvidence,
      config: snapshot.config,
      includeTraces: input.includeTraces ?? true,
    }),
  );
  const failed =
    snapshot.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    ruleResult.findings.some((finding) =>
      severityMeetsThreshold(finding.severity, snapshot.config.failOnSeverity),
    );
  const summary = buildScanSummary({
    sourceFileCount: snapshot.discoveredFiles.sourceFiles.length,
    cssFileCount: snapshot.discoveredFiles.cssFiles.length,
    findings: ruleResult.findings,
    diagnostics: snapshot.diagnostics,
    classReferenceCount: engineResult.projectAnalysis.entities.classReferences.length,
    classDefinitionCount: engineResult.projectAnalysis.entities.classDefinitions.length,
    selectorQueryCount: engineResult.projectAnalysis.entities.selectorQueries.length,
    failed,
  });

  const unignoredResult: ScanProjectResult = {
    rootDir: snapshot.rootDir,
    config: snapshot.config,
    findings: ruleResult.findings,
    diagnostics: snapshot.diagnostics,
    summary,
    ...(input.collectPerformance
      ? {
          performance: buildScanPerformance({
            totalMs: performance.now() - totalStartedAt,
            stages: performanceStages,
          }),
        }
      : {}),
    failed,
    files: {
      sourceFiles: snapshot.discoveredFiles.sourceFiles,
      cssFiles: snapshot.discoveredFiles.cssFiles,
      htmlFiles: snapshot.discoveredFiles.htmlFiles,
    },
  };

  return applyIgnoreFilter(
    unignoredResult,
    mergeIgnoreConfig({
      config: snapshot.config.ignore,
      overrides: input.ignore,
    }),
  );
}

function createScanProgressReporter(input: {
  onProgress?: ScanProgressCallback;
  performanceStages?: ScanPerformanceStage[];
}) {
  return (
    stage: string,
    status: "started" | "completed",
    message: string,
    durationMs?: number,
  ): void => {
    if (status === "completed" && durationMs !== undefined) {
      input.performanceStages?.push({
        stage,
        message,
        durationMs: roundDuration(durationMs),
      });
    }

    input.onProgress?.({
      stage,
      status,
      message,
      ...(durationMs === undefined ? {} : { durationMs: roundDuration(durationMs) }),
    });
  };
}

async function runScanStage<T>(
  progress: ReturnType<typeof createScanProgressReporter>,
  stage: string,
  message: string,
  run: () => T | Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  progress(stage, "started", message);
  const result = await run();
  progress(stage, "completed", message, performance.now() - startedAt);
  return result;
}

function buildScanPerformance(input: {
  totalMs: number;
  stages: ScanPerformanceStage[];
}): ScanPerformance {
  return {
    totalMs: roundDuration(input.totalMs),
    stages: input.stages,
  };
}

function roundDuration(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

function buildScanSummary(input: {
  sourceFileCount: number;
  cssFileCount: number;
  findings: ScanProjectResult["findings"];
  diagnostics: ScanDiagnostic[];
  classReferenceCount: number;
  classDefinitionCount: number;
  selectorQueryCount: number;
  failed: boolean;
}): ScanSummary {
  return {
    sourceFileCount: input.sourceFileCount,
    cssFileCount: input.cssFileCount,
    findingCount: input.findings.length,
    ignoredFindingCount: 0,
    findingsByRule: countFindingsByRule(input.findings),
    findingsBySeverity: countFindingsBySeverity(input.findings),
    diagnosticCount: input.diagnostics.length,
    diagnosticsBySeverity: {
      debug: countDiagnosticsBySeverity(input.diagnostics, "debug"),
      info: countDiagnosticsBySeverity(input.diagnostics, "info"),
      warning: countDiagnosticsBySeverity(input.diagnostics, "warning"),
      error: countDiagnosticsBySeverity(input.diagnostics, "error"),
    },
    classReferenceCount: input.classReferenceCount,
    classDefinitionCount: input.classDefinitionCount,
    selectorQueryCount: input.selectorQueryCount,
    failed: input.failed,
  };
}

function countDiagnosticsBySeverity(
  diagnostics: ScanDiagnostic[],
  severity: keyof ScanSummary["diagnosticsBySeverity"],
): number {
  return diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
}
