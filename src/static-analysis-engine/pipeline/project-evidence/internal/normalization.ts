import type { SourceAnchor } from "../../../types/core.js";
import { isCssModulePath } from "../../../libraries/stylesheets/cssModulePaths.js";

export function isCssModuleStylesheet(filePath: string | undefined): boolean {
  return Boolean(filePath && isCssModulePath(filePath));
}

export function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function normalizeOptionalProjectPath(filePath: string | undefined): string | undefined {
  return filePath ? normalizeProjectPath(filePath) : undefined;
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function normalizeAnchor(anchor: SourceAnchor): SourceAnchor {
  return {
    ...anchor,
    filePath: normalizeProjectPath(anchor.filePath),
  };
}

export function normalizeOptionalAnchor(
  anchor: SourceAnchor | undefined,
): SourceAnchor | undefined {
  return anchor ? normalizeAnchor(anchor) : undefined;
}
