import type { SelectorSourceInput } from "../pipeline/selector-analysis/index.js";
import type { ExternalCssAnalysisInput } from "../pipeline/external-css/index.js";
import {
  graphToProjectResourceEdges,
  graphToStylesheetFilePaths,
  type FactGraphResult,
} from "../pipeline/fact-graph/index.js";
import {
  buildSourceFrontendFactsFromSourceFiles,
  type CssFrontendFacts,
  type SourceFrontendFacts,
} from "../pipeline/language-frontends/index.js";
import type {
  CssModuleLocalsConvention,
  ProjectAnalysisStylesheetInput,
} from "../pipeline/project-analysis/index.js";
import { collectWorkspacePackageBoundaries } from "../pipeline/workspace-discovery/boundaries/collectWorkspacePackageBoundaries.js";
import type {
  ProjectBoundary,
  ProjectResourceEdge,
} from "../pipeline/workspace-discovery/index.js";
import { compareProjectResourceEdges } from "../pipeline/workspace-discovery/utils/sorting.js";
import type { AnalysisProgressCallback, StaticAnalysisEngineResult } from "../types/runtime.js";
import { runCssAnalysisStage } from "./stages/cssAnalysisStage.js";
import { runExternalCssStage } from "./stages/externalCssStage.js";
import { runModuleFactsStage } from "./stages/moduleFactsStage.js";
import { runProjectAnalysisStage } from "./stages/projectAnalysisStage.js";
import { runReachabilityStage } from "./stages/reachabilityStage.js";
import { runRenderModelStage } from "./stages/renderModelStage.js";
import { runSelectorAnalysisStage } from "./stages/selectorAnalysisStage.js";
import { runSymbolResolutionStage } from "./stages/symbolResolutionStage.js";
import { runSymbolicEvaluationStage } from "./stages/symbolicEvaluationStage.js";

export function analyzeSourceText(input: {
  filePath: string;
  sourceText: string;
  selectorQueries?: string[];
  selectorCssSources?: SelectorSourceInput[];
  source?: SourceFrontendFacts;
  css?: CssFrontendFacts;
  stylesheets?: ProjectAnalysisStylesheetInput[];
  boundaries?: ProjectBoundary[];
  resourceEdges?: ProjectResourceEdge[];
  externalCss?: ExternalCssAnalysisInput;
  factGraph?: FactGraphResult;
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
    source: input.source,
    css: input.css,
    stylesheets: input.stylesheets,
    boundaries: input.boundaries,
    resourceEdges: input.resourceEdges,
    externalCss: input.externalCss,
    factGraph: input.factGraph,
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
  source?: SourceFrontendFacts;
  css?: CssFrontendFacts;
  stylesheets?: ProjectAnalysisStylesheetInput[];
  boundaries?: ProjectBoundary[];
  resourceEdges?: ProjectResourceEdge[];
  externalCss?: ExternalCssAnalysisInput;
  factGraph?: FactGraphResult;
  cssModules?: {
    localsConvention?: CssModuleLocalsConvention;
  };
  onProgress?: AnalysisProgressCallback;
  includeTraces?: boolean;
}): StaticAnalysisEngineResult {
  const includeTraces = input.includeTraces ?? true;
  const mergedResourceEdges = getMergedResourceEdges({
    inputResourceEdges: input.resourceEdges,
    factResourceEdges: input.factGraph
      ? graphToProjectResourceEdges(input.factGraph.graph)
      : undefined,
  });
  const cssFrontendStylesheets = input.css?.files.map((file) => ({
    filePath: file.filePath,
    cssKind: file.cssKind,
    origin: file.origin,
  }));
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
  const sourceFrontendFacts =
    input.source ??
    buildSourceFrontendFactsFromSourceFiles(
      input.sourceFiles.map((sourceFile) => ({
        filePath: sourceFile.filePath,
        absolutePath: sourceFile.filePath,
        sourceText: sourceFile.sourceText,
      })),
    );
  const parsedFiles = sourceFrontendFacts.files.map((file) => file.legacy.parsedFile);
  const moduleFactsStage = runAnalysisStage(progress, "module-facts", "Building module facts", () =>
    runModuleFactsStage({
      source: sourceFrontendFacts,
      stylesheetFilePaths: input.factGraph
        ? graphToStylesheetFilePaths(input.factGraph.graph)
        : (input.css?.files ?? input.selectorCssSources ?? [])
            .map((stylesheet) => stylesheet.filePath)
            .filter((filePath): filePath is string => Boolean(filePath)),
      projectRoot: input.projectRoot,
      boundaries,
      resourceEdges: mergedResourceEdges,
    }),
  );
  const symbolResolutionStage = runAnalysisStage(
    progress,
    "symbol-resolution",
    "Resolving symbols",
    () =>
      runSymbolResolutionStage({
        source: sourceFrontendFacts,
        moduleFacts: moduleFactsStage.moduleFacts,
        includeTraces,
      }),
  );
  const renderModelStage = runAnalysisStage(progress, "render-model", "Building render model", () =>
    runRenderModelStage({
      parsedFiles,
      factGraph: input.factGraph,
      symbolResolution: symbolResolutionStage,
      moduleFacts: moduleFactsStage.moduleFacts,
      includeTraces,
    }),
  );
  const factGraphStage = input.factGraph;
  const symbolicEvaluationStage = factGraphStage
    ? runAnalysisStage(
        progress,
        "symbolic-evaluation",
        "Evaluating symbolic class expressions",
        () =>
          runSymbolicEvaluationStage({
            graph: factGraphStage.graph,
            symbolResolution: symbolResolutionStage,
            includeTraces,
          }),
      )
    : undefined;
  const cssAnalysisStage = runAnalysisStage(progress, "css-analysis", "Analyzing CSS", () =>
    runCssAnalysisStage({
      factGraph: input.factGraph,
      css: input.css,
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
        factGraph: input.factGraph,
        renderGraph: renderModelStage.renderGraph,
        renderSubtrees: renderModelStage.renderSubtrees,
        css: input.css,
        selectorCssSources: input.selectorCssSources ?? [],
        resourceEdges: mergedResourceEdges,
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
        factGraph: input.factGraph,
        css: input.css,
        selectorCssSources: input.selectorCssSources ?? [],
        renderSubtrees: renderModelStage.renderSubtrees,
        reachabilitySummary: reachabilityStage.reachabilitySummary,
        symbolicEvaluation: symbolicEvaluationStage,
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
        factGraph: input.factGraph,
        cssFiles: cssAnalysisStage.cssFiles,
        stylesheets: input.stylesheets ?? cssFrontendStylesheets,
        symbolResolution: symbolResolutionStage,
        cssModuleLocalsConvention: input.cssModules?.localsConvention,
        externalCssSummary: externalCssStage.externalCssSummary,
        reachabilitySummary: reachabilityStage.reachabilitySummary,
        renderGraph: renderModelStage.renderGraph,
        renderSubtrees: renderModelStage.renderSubtrees,
        unsupportedClassReferences: renderModelStage.unsupportedClassReferences,
        symbolicEvaluation: symbolicEvaluationStage,
        selectorQueryResults: selectorAnalysisStage.selectorQueryResults,
        includeTraces,
      }),
  );

  return {
    projectAnalysis: projectAnalysisStage.projectAnalysis,
    ...(symbolicEvaluationStage ? { symbolicEvaluation: symbolicEvaluationStage } : {}),
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

function getMergedResourceEdges(input: {
  inputResourceEdges?: ProjectResourceEdge[];
  factResourceEdges?: ProjectResourceEdge[];
}): ProjectResourceEdge[] | undefined {
  if (input.inputResourceEdges === undefined && input.factResourceEdges === undefined) {
    return undefined;
  }

  const allEdges = [...(input.inputResourceEdges ?? []), ...(input.factResourceEdges ?? [])];
  const dedupedByKey = new Map<string, ProjectResourceEdge>();

  for (const edge of allEdges.sort(compareProjectResourceEdges)) {
    const key = getResourceEdgeMergeKey(edge);
    const existing = dedupedByKey.get(key);
    if (existing === undefined || shouldReplaceResourceEdge(existing, edge)) {
      dedupedByKey.set(key, edge);
    }
  }

  return [...dedupedByKey.values()].sort(compareProjectResourceEdges);
}

function getResourceEdgeMergeKey(edge: ProjectResourceEdge): string {
  if (edge.kind === "source-import") {
    return `source-import\0${edge.importerFilePath}\0${edge.specifier}\0${edge.importKind}`;
  }
  if (edge.kind === "stylesheet-import") {
    return `stylesheet-import\0${edge.importerFilePath}\0${edge.specifier}\0${edge.resolvedFilePath}`;
  }
  if (edge.kind === "package-css-import") {
    return `package-css-import\0${edge.importerKind}\0${edge.importerFilePath}\0${edge.specifier}\0${edge.resolvedFilePath}`;
  }
  if (edge.kind === "html-stylesheet") {
    return `html-stylesheet\0${edge.fromHtmlFilePath}\0${edge.href}\0${edge.resolvedFilePath ?? ""}`;
  }

  return `html-script\0${edge.fromHtmlFilePath}\0${edge.src}\0${edge.resolvedFilePath ?? ""}\0${edge.appRootPath ?? ""}`;
}

function shouldReplaceResourceEdge(
  existing: ProjectResourceEdge,
  candidate: ProjectResourceEdge,
): boolean {
  if (existing.kind !== "source-import" || candidate.kind !== "source-import") {
    return false;
  }

  const existingRank = getSourceImportResolutionRank(existing.resolutionStatus);
  const candidateRank = getSourceImportResolutionRank(candidate.resolutionStatus);
  return candidateRank > existingRank;
}

type SourceImportResolutionStatus = "resolved" | "unresolved" | "external" | "unsupported";

function getSourceImportResolutionRank(status: SourceImportResolutionStatus): number {
  if (status === "resolved") {
    return 3;
  }
  if (status === "external") {
    return 2;
  }
  if (status === "unresolved") {
    return 1;
  }
  return 0;
}
