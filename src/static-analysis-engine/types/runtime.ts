import type { ClassExpressionSummary } from "../pipeline/abstract-values/types.js";
import type { ExperimentalCssFileAnalysis } from "../pipeline/css-analysis/types.js";
import type { ModuleGraph } from "../pipeline/module-graph/types.js";
import type { ReachabilitySummary } from "../pipeline/reachability/types.js";
import type { RenderGraph } from "../pipeline/render-graph/types.js";
import type { RenderSubtree } from "../pipeline/render-ir/types.js";
import type { ExperimentalRuleResult } from "../pipeline/rule-execution/types.js";
import type { SelectorQueryResult } from "../pipeline/selector-analysis/types.js";
import type { EngineSymbol } from "../pipeline/symbol-resolution/types.js";
import type { EngineSymbolId } from "./core.js";

export type StaticAnalysisEngineResult = {
  moduleGraph: ModuleGraph;
  symbols: Map<EngineSymbolId, EngineSymbol>;
  classExpressions: ClassExpressionSummary[];
  cssFiles: ExperimentalCssFileAnalysis[];
  reachabilitySummary: ReachabilitySummary;
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
  selectorQueryResults: SelectorQueryResult[];
  experimentalRuleResults: ExperimentalRuleResult[];
};
