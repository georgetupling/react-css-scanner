import type { SelectorSourceInput } from "../pipeline/selector-analysis/index.js";
import type { StaticAnalysisEngineResult } from "../types/runtime.js";
import {
  runAbstractValueStage,
  runCssAnalysisStage,
  runModuleGraphStage,
  runParseStage,
  runProjectBindingResolutionStage,
  runProjectAbstractValueStage,
  runProjectModuleGraphStage,
  runProjectParseStage,
  runProjectSymbolResolutionStage,
  runReachabilityStage,
  runRuleExecutionStage,
  runSelectorAnalysisStage,
  runSymbolResolutionStage,
} from "./stages/basicStages.js";
import { buildProjectRenderContext } from "./stages/buildProjectRenderContext.js";
import { runProjectRenderGraphStage, runRenderGraphStage } from "./stages/renderGraphStage.js";
import { runProjectRenderIrStage, runRenderIrStage } from "./stages/renderIrStage.js";

export function analyzeSourceText(input: {
  filePath: string;
  sourceText: string;
  selectorQueries?: string[];
  selectorCssSources?: SelectorSourceInput[];
}): StaticAnalysisEngineResult {
  const parseStage = runParseStage(input);
  const symbolResolutionStage = runSymbolResolutionStage({
    filePath: input.filePath,
    parsedSourceFile: parseStage.parsedSourceFile,
  });
  const moduleGraphStage = runModuleGraphStage({
    filePath: input.filePath,
    parsedSourceFile: parseStage.parsedSourceFile,
    moduleId: symbolResolutionStage.moduleId,
    symbols: symbolResolutionStage.symbols,
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
  const reachabilityStage = runReachabilityStage({
    moduleGraph: moduleGraphStage.moduleGraph,
    renderGraph: renderGraphStage.renderGraph,
    renderSubtrees: renderIrStage.renderSubtrees,
    selectorCssSources: input.selectorCssSources ?? [],
  });
  const selectorAnalysisStage = runSelectorAnalysisStage({
    selectorQueries: input.selectorQueries ?? [],
    selectorCssSources: input.selectorCssSources ?? [],
    renderSubtrees: renderIrStage.renderSubtrees,
    reachabilitySummary: reachabilityStage.reachabilitySummary,
  });
  const ruleExecutionStage = runRuleExecutionStage({
    cssFiles: cssAnalysisStage.cssFiles,
    selectorQueryResults: selectorAnalysisStage.selectorQueryResults,
  });

  return {
    moduleGraph: moduleGraphStage.moduleGraph,
    symbols: symbolResolutionStage.symbols,
    classExpressions: abstractValueStage.classExpressions,
    cssFiles: cssAnalysisStage.cssFiles,
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
}): StaticAnalysisEngineResult {
  const parseStage = runProjectParseStage(input.sourceFiles);
  const symbolResolutionStage = runProjectSymbolResolutionStage({
    parsedFiles: parseStage.parsedFiles,
  });
  const moduleGraphStage = runProjectModuleGraphStage({
    parsedFiles: parseStage.parsedFiles,
    symbolsByFilePath: symbolResolutionStage.symbolsByFilePath,
  });
  const abstractValueStage = runProjectAbstractValueStage({
    parsedFiles: parseStage.parsedFiles,
  });
  const bindingResolutionStage = runProjectBindingResolutionStage({
    moduleGraph: moduleGraphStage.moduleGraph,
    symbolsByFilePath: symbolResolutionStage.symbolsByFilePath,
    parsedFiles: parseStage.parsedFiles,
  });
  const projectRenderContext = buildProjectRenderContext({
    parsedFiles: parseStage.parsedFiles,
    exportedExpressionBindingsByFilePath:
      bindingResolutionStage.exportedExpressionBindingsByFilePath,
    importedExpressionBindingsByFilePath:
      bindingResolutionStage.importedExpressionBindingsByFilePath,
    resolvedImportedComponentBindingsByFilePath:
      bindingResolutionStage.resolvedImportedComponentBindingsByFilePath,
    resolvedImportedBindingsByFilePath: bindingResolutionStage.resolvedImportedBindingsByFilePath,
    resolvedNamespaceImportsByFilePath: bindingResolutionStage.resolvedNamespaceImportsByFilePath,
  });
  const renderGraphStage = runProjectRenderGraphStage({
    projectRenderContext,
  });
  const renderIrStage = runProjectRenderIrStage({
    projectRenderContext,
  });
  const cssAnalysisStage = runCssAnalysisStage({
    selectorCssSources: input.selectorCssSources ?? [],
  });
  const reachabilityStage = runReachabilityStage({
    moduleGraph: moduleGraphStage.moduleGraph,
    renderGraph: renderGraphStage.renderGraph,
    renderSubtrees: renderIrStage.renderSubtrees,
    selectorCssSources: input.selectorCssSources ?? [],
  });
  const selectorAnalysisStage = runSelectorAnalysisStage({
    selectorQueries: input.selectorQueries ?? [],
    selectorCssSources: input.selectorCssSources ?? [],
    renderSubtrees: renderIrStage.renderSubtrees,
    reachabilitySummary: reachabilityStage.reachabilitySummary,
  });
  const ruleExecutionStage = runRuleExecutionStage({
    cssFiles: cssAnalysisStage.cssFiles,
    selectorQueryResults: selectorAnalysisStage.selectorQueryResults,
  });

  return {
    moduleGraph: moduleGraphStage.moduleGraph,
    symbols: bindingResolutionStage.symbols,
    classExpressions: abstractValueStage.classExpressions,
    cssFiles: cssAnalysisStage.cssFiles,
    reachabilitySummary: reachabilityStage.reachabilitySummary,
    renderGraph: renderGraphStage.renderGraph,
    renderSubtrees: renderIrStage.renderSubtrees,
    selectorQueryResults: selectorAnalysisStage.selectorQueryResults,
    experimentalRuleResults: ruleExecutionStage.experimentalRuleResults,
  };
}
