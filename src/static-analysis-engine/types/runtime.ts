import type { ClassExpressionSummary } from "../pipeline/abstract-values/types.js";
import type { ModuleGraph } from "../pipeline/module-graph/types.js";
import type { RenderSubtree } from "../pipeline/render-ir/types.js";
import type { SelectorQueryResult } from "../pipeline/selector-analysis/types.js";
import type { EngineSymbol } from "../pipeline/symbol-resolution/types.js";
import type { EngineSymbolId } from "./core.js";

export type StaticAnalysisEngineResult = {
  moduleGraph: ModuleGraph;
  symbols: Map<EngineSymbolId, EngineSymbol>;
  classExpressions: ClassExpressionSummary[];
  renderSubtrees: RenderSubtree[];
  selectorQueryResults: SelectorQueryResult[];
};
