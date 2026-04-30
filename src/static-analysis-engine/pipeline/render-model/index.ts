export { buildRenderModel } from "./buildRenderModel.js";
export type { RenderModel, RenderModelBuildInput } from "./buildRenderModel.js";
export { toAbstractClassSet } from "../symbolic-evaluation/class-values/index.js";
export { toClassExpressionSummary } from "../symbolic-evaluation/adapters/classExpressionSummary.js";
export { collectUnsupportedClassReferences } from "./class-reference-diagnostics/index.js";
export {
  buildSameFileRenderSubtrees,
  collectRenderRegionsFromSubtrees,
} from "./render-ir/index.js";
export { buildRenderGraph } from "./render-graph/index.js";
export type {
  AbstractClassSet,
  AbstractValue,
  ClassDerivationStep,
  ClassExpressionSummary,
} from "../symbolic-evaluation/class-values/index.js";
export type {
  UnsupportedClassReferenceDiagnostic,
  UnsupportedClassReferenceReason,
} from "./class-reference-diagnostics/index.js";
export type { RenderGraph, RenderGraphEdge, RenderGraphNode } from "./render-graph/index.js";
export type {
  RenderComponentReferenceExpansion,
  RenderComponentReferenceNode,
  RenderConditionalNode,
  RenderElementNode,
  RenderFragmentNode,
  RenderNode,
  RenderNodeKind,
  RenderRepeatedRegionNode,
  RenderRegion,
  RenderRegionKind,
  RenderRegionPathSegment,
  RenderSubtree,
  RenderUnknownNode,
} from "./render-ir/index.js";
