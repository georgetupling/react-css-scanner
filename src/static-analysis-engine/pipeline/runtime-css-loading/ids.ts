import { normalizeProjectPath } from "./pathUtils.js";
import type { RuntimeCssChunk, RuntimeCssEntry, RuntimeCssEnvironmentContext } from "./types.js";

export function runtimeCssEntryId(input: {
  kind: RuntimeCssEntry["kind"];
  entrySourceFilePath: string;
  htmlFilePath?: string;
}): string {
  return [
    "runtime-css-entry",
    input.kind,
    normalizeProjectPath(input.entrySourceFilePath),
    input.htmlFilePath ? normalizeProjectPath(input.htmlFilePath) : "",
  ].join(":");
}

export function runtimeCssChunkId(input: {
  entryId: string;
  loading: RuntimeCssChunk["loading"];
  rootSourceFilePath: string;
}): string {
  return [
    "runtime-css-chunk",
    input.entryId,
    input.loading,
    normalizeProjectPath(input.rootSourceFilePath),
  ].join(":");
}

export function runtimeCssEnvironmentContextId(input: {
  kind: RuntimeCssEnvironmentContext["kind"];
  entryId: string;
  rootSourceFilePath: string;
}): string {
  return [
    "runtime-css-env",
    input.kind,
    input.entryId,
    normalizeProjectPath(input.rootSourceFilePath),
  ].join(":");
}
