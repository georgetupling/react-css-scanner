import type { SelectorSourceInput } from "../pipeline/selector-analysis/index.js";
import type { ExternalCssAnalysisInput } from "../pipeline/external-css/index.js";
import {
  buildFactGraph,
  graphToProjectResourceEdges,
  graphToStylesheetFilePaths,
  type FactGraphResult,
} from "../pipeline/fact-graph/index.js";
import {
  buildLanguageFrontends,
  buildSourceFrontendFactsFromSourceFiles,
  type CssFrontendFacts,
  type SourceFrontendFacts,
} from "../pipeline/language-frontends/index.js";
import type {
  CssModuleLocalsConvention,
  ProjectEvidenceStylesheetInput,
} from "../pipeline/project-evidence/index.js";
import { collectWorkspacePackageBoundaries } from "../pipeline/workspace-discovery/boundaries/collectWorkspacePackageBoundaries.js";
import type {
  ProjectBoundary,
  ProjectResourceEdge,
  ProjectSnapshot,
  ProjectStylesheetFile,
} from "../pipeline/workspace-discovery/index.js";
import { compareProjectResourceEdges } from "../pipeline/workspace-discovery/utils/sorting.js";
import type { AnalysisProgressCallback, StaticAnalysisEngineResult } from "../types/runtime.js";
import { DEFAULT_SCANNER_CONFIG } from "../../config/index.js";
import { runCssAnalysisStage } from "./stages/cssAnalysisStage.js";
import { runExternalCssStage } from "./stages/externalCssStage.js";
import { runModuleFactsStage } from "./stages/moduleFactsStage.js";
import { runOwnershipInferenceStage } from "./stages/ownershipInferenceStage.js";
import { runProjectEvidenceStage } from "./stages/projectEvidenceStage.js";
import { runReachabilityStage } from "./stages/reachabilityStage.js";
import { runRenderStructureStage } from "./stages/renderStructureStage.js";
import { runSelectorAnalysisStage } from "./stages/selectorAnalysisStage.js";
import { runSelectorReachabilityStage } from "./stages/selectorReachabilityStage.js";
import { runSymbolResolutionStage } from "./stages/symbolResolutionStage.js";
import { runSymbolicEvaluationStage } from "./stages/symbolicEvaluationStage.js";

export function analyzeSourceText(input: {
  filePath: string;
  sourceText: string;
  selectorQueries?: string[];
  selectorCssSources?: SelectorSourceInput[];
  source?: SourceFrontendFacts;
  css?: CssFrontendFacts;
  stylesheets?: ProjectEvidenceStylesheetInput[];
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
  stylesheets?: ProjectEvidenceStylesheetInput[];
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
  const syntheticSnapshot = input.factGraph
    ? undefined
    : buildInlineProjectSnapshot({
        sourceFiles: input.sourceFiles,
        projectRoot: input.projectRoot,
        css: input.css,
        selectorCssSources: input.selectorCssSources,
        stylesheets: input.stylesheets,
        boundaries,
        resourceEdges: mergedResourceEdges,
        externalCss: input.externalCss,
      });
  const syntheticFrontends = syntheticSnapshot
    ? buildLanguageFrontends({ snapshot: syntheticSnapshot })
    : undefined;
  const sourceFrontendFacts =
    input.source ??
    syntheticFrontends?.source ??
    buildSourceFrontendFactsFromSourceFiles(
      input.sourceFiles.map((sourceFile) => ({
        filePath: sourceFile.filePath,
        absolutePath: sourceFile.filePath,
        sourceText: sourceFile.sourceText,
      })),
    );
  const cssFrontendFacts = input.css ?? syntheticFrontends?.css;
  const factGraphStage: FactGraphResult =
    input.factGraph ??
    runAnalysisStage(progress, "fact-graph", "Building fact graph", () => {
      const snapshot = syntheticSnapshot as ProjectSnapshot;
      return buildFactGraph({
        snapshot,
        frontends: {
          snapshot,
          source: sourceFrontendFacts,
          css: cssFrontendFacts ?? {
            files: [],
            filesByPath: new Map(),
          },
        },
        includeTraces,
      });
    });
  const moduleFactsStage = runAnalysisStage(progress, "module-facts", "Building module facts", () =>
    runModuleFactsStage({
      source: sourceFrontendFacts,
      stylesheetFilePaths: factGraphStage
        ? graphToStylesheetFilePaths(factGraphStage.graph)
        : (cssFrontendFacts?.files ?? input.selectorCssSources ?? [])
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
  const symbolicEvaluationStage = runAnalysisStage(
    progress,
    "symbolic-evaluation",
    "Evaluating symbolic class expressions",
    () =>
      runSymbolicEvaluationStage({
        graph: factGraphStage.graph,
        symbolResolution: symbolResolutionStage,
        includeTraces,
      }),
  );
  const renderStructureStage = runAnalysisStage(
    progress,
    "render-structure",
    "Building render structure",
    () =>
      runRenderStructureStage({
        factGraph: factGraphStage,
        symbolicEvaluation: symbolicEvaluationStage,
        includeTraces,
      }),
  );
  const cssAnalysisStage = runAnalysisStage(progress, "css-analysis", "Analyzing CSS", () =>
    runCssAnalysisStage({
      factGraph: factGraphStage,
      css: cssFrontendFacts,
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
        factGraph: factGraphStage,
        renderModel: renderStructureStage.renderModel,
        css: cssFrontendFacts,
        selectorCssSources: input.selectorCssSources ?? [],
        resourceEdges: mergedResourceEdges,
        externalCssSummary: externalCssStage.externalCssSummary,
        includeTraces,
      }),
  );
  const selectorReachabilityStage = runAnalysisStage(
    progress,
    "selector-reachability",
    "Building selector reachability evidence",
    () => runSelectorReachabilityStage(renderStructureStage),
  );
  const selectorAnalysisStage = runAnalysisStage(
    progress,
    "selector-analysis",
    "Analyzing selector reachability",
    () =>
      runSelectorAnalysisStage({
        selectorQueries: input.selectorQueries ?? [],
        factGraph: factGraphStage,
        css: cssFrontendFacts,
        selectorCssSources: input.selectorCssSources ?? [],
        renderModel: renderStructureStage.renderModel,
        reachabilitySummary: reachabilityStage.reachabilitySummary,
        selectorReachability: selectorReachabilityStage.selectorReachability,
        includeTraces,
      }),
  );
  const projectEvidenceStage = runAnalysisStage(
    progress,
    "project-evidence",
    "Building project evidence",
    () =>
      runProjectEvidenceStage({
        includeTraces,
        projectInput: {
          moduleFacts: moduleFactsStage.moduleFacts,
          factGraph: factGraphStage,
          cssFiles: cssAnalysisStage.cssFiles,
          stylesheets: input.stylesheets ?? cssFrontendStylesheets,
          symbolResolution: symbolResolutionStage,
          cssModuleLocalsConvention: input.cssModules?.localsConvention,
          externalCssSummary: externalCssStage.externalCssSummary,
          reachabilitySummary: reachabilityStage.reachabilitySummary,
          renderModel: renderStructureStage.renderModel,
          symbolicEvaluation: symbolicEvaluationStage,
          selectorReachability: selectorReachabilityStage.selectorReachability,
          selectorQueryResults: selectorAnalysisStage.selectorQueryResults,
          includeTraces,
        },
      }),
  );
  const ownershipInferenceStage = runAnalysisStage(
    progress,
    "ownership-inference",
    "Building ownership inference",
    () =>
      runOwnershipInferenceStage({
        projectEvidence: projectEvidenceStage.projectEvidence,
        selectorReachability: selectorReachabilityStage.selectorReachability,
        includeTraces,
      }),
  );
  return {
    analysisEvidence: {
      projectEvidence: projectEvidenceStage.projectEvidence,
      selectorReachability: selectorReachabilityStage.selectorReachability,
      ownershipInference: ownershipInferenceStage.ownershipInference,
    },
    ...(symbolicEvaluationStage ? { symbolicEvaluation: symbolicEvaluationStage } : {}),
  };
}

function buildInlineProjectSnapshot(input: {
  sourceFiles: Array<{
    filePath: string;
    sourceText: string;
  }>;
  projectRoot?: string;
  css?: CssFrontendFacts;
  selectorCssSources?: SelectorSourceInput[];
  stylesheets?: ProjectEvidenceStylesheetInput[];
  boundaries?: ProjectBoundary[];
  resourceEdges?: ProjectResourceEdge[];
  externalCss?: ExternalCssAnalysisInput;
}): ProjectSnapshot {
  const stylesheetMetadataByPath = new Map(
    (input.stylesheets ?? []).flatMap((stylesheet) =>
      stylesheet.filePath ? [[normalizeProjectPath(stylesheet.filePath), stylesheet]] : [],
    ),
  );
  const stylesheetSources = input.css?.files ?? input.selectorCssSources ?? [];
  const stylesheets = stylesheetSources.map((stylesheet, index) => {
    const filePath = stylesheet.filePath ?? `<inline-stylesheet-${index}.css>`;
    const metadata = stylesheetMetadataByPath.get(normalizeProjectPath(filePath));
    const cssKind: ProjectStylesheetFile["cssKind"] =
      "cssKind" in stylesheet &&
      (stylesheet.cssKind === "global-css" || stylesheet.cssKind === "css-module")
        ? stylesheet.cssKind
        : (metadata?.cssKind ?? (isCssModulePath(filePath) ? "css-module" : "global-css"));
    const origin: ProjectStylesheetFile["origin"] =
      "origin" in stylesheet &&
      (stylesheet.origin === "project" ||
        stylesheet.origin === "html-linked" ||
        stylesheet.origin === "package" ||
        stylesheet.origin === "remote")
        ? stylesheet.origin
        : (metadata?.origin ?? "project");

    return {
      kind: "stylesheet" as const,
      filePath,
      absolutePath: filePath,
      cssText: stylesheet.cssText,
      cssKind,
      origin,
    };
  });

  return {
    rootDir: input.projectRoot ?? ".",
    config: {
      ...DEFAULT_SCANNER_CONFIG,
      rules: { ...DEFAULT_SCANNER_CONFIG.rules },
      cssModules: { ...DEFAULT_SCANNER_CONFIG.cssModules },
      externalCss: {
        ...DEFAULT_SCANNER_CONFIG.externalCss,
        fetchRemote:
          input.externalCss?.fetchRemote ?? DEFAULT_SCANNER_CONFIG.externalCss.fetchRemote,
        globals: input.externalCss?.globalProviders ?? DEFAULT_SCANNER_CONFIG.externalCss.globals,
      },
      ownership: { ...DEFAULT_SCANNER_CONFIG.ownership },
      discovery: { ...DEFAULT_SCANNER_CONFIG.discovery },
      ignore: { ...DEFAULT_SCANNER_CONFIG.ignore },
      source: { kind: "default" as const },
    },
    files: {
      sourceFiles: input.sourceFiles.map((sourceFile) => ({
        kind: "source" as const,
        filePath: sourceFile.filePath,
        absolutePath: sourceFile.filePath,
        sourceText: sourceFile.sourceText,
      })),
      stylesheets,
      htmlFiles: [],
      configFiles: [],
    },
    discoveredFiles: {
      sourceFiles: input.sourceFiles.map((sourceFile) => ({
        filePath: sourceFile.filePath,
        absolutePath: sourceFile.filePath,
      })),
      cssFiles: stylesheets.map((stylesheet) => ({
        filePath: stylesheet.filePath,
        absolutePath: stylesheet.absolutePath ?? stylesheet.filePath,
      })),
      htmlFiles: [],
    },
    boundaries: input.boundaries ?? [
      {
        kind: "scan-root" as const,
        rootDir: input.projectRoot ?? ".",
      },
    ],
    edges: input.resourceEdges ?? [],
    externalCss: {
      fetchRemote: input.externalCss?.fetchRemote ?? false,
      globalProviders: input.externalCss?.globalProviders ?? [],
    },
    diagnostics: [],
  };
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isCssModulePath(filePath: string): boolean {
  return /\.module\.css$/i.test(filePath);
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
