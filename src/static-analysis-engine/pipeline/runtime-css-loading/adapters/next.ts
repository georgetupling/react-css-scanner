import type { FactGraphResult } from "../../fact-graph/index.js";
import type { RuntimeCssEntry } from "../types.js";
import { hasNextPackageDependency } from "../packageMetadata.js";
import { getBaseName, normalizeProjectPath } from "../pathUtils.js";
import type { RuntimeCssEntryCandidate } from "./vite.js";

export function collectNextEntries(input: {
  bundlerConfigFiles: FactGraphResult["snapshot"]["files"]["bundlerConfigFiles"];
  packageJsonFiles: FactGraphResult["snapshot"]["files"]["packageJsonFiles"];
  moduleFilePaths: string[];
}): RuntimeCssEntryCandidate[] {
  const hasNextEvidence =
    input.bundlerConfigFiles.some((configFile) => configFile.bundler === "next") ||
    input.packageJsonFiles.some(hasNextPackageDependency);
  if (!hasNextEvidence) {
    return [];
  }

  const entries: RuntimeCssEntryCandidate[] = [];
  const moduleFilePathSet = new Set(input.moduleFilePaths);
  for (const candidatePath of [
    "src/app/layout.tsx",
    "src/app/layout.jsx",
    "app/layout.tsx",
    "app/layout.jsx",
  ]) {
    if (!moduleFilePathSet.has(candidatePath)) {
      continue;
    }
    entries.push({
      kind: "next-app-entry",
      entrySourceFilePath: candidatePath,
      confidence: "medium",
      reason: "Next app-router root layout inferred as the global CSS runtime entry",
    });
  }
  for (const candidatePath of [
    "src/pages/_app.tsx",
    "src/pages/_app.jsx",
    "pages/_app.tsx",
    "pages/_app.jsx",
  ]) {
    if (!moduleFilePathSet.has(candidatePath)) {
      continue;
    }
    entries.push({
      kind: "next-pages-entry",
      entrySourceFilePath: candidatePath,
      confidence: "medium",
      reason: "Next pages-router _app inferred as the global CSS runtime entry",
    });
  }

  return entries.sort((left, right) =>
    left.entrySourceFilePath.localeCompare(right.entrySourceFilePath),
  );
}

export function collectNextRuntimeSourceFilePaths(input: {
  entry: RuntimeCssEntry;
  entryBundleSourceFilePaths: string[];
  moduleFilePaths: string[];
}): string[] {
  const sourceFilePaths = new Set(input.entryBundleSourceFilePaths);
  const entryPath = normalizeProjectPath(input.entry.entrySourceFilePath);
  const appRootPrefix = getNextAppRootPrefix(entryPath);
  const pagesRootPrefix = getNextPagesRootPrefix(entryPath);

  for (const moduleFilePath of input.moduleFilePaths) {
    const normalizedModulePath = normalizeProjectPath(moduleFilePath);
    if (
      appRootPrefix &&
      normalizedModulePath.startsWith(appRootPrefix) &&
      isNextAppRouteFile(normalizedModulePath)
    ) {
      sourceFilePaths.add(normalizedModulePath);
      continue;
    }
    if (
      pagesRootPrefix &&
      normalizedModulePath.startsWith(pagesRootPrefix) &&
      isNextPagesRouteFile(normalizedModulePath)
    ) {
      sourceFilePaths.add(normalizedModulePath);
    }
  }

  return [...sourceFilePaths].sort((left, right) => left.localeCompare(right));
}

export function isNextEntry(entry: RuntimeCssEntry): boolean {
  return entry.kind === "next-app-entry" || entry.kind === "next-pages-entry";
}

function getNextAppRootPrefix(entrySourceFilePath: string): string | undefined {
  if (entrySourceFilePath === "app/layout.tsx" || entrySourceFilePath === "app/layout.jsx") {
    return "app/";
  }
  if (
    entrySourceFilePath === "src/app/layout.tsx" ||
    entrySourceFilePath === "src/app/layout.jsx"
  ) {
    return "src/app/";
  }
  return undefined;
}

function getNextPagesRootPrefix(entrySourceFilePath: string): string | undefined {
  if (entrySourceFilePath === "pages/_app.tsx" || entrySourceFilePath === "pages/_app.jsx") {
    return "pages/";
  }
  if (
    entrySourceFilePath === "src/pages/_app.tsx" ||
    entrySourceFilePath === "src/pages/_app.jsx"
  ) {
    return "src/pages/";
  }
  return undefined;
}

function isNextAppRouteFile(filePath: string): boolean {
  return /\/(layout|page)\.[jt]sx?$/.test(filePath);
}

function isNextPagesRouteFile(filePath: string): boolean {
  const baseName = getBaseName(filePath);
  if (baseName.startsWith("_") || baseName.startsWith(".")) {
    return false;
  }
  return /\.[jt]sx?$/.test(baseName);
}
