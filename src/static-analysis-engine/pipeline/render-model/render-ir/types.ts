import type { ClassExpressionSummary } from "../abstract-values/types.js";
import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SourceAnchor } from "../../../types/core.js";

export type RenderNodeKind =
  | "element"
  | "fragment"
  | "conditional"
  | "repeated-region"
  | "component-reference"
  | "unknown";

export type RenderNodeBase = {
  kind: RenderNodeKind;
  sourceAnchor: SourceAnchor;
  placementAnchor?: SourceAnchor;
  expandedFromComponentReference?: RenderComponentReferenceExpansion;
  staticallySkippedBranches?: RenderSkippedBranch[];
  traces?: AnalysisTrace[];
};

export type RenderSkippedBranch = {
  reason: "condition-resolved-true" | "condition-resolved-false" | "expression-resolved-nullish";
  conditionSourceText: string;
  skippedBranch: "when-true" | "when-false";
  sourceAnchor: SourceAnchor;
  node: RenderNode;
};

export type RenderComponentReferenceExpansion = {
  componentKey: string;
  componentName: string;
  filePath: string;
  targetSourceAnchor: SourceAnchor;
  sourceAnchor: SourceAnchor;
  traces: AnalysisTrace[];
};

export type RenderElementNode = RenderNodeBase & {
  kind: "element";
  tagName: string;
  className?: ClassExpressionSummary;
  children: RenderNode[];
};

export type RenderFragmentNode = RenderNodeBase & {
  kind: "fragment";
  children: RenderNode[];
};

export type RenderConditionalNode = RenderNodeBase & {
  kind: "conditional";
  conditionSourceText: string;
  whenTrue: RenderNode;
  whenFalse: RenderNode;
};

export type RenderRepeatedRegionNode = RenderNodeBase & {
  kind: "repeated-region";
  template: RenderNode;
  reason: string;
};

export type RenderComponentReferenceNode = RenderNodeBase & {
  kind: "component-reference";
  componentName: string;
  componentKey?: string;
  className?: ClassExpressionSummary;
  reason: string;
};

export type RenderUnknownNode = RenderNodeBase & {
  kind: "unknown";
  reason: string;
};

export type RenderNode =
  | RenderElementNode
  | RenderFragmentNode
  | RenderConditionalNode
  | RenderRepeatedRegionNode
  | RenderComponentReferenceNode
  | RenderUnknownNode;

export type RenderSubtree = {
  root: RenderNode;
  exported: boolean;
  componentKey?: string;
  componentName?: string;
  sourceAnchor: SourceAnchor;
};

export type RenderRegionPathSegment =
  | { kind: "root" }
  | { kind: "fragment-child"; childIndex: number }
  | { kind: "conditional-branch"; branch: "when-true" | "when-false" }
  | { kind: "repeated-template" };

export type RenderRegionKind = "subtree-root" | "conditional-branch" | "repeated-template";

export type RenderRegion = {
  filePath: string;
  componentKey?: string;
  componentName?: string;
  kind: RenderRegionKind;
  path: RenderRegionPathSegment[];
  sourceAnchor: SourceAnchor;
};
