import type { SelectorSourceInput } from "../pipeline/selector-analysis/index.js";
import type { ExternalCssAnalysisInput } from "../pipeline/external-css/index.js";
import type { CssModuleAnalysisOptions } from "../pipeline/css-modules/index.js";
import type { AnalysisProgressCallback, StaticAnalysisEngineResult } from "../types/runtime.js";
import { runCssAnalysisStage } from "./stages/cssAnalysisStage.js";
import { runCssModuleAnalysisStage } from "./stages/cssModuleAnalysisStage.js";
import { runExternalCssStage } from "./stages/externalCssStage.js";
import { runModuleGraphStage } from "./stages/moduleGraphStage.js";
import { runParseStage } from "./stages/parseStage.js";
import { runProjectAnalysisStage } from "./stages/projectAnalysisStage.js";
import { runReachabilityStage } from "./stages/reachabilityStage.js";
import { runRenderModelStage } from "./stages/renderModelStage.js";
import { runSelectorAnalysisStage } from "./stages/selectorAnalysisStage.js";
import { runSymbolResolutionStage } from "./stages/symbolResolutionStage.js";

export function analyzeSourceText(input: {
  filePath: string;
  sourceText: string;
  selectorQueries?: string[];
  selectorCssSources?: SelectorSourceInput[];
  externalCss?: ExternalCssAnalysisInput;
  cssModules?: CssModuleAnalysisOptions;
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
  selectorQueries?: string[];
  selectorCssSources?: SelectorSourceInput[];
  externalCss?: ExternalCssAnalysisInput;
  cssModules?: CssModuleAnalysisOptions;
  onProgress?: AnalysisProgressCallback;
  includeTraces?: boolean;
}): StaticAnalysisEngineResult {
  const includeTraces = input.includeTraces ?? true;
  const progress = createAnalysisProgressReporter(input.onProgress);
  const parseStage = runAnalysisStage(progress, "parse", "Parsing source files", () =>
    runParseStage(input.sourceFiles),
  );
  const moduleGraphStage = runAnalysisStage(progress, "module-graph", "Building module graph", () =>
    runModuleGraphStage({
      parsedFiles: parseStage.parsedFiles,
    }),
  );
  const symbolResolutionStage = runAnalysisStage(
    progress,
    "symbol-resolution",
    "Resolving symbols",
    () =>
      runSymbolResolutionStage({
        parsedFiles: parseStage.parsedFiles,
        moduleGraph: moduleGraphStage.moduleGraph,
        includeTraces,
      }),
  );
  const renderModelStage = runAnalysisStage(progress, "render-model", "Building render model", () =>
    runRenderModelStage({
      parsedFiles: parseStage.parsedFiles,
      symbolResolution: symbolResolutionStage,
      includeTraces,
    }),
  );
  const cssAnalysisStage = runAnalysisStage(progress, "css-analysis", "Analyzing CSS", () =>
    runCssAnalysisStage({
      selectorCssSources: input.selectorCssSources ?? [],
    }),
  );
  const cssModuleAnalysisStage = runAnalysisStage(
    progress,
    "css-modules",
    "Analyzing CSS Modules",
    () =>
      runCssModuleAnalysisStage({
        parsedFiles: parseStage.parsedFiles,
        moduleGraph: moduleGraphStage.moduleGraph,
        cssFiles: cssAnalysisStage.cssFiles,
        options: input.cssModules,
        includeTraces,
      }),
  );
  const externalCssStage = runAnalysisStage(
    progress,
    "external-css",
    "Analyzing external CSS",
    () =>
      runExternalCssStage({
        externalCss: input.externalCss,
      }),
  );
  const reachabilityStage = runAnalysisStage(
    progress,
    "reachability",
    "Building reachability graph",
    () =>
      runReachabilityStage({
        moduleGraph: moduleGraphStage.moduleGraph,
        renderGraph: renderModelStage.renderGraph,
        renderSubtrees: renderModelStage.renderSubtrees,
        selectorCssSources: input.selectorCssSources ?? [],
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
        moduleGraph: moduleGraphStage.moduleGraph,
        cssFiles: cssAnalysisStage.cssFiles,
        cssModules: cssModuleAnalysisStage.cssModules,
        externalCssSummary: externalCssStage.externalCssSummary,
        reachabilitySummary: reachabilityStage.reachabilitySummary,
        renderGraph: renderModelStage.renderGraph,
        renderSubtrees: renderModelStage.renderSubtrees,
        unsupportedClassReferences: renderModelStage.unsupportedClassReferences,
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
