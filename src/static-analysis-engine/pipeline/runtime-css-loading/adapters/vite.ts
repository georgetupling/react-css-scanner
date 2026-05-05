import type { FactGraphResult } from "../../fact-graph/index.js";
import type { RuntimeCssEntry } from "../types.js";
import { normalizeProjectPath } from "../pathUtils.js";
import { extractViteRollupInputPaths } from "../staticConfig.js";

export type HtmlRuntimeEntryCandidate = {
  kind: "html-entry";
  htmlFilePath: string;
  entrySourceFilePath: string;
  confidence: "high";
  reason: string;
};

export type RuntimeCssEntryCandidate = {
  kind: RuntimeCssEntry["kind"];
  entrySourceFilePath: string;
  htmlFilePath?: string;
  confidence: RuntimeCssEntry["confidence"];
  reason: string;
};

export function collectViteInputEntries(input: {
  bundlerConfigFiles: FactGraphResult["snapshot"]["files"]["bundlerConfigFiles"];
  htmlEntries: HtmlRuntimeEntryCandidate[];
  moduleFilePathSet: ReadonlySet<string>;
}): RuntimeCssEntryCandidate[] {
  const entries: RuntimeCssEntryCandidate[] = [];
  const entryKeys = new Set<string>();

  for (const configFile of input.bundlerConfigFiles) {
    if (configFile.bundler !== "vite") {
      continue;
    }
    for (const inputPath of extractViteRollupInputPaths(configFile.sourceText)) {
      const normalizedInputPath = normalizeProjectPath(inputPath);
      const htmlEntry = input.htmlEntries.find(
        (entry) => entry.htmlFilePath === normalizedInputPath,
      );
      if (htmlEntry && input.moduleFilePathSet.has(htmlEntry.entrySourceFilePath)) {
        const key = `html:${htmlEntry.htmlFilePath}:${htmlEntry.entrySourceFilePath}`;
        if (!entryKeys.has(key)) {
          entryKeys.add(key);
          entries.push({
            ...htmlEntry,
            reason: `Vite rollupOptions.input ${normalizedInputPath} resolved through HTML module script`,
          });
        }
        continue;
      }

      if (input.moduleFilePathSet.has(normalizedInputPath)) {
        const key = `source:${normalizedInputPath}`;
        if (!entryKeys.has(key)) {
          entryKeys.add(key);
          entries.push({
            kind: "vite-input-entry",
            entrySourceFilePath: normalizedInputPath,
            confidence: "high",
            reason: `Vite rollupOptions.input ${normalizedInputPath} resolved to an analyzed source entry`,
          });
        }
      }
    }
  }

  return entries.sort(
    (left, right) =>
      (left.htmlFilePath ?? "").localeCompare(right.htmlFilePath ?? "") ||
      left.entrySourceFilePath.localeCompare(right.entrySourceFilePath),
  );
}
