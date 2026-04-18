import ts from "typescript";

import type { SameFileComponentDefinition } from "../render-ir/index.js";
import { isIntrinsicTagName } from "../render-ir/resolution/resolveExactIntrinsicTag.js";
import type { RenderGraph, RenderGraphEdge, RenderGraphNode } from "./types.js";

export function buildRenderGraph(input: {
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  componentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
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

    const targetDefinition = resolveComponentDefinition(
      tagNameNode,
      input.availableComponents,
      input.namespaceComponents,
    );

    edges.push({
      fromComponentName: input.definition.componentName,
      fromFilePath: input.definition.filePath,
      toComponentName: targetDefinition?.componentName ?? tagName,
      toFilePath: targetDefinition?.filePath,
      targetSourceAnchor: targetDefinition?.sourceAnchor,
      sourceAnchor: toSourceAnchor(
        tagNameNode,
        input.definition.parsedSourceFile,
        input.definition.filePath,
      ),
      resolution: targetDefinition ? "resolved" : "unresolved",
      traversal: "direct-jsx",
    });
  });

  return edges;
}

function resolveComponentDefinition(
  tagNameNode: ts.JsxTagNameExpression,
  availableComponents: Map<string, SameFileComponentDefinition>,
  namespaceComponents: Map<string, Map<string, SameFileComponentDefinition>>,
): SameFileComponentDefinition | undefined {
  if (ts.isPropertyAccessExpression(tagNameNode) && ts.isIdentifier(tagNameNode.expression)) {
    return namespaceComponents.get(tagNameNode.expression.text)?.get(tagNameNode.name.text);
  }

  return availableComponents.get(tagNameNode.getText());
}

function visitNode(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => visitNode(child, visitor));
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
