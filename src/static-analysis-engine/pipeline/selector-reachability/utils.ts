import type { SourceAnchor } from "../../types/core.js";

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function anchorKey(anchor: SourceAnchor): string {
  return [
    anchor.filePath.replace(/\\/g, "/"),
    anchor.startLine,
    anchor.startColumn,
    anchor.endLine ?? "",
    anchor.endColumn ?? "",
  ].join(":");
}
