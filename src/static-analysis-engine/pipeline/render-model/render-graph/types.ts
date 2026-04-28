import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SourceAnchor } from "../../../types/core.js";

export type RenderGraphNode = {
  componentKey: string;
  componentName: string;
  filePath: string;
  exported: boolean;
  sourceAnchor: SourceAnchor;
};

export type RenderGraphEdge = {
  fromComponentKey: string;
  fromComponentName: string;
  fromFilePath: string;
  toComponentKey?: string;
  toComponentName: string;
  toFilePath?: string;
  targetSourceAnchor?: SourceAnchor;
  sourceAnchor: SourceAnchor;
  resolution: "resolved" | "unresolved";
  traversal: "render-ir";
  renderPath: "definite" | "possible" | "unknown";
  traces: AnalysisTrace[];
};

export type RenderGraph = {
  nodes: RenderGraphNode[];
  edges: RenderGraphEdge[];
};
