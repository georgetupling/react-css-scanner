import type { SelectorSourceInput } from "../pipeline/selector-analysis/index.js";
import type { ExternalCssAnalysisInput } from "../pipeline/external-css/index.js";
import type { StaticAnalysisEngineResult } from "../types/runtime.js";
import {
  runAbstractValueStage,
  runCssAnalysisStage,
  runExternalCssStage,
  runModuleGraphStage,
  runParseStage,
  runProjectAbstractValueStage,
  runProjectModuleGraphStage,
  runProjectParseStage,
  runProjectSymbolResolutionStage,
  runReachabilityStage,
  runRuleExecutionStage,
  runSelectorAnalysisStage,
  runSymbolResolutionStage,
} from "./stages/basicStages.js";
import { runProjectRenderGraphStage, runRenderGraphStage } from "./stages/renderGraphStage.js";
import { runProjectRenderIrStage, runRenderIrStage } from "./stages/renderIrStage.js";
import { runProjectRenderSummaryStage } from "./stages/renderSummaryStage.js";

export function analyzeSourceText(input: {
  filePath: string;
  sourceText: string;
  selectorQueries?: string[];
  selectorCssSources?: SelectorSourceInput[];
  externalCss?: ExternalCssAnalysisInput;
}): StaticAnalysisEngineResult {
  const parseStage = runParseStage(input);
  const symbolResolutionStage = runSymbolResolutionStage({
    filePath: input.filePath,
    parsedSourceFile: parseStage.parsedSourceFile,
  });
  const moduleGraphStage = runModuleGraphStage({
    filePath: input.filePath,
    parsedSourceFile: parseStage.parsedSourceFile,
  });
  const abstractValueStage = runAbstractValueStage({
    filePath: input.filePath,
    parsedSourceFile: parseStage.parsedSourceFile,
  });
  const renderGraphStage = runRenderGraphStage({
    filePath: input.filePath,
    parsedSourceFile: parseStage.parsedSourceFile,
  });
  const renderIrStage = runRenderIrStage({
    filePath: input.filePath,
    parsedSourceFile: parseStage.parsedSourceFile,
  });
  const cssAnalysisStage = runCssAnalysisStage({
    selectorCssSources: input.selectorCssSources ?? [],
  });
  const externalCssStage = runExternalCssStage({
    externalCss: input.externalCss,
  });
  const reachabilityStage = runReachabilityStage({
    moduleGraph: moduleGraphStage.moduleGraph,
    renderGraph: renderGraphStage.renderGraph,
    renderSubtrees: renderIrStage.renderSubtrees,
    selectorCssSources: input.selectorCssSources ?? [],
    externalCssSummary: externalCssStage.externalCssSummary,
  });
  const selectorAnalysisStage = runSelectorAnalysisStage({
    selectorQueries: input.selectorQueries ?? [],
    selectorCssSources: input.selectorCssSources ?? [],
    renderSubtrees: renderIrStage.renderSubtrees,
    reachabilitySummary: reachabilityStage.reachabilitySummary,
  });
  const ruleExecutionStage = runRuleExecutionStage({
    moduleGraph: moduleGraphStage.moduleGraph,
    classExpressions: abstractValueStage.classExpressions,
    cssFiles: cssAnalysisStage.cssFiles,
    externalCssSummary: externalCssStage.externalCssSummary,
    reachabilitySummary: reachabilityStage.reachabilitySummary,
    selectorQueryResults: selectorAnalysisStage.selectorQueryResults,
  });

  return {
    moduleGraph: moduleGraphStage.moduleGraph,
    symbols: symbolResolutionStage.symbols,
    classExpressions: abstractValueStage.classExpressions,
    cssFiles: cssAnalysisStage.cssFiles,
    externalCssSummary: externalCssStage.externalCssSummary,
    reachabilitySummary: reachabilityStage.reachabilitySummary,
    renderGraph: renderGraphStage.renderGraph,
    renderSubtrees: renderIrStage.renderSubtrees,
    selectorQueryResults: selectorAnalysisStage.selectorQueryResults,
    experimentalRuleResults: ruleExecutionStage.experimentalRuleResults,
  };
}

export function analyzeProjectSourceTexts(input: {
  sourceFiles: Array<{
    filePath: string;
    sourceText: string;
  }>;
  selectorQueries?: string[];
  selectorCssSources?: SelectorSourceInput[];
  externalCss?: ExternalCssAnalysisInput;
}): StaticAnalysisEngineResult {
  const parseStage = runProjectParseStage(input.sourceFiles);
  const moduleGraphStage = runProjectModuleGraphStage({
    parsedFiles: parseStage.parsedFiles,
  });
  const symbolResolutionStage = runProjectSymbolResolutionStage({
    parsedFiles: parseStage.parsedFiles,
    moduleGraph: moduleGraphStage.moduleGraph,
  });
  const abstractValueStage = runProjectAbstractValueStage({
    parsedFiles: parseStage.parsedFiles,
  });
  const renderSummaryStage = runProjectRenderSummaryStage({
    parsedFiles: parseStage.parsedFiles,
    symbolResolution: symbolResolutionStage,
  });
  const renderGraphStage = runProjectRenderGraphStage(renderSummaryStage.renderGraphInput);
  const renderIrStage = runProjectRenderIrStage(renderSummaryStage.renderIrInput);
  const cssAnalysisStage = runCssAnalysisStage({
    selectorCssSources: input.selectorCssSources ?? [],
  });
  const externalCssStage = runExternalCssStage({
    externalCss: input.externalCss,
  });
  const reachabilityStage = runReachabilityStage({
    moduleGraph: moduleGraphStage.moduleGraph,
    renderGraph: renderGraphStage.renderGraph,
    renderSubtrees: renderIrStage.renderSubtrees,
    selectorCssSources: input.selectorCssSources ?? [],
    externalCssSummary: externalCssStage.externalCssSummary,
  });
  const selectorAnalysisStage = runSelectorAnalysisStage({
    selectorQueries: input.selectorQueries ?? [],
    selectorCssSources: input.selectorCssSources ?? [],
    renderSubtrees: renderIrStage.renderSubtrees,
    reachabilitySummary: reachabilityStage.reachabilitySummary,
  });
  const ruleExecutionStage = runRuleExecutionStage({
    moduleGraph: moduleGraphStage.moduleGraph,
    classExpressions: abstractValueStage.classExpressions,
    cssFiles: cssAnalysisStage.cssFiles,
    externalCssSummary: externalCssStage.externalCssSummary,
    reachabilitySummary: reachabilityStage.reachabilitySummary,
    selectorQueryResults: selectorAnalysisStage.selectorQueryResults,
  });

  return {
    moduleGraph: moduleGraphStage.moduleGraph,
    symbols: symbolResolutionStage.symbols,
    classExpressions: abstractValueStage.classExpressions,
    cssFiles: cssAnalysisStage.cssFiles,
    externalCssSummary: externalCssStage.externalCssSummary,
    reachabilitySummary: reachabilityStage.reachabilitySummary,
    renderGraph: renderGraphStage.renderGraph,
    renderSubtrees: renderIrStage.renderSubtrees,
    selectorQueryResults: selectorAnalysisStage.selectorQueryResults,
    experimentalRuleResults: ruleExecutionStage.experimentalRuleResults,
  };
}
