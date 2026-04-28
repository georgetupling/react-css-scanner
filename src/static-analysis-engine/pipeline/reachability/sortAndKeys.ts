import type { RenderRegion } from "../render-model/render-ir/index.js";
import type { ReachabilityDerivation, StylesheetReachabilityContextRecord } from "./types.js";
import type { ProjectWideEntrySource, StylesheetImportRecord } from "./internalTypes.js";
import { normalizeProjectPath } from "./pathUtils.js";

export function serializeContextKey(contextRecord: StylesheetReachabilityContextRecord): string {
  if (contextRecord.context.kind === "source-file") {
    return `source-file:${contextRecord.context.filePath}`;
  }

  if (contextRecord.context.kind === "component") {
    return `component:${contextRecord.context.componentKey ?? `${contextRecord.context.filePath}:${contextRecord.context.componentName}`}`;
  }

  if (contextRecord.context.kind === "render-region") {
    return [
      "render-region",
      contextRecord.context.filePath,
      contextRecord.context.componentKey ?? "",
      contextRecord.context.componentName ?? "",
      contextRecord.context.regionKind,
      serializeRegionPath(contextRecord.context.path),
      contextRecord.context.sourceAnchor.startLine,
      contextRecord.context.sourceAnchor.startColumn,
      contextRecord.context.sourceAnchor.endLine ?? "",
      contextRecord.context.sourceAnchor.endColumn ?? "",
    ].join(":");
  }

  return [
    "render-subtree-root",
    contextRecord.context.filePath,
    contextRecord.context.componentKey ?? "",
    contextRecord.context.componentName ?? "",
    contextRecord.context.rootAnchor.startLine,
    contextRecord.context.rootAnchor.startColumn,
    contextRecord.context.rootAnchor.endLine ?? "",
    contextRecord.context.rootAnchor.endColumn ?? "",
  ].join(":");
}

export function compareDerivations(
  left: ReachabilityDerivation,
  right: ReachabilityDerivation,
): number {
  return serializeDerivation(left).localeCompare(serializeDerivation(right));
}

const derivationKeyCache = new WeakMap<ReachabilityDerivation, string>();

export function serializeDerivation(derivation: ReachabilityDerivation): string {
  const cachedKey = derivationKeyCache.get(derivation);
  if (cachedKey) {
    return cachedKey;
  }

  let key: string;
  switch (derivation.kind) {
    case "source-file-direct-import":
      key = derivation.kind;
      break;
    case "source-file-project-wide-external-css":
      key = [derivation.kind, derivation.stylesheetHref].join(":");
      break;
    case "source-file-project-wide-app-entry-css":
    case "source-file-outside-app-entry-css-boundary":
      key = [derivation.kind, derivation.entrySourceFilePath, derivation.appRootPath].join(":");
      break;
    case "whole-component-direct-import":
    case "whole-component-all-known-renderers-definite":
    case "whole-component-at-least-one-renderer":
    case "whole-component-only-possible-renderers":
      key = derivation.kind;
      break;
    case "whole-component-unknown-barrier":
    case "render-region-unknown-barrier":
      key = [derivation.kind, derivation.reason].join(":");
      break;
    case "placement-derived-region":
      key = [
        derivation.kind,
        derivation.toComponentName,
        derivation.toFilePath ?? "",
        derivation.renderPath,
      ].join(":");
      break;
  }

  derivationKeyCache.set(derivation, key);
  return key;
}

export function createComponentKey(filePath: string, componentName: string): string {
  return `${normalizeProjectPath(filePath) ?? filePath}::${componentName}`;
}

export function createPackageCssImportKey(sourceFilePath: string, specifier: string): string {
  return `${normalizeProjectPath(sourceFilePath) ?? sourceFilePath}:${specifier}`;
}

export function compareContextRecords(
  left: StylesheetReachabilityContextRecord,
  right: StylesheetReachabilityContextRecord,
): number {
  if (left.context.kind !== right.context.kind) {
    return left.context.kind.localeCompare(right.context.kind);
  }

  if (left.context.kind === "source-file" && right.context.kind === "source-file") {
    return left.context.filePath.localeCompare(right.context.filePath);
  }

  if (left.context.kind === "component" && right.context.kind === "component") {
    return (
      left.context.filePath.localeCompare(right.context.filePath) ||
      (left.context.componentKey ?? "").localeCompare(right.context.componentKey ?? "") ||
      left.context.componentName.localeCompare(right.context.componentName)
    );
  }

  if (left.context.kind === "render-subtree-root" && right.context.kind === "render-subtree-root") {
    return (
      left.context.filePath.localeCompare(right.context.filePath) ||
      (left.context.componentKey ?? "").localeCompare(right.context.componentKey ?? "") ||
      (left.context.componentName ?? "").localeCompare(right.context.componentName ?? "") ||
      left.context.rootAnchor.startLine - right.context.rootAnchor.startLine ||
      left.context.rootAnchor.startColumn - right.context.rootAnchor.startColumn ||
      (left.context.rootAnchor.endLine ?? 0) - (right.context.rootAnchor.endLine ?? 0) ||
      (left.context.rootAnchor.endColumn ?? 0) - (right.context.rootAnchor.endColumn ?? 0)
    );
  }

  if (left.context.kind === "render-region" && right.context.kind === "render-region") {
    return (
      left.context.filePath.localeCompare(right.context.filePath) ||
      (left.context.componentKey ?? "").localeCompare(right.context.componentKey ?? "") ||
      (left.context.componentName ?? "").localeCompare(right.context.componentName ?? "") ||
      left.context.regionKind.localeCompare(right.context.regionKind) ||
      serializeRegionPath(left.context.path).localeCompare(
        serializeRegionPath(right.context.path),
      ) ||
      left.context.sourceAnchor.startLine - right.context.sourceAnchor.startLine ||
      left.context.sourceAnchor.startColumn - right.context.sourceAnchor.startColumn ||
      (left.context.sourceAnchor.endLine ?? 0) - (right.context.sourceAnchor.endLine ?? 0) ||
      (left.context.sourceAnchor.endColumn ?? 0) - (right.context.sourceAnchor.endColumn ?? 0)
    );
  }

  return 0;
}

export function serializeRegionPath(path: RenderRegion["path"]): string {
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

export function compareEdges(
  left: import("../render-model/render-graph/types.js").RenderGraphEdge,
  right: import("../render-model/render-graph/types.js").RenderGraphEdge,
): number {
  return (
    left.fromFilePath.localeCompare(right.fromFilePath) ||
    (left.fromComponentKey ?? "").localeCompare(right.fromComponentKey ?? "") ||
    left.fromComponentName.localeCompare(right.fromComponentName) ||
    left.toComponentName.localeCompare(right.toComponentName) ||
    (left.toComponentKey ?? "").localeCompare(right.toComponentKey ?? "") ||
    (left.toFilePath ?? "").localeCompare(right.toFilePath ?? "")
  );
}

export function compareStylesheetImportRecords(
  left: StylesheetImportRecord,
  right: StylesheetImportRecord,
): number {
  return `${left.importerFilePath}:${left.specifier}:${left.resolvedFilePath}`.localeCompare(
    `${right.importerFilePath}:${right.specifier}:${right.resolvedFilePath}`,
  );
}

export function compareProjectWideEntrySources(
  left: ProjectWideEntrySource,
  right: ProjectWideEntrySource,
): number {
  return (
    left.entrySourceFilePath.localeCompare(right.entrySourceFilePath) ||
    left.appRootPath.localeCompare(right.appRootPath)
  );
}
