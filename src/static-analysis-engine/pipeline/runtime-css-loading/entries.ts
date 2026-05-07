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
  if (validHtmlEntryEdges.length > 0) {
    return validHtmlEntryEdges;
  }

  const conventionalEntries = collectConventionalEntrySourceFilePaths(input.moduleFilePaths).map(
    (entrySourceFilePath) =>
      ({
        kind: "conventional-entry",
        entrySourceFilePath,
        confidence: "medium",
        reason: "No valid HTML module script entry resolved; inferred conventional main module",
      }) satisfies RuntimeCssEntryCandidate,
  );
  if (conventionalEntries.length > 0) {
    return conventionalEntries;
  }

  return collectInferredAppShellEntrySourceFilePaths({
    snapshotEdges: input.snapshotEdges,
    moduleFilePaths: input.moduleFilePaths,
  }).map(
    (entrySourceFilePath) =>
      ({
        kind: "inferred-app-shell-entry",
        entrySourceFilePath,
        confidence: "medium",
        reason:
          "No configured or conventional runtime entry resolved; inferred CSS-importing app shell module",
      }) satisfies RuntimeCssEntryCandidate,
  );
}

function collectConventionalEntrySourceFilePaths(moduleFilePaths: string[]): string[] {
  const entryFileNames = new Set([
    "index.jsx",
    "index.js",
    "index.ts",
    "index.tsx",
    "main.jsx",
    "main.js",
    "main.ts",
    "main.tsx",
  ]);
  return moduleFilePaths
    .filter((filePath) => entryFileNames.has(getBaseName(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
}

function collectInferredAppShellEntrySourceFilePaths(input: {
  snapshotEdges: ProjectResourceEdge[];
  moduleFilePaths: string[];
}): string[] {
  const moduleFilePathSet = new Set(input.moduleFilePaths);
  const sourceImportsByImporterPath = new Map<string, string[]>();
  const cssImportsByImporterPath = new Map<string, string[]>();

  for (const edge of input.snapshotEdges) {
    if (
      edge.kind !== "source-import" ||
      edge.importLoading !== "static" ||
      !edge.resolvedFilePath
    ) {
      continue;
    }

    const importerPath = normalizeProjectPath(edge.importerFilePath);
    const importedPath = normalizeProjectPath(edge.resolvedFilePath);
    if (!moduleFilePathSet.has(importerPath)) {
      continue;
    }

    if (edge.importKind === "source" && moduleFilePathSet.has(importedPath)) {
      pushMapValue(sourceImportsByImporterPath, importerPath, importedPath);
      continue;
    }

    if (edge.importKind === "css") {
      pushMapValue(cssImportsByImporterPath, importerPath, importedPath);
    }
  }

  return input.moduleFilePaths
    .filter((filePath) => isConventionalAppShellFile(filePath))
    .filter((filePath) => (cssImportsByImporterPath.get(filePath) ?? []).length > 0)
    .filter((filePath) => (sourceImportsByImporterPath.get(filePath) ?? []).length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function isConventionalAppShellFile(filePath: string): boolean {
  const baseName = getBaseName(filePath).toLowerCase();
  return (
    baseName === "app.jsx" ||
    baseName === "app.js" ||
    baseName === "app.ts" ||
    baseName === "app.tsx"
  );
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}
