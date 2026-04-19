import ts from "typescript";

import { collectClassExpressionSummaries } from "../../pipeline/abstract-values/index.js";
import { analyzeCssSources } from "../../pipeline/css-analysis/index.js";
import {
  buildModuleGraphFromSource,
  buildModuleGraphFromSources,
  createModuleId,
} from "../../pipeline/module-graph/index.js";
import { parseSourceFile } from "../../pipeline/source-file-parsing/index.js";
import { buildReachabilitySummary } from "../../pipeline/reachability/index.js";
import { runExperimentalRules } from "../../pipeline/rule-execution/index.js";
import {
  analyzeSelectorQueries,
  buildParsedSelectorQueries,
  extractSelectorQueriesFromCssText,
} from "../../pipeline/selector-analysis/index.js";
import {
  buildProjectBindingResolution,
  collectTopLevelSymbols,
} from "../../pipeline/symbol-resolution/index.js";
import type { ModuleGraph } from "../../pipeline/module-graph/index.js";
import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { RenderSubtree } from "../../pipeline/render-ir/index.js";
import type { ExperimentalCssFileAnalysis } from "../../pipeline/css-analysis/index.js";
import type { SelectorSourceInput } from "../../pipeline/selector-analysis/index.js";
import type { EngineSymbol } from "../../pipeline/symbol-resolution/index.js";
import type { EngineModuleId, EngineSymbolId } from "../../types/core.js";
import type {
  AbstractValueStageResult,
  CssAnalysisStageResult,
  ModuleGraphStageResult,
  ParseStageResult,
  ProjectBindingResolutionStageResult,
  ParsedProjectFile,
  ProjectParseStageResult,
  ProjectSymbolResolutionStageResult,
  ReachabilityStageResult,
  RuleExecutionStageResult,
  SelectorAnalysisStageResult,
  SelectorInputStageResult,
  SelectorParsingStageResult,
  SymbolResolutionStageResult,
} from "./types.js";

export function runParseStage(input: { filePath: string; sourceText: string }): ParseStageResult {
  return {
    parsedSourceFile: parseSourceFile(input),
  };
}

export function runProjectParseStage(
  sourceFiles: Array<{
    filePath: string;
    sourceText: string;
  }>,
): ProjectParseStageResult {
  return {
    parsedFiles: sourceFiles.map((sourceFile) => ({
      filePath: sourceFile.filePath,
      parsedSourceFile: parseSourceFile(sourceFile),
    })),
  };
}

export function runSymbolResolutionStage(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
}): SymbolResolutionStageResult {
  const moduleId = createModuleId(input.filePath);

  return {
    moduleId,
    symbols: collectTopLevelSymbols({
      filePath: input.filePath,
      parsedSourceFile: input.parsedSourceFile,
      moduleId,
    }),
  };
}

export function runProjectSymbolResolutionStage(input: {
  parsedFiles: ParsedProjectFile[];
}): ProjectSymbolResolutionStageResult {
  const symbols = new Map<EngineSymbolId, EngineSymbol>();
  const symbolsByFilePath = new Map<string, Map<EngineSymbolId, EngineSymbol>>();

  for (const parsedFile of input.parsedFiles) {
    const moduleId = createModuleId(parsedFile.filePath);
    const fileSymbols = collectTopLevelSymbols({
      filePath: parsedFile.filePath,
      parsedSourceFile: parsedFile.parsedSourceFile,
      moduleId,
    });
    symbolsByFilePath.set(parsedFile.filePath, fileSymbols);

    for (const [symbolId, symbol] of fileSymbols.entries()) {
      symbols.set(symbolId, symbol);
    }
  }

  return {
    symbols,
    symbolsByFilePath,
  };
}

export function runModuleGraphStage(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  moduleId: EngineModuleId;
  symbols: Map<EngineSymbolId, EngineSymbol>;
}): ModuleGraphStageResult {
  const topLevelSymbolIds = [...input.symbols.keys()].sort((left, right) =>
    left.localeCompare(right),
  );

  return {
    moduleGraph: buildModuleGraphFromSource({
      filePath: input.filePath,
      parsedSourceFile: input.parsedSourceFile,
      topLevelSymbolIds,
    }),
  };
}

export function runProjectModuleGraphStage(input: {
  parsedFiles: ParsedProjectFile[];
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
}): ModuleGraphStageResult {
  return {
    moduleGraph: buildModuleGraphFromSources(
      input.parsedFiles.map((parsedFile) => ({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
        topLevelSymbolIds: [
          ...(input.symbolsByFilePath.get(parsedFile.filePath)?.keys() ?? []),
        ].sort((left, right) => left.localeCompare(right)),
      })),
    ),
  };
}

export function runProjectBindingResolutionStage(input: {
  moduleGraph: ModuleGraph;
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
}): ProjectBindingResolutionStageResult {
  return buildProjectBindingResolution(input);
}

export function runAbstractValueStage(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
}): AbstractValueStageResult {
  return {
    classExpressions: collectClassExpressionSummaries(input),
  };
}

export function runProjectAbstractValueStage(input: {
  parsedFiles: ParsedProjectFile[];
}): AbstractValueStageResult {
  return {
    classExpressions: input.parsedFiles.flatMap((parsedFile) =>
      collectClassExpressionSummaries({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
      }),
    ),
  };
}

export function runCssAnalysisStage(input: {
  selectorCssSources: SelectorSourceInput[];
}): CssAnalysisStageResult {
  return {
    cssFiles: analyzeCssSources(input.selectorCssSources),
  };
}

export function runReachabilityStage(input: {
  moduleGraph: ModuleGraph;
  selectorCssSources: SelectorSourceInput[];
}): ReachabilityStageResult {
  return {
    reachabilitySummary: buildReachabilitySummary({
      moduleGraph: input.moduleGraph,
      cssSources: input.selectorCssSources,
    }),
  };
}

export function runSelectorInputStage(input: {
  selectorQueries: string[];
  selectorCssSources: SelectorSourceInput[];
}): SelectorInputStageResult {
  const directQueries = input.selectorQueries.map((selectorText) => ({
    selectorText,
    source: { kind: "direct-query" as const },
  }));
  const cssDerivedQueries = input.selectorCssSources.flatMap((selectorSource) =>
    extractSelectorQueriesFromCssText(selectorSource),
  );

  return {
    selectorQueries: [...directQueries, ...cssDerivedQueries],
  };
}

export function runSelectorParsingStage(input: {
  selectorQueries: SelectorInputStageResult["selectorQueries"];
}): SelectorParsingStageResult {
  return {
    selectorQueries: buildParsedSelectorQueries(input.selectorQueries),
  };
}

export function runSelectorAnalysisStage(input: {
  selectorQueries: SelectorParsingStageResult["selectorQueries"];
  renderSubtrees: RenderSubtree[];
  reachabilitySummary: ReachabilitySummary;
}): SelectorAnalysisStageResult {
  return {
    selectorQueryResults: analyzeSelectorQueries(input),
  };
}

export function runRuleExecutionStage(input: {
  cssFiles: ExperimentalCssFileAnalysis[];
  selectorQueryResults: SelectorAnalysisStageResult["selectorQueryResults"];
}): RuleExecutionStageResult {
  return {
    experimentalRuleResults: runExperimentalRules(input),
  };
}
