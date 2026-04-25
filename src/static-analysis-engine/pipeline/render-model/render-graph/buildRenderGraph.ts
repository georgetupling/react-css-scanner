import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SourceAnchor } from "../../../types/core.js";
import type { RenderGraph, RenderGraphEdge, RenderGraphNode } from "./types.js";
import type {
  RenderComponentReferenceNode,
  RenderNode,
  RenderSubtree,
} from "../render-ir/types.js";

export function buildRenderGraph(input: { renderSubtrees: RenderSubtree[] }): RenderGraph {
  const nodes = input.renderSubtrees
    .filter((renderSubtree) => renderSubtree.componentName)
    .map<RenderGraphNode>((renderSubtree) => ({
      componentName: renderSubtree.componentName ?? "",
      filePath: normalizeProjectPath(renderSubtree.sourceAnchor.filePath),
      exported: renderSubtree.exported,
      sourceAnchor: normalizeAnchor(renderSubtree.sourceAnchor),
    }))
    .sort(compareNodes);

  const edges = input.renderSubtrees
    .filter((renderSubtree) => renderSubtree.componentName)
    .flatMap((renderSubtree) =>
      collectRenderEdgesFromSubtree({
        renderSubtree,
        fromComponentName: renderSubtree.componentName ?? "",
        fromFilePath: normalizeProjectPath(renderSubtree.sourceAnchor.filePath),
      }),
    )
    .sort(compareEdges);

  return { nodes, edges };
}

function collectRenderEdgesFromSubtree(input: {
  renderSubtree: RenderSubtree;
  fromComponentName: string;
  fromFilePath: string;
}): RenderGraphEdge[] {
  const edges: RenderGraphEdge[] = [];

  visitRenderNode(input.renderSubtree.root, "definite", (node, renderPath) => {
    if (node.expandedFromComponentReference) {
      const expansion = node.expandedFromComponentReference;
      edges.push({
        fromComponentName: input.fromComponentName,
        fromFilePath: input.fromFilePath,
        toComponentName: expansion.componentName,
        toFilePath: normalizeProjectPath(expansion.filePath),
        targetSourceAnchor: normalizeAnchor(expansion.targetSourceAnchor),
        sourceAnchor: normalizeAnchor(expansion.sourceAnchor),
        resolution: "resolved",
        traversal: "render-ir",
        renderPath,
        traces: [
          createRenderGraphTrace({
            traceId: `render-graph:edge:${input.fromFilePath}:${input.fromComponentName}:${expansion.componentName}:${renderPath}:resolved`,
            summary: summarizeRenderEdge({
              fromComponentName: input.fromComponentName,
              toComponentName: expansion.componentName,
              resolution: "resolved",
              renderPath,
            }),
            anchor: normalizeAnchor(expansion.sourceAnchor),
            children: expansion.traces,
            metadata: {
              fromComponentName: input.fromComponentName,
              fromFilePath: input.fromFilePath,
              toComponentName: expansion.componentName,
              toFilePath: normalizeProjectPath(expansion.filePath),
              resolution: "resolved",
              renderPath,
              traversal: "render-ir",
            },
          }),
        ],
      });
      return;
    }

    if (node.kind === "component-reference") {
      edges.push(buildUnresolvedRenderEdge({ node, ...input }));
    }
  });

  return edges;
}

function buildUnresolvedRenderEdge(input: {
  node: RenderComponentReferenceNode;
  renderSubtree: RenderSubtree;
  fromComponentName: string;
  fromFilePath: string;
}): RenderGraphEdge {
  const sourceAnchor = normalizeAnchor(input.node.sourceAnchor);

  return {
    fromComponentName: input.fromComponentName,
    fromFilePath: input.fromFilePath,
    toComponentName: input.node.componentName,
    sourceAnchor,
    resolution: "unresolved",
    traversal: "render-ir",
    renderPath: "unknown",
    traces: [
      createRenderGraphTrace({
        traceId: `render-graph:edge:${input.fromFilePath}:${input.fromComponentName}:${input.node.componentName}:unknown:unresolved`,
        summary: summarizeRenderEdge({
          fromComponentName: input.fromComponentName,
          toComponentName: input.node.componentName,
          resolution: "unresolved",
          renderPath: "unknown",
        }),
        anchor: sourceAnchor,
        children: input.node.traces ?? [],
        metadata: {
          fromComponentName: input.fromComponentName,
          fromFilePath: input.fromFilePath,
          toComponentName: input.node.componentName,
          resolution: "unresolved",
          renderPath: "unknown",
          traversal: "render-ir",
          reason: input.node.reason,
        },
      }),
    ],
  };
}

function visitRenderNode(
  node: RenderNode,
  renderPath: RenderGraphEdge["renderPath"],
  visit: (node: RenderNode, renderPath: RenderGraphEdge["renderPath"]) => void,
): void {
  visit(node, renderPath);

  if (node.kind === "element" || node.kind === "fragment") {
    for (const child of node.children) {
      visitRenderNode(child, renderPath, visit);
    }
    return;
  }

  if (node.kind === "conditional") {
    visitRenderNode(node.whenTrue, downgradeRenderPath(renderPath), visit);
    visitRenderNode(node.whenFalse, downgradeRenderPath(renderPath), visit);
    return;
  }

  if (node.kind === "repeated-region") {
    visitRenderNode(node.template, downgradeRenderPath(renderPath), visit);
  }
}

function downgradeRenderPath(
  renderPath: RenderGraphEdge["renderPath"],
): RenderGraphEdge["renderPath"] {
  return renderPath === "unknown" ? "unknown" : "possible";
}

function createRenderGraphTrace(input: {
  traceId: string;
  summary: string;
  anchor: SourceAnchor;
  metadata?: Record<string, unknown>;
  children?: AnalysisTrace[];
}): AnalysisTrace {
  return {
    traceId: input.traceId,
    category: "render-graph",
    summary: input.summary,
    anchor: input.anchor,
    children: [...(input.children ?? [])],
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function summarizeRenderEdge(input: {
  fromComponentName: string;
  toComponentName: string;
  resolution: RenderGraphEdge["resolution"];
  renderPath: RenderGraphEdge["renderPath"];
}): string {
  if (input.resolution === "unresolved") {
    return `could not resolve render edge ${input.fromComponentName} -> ${input.toComponentName}`;
  }

  if (input.renderPath === "possible") {
    return `resolved render edge ${input.fromComponentName} -> ${input.toComponentName} on a possible render path`;
  }

  if (input.renderPath === "unknown") {
    return `resolved render edge ${input.fromComponentName} -> ${input.toComponentName} with unknown render certainty`;
  }

  return `resolved render edge ${input.fromComponentName} -> ${input.toComponentName}`;
}

function compareNodes(left: RenderGraphNode, right: RenderGraphNode): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.componentName.localeCompare(right.componentName) ||
    compareAnchors(left.sourceAnchor, right.sourceAnchor)
  );
}

function compareEdges(left: RenderGraphEdge, right: RenderGraphEdge): number {
  return (
    left.fromFilePath.localeCompare(right.fromFilePath) ||
    left.fromComponentName.localeCompare(right.fromComponentName) ||
    compareAnchors(left.sourceAnchor, right.sourceAnchor) ||
    left.toComponentName.localeCompare(right.toComponentName) ||
    (left.toFilePath ?? "").localeCompare(right.toFilePath ?? "")
  );
}

function compareAnchors(left: SourceAnchor, right: SourceAnchor): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    (left.endLine ?? 0) - (right.endLine ?? 0) ||
    (left.endColumn ?? 0) - (right.endColumn ?? 0)
  );
}

function normalizeAnchor(anchor: SourceAnchor): SourceAnchor {
  return {
    ...anchor,
    filePath: normalizeProjectPath(anchor.filePath),
  };
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
