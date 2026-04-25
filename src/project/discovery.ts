import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ProjectDiscoveryResult, ProjectFileRecord, ScanDiagnostic } from "./types.js";
import { normalizeProjectPath, resolveProjectFile, resolveRootDir } from "./pathUtils.js";

const IGNORED_DIRECTORIES = new Set([".git", "build", "coverage", "dist", "node_modules"]);

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

export async function discoverProjectFiles(input: {
  rootDir?: string;
  sourceFilePaths?: string[];
  cssFilePaths?: string[];
}): Promise<ProjectDiscoveryResult> {
  const rootDir = resolveRootDir(input.rootDir);
  const diagnostics: ScanDiagnostic[] = [];

  const sourceFiles = input.sourceFilePaths
    ? normalizeExplicitFiles(rootDir, input.sourceFilePaths)
    : await discoverFilesByPredicate(rootDir, isSourceFilePath);
  const cssFiles = input.cssFilePaths
    ? normalizeExplicitFiles(rootDir, input.cssFilePaths)
    : await discoverFilesByPredicate(rootDir, isCssFilePath);

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
    diagnostics,
  };
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

function normalizeExplicitFiles(rootDir: string, filePaths: string[]): ProjectFileRecord[] {
  return filePaths
    .map((filePath) => resolveProjectFile(rootDir, filePath))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function isSourceFilePath(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath)) && !filePath.endsWith(".d.ts");
}

function isCssFilePath(filePath: string): boolean {
  return path.extname(filePath) === ".css";
}
