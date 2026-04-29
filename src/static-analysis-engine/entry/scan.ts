import type { SelectorSourceInput } from "../pipeline/selector-analysis/index.js";
import type { ExternalCssAnalysisInput } from "../pipeline/external-css/index.js";
import type {
  CssModuleLocalsConvention,
  ProjectAnalysisStylesheetInput,
} from "../pipeline/project-analysis/index.js";
import { collectWorkspacePackageBoundaries } from "../pipeline/workspace-discovery/boundaries/collectWorkspacePackageBoundaries.js";
import type {
  ProjectBoundary,
  ProjectResourceEdge,
} from "../pipeline/workspace-discovery/index.js";
import type { AnalysisProgressCallback, StaticAnalysisEngineResult } from "../types/runtime.js";
import { runCssAnalysisStage } from "./stages/cssAnalysisStage.js";
import { runExternalCssStage } from "./stages/externalCssStage.js";
import { runModuleFactsStage } from "./stages/moduleFactsStage.js";
import { runParseStage } from "./stages/parseStage.js";
import { runProjectAnalysisStage } from "./stages/projectAnalysisStage.js";
import { runReachabilityStage } from "./stages/reachabilityStage.js";
import { runRenderModelStage } from "./stages/renderModelStage.js";
import { runRuntimeDomStage } from "./stages/runtimeDomStage.js";
import { runSelectorAnalysisStage } from "./stages/selectorAnalysisStage.js";
import { runSymbolResolutionStage } from "./stages/symbolResolutionStage.js";

export function analyzeSourceText(input: {
  filePath: string;
  sourceText: string;
  selectorQueries?: string[];
  selectorCssSources?: SelectorSourceInput[];
  stylesheets?: ProjectAnalysisStylesheetInput[];
  boundaries?: ProjectBoundary[];
  resourceEdges?: ProjectResourceEdge[];
  externalCss?: ExternalCssAnalysisInput;
  cssModules?: {
    localsConvention?: CssModuleLocalsConvention;
  };
  onProgress?: AnalysisProgressCallback;
  includeTraces?: boolean;
}): StaticAnalysisEngineResult {
  return analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: input.filePath,
        sourceText: input.sourceText,
      },
    ],
    selectorQueries: input.selectorQueries,
    selectorCssSources: input.selectorCssSources,
    stylesheets: input.stylesheets,
    boundaries: input.boundaries,
    resourceEdges: input.resourceEdges,
    externalCss: input.externalCss,
    cssModules: input.cssModules,
    onProgress: input.onProgress,
    includeTraces: input.includeTraces,
  });
}

export function analyzeProjectSourceTexts(input: {
  sourceFiles: Array<{
    filePath: string;
    sourceText: string;
  }>;
  projectRoot?: string;
  selectorQueries?: string[];
  selectorCssSources?: SelectorSourceInput[];
  stylesheets?: ProjectAnalysisStylesheetInput[];
  boundaries?: ProjectBoundary[];
  resourceEdges?: ProjectResourceEdge[];
  externalCss?: ExternalCssAnalysisInput;
  cssModules?: {
    localsConvention?: CssModuleLocalsConvention;
  };
  onProgress?: AnalysisProgressCallback;
  includeTraces?: boolean;
}): StaticAnalysisEngineResult {
  const includeTraces = input.includeTraces ?? true;
  const boundaries =
    input.boundaries ??
    collectWorkspacePackageBoundaries(
      input.sourceFiles.map((sourceFile) => ({
        kind: "source" as const,
        filePath: sourceFile.filePath,
        absolutePath: sourceFile.filePath,
        sourceText: sourceFile.sourceText,
      })),
    );
  const progress = createAnalysisProgressReporter(input.onProgress);
  const parseStage = runAnalysisStage(progress, "parse", "Parsing source files", () =>
    runParseStage(input.sourceFiles),
  );
  const moduleFactsStage = runAnalysisStage(progress, "module-facts", "Building module facts", () =>
    runModuleFactsStage({
      parsedFiles: parseStage.parsedFiles,
      stylesheetFilePaths: (input.selectorCssSources ?? [])
        .map((cssSource) => cssSource.filePath)
        .filter((filePath): filePath is string => Boolean(filePath)),
      projectRoot: input.projectRoot,
      boundaries,
      resourceEdges: input.resourceEdges,
    }),
  );
  const symbolResolutionStage = runAnalysisStage(
    progress,
    "symbol-resolution",
    "Resolving symbols",
    () =>
      runSymbolResolutionStage({
        parsedFiles: parseStage.parsedFiles,
        moduleFacts: moduleFactsStage.moduleFacts,
        includeTraces,
      }),
  );
  const renderModelStage = runAnalysisStage(progress, "render-model", "Building render model", () =>
    runRenderModelStage({
      parsedFiles: parseStage.parsedFiles,
      symbolResolution: symbolResolutionStage,
      moduleFacts: moduleFactsStage.moduleFacts,
      includeTraces,
    }),
  );
  const runtimeDomStage = runAnalysisStage(
    progress,
    "runtime-dom",
    "Analyzing runtime DOM class usage",
    () =>
      runRuntimeDomStage({
        parsedFiles: parseStage.parsedFiles,
        includeTraces,
      }),
  );
  const cssAnalysisStage = runAnalysisStage(progress, "css-analysis", "Analyzing CSS", () =>
    runCssAnalysisStage({
      selectorCssSources: input.selectorCssSources ?? [],
    }),
  );
  const externalCssStage = runAnalysisStage(
    progress,
    "external-css",
    "Analyzing external CSS",
    () =>
      runExternalCssStage({
        externalCss: input.externalCss,
        resourceEdges: input.resourceEdges,
      }),
  );
  const reachabilityStage = runAnalysisStage(
    progress,
    "reachability",
    "Building reachability graph",
    () =>
      runReachabilityStage({
        moduleFacts: moduleFactsStage.moduleFacts,
        renderGraph: renderModelStage.renderGraph,
        renderSubtrees: renderModelStage.renderSubtrees,
        selectorCssSources: input.selectorCssSources ?? [],
        resourceEdges: input.resourceEdges,
        externalCssSummary: externalCssStage.externalCssSummary,
        includeTraces,
      }),
  );
  const selectorAnalysisStage = runAnalysisStage(
    progress,
    "selector-analysis",
    "Analyzing selector reachability",
    () =>
      runSelectorAnalysisStage({
        selectorQueries: input.selectorQueries ?? [],
        selectorCssSources: input.selectorCssSources ?? [],
        renderSubtrees: renderModelStage.renderSubtrees,
        reachabilitySummary: reachabilityStage.reachabilitySummary,
        includeTraces,
      }),
  );
  const projectAnalysisStage = runAnalysisStage(
    progress,
    "project-analysis",
    "Building project analysis",
    () =>
      runProjectAnalysisStage({
        moduleFacts: moduleFactsStage.moduleFacts,
        cssFiles: cssAnalysisStage.cssFiles,
        stylesheets: input.stylesheets,
        symbolResolution: symbolResolutionStage,
        cssModuleLocalsConvention: input.cssModules?.localsConvention,
        externalCssSummary: externalCssStage.externalCssSummary,
        reachabilitySummary: reachabilityStage.reachabilitySummary,
        renderGraph: renderModelStage.renderGraph,
        renderSubtrees: renderModelStage.renderSubtrees,
        unsupportedClassReferences: renderModelStage.unsupportedClassReferences,
        runtimeDomClassReferences: runtimeDomStage.runtimeDomClassReferences,
        selectorQueryResults: selectorAnalysisStage.selectorQueryResults,
        includeTraces,
      }),
  );

  return {
    projectAnalysis: projectAnalysisStage.projectAnalysis,
  };
}

function createAnalysisProgressReporter(onProgress?: AnalysisProgressCallback) {
  return (
    stage: string,
    status: "started" | "completed",
    message: string,
    durationMs?: number,
  ): void => {
    onProgress?.({
      stage,
      status,
      message,
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  };
}

function runAnalysisStage<T>(
  progress: ReturnType<typeof createAnalysisProgressReporter>,
  stage: string,
  message: string,
  run: () => T,
): T {
  const startedAt = performance.now();
  progress(stage, "started", message);
  const result = run();
  progress(stage, "completed", message, performance.now() - startedAt);
  return result;
}
