import type { FactGraphResult } from "../fact-graph/index.js";
import type { ProjectResourceEdge } from "../workspace-discovery/index.js";
import { collectNextEntries } from "./adapters/next.js";
import { collectViteInputEntries, type RuntimeCssEntryCandidate } from "./adapters/vite.js";
import { collectWebpackEntries } from "./adapters/webpack.js";
import { getBaseName, normalizeProjectPath } from "./pathUtils.js";

export function collectAppEntries(input: {
  snapshotEdges: ProjectResourceEdge[];
  bundlerConfigFiles: FactGraphResult["snapshot"]["files"]["bundlerConfigFiles"];
  packageJsonFiles: FactGraphResult["snapshot"]["files"]["packageJsonFiles"];
  moduleFilePaths: string[];
}): RuntimeCssEntryCandidate[] {
  const htmlEntryEdges = input.snapshotEdges
    .filter(
      (
        edge,
      ): edge is ProjectResourceEdge & {
        kind: "html-script";
        resolvedFilePath: string;
      } => edge.kind === "html-script" && Boolean(edge.resolvedFilePath),
    )
    .map((edge) => ({
      kind: "html-entry" as const,
      htmlFilePath: normalizeProjectPath(edge.fromHtmlFilePath),
      entrySourceFilePath: normalizeProjectPath(edge.resolvedFilePath),
      confidence: "high" as const,
      reason: "HTML module script resolved to an analyzed source entry",
    }))
    .sort(
      (left, right) =>
        left.htmlFilePath.localeCompare(right.htmlFilePath) ||
        left.entrySourceFilePath.localeCompare(right.entrySourceFilePath),
    );
  const moduleFilePathSet = new Set(input.moduleFilePaths);
  const viteInputEntries = collectViteInputEntries({
    bundlerConfigFiles: input.bundlerConfigFiles,
    htmlEntries: htmlEntryEdges,
    moduleFilePathSet,
  });
  if (viteInputEntries.length > 0) {
    return viteInputEntries;
  }
  const webpackEntries = collectWebpackEntries({
    bundlerConfigFiles: input.bundlerConfigFiles,
    moduleFilePathSet,
  });
  if (webpackEntries.length > 0) {
    return webpackEntries;
  }
  const nextEntries = collectNextEntries({
    bundlerConfigFiles: input.bundlerConfigFiles,
    packageJsonFiles: input.packageJsonFiles,
    moduleFilePaths: input.moduleFilePaths,
  });
  if (nextEntries.length > 0) {
    return nextEntries;
  }

  const validHtmlEntryEdges = htmlEntryEdges.filter((entry) =>
    moduleFilePathSet.has(entry.entrySourceFilePath),
  );
  return validHtmlEntryEdges.length > 0
    ? validHtmlEntryEdges
    : collectConventionalEntrySourceFilePaths(input.moduleFilePaths).map((entrySourceFilePath) => ({
        kind: "conventional-entry",
        entrySourceFilePath,
        confidence: "medium",
        reason: "No valid HTML module script entry resolved; inferred conventional main module",
      }));
}

function collectConventionalEntrySourceFilePaths(moduleFilePaths: string[]): string[] {
  const entryFileNames = new Set(["main.jsx", "main.js", "main.ts", "main.tsx"]);
  return moduleFilePaths
    .filter((filePath) => entryFileNames.has(getBaseName(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
}
