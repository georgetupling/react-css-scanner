import type {
  RuntimeCssAvailability,
  RuntimeCssChunk,
  RuntimeCssDiagnostic,
  RuntimeCssEntry,
} from "./types.js";

export function compareRuntimeCssEntries(left: RuntimeCssEntry, right: RuntimeCssEntry): number {
  return left.id.localeCompare(right.id);
}

export function compareRuntimeCssChunks(left: RuntimeCssChunk, right: RuntimeCssChunk): number {
  return left.id.localeCompare(right.id);
}

export function compareRuntimeCssAvailability(
  left: RuntimeCssAvailability,
  right: RuntimeCssAvailability,
): number {
  return (
    left.stylesheetFilePath.localeCompare(right.stylesheetFilePath) ||
    left.sourceFilePath.localeCompare(right.sourceFilePath) ||
    left.entryId.localeCompare(right.entryId) ||
    left.chunkId.localeCompare(right.chunkId) ||
    left.entrySourceFilePath.localeCompare(right.entrySourceFilePath) ||
    (left.htmlFilePath ?? "").localeCompare(right.htmlFilePath ?? "") ||
    left.availability.localeCompare(right.availability) ||
    left.reason.localeCompare(right.reason)
  );
}

export function compareRuntimeCssDiagnostics(
  left: RuntimeCssDiagnostic,
  right: RuntimeCssDiagnostic,
): number {
  return (
    left.code.localeCompare(right.code) ||
    (left.filePath ?? "").localeCompare(right.filePath ?? "") ||
    left.message.localeCompare(right.message)
  );
}
