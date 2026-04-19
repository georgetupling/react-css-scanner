import ts from "typescript";

import type { AnalysisTrace } from "../../types/analysis.js";
import type { SameFileComponentDefinition } from "../render-ir/index.js";
import { isIntrinsicTagName } from "../render-ir/resolution/resolveExactIntrinsicTag.js";
import type { RenderGraph, RenderGraphEdge, RenderGraphNode } from "./types.js";

export function buildRenderGraph(input: {
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  componentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  importedComponentBindingTracesByFilePath: Map<string, Map<string, AnalysisTrace[]>>;
  importedNamespaceComponentDefinitionsByFilePath: Map<
    string,
    Map<string, Map<string, SameFileComponentDefinition>>
  >;
}): RenderGraph {
  const nodes = [...input.componentDefinitionsByFilePath.entries()]
    .flatMap(([filePath, componentDefinitions]) =>
      componentDefinitions.map<RenderGraphNode>((definition) => ({
        componentName: definition.componentName,
        filePath,
        exported: definition.exported,
        sourceAnchor: definition.sourceAnchor,
      })),
    )
    .sort(compareNodes);

  const edges = [...input.componentDefinitionsByFilePath.entries()]
    .flatMap(([filePath, componentDefinitions]) =>
      componentDefinitions.flatMap((definition) =>
        collectRenderEdgesForComponent({
          definition,
          availableComponents: input.componentsByFilePath.get(filePath) ?? new Map(),
          importedComponentBindingTraces:
            input.importedComponentBindingTracesByFilePath.get(filePath) ?? new Map(),
          namespaceComponents:
            input.importedNamespaceComponentDefinitionsByFilePath.get(filePath) ?? new Map(),
        }),
      ),
    )
    .sort(compareEdges);

  return { nodes, edges };
}

function collectRenderEdgesForComponent(input: {
  definition: SameFileComponentDefinition;
  availableComponents: Map<string, SameFileComponentDefinition>;
  importedComponentBindingTraces: Map<string, AnalysisTrace[]>;
  namespaceComponents: Map<string, Map<string, SameFileComponentDefinition>>;
}): RenderGraphEdge[] {
  const edges: RenderGraphEdge[] = [];

  visitNode(input.definition.rootExpression, (node) => {
    if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) {
      return;
    }

    const tagNameNode = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
    const tagName = tagNameNode.getText(input.definition.parsedSourceFile);
    if (isIntrinsicTagName(tagName)) {
      return;
    }

    const resolvedComponent = resolveComponentDefinition(
      tagNameNode,
      input.availableComponents,
      input.importedComponentBindingTraces,
      input.namespaceComponents,
    );

    const sourceAnchor = toSourceAnchor(
      tagNameNode,
      input.definition.parsedSourceFile,
      input.definition.filePath,
    );
    const renderPath = classifyRenderPath({
      jsxNode: node,
      componentRootExpression: input.definition.rootExpression,
      resolved: Boolean(resolvedComponent.definition),
    });

    edges.push({
      fromComponentName: input.definition.componentName,
      fromFilePath: input.definition.filePath,
      toComponentName: resolvedComponent.definition?.componentName ?? tagName,
      toFilePath: resolvedComponent.definition?.filePath,
      targetSourceAnchor: resolvedComponent.definition?.sourceAnchor,
      sourceAnchor,
      resolution: resolvedComponent.definition ? "resolved" : "unresolved",
      traversal: "direct-jsx",
      renderPath,
      traces: [
        createRenderGraphTrace({
          traceId: `render-graph:edge:${input.definition.filePath}:${input.definition.componentName}:${resolvedComponent.definition?.componentName ?? tagName}:${renderPath}:${resolvedComponent.definition ? "resolved" : "unresolved"}`,
          summary: summarizeRenderEdge({
            fromComponentName: input.definition.componentName,
            toComponentName: resolvedComponent.definition?.componentName ?? tagName,
            resolution: resolvedComponent.definition ? "resolved" : "unresolved",
            renderPath,
          }),
          anchor: sourceAnchor,
          children: resolvedComponent.traces,
          metadata: {
            fromComponentName: input.definition.componentName,
            fromFilePath: input.definition.filePath,
            toComponentName: resolvedComponent.definition?.componentName ?? tagName,
            toFilePath: resolvedComponent.definition?.filePath,
            resolution: resolvedComponent.definition ? "resolved" : "unresolved",
            renderPath,
            traversal: "direct-jsx",
          },
        }),
      ],
    });
  });

  return edges;
}

function resolveComponentDefinition(
  tagNameNode: ts.JsxTagNameExpression,
  availableComponents: Map<string, SameFileComponentDefinition>,
  importedComponentBindingTraces: Map<string, AnalysisTrace[]>,
  namespaceComponents: Map<string, Map<string, SameFileComponentDefinition>>,
): {
  definition?: SameFileComponentDefinition;
  traces: AnalysisTrace[];
} {
  if (ts.isPropertyAccessExpression(tagNameNode) && ts.isIdentifier(tagNameNode.expression)) {
    return {
      definition: namespaceComponents.get(tagNameNode.expression.text)?.get(tagNameNode.name.text),
      traces: [],
    };
  }

  const localName = tagNameNode.getText();
  return {
    definition: availableComponents.get(localName),
    traces: [...(importedComponentBindingTraces.get(localName) ?? [])],
  };
}

function visitNode(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => visitNode(child, visitor));
}

function classifyRenderPath(input: {
  jsxNode: ts.JsxElement | ts.JsxSelfClosingElement;
  componentRootExpression: ts.Expression;
  resolved: boolean;
}): RenderGraphEdge["renderPath"] {
  if (!input.resolved) {
    return "unknown";
  }

  let current: ts.Node | undefined = input.jsxNode;

  while (current && current !== input.componentRootExpression) {
    const parent: ts.Node | undefined = current.parent;
    if (!parent) {
      break;
    }

    if (
      ts.isConditionalExpression(parent) ||
      (ts.isBinaryExpression(parent) &&
        (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isCallExpression(parent)
    ) {
      return "possible";
    }

    current = parent;
  }

  return "definite";
}

function toSourceAnchor(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
): import("../../types/core.js").SourceAnchor {
  const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
  const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

  return {
    filePath,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
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

function createRenderGraphTrace(input: {
  traceId: string;
  summary: string;
  anchor: import("../../types/core.js").SourceAnchor;
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

function compareAnchors(
  left: import("../../types/core.js").SourceAnchor,
  right: import("../../types/core.js").SourceAnchor,
): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    (left.endLine ?? 0) - (right.endLine ?? 0) ||
    (left.endColumn ?? 0) - (right.endColumn ?? 0)
  );
}
