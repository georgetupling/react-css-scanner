import type {
  RenderConditionalNode,
  RenderNode,
  RenderRepeatedRegionNode,
  RenderSubtree,
} from "./types.js";
import type { RenderRegion, RenderRegionPathSegment } from "./types.js";

export function collectRenderRegionsFromSubtrees(renderSubtrees: RenderSubtree[]): RenderRegion[] {
  return renderSubtrees
    .flatMap((renderSubtree) => collectRegionsForSubtree(renderSubtree))
    .sort(compareRegions);
}

function collectRegionsForSubtree(renderSubtree: RenderSubtree): RenderRegion[] {
  const filePath = renderSubtree.sourceAnchor.filePath.replace(/\\/g, "/");
  const regions: RenderRegion[] = [
    {
      filePath,
      componentName: renderSubtree.componentName,
      kind: "subtree-root",
      path: [{ kind: "root" }],
      sourceAnchor: getRegionSourceAnchor(renderSubtree.root),
    },
  ];

  collectNestedRegions({
    node: renderSubtree.root,
    filePath,
    componentName: renderSubtree.componentName,
    path: [{ kind: "root" }],
    regions,
  });

  return regions;
}

function collectNestedRegions(input: {
  node: RenderNode;
  filePath: string;
  componentName?: string;
  path: RenderRegionPathSegment[];
  regions: RenderRegion[];
}): void {
  if (input.node.kind === "conditional") {
    collectConditionalRegions({
      node: input.node,
      filePath: input.filePath,
      componentName: input.componentName,
      path: input.path,
      regions: input.regions,
    });
    return;
  }

  if (input.node.kind === "repeated-region") {
    collectRepeatedTemplateRegion({
      node: input.node,
      filePath: input.filePath,
      componentName: input.componentName,
      path: input.path,
      regions: input.regions,
    });
    return;
  }

  if (input.node.kind === "element" || input.node.kind === "fragment") {
    input.node.children.forEach((child, childIndex) =>
      collectNestedRegions({
        node: child,
        filePath: input.filePath,
        componentName: input.componentName,
        path: [...input.path, { kind: "fragment-child", childIndex }],
        regions: input.regions,
      }),
    );
  }
}

function collectConditionalRegions(input: {
  node: RenderConditionalNode;
  filePath: string;
  componentName?: string;
  path: RenderRegionPathSegment[];
  regions: RenderRegion[];
}): void {
  const whenTruePath: RenderRegionPathSegment[] = [
    ...input.path,
    { kind: "conditional-branch", branch: "when-true" },
  ];
  const whenFalsePath: RenderRegionPathSegment[] = [
    ...input.path,
    { kind: "conditional-branch", branch: "when-false" },
  ];

  input.regions.push(
    {
      filePath: input.filePath,
      componentName: input.componentName,
      kind: "conditional-branch",
      path: whenTruePath,
      sourceAnchor: getRegionSourceAnchor(input.node.whenTrue),
    },
    {
      filePath: input.filePath,
      componentName: input.componentName,
      kind: "conditional-branch",
      path: whenFalsePath,
      sourceAnchor: getRegionSourceAnchor(input.node.whenFalse),
    },
  );

  collectNestedRegions({
    node: input.node.whenTrue,
    filePath: input.filePath,
    componentName: input.componentName,
    path: whenTruePath,
    regions: input.regions,
  });
  collectNestedRegions({
    node: input.node.whenFalse,
    filePath: input.filePath,
    componentName: input.componentName,
    path: whenFalsePath,
    regions: input.regions,
  });
}

function collectRepeatedTemplateRegion(input: {
  node: RenderRepeatedRegionNode;
  filePath: string;
  componentName?: string;
  path: RenderRegionPathSegment[];
  regions: RenderRegion[];
}): void {
  const templatePath: RenderRegionPathSegment[] = [...input.path, { kind: "repeated-template" }];
  input.regions.push({
    filePath: input.filePath,
    componentName: input.componentName,
    kind: "repeated-template",
    path: templatePath,
    sourceAnchor: getRegionSourceAnchor(input.node.template),
  });

  collectNestedRegions({
    node: input.node.template,
    filePath: input.filePath,
    componentName: input.componentName,
    path: templatePath,
    regions: input.regions,
  });
}

function compareRegions(left: RenderRegion, right: RenderRegion): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    (left.componentName ?? "").localeCompare(right.componentName ?? "") ||
    left.sourceAnchor.startLine - right.sourceAnchor.startLine ||
    left.sourceAnchor.startColumn - right.sourceAnchor.startColumn ||
    left.kind.localeCompare(right.kind) ||
    serializePath(left.path).localeCompare(serializePath(right.path))
  );
}

function serializePath(path: RenderRegionPathSegment[]): string {
  return path
    .map((segment) => {
      if (segment.kind === "root") {
        return "root";
      }

      if (segment.kind === "fragment-child") {
        return `fragment-child:${segment.childIndex}`;
      }

      if (segment.kind === "conditional-branch") {
        return `conditional-branch:${segment.branch}`;
      }

      return "repeated-template";
    })
    .join("/");
}

function getRegionSourceAnchor(node: RenderNode): RenderNode["sourceAnchor"] {
  return node.placementAnchor ?? node.sourceAnchor;
}
