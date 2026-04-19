import ts from "typescript";

import type { ClassExpressionSummary } from "../../pipeline/abstract-values/index.js";
import type { ExperimentalCssFileAnalysis } from "../../pipeline/css-analysis/index.js";
import type { ModuleGraph } from "../../pipeline/module-graph/index.js";
import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { RenderGraph } from "../../pipeline/render-graph/index.js";
import type { RenderSubtree } from "../../pipeline/render-ir/index.js";
import type { ExperimentalRuleResult } from "../../pipeline/rule-execution/index.js";
import type {
  ExtractedSelectorQuery,
  ParsedSelectorQuery,
  SelectorQueryResult,
} from "../../pipeline/selector-analysis/index.js";
import type {
  EngineSymbol,
  ResolvedImportedBinding,
  ResolvedImportedComponentBinding,
  ResolvedNamespaceImport,
} from "../../pipeline/symbol-resolution/index.js";
import type { EngineModuleId, EngineSymbolId } from "../../types/core.js";
import type { ProjectRenderContext } from "./buildProjectRenderContext.js";

export type ParseStageResult = {
  parsedSourceFile: ts.SourceFile;
};

export type ParsedProjectFile = {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
};

export type ProjectParseStageResult = {
  parsedFiles: ParsedProjectFile[];
};

export type SymbolResolutionStageResult = {
  moduleId: EngineModuleId;
  symbols: Map<EngineSymbolId, EngineSymbol>;
};

export type ProjectSymbolResolutionStageResult = {
  symbols: Map<EngineSymbolId, EngineSymbol>;
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
};

export type ProjectBindingResolutionStageResult = {
  symbols: Map<EngineSymbolId, EngineSymbol>;
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  resolvedImportedBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  resolvedImportedComponentBindingsByFilePath: Map<string, ResolvedImportedComponentBinding[]>;
  resolvedNamespaceImportsByFilePath: Map<string, ResolvedNamespaceImport[]>;
  exportedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  importedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
};

export type ModuleGraphStageResult = {
  moduleGraph: ModuleGraph;
};

export type AbstractValueStageResult = {
  classExpressions: ClassExpressionSummary[];
};

export type RenderIrStageResult = {
  renderSubtrees: RenderSubtree[];
};

export type RenderGraphStageResult = {
  renderGraph: RenderGraph;
};

export type ProjectRenderContextStageResult = {
  projectRenderContext: ProjectRenderContext;
};

export type CssAnalysisStageResult = {
  cssFiles: ExperimentalCssFileAnalysis[];
};

export type ReachabilityStageResult = {
  reachabilitySummary: ReachabilitySummary;
};

export type SelectorAnalysisStageResult = {
  selectorQueryResults: SelectorQueryResult[];
};

export type RuleExecutionStageResult = {
  experimentalRuleResults: ExperimentalRuleResult[];
};

export type SelectorInputStageResult = {
  selectorQueries: ExtractedSelectorQuery[];
};

export type SelectorParsingStageResult = {
  selectorQueries: ParsedSelectorQuery[];
};
