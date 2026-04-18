import type { ClassExpressionSummary } from "../abstract-values/types.js";
import type { SourceAnchor } from "../../types/core.js";

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
  componentName?: string;
  sourceAnchor: SourceAnchor;
};
