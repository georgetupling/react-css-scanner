import type { RenderNode, RenderSubtree } from "../render-ir/types.js";
import type { UnsupportedClassReferenceDiagnostic } from "./types.js";
import type { SourceAnchor } from "../../../types/core.js";
import type { FactGraphReactRenderSyntaxInputs } from "../../fact-graph/index.js";

export function collectUnsupportedClassReferences(input: {
  reactRenderSyntax?: FactGraphReactRenderSyntaxInputs;
  renderSubtrees: RenderSubtree[];
  classExpressionSummaries?: Array<{ location: SourceAnchor }>;
  includeTraces?: boolean;
}): UnsupportedClassReferenceDiagnostic[] {
  const includeTraces = input.includeTraces ?? true;
  const modeledClassReferenceKeys = collectModeledClassReferenceKeys({
    renderSubtrees: input.renderSubtrees,
    classExpressionSummaries: input.classExpressionSummaries ?? [],
  });
  const diagnostics = input.reactRenderSyntax
    ? collectGraphClassExpressionDiagnostics({
        reactRenderSyntax: input.reactRenderSyntax,
        modeledClassReferenceKeys,
        includeTraces,
      })
    : [];

  return diagnostics.sort((left, right) =>
    createAnchorKey(left.sourceAnchor).localeCompare(createAnchorKey(right.sourceAnchor)),
  );
}

function collectGraphClassExpressionDiagnostics(input: {
  reactRenderSyntax: FactGraphReactRenderSyntaxInputs;
  modeledClassReferenceKeys: Set<string>;
  includeTraces: boolean;
}): UnsupportedClassReferenceDiagnostic[] {
  const diagnostics: UnsupportedClassReferenceDiagnostic[] = [];

  for (const site of input.reactRenderSyntax.classExpressionSites) {
    if (
      site.classExpressionSiteKind !== "jsx-class" &&
      site.classExpressionSiteKind !== "component-prop-class"
    ) {
      continue;
    }

    if (input.modeledClassReferenceKeys.has(createAnchorKey(site.location))) {
      continue;
    }

    diagnostics.push(
      createUnsupportedClassReferenceDiagnostic({
        anchor: site.location,
        rawExpressionText: site.rawExpressionText,
        includeTraces: input.includeTraces,
      }),
    );
  }

  return diagnostics;
}

function createUnsupportedClassReferenceDiagnostic(input: {
  anchor: SourceAnchor;
  rawExpressionText: string;
  includeTraces: boolean;
}): UnsupportedClassReferenceDiagnostic {
  return {
    sourceAnchor: input.anchor,
    rawExpressionText: input.rawExpressionText,
    reason: "raw-jsx-class-not-modeled",
    traces: input.includeTraces
      ? [
          {
            traceId: `diagnostic:class-reference:unsupported:${input.anchor.filePath}:${input.anchor.startLine}:${input.anchor.startColumn}`,
            category: "render-expansion",
            summary:
              "raw JSX className syntax was present in the source file but was not represented in the render IR",
            anchor: input.anchor,
            children: [],
            metadata: {
              reason: "raw-jsx-class-not-modeled",
              rawExpressionText: input.rawExpressionText,
            },
          },
        ]
      : [],
  };
}

function collectModeledClassReferenceKeys(input: {
  renderSubtrees: RenderSubtree[];
  classExpressionSummaries: Array<{ location: SourceAnchor }>;
}): Set<string> {
  const keys = new Set<string>();

  for (const summary of input.classExpressionSummaries) {
    keys.add(createAnchorKey(summary.location));
  }

  for (const renderSubtree of input.renderSubtrees) {
    visitRenderNode(renderSubtree.root, (node) => {
      if ((node.kind === "element" || node.kind === "component-reference") && node.className) {
        keys.add(createAnchorKey(node.className.sourceAnchor));
      }
    });
  }

  return keys;
}

function visitRenderNode(node: RenderNode, visit: (node: RenderNode) => void): void {
  visit(node);

  if (node.kind === "element" || node.kind === "fragment") {
    for (const child of node.children) {
      visitRenderNode(child, visit);
    }
    return;
  }

  if (node.kind === "conditional") {
    visitRenderNode(node.whenTrue, visit);
    visitRenderNode(node.whenFalse, visit);
    return;
  }

  if (node.kind === "repeated-region") {
    visitRenderNode(node.template, visit);
  }
}

function createAnchorKey(anchor: SourceAnchor): string {
  return [
    normalizeProjectPath(anchor.filePath),
    anchor.startLine,
    anchor.startColumn,
    anchor.endLine ?? "",
    anchor.endColumn ?? "",
  ].join(":");
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
