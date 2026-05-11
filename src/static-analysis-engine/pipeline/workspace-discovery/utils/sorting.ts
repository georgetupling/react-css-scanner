import type { ProjectBoundary, ProjectResourceEdge } from "../types.js";

export function compareProjectBoundaries(left: ProjectBoundary, right: ProjectBoundary): number {
  return serializeProjectBoundary(left).localeCompare(serializeProjectBoundary(right));
}

export function compareProjectResourceEdges(
  left: ProjectResourceEdge,
  right: ProjectResourceEdge,
): number {
  return serializeProjectResourceEdge(left).localeCompare(serializeProjectResourceEdge(right));
}

function serializeProjectBoundary(boundary: ProjectBoundary): string {
  if (boundary.kind === "scan-root") {
    return `${boundary.kind}:${boundary.rootDir}`;
  }
  if (boundary.kind === "source-root") {
    return `${boundary.kind}:${boundary.filePath}`;
  }
  if (boundary.kind === "workspace-package") {
    return `${boundary.kind}:${boundary.packageName}:${boundary.entryFilePath}`;
  }
  return `${boundary.kind}:${boundary.htmlFilePath}:${boundary.entrySourceFilePath}:${boundary.appRootPath}`;
}

function serializeProjectResourceEdge(edge: ProjectResourceEdge): string {
  if (edge.kind === "html-stylesheet") {
    return [
      edge.kind,
      edge.fromHtmlFilePath,
      edge.documentOrder.toString().padStart(8, "0"),
      edge.href,
      edge.resolvedFilePath ?? "",
    ].join(":");
  }
  if (edge.kind === "html-script") {
    return `${edge.kind}:${edge.fromHtmlFilePath}:${edge.src}:${edge.resolvedFilePath ?? ""}:${edge.appRootPath ?? ""}`;
  }
  if (edge.kind === "stylesheet-import") {
    return `${edge.kind}:${edge.importerFilePath}:${edge.specifier}:${edge.resolvedFilePath}`;
  }
  if (edge.kind === "source-import") {
    return `${edge.kind}:${edge.importerFilePath}:${edge.specifier}:${edge.importKind}:${edge.importLoading}:${edge.resolutionStatus}:${edge.resolvedFilePath ?? ""}`;
  }
  return `${edge.kind}:${edge.importerKind}:${edge.importerFilePath}:${edge.specifier}:${edge.resolvedFilePath}`;
}
