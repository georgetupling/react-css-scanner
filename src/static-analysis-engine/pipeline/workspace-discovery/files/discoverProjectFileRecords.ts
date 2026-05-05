import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { DiscoveryConfig } from "../../../../config/index.js";
import {
  normalizeProjectPath,
  resolveProjectFile,
  resolveRootDir,
} from "../../../../project/pathUtils.js";
import type { ProjectFileRecord, ScanDiagnostic } from "../../../../project/types.js";
import type { ProjectFileDiscoveryResult } from "../types.js";

const IGNORED_DIRECTORIES = new Set([".git", "build", "coverage", "dist", "node_modules"]);

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const DEFAULT_SOURCE_EXCLUDE_PATTERNS = [
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/*.test.js",
  "**/*.test.jsx",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.js",
  "**/*.spec.jsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
];

export async function discoverProjectFileRecords(input: {
  rootDir?: string;
  sourceFilePaths?: string[];
  cssFilePaths?: string[];
  htmlFilePaths?: string[];
  discovery?: DiscoveryConfig;
}): Promise<ProjectFileDiscoveryResult> {
  const rootDir = resolveRootDir(input.rootDir);
  const diagnostics: ScanDiagnostic[] = [];
  const rootValidationDiagnostic = await validateRootDir(rootDir);
  if (rootValidationDiagnostic) {
    diagnostics.push(rootValidationDiagnostic);
    return {
      rootDir,
      sourceFiles: [],
      cssFiles: [],
      htmlFiles: [],
      diagnostics,
    };
  }

  const sourceFiles = input.sourceFilePaths
    ? normalizeExplicitFiles(rootDir, input.sourceFilePaths)
    : await discoverSourceFiles({
        rootDir,
        discovery: input.discovery,
      });
  const cssFiles = input.cssFilePaths
    ? normalizeExplicitFiles(rootDir, input.cssFilePaths)
    : await discoverFilesByPredicate(rootDir, (filePath) =>
        isStylesheetFilePath(filePath, input.discovery?.stylesheetExtensions),
      );
  const htmlFiles = input.htmlFilePaths
    ? normalizeExplicitFiles(rootDir, input.htmlFilePaths)
    : await discoverFilesByPredicate(rootDir, isHtmlFilePath);

  if (sourceFiles.length === 0) {
    diagnostics.push({
      code: "discovery.no-source-files",
      severity: "warning",
      phase: "discovery",
      message: "no source files were discovered for analysis",
    });
  }

  return {
    rootDir,
    sourceFiles,
    cssFiles,
    htmlFiles,
    diagnostics,
  };
}

async function discoverSourceFiles(input: {
  rootDir: string;
  discovery: DiscoveryConfig | undefined;
}): Promise<ProjectFileRecord[]> {
  const excludePatterns = [
    ...DEFAULT_SOURCE_EXCLUDE_PATTERNS,
    ...(input.discovery?.exclude ?? []),
  ].map(globToRegExp);
  const sourceRoots = input.discovery?.sourceRoots ?? [];
  const predicate = (filePath: string): boolean =>
    isSourceFilePath(filePath) &&
    !isBundlerConfigFilePath(filePath) &&
    !excludePatterns.some((pattern) => pattern.test(filePath));

  if (sourceRoots.length === 0) {
    return discoverFilesByPredicate(input.rootDir, predicate);
  }

  const files: ProjectFileRecord[] = [];
  for (const sourceRoot of sourceRoots) {
    const absoluteRoot = path.resolve(input.rootDir, sourceRoot);
    if (!(await isDirectory(absoluteRoot))) {
      continue;
    }

    await walkDirectory(input.rootDir, absoluteRoot, predicate, files);
  }

  return deduplicateFiles(files).sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function validateRootDir(rootDir: string): Promise<ScanDiagnostic | undefined> {
  try {
    const rootStats = await stat(rootDir);
    if (!rootStats.isDirectory()) {
      return {
        code: "discovery.root-not-directory",
        severity: "error",
        phase: "discovery",
        filePath: ".",
        message: `scan root must be a directory: ${rootDir}`,
      };
    }

    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: "discovery.root-not-found",
      severity: "error",
      phase: "discovery",
      filePath: ".",
      message: `scan root does not exist or cannot be accessed: ${rootDir} (${message})`,
    };
  }
}

async function discoverFilesByPredicate(
  rootDir: string,
  predicate: (filePath: string) => boolean,
): Promise<ProjectFileRecord[]> {
  const files: ProjectFileRecord[] = [];
  await walkDirectory(rootDir, rootDir, predicate, files);
  return files.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function walkDirectory(
  rootDir: string,
  currentDir: string,
  predicate: (filePath: string) => boolean,
  files: ProjectFileRecord[],
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        await walkDirectory(rootDir, path.join(currentDir, entry.name), predicate, files);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const filePath = normalizeProjectPath(path.relative(rootDir, absolutePath));
    if (predicate(filePath)) {
      files.push({
        filePath,
        absolutePath,
      });
    }
  }
}

async function isDirectory(absolutePath: string): Promise<boolean> {
  try {
    return (await stat(absolutePath)).isDirectory();
  } catch {
    return false;
  }
}

function deduplicateFiles(files: ProjectFileRecord[]): ProjectFileRecord[] {
  const byPath = new Map<string, ProjectFileRecord>();
  for (const file of files) {
    byPath.set(file.filePath, file);
  }

  return [...byPath.values()];
}

function normalizeExplicitFiles(rootDir: string, filePaths: string[]): ProjectFileRecord[] {
  return filePaths
    .map((filePath) => resolveProjectFile(rootDir, filePath))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function isSourceFilePath(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath)) && !filePath.endsWith(".d.ts");
}

function isBundlerConfigFilePath(filePath: string): boolean {
  return /(?:^|\/)(?:vite|webpack|next|remix|astro)\.config\.[cm]?[jt]s$/.test(
    normalizeProjectPath(filePath),
  );
}

function isStylesheetFilePath(
  filePath: string,
  stylesheetExtensions: string[] | undefined,
): boolean {
  const extensions = stylesheetExtensions ?? [".css"];
  return extensions.includes(path.extname(filePath).toLowerCase());
}

function isHtmlFilePath(filePath: string): boolean {
  return path.extname(filePath) === ".html";
}

function globToRegExp(glob: string): RegExp {
  let source = "^";
  const normalized = normalizeProjectPath(glob);
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const nextChar = normalized[index + 1];

    if (char === "*" && nextChar === "*") {
      const afterGlobstar = normalized[index + 2];
      if (afterGlobstar === "/") {
        source += "(?:.*/)?";
        index += 2;
        continue;
      }

      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
