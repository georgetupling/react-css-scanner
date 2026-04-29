export { buildFactGraph } from "./buildFactGraph.js";
export { graphToCssRuleFileInputs } from "./adapters/cssAnalysisInputs.js";
export { graphToSelectorEntries } from "./adapters/selectorAnalysisInputs.js";
export type {
  FactEdge,
  FactEdgeId,
  FactGraph,
  FactGraphDiagnostic,
  FactGraphEdges,
  FactGraphIndexes,
  FactGraphInput,
  FactGraphMeta,
  FactGraphNodes,
  FactGraphResult,
  FactNode,
  FactNodeId,
  FactProvenance,
  FileResourceNode,
  ContainsEdge,
  DefinesSelectorEdge,
  ModuleNode,
  OriginatesFromFileEdge,
  RuleDefinitionNode,
  SelectorBranchNode,
  SelectorNode,
  StyleSheetNode,
} from "./types.js";
export type { FactGraphCssRuleFileInput } from "./adapters/cssAnalysisInputs.js";
