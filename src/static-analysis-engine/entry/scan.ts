import type { SelectorSourceInput } from "../pipeline/selector-analysis/index.js";
import type { ExternalCssAnalysisInput } from "../pipeline/external-css/index.js";
import type { CssModuleAnalysisOptions } from "../pipeline/css-modules/index.js";
import type { StaticAnalysisEngineResult } from "../types/runtime.js";
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
}): StaticAnalysisEngineResult {
  const parseStage = runParseStage(input.sourceFiles);
  const moduleGraphStage = runModuleGraphStage({
    parsedFiles: parseStage.parsedFiles,
  });
  const symbolResolutionStage = runSymbolResolutionStage({
    parsedFiles: parseStage.parsedFiles,
    moduleGraph: moduleGraphStage.moduleGraph,
  });
  const renderModelStage = runRenderModelStage({
    parsedFiles: parseStage.parsedFiles,
    symbolResolution: symbolResolutionStage,
  });
  const cssAnalysisStage = runCssAnalysisStage({
    selectorCssSources: input.selectorCssSources ?? [],
  });
  const cssModuleAnalysisStage = runCssModuleAnalysisStage({
    parsedFiles: parseStage.parsedFiles,
    moduleGraph: moduleGraphStage.moduleGraph,
    cssFiles: cssAnalysisStage.cssFiles,
    options: input.cssModules,
  });
  const externalCssStage = runExternalCssStage({
    externalCss: input.externalCss,
  });
  const reachabilityStage = runReachabilityStage({
    moduleGraph: moduleGraphStage.moduleGraph,
    renderGraph: renderModelStage.renderGraph,
    renderSubtrees: renderModelStage.renderSubtrees,
    selectorCssSources: input.selectorCssSources ?? [],
    externalCssSummary: externalCssStage.externalCssSummary,
  });
  const selectorAnalysisStage = runSelectorAnalysisStage({
    selectorQueries: input.selectorQueries ?? [],
    selectorCssSources: input.selectorCssSources ?? [],
    renderSubtrees: renderModelStage.renderSubtrees,
    reachabilitySummary: reachabilityStage.reachabilitySummary,
  });
  const projectAnalysisStage = runProjectAnalysisStage({
    moduleGraph: moduleGraphStage.moduleGraph,
    cssFiles: cssAnalysisStage.cssFiles,
    cssModules: cssModuleAnalysisStage.cssModules,
    externalCssSummary: externalCssStage.externalCssSummary,
    reachabilitySummary: reachabilityStage.reachabilitySummary,
    renderGraph: renderModelStage.renderGraph,
    renderSubtrees: renderModelStage.renderSubtrees,
    unsupportedClassReferences: renderModelStage.unsupportedClassReferences,
    selectorQueryResults: selectorAnalysisStage.selectorQueryResults,
  });

  return {
    projectAnalysis: projectAnalysisStage.projectAnalysis,
  };
}
