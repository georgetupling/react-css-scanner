import type { StaticAnalysisEngineProjectResult } from "../../types/runtime.js";

export function collectRootHtmlEntryLinkedStylesheetPaths(
  snapshot: StaticAnalysisEngineProjectResult["snapshot"],
): string[] {
  const rootHtmlFiles = new Set(selectRootHtmlEntryCandidates(snapshot.files.htmlFiles));
  const sourceFilePaths = new Set(
    snapshot.files.sourceFiles.map((file) => normalizeProjectPath(file.filePath)),
  );

  const directlyLinkedStylesheetPaths = snapshot.edges
    .filter((edge) => edge.kind === "html-stylesheet")
    .filter((edge) => rootHtmlFiles.has(normalizeProjectPath(edge.fromHtmlFilePath)))
    .map((edge) => edge.resolvedFilePath)
    .filter((filePath): filePath is string => Boolean(filePath))
    .map((filePath) => normalizeProjectPath(filePath));

  const rootHtmlEntrySourcePaths = snapshot.edges
    .filter((edge) => edge.kind === "html-script")
    .filter((edge) => rootHtmlFiles.has(normalizeProjectPath(edge.fromHtmlFilePath)))
    .map((edge) =>
      edge.resolvedFilePath
        ? resolveHtmlScriptSourcePath({
            fromHtmlFilePath: edge.fromHtmlFilePath,
            resolvedFilePath: edge.resolvedFilePath,
            sourceFilePaths,
          })
        : undefined,
    )
    .filter((filePath): filePath is string => Boolean(filePath))
    .map((filePath) => normalizeProjectPath(filePath));

  const importedSourcePathsBySourcePath = new Map<string, string[]>();
  const directlyImportedStylesheetPathsBySourcePath = new Map<string, string[]>();
  for (const edge of snapshot.edges) {
    if (
      edge.kind !== "source-import" ||
      edge.importLoading !== "static" ||
      edge.resolutionStatus !== "resolved" ||
      !edge.resolvedFilePath
    ) {
      continue;
    }
    const importerPath = normalizeProjectPath(edge.importerFilePath);
    const resolvedPath = normalizeProjectPath(edge.resolvedFilePath);
    if (edge.importKind === "source") {
      pushMapValue(importedSourcePathsBySourcePath, importerPath, resolvedPath);
      continue;
    }
    if (edge.importKind === "css") {
      pushMapValue(directlyImportedStylesheetPathsBySourcePath, importerPath, resolvedPath);
    }
  }

  const sourceQueue = [...new Set(rootHtmlEntrySourcePaths)];
  const visitedSourcePaths = new Set<string>();
  const rootHtmlScriptReachableStylesheetPaths = new Set<string>();
  while (sourceQueue.length > 0) {
    const sourcePath = sourceQueue.shift();
    if (!sourcePath || visitedSourcePaths.has(sourcePath)) {
      continue;
    }
    visitedSourcePaths.add(sourcePath);
    for (const stylesheetPath of directlyImportedStylesheetPathsBySourcePath.get(sourcePath) ??
      []) {
      rootHtmlScriptReachableStylesheetPaths.add(stylesheetPath);
    }
    for (const importedSourcePath of importedSourcePathsBySourcePath.get(sourcePath) ?? []) {
      if (!visitedSourcePaths.has(importedSourcePath)) {
        sourceQueue.push(importedSourcePath);
      }
    }
  }

  const importedStylesheetPathsByImporterPath = new Map<string, string[]>();
  for (const edge of snapshot.edges) {
    if (edge.kind === "stylesheet-import") {
      pushMapValue(
        importedStylesheetPathsByImporterPath,
        normalizeProjectPath(edge.importerFilePath),
        normalizeProjectPath(edge.resolvedFilePath),
      );
      continue;
    }
    if (edge.kind === "package-css-import" && edge.importerKind === "stylesheet") {
      pushMapValue(
        importedStylesheetPathsByImporterPath,
        normalizeProjectPath(edge.importerFilePath),
        normalizeProjectPath(edge.resolvedFilePath),
      );
    }
  }

  const queue = [
    ...new Set([...directlyLinkedStylesheetPaths, ...rootHtmlScriptReachableStylesheetPaths]),
  ];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const stylesheetPath = queue.shift();
    if (!stylesheetPath || visited.has(stylesheetPath)) {
      continue;
    }
    visited.add(stylesheetPath);
    for (const importedPath of importedStylesheetPathsByImporterPath.get(stylesheetPath) ?? []) {
      if (!visited.has(importedPath)) {
        queue.push(importedPath);
      }
    }
  }

  return [...visited].sort((left, right) => left.localeCompare(right));
}

function selectRootHtmlEntryCandidates(
  htmlFiles: StaticAnalysisEngineProjectResult["snapshot"]["files"]["htmlFiles"],
): string[] {
  const normalizedHtmlFiles = htmlFiles.map((file) => normalizeProjectPath(file.filePath));
  if (normalizedHtmlFiles.length === 1) {
    return normalizedHtmlFiles;
  }

  const obviousEntryNames = new Set(["index.html", "app.html", "main.html"]);
  const namedCandidates = normalizedHtmlFiles.filter((filePath) =>
    obviousEntryNames.has(getBaseName(filePath).toLowerCase()),
  );
  return namedCandidates;
}

function pushMapValue(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) {
    if (!existing.includes(value)) {
      existing.push(value);
    }
    return;
  }
  map.set(key, [value]);
}

function normalizeProjectPath(filePath: string): string {
  return filePath
    .split("\\")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function getBaseName(filePath: string): string {
  return normalizeProjectPath(filePath).split("/").at(-1) ?? filePath;
}

function resolveHtmlScriptSourcePath(input: {
  fromHtmlFilePath: string;
  resolvedFilePath: string;
  sourceFilePaths: Set<string>;
}): string {
  const normalizedResolvedPath = normalizeProjectPath(input.resolvedFilePath);
  if (input.sourceFilePaths.has(normalizedResolvedPath)) {
    return normalizedResolvedPath;
  }

  const htmlDirectory = getDirectoryPath(normalizeProjectPath(input.fromHtmlFilePath));
  const htmlDirectoryAnchoredPath = normalizeProjectPath(
    htmlDirectory ? `${htmlDirectory}/${normalizedResolvedPath}` : normalizedResolvedPath,
  );
  if (input.sourceFilePaths.has(htmlDirectoryAnchoredPath)) {
    return htmlDirectoryAnchoredPath;
  }

  return normalizedResolvedPath;
}

function getDirectoryPath(filePath: string): string {
  const normalizedPath = normalizeProjectPath(filePath);
  const parts = normalizedPath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}
