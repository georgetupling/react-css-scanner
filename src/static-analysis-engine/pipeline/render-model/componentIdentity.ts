import type { SourceAnchor } from "../../types/core.js";

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function createComponentKey(input: {
  filePath: string;
  sourceAnchor: SourceAnchor;
  componentName: string;
}): string {
  const normalizedFilePath = normalizeProjectPath(input.filePath);
  return [
    "component",
    normalizedFilePath,
    input.componentName,
    input.sourceAnchor.startLine,
    input.sourceAnchor.startColumn,
    input.sourceAnchor.endLine ?? 0,
    input.sourceAnchor.endColumn ?? 0,
  ].join(":");
}

export function normalizeComponentKey(componentKey: string): string {
  return componentKey.replace(/\\/g, "/");
}
