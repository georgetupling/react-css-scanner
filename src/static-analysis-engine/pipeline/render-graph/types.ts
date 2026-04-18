import type { SourceAnchor } from "../../types/core.js";

export type RenderGraphNode = {
  componentName: string;
  filePath: string;
  exported: boolean;
  sourceAnchor: SourceAnchor;
};

export type RenderGraphEdge = {
  fromComponentName: string;
  fromFilePath: string;
  toComponentName: string;
  toFilePath?: string;
  targetSourceAnchor?: SourceAnchor;
  sourceAnchor: SourceAnchor;
  resolution: "resolved" | "unresolved";
  traversal: "direct-jsx";
};

export type RenderGraph = {
  nodes: RenderGraphNode[];
  edges: RenderGraphEdge[];
};
