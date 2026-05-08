import type { SourceAnchor } from "../../../types/core.js";
import type { StylesheetReachabilityRelation } from "../analysisTypes.js";
import { normalizeProjectPath } from "./normalization.js";

export function compareById<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

export function compareReachabilityRelations(
  left: StylesheetReachabilityRelation,
  right: StylesheetReachabilityRelation,
): number {
  return `${left.stylesheetId}:${left.sourceFileId ?? ""}:${left.componentId ?? ""}:${left.availability}`.localeCompare(
    `${right.stylesheetId}:${right.sourceFileId ?? ""}:${right.componentId ?? ""}:${right.availability}`,
  );
}

export function compareAnchors(left: SourceAnchor, right: SourceAnchor): number {
  return (
    normalizeProjectPath(left.filePath).localeCompare(normalizeProjectPath(right.filePath)) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    (left.endLine ?? 0) - (right.endLine ?? 0) ||
    (left.endColumn ?? 0) - (right.endColumn ?? 0)
  );
}

export function compareStringRecords(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }

  return serializeStringRecord(left).localeCompare(serializeStringRecord(right));
}

export function serializeStringRecord(record: Record<string, string>): string {
  return Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}
