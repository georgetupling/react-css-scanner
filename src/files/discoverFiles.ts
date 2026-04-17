import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedReactCssScannerConfig } from "../config/types.js";
import { directoryExists } from "./fsUtils.js";
import {
  isCssFilePath,
  isHtmlFilePath,
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
  const includePatterns =
    config.source.discovery === "auto"
      ? await discoverReactSourceIncludePaths(rootDir, config.source.exclude)
      : config.source.include;
  const discoveredFiles: DiscoveredProjectFile[] = [];
  await walkDirectory(rootDir, rootDir, config, includePatterns, discoveredFiles);

  const sourceFiles = discoveredFiles
    .filter((file) => file.kind === "source")
    .sort(compareDiscoveredFiles);
  const cssFiles = discoveredFiles
    .filter((file) => file.kind === "css")
    .sort(compareDiscoveredFiles);
  const htmlFiles = discoveredFiles
    .filter((file) => file.kind === "html")
    .sort(compareDiscoveredFiles);

  return {
    rootDir,
    sourceFiles,
    cssFiles,
    htmlFiles,
  };
}

async function walkDirectory(
  currentDir: string,
  rootDir: string,
  config: ResolvedReactCssScannerConfig,
  includePatterns: string[],
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

      await walkDirectory(absolutePath, rootDir, config, includePatterns, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (shouldExcludePath(relativePath, config.source.exclude)) {
      continue;
    }

    const kind = getFileKind(relativePath);
    if (!kind) {
      continue;
    }

    if (kind !== "html" && !shouldIncludePath(relativePath, includePatterns)) {
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

  if (isHtmlFilePath(relativePath)) {
    return "html";
  }

  return undefined;
}

function compareDiscoveredFiles(left: DiscoveredProjectFile, right: DiscoveredProjectFile): number {
  return left.relativePath.localeCompare(right.relativePath);
}

async function discoverReactSourceIncludePaths(
  rootDir: string,
  excludePatterns: string[],
): Promise<string[]> {
  const reactPackageRoots = await discoverReactPackageRoots(rootDir, excludePatterns);
  const includePaths = new Set<string>();

  for (const packageRoot of reactPackageRoots) {
    for (const candidate of ["src", "app", "client/src"]) {
      const absoluteCandidatePath = path.join(rootDir, packageRoot, candidate);
      if (!(await directoryExists(absoluteCandidatePath))) {
        continue;
      }

      includePaths.add(normalizeRelativePath(path.join(packageRoot, candidate)));
    }
  }

  const sortedIncludePaths = [...includePaths].sort((left, right) => left.localeCompare(right));
  if (sortedIncludePaths.length === 0) {
    throw new Error(
      "No React source roots were discovered automatically. Add React to the relevant package.json files and ensure those projects have a source directory such as src, or configure source.include explicitly.",
    );
  }

  return sortedIncludePaths;
}

async function discoverReactPackageRoots(
  rootDir: string,
  excludePatterns: string[],
): Promise<string[]> {
  const packageRoots = new Set<string>();
  await walkForPackageJson(rootDir, rootDir, excludePatterns, packageRoots);
  return [...packageRoots].sort((left, right) => left.localeCompare(right));
}

async function walkForPackageJson(
  currentDir: string,
  rootDir: string,
  excludePatterns: string[],
  packageRoots: Set<string>,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizePathForMatch(path.relative(rootDir, absolutePath));

    if (entry.isDirectory()) {
      if (shouldExcludePath(relativePath, excludePatterns)) {
        continue;
      }

      await walkForPackageJson(absolutePath, rootDir, excludePatterns, packageRoots);
      continue;
    }

    if (!entry.isFile() || entry.name !== "package.json") {
      continue;
    }

    if (await isReactPackageJson(absolutePath)) {
      packageRoots.add(normalizeRelativePath(path.dirname(relativePath)));
    }
  }
}

async function isReactPackageJson(packageJsonPath: string): Promise<boolean> {
  let parsedPackageJson: unknown;

  try {
    parsedPackageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as unknown;
  } catch {
    return false;
  }

  if (
    !parsedPackageJson ||
    typeof parsedPackageJson !== "object" ||
    Array.isArray(parsedPackageJson)
  ) {
    return false;
  }

  const packageJson = parsedPackageJson as Record<string, unknown>;
  return ["dependencies", "devDependencies", "peerDependencies"].some((fieldName) =>
    hasReactDependency(packageJson[fieldName]),
  );
}

function hasReactDependency(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return typeof (value as Record<string, unknown>).react === "string";
}

function normalizeRelativePath(value: string): string {
  const normalizedValue = normalizePathForMatch(value);
  return normalizedValue === "." ? "" : normalizedValue.replace(/^\.\//, "");
}
