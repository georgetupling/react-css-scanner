import type { FactGraphResult } from "../../fact-graph/index.js";
import type { RuntimeCssEntry } from "../types.js";
import { normalizeProjectPath } from "../pathUtils.js";
import { extractWebpackEntryPaths } from "../staticConfig.js";
import type { RuntimeCssEntryCandidate } from "./vite.js";

export function collectWebpackEntries(input: {
  bundlerConfigFiles: FactGraphResult["snapshot"]["files"]["bundlerConfigFiles"];
  moduleFilePathSet: ReadonlySet<string>;
}): RuntimeCssEntryCandidate[] {
  const entries: RuntimeCssEntryCandidate[] = [];
  const entryPaths = new Set<string>();

  for (const configFile of input.bundlerConfigFiles) {
    if (configFile.bundler !== "webpack") {
      continue;
    }
    for (const entryPath of extractWebpackEntryPaths(configFile.sourceText, configFile.filePath)) {
      const normalizedEntryPath = normalizeProjectPath(entryPath);
      if (
        !input.moduleFilePathSet.has(normalizedEntryPath) ||
        entryPaths.has(normalizedEntryPath)
      ) {
        continue;
      }
      entryPaths.add(normalizedEntryPath);
      entries.push({
        kind: "webpack-entry",
        entrySourceFilePath: normalizedEntryPath,
        confidence: "high" satisfies RuntimeCssEntry["confidence"],
        reason: `Webpack config entry ${normalizedEntryPath} resolved to an analyzed source entry`,
      });
    }
  }

  return entries.sort((left, right) =>
    left.entrySourceFilePath.localeCompare(right.entrySourceFilePath),
  );
}
