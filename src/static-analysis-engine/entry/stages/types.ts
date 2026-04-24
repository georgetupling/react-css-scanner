import ts from "typescript";

import type { ClassExpressionSummary } from "../../pipeline/abstract-values/index.js";
import type { ExperimentalCssFileAnalysis } from "../../pipeline/css-analysis/index.js";
import type { ExternalCssSummary } from "../../pipeline/external-css/index.js";
import type { ModuleGraph } from "../../pipeline/module-graph/index.js";
import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type {
  ProjectComponentAvailability,
  RenderGraph,
} from "../../pipeline/render-graph/index.js";
import type {
  LocalHelperDefinition,
  ProjectRenderBindings,
  ProjectRenderDefinitions,
  RenderSubtree,
  SameFileComponentDefinition,
} from "../../pipeline/render-ir/index.js";
import type { ExperimentalRuleResult } from "../../pipeline/rule-execution/index.js";
import type { SelectorQueryResult } from "../../pipeline/selector-analysis/index.js";
import type {
  EngineSymbol,
  ProjectBindingResolution,
} from "../../pipeline/symbol-resolution/index.js";
import type { EngineModuleId, EngineSymbolId } from "../../types/core.js";
import type { AnalysisTrace } from "../../types/analysis.js";

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

export type ProjectSymbolCollection = {
  symbols: Map<EngineSymbolId, EngineSymbol>;
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
};

export type ProjectSymbolResolutionStageResult = ProjectBindingResolution;

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

export type ProjectRenderDefinitionsStageResult = ProjectRenderDefinitions;

export type ProjectRenderBindingsStageResult = ProjectRenderBindings;

export type ProjectComponentAvailabilityStageResult = ProjectComponentAvailability;

export type ProjectRenderGraphStageInput = {
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  componentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  importedComponentBindingTracesByFilePath: Map<string, Map<string, AnalysisTrace[]>>;
  importedNamespaceComponentDefinitionsByFilePath: Map<
    string,
    Map<string, Map<string, SameFileComponentDefinition>>
  >;
};

export type ProjectRenderIrStageInput = {
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  componentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  importedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  importedHelperDefinitionsByFilePath: Map<string, Map<string, LocalHelperDefinition>>;
  importedNamespaceExpressionBindingsByFilePath: Map<
    string,
    Map<string, Map<string, ts.Expression>>
  >;
  importedNamespaceHelperDefinitionsByFilePath: Map<
    string,
    Map<string, Map<string, LocalHelperDefinition>>
  >;
  importedNamespaceComponentDefinitionsByFilePath: Map<
    string,
    Map<string, Map<string, SameFileComponentDefinition>>
  >;
};

export type ProjectRenderSummaryStageResult = {
  renderDefinitions: ProjectRenderDefinitionsStageResult;
  renderBindings: ProjectRenderBindingsStageResult;
  componentAvailability: ProjectComponentAvailabilityStageResult;
  renderGraphInput: ProjectRenderGraphStageInput;
  renderIrInput: ProjectRenderIrStageInput;
};

export type CssAnalysisStageResult = {
  cssFiles: ExperimentalCssFileAnalysis[];
};

export type ExternalCssStageResult = {
  externalCssSummary: ExternalCssSummary;
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
