import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ResolvedReactCssScannerConfig } from "../config/types.js";
import {
  isCssFilePath,
  isSourceFilePath,
  matchesAnyGlob,
  normalizePathForMatch,
} from "./pathUtils.js";
import type { DiscoveredProjectFile, FileDiscoveryResult } from "./types.js";

export async function discoverProjectFiles(
  config: ResolvedReactCssScannerConfig,
  cwd: string,
): Promise<FileDiscoveryResult> {
  const rootDir = path.resolve(cwd, config.rootDir);
  const discoveredFiles: DiscoveredProjectFile[] = [];

  await walkDirectory(rootDir, rootDir, config, discoveredFiles);

  const sourceFiles = discoveredFiles
    .filter((file) => file.kind === "source")
    .sort(compareDiscoveredFiles);
  const cssFiles = discoveredFiles
    .filter((file) => file.kind === "css")
    .sort(compareDiscoveredFiles);

  return {
    rootDir,
    sourceFiles,
    cssFiles,
  };
}

async function walkDirectory(
  currentDir: string,
  rootDir: string,
  config: ResolvedReactCssScannerConfig,
  results: DiscoveredProjectFile[],
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizePathForMatch(path.relative(rootDir, absolutePath));

    if (entry.isDirectory()) {
      if (shouldExcludePath(relativePath, config.source.exclude)) {
        continue;
      }

      await walkDirectory(absolutePath, rootDir, config, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (shouldExcludePath(relativePath, config.source.exclude)) {
      continue;
    }

    if (!shouldIncludePath(relativePath, config.source.include)) {
      continue;
    }

    const kind = getFileKind(relativePath);
    if (!kind) {
      continue;
    }

    results.push({
      kind,
      absolutePath,
      relativePath,
    });
  }
}

function shouldExcludePath(relativePath: string, excludePatterns: string[]): boolean {
  if (!relativePath) {
    return false;
  }

  return excludePatterns.some((pattern) => {
    const normalizedPattern = normalizePathForMatch(pattern);
    return (
      matchesAnyGlob(relativePath, [normalizedPattern]) ||
      relativePath === normalizedPattern ||
      relativePath.startsWith(`${normalizedPattern}/`)
    );
  });
}

function shouldIncludePath(relativePath: string, includePatterns: string[]): boolean {
  return includePatterns.some((pattern) => {
    const normalizedPattern = normalizePathForMatch(pattern);
    return (
      matchesAnyGlob(relativePath, [normalizedPattern]) ||
      relativePath === normalizedPattern ||
      relativePath.startsWith(`${normalizedPattern}/`)
    );
  });
}

function getFileKind(relativePath: string): DiscoveredProjectFile["kind"] | undefined {
  if (isSourceFilePath(relativePath)) {
    return "source";
  }

  if (isCssFilePath(relativePath)) {
    return "css";
  }

  return undefined;
}

function compareDiscoveredFiles(left: DiscoveredProjectFile, right: DiscoveredProjectFile): number {
  return left.relativePath.localeCompare(right.relativePath);
}
