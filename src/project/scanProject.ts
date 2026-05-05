import { runRules } from "../rules/index.js";
import { severityMeetsThreshold } from "../rules/severity.js";
import { runAnalysisPipeline } from "../static-analysis-engine/index.js";
import { applyIgnoreFilter, mergeIgnoreConfig } from "./ignoreFilter.js";
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

export async function scanProject(input: ScanProjectInput = {}): Promise<ScanProjectResult> {
  const totalStartedAt = performance.now();
  const performanceStages: ScanPerformanceStage[] = [];
  const progress = createScanProgressReporter({
    onProgress: input.onProgress,
    performanceStages: input.collectPerformance ? performanceStages : undefined,
  });
  const engineProjectResult = await runAnalysisPipeline({
    scanInput: input,
    includeTraces: input.includeTraces ?? true,
    onProgress: (event) => progress(event.stage, event.status, event.message, event.durationMs),
  });
  const { snapshot, analysisEvidence } = engineProjectResult;
  const includeRuntimeCssDebug =
    input.includeDebugRuntimeCss || snapshot.config.reporting.debugRuntimeCss;
  const runtimeCssDiagnostics = analysisEvidence.runtimeCssLoading.diagnostics.map(
    (diagnostic): ScanDiagnostic => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      phase: "analysis",
      message: diagnostic.message,
      ...(diagnostic.filePath ? { filePath: diagnostic.filePath } : {}),
      ...(diagnostic.evidence.length > 0 ? { evidence: diagnostic.evidence } : {}),
    }),
  );
  const diagnostics = [
    ...snapshot.diagnostics,
    ...(includeRuntimeCssDebug ? runtimeCssDiagnostics : []),
  ].sort(compareDiagnostics);
  const ruleResult = await runScanStage(progress, "run-rules", "Running rules", () =>
    runRules({
      analysisEvidence,
      externalCssPackageImports: snapshot.edges.filter(
        (edge) => edge.kind === "package-css-import",
      ),
      config: snapshot.config,
      includeTraces: input.includeTraces ?? true,
    }),
  );
  const failed =
    diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    ruleResult.findings.some((finding) =>
      severityMeetsThreshold(finding.severity, snapshot.config.failOnSeverity),
    );
  const summary = buildScanSummary({
    sourceFileCount: snapshot.discoveredFiles.sourceFiles.length,
    cssFileCount: snapshot.discoveredFiles.cssFiles.length,
    findings: ruleResult.findings,
    diagnostics,
    classReferenceCount: analysisEvidence.projectEvidence.meta.classReferenceCount,
    classDefinitionCount: analysisEvidence.projectEvidence.meta.classDefinitionCount,
    selectorQueryCount: analysisEvidence.projectEvidence.entities.selectorQueries.length,
    failed,
  });

  const unignoredResult: ScanProjectResult = {
    rootDir: snapshot.rootDir,
    config: snapshot.config,
    findings: ruleResult.findings,
    diagnostics,
    summary,
    ...(input.collectPerformance
      ? {
          performance: buildScanPerformance({
            totalMs: performance.now() - totalStartedAt,
            stages: performanceStages,
          }),
        }
      : {}),
    ...(includeRuntimeCssDebug
      ? {
          debug: {
            runtimeCss: {
              bundlerProfiles: analysisEvidence.runtimeCssLoading.bundlerProfiles,
              selectedBundlerProfileId: analysisEvidence.runtimeCssLoading.selectedBundlerProfileId,
              entries: analysisEvidence.runtimeCssLoading.entries,
              chunks: analysisEvidence.runtimeCssLoading.chunks,
            },
          },
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

function compareDiagnostics(left: ScanDiagnostic, right: ScanDiagnostic): number {
  return (
    diagnosticSeverityRank(left.severity) - diagnosticSeverityRank(right.severity) ||
    left.phase.localeCompare(right.phase) ||
    (left.filePath ?? "").localeCompare(right.filePath ?? "") ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}

function diagnosticSeverityRank(severity: ScanDiagnostic["severity"]): number {
  return {
    error: 0,
    warning: 1,
    info: 2,
    debug: 3,
  }[severity];
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
