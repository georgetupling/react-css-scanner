import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { DiscoveryConfig } from "../../../../config/index.js";
import { normalizeProjectPath } from "../../../../project/pathUtils.js";
import type { ScanDiagnostic } from "../../../../project/types.js";
import type { PackageCssImportFact } from "../types.js";
import { resolveWorkspaceSpecifier } from "../resolution/index.js";

export type PackageCssImportRecord = PackageCssImportFact & {
  resolvedAbsolutePath: string;
};

export type LoadedPackageCssImports = {
  cssSources: Array<{ filePath: string; cssText: string }>;
  imports: PackageCssImportRecord[];
};

export async function loadPackageCssImports(input: {
  rootDir: string;
  sourceFiles: Array<{ filePath: string; sourceText: string }>;
  cssSources: Array<{ filePath: string; cssText: string }>;
  discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
  diagnostics: ScanDiagnostic[];
}): Promise<LoadedPackageCssImports> {
  const nodeModulesRootsByStartDir = new Map<string, string[]>();
  const importsByKey = new Map<string, PackageCssImportRecord>();
  const cssSourcesByPath = new Map(
    input.cssSources.map((cssSource) => [cssSource.filePath, cssSource]),
  );
  const pendingImports = await collectSourcePackageCssImportRecords({
    rootDir: input.rootDir,
    nodeModulesRootsByStartDir,
    sourceFiles: input.sourceFiles,
    knownStylesheetFilePaths: new Set(cssSourcesByPath.keys()),
    discovery: input.discovery,
  });
  const loadedPackageCssSources: Array<{ filePath: string; cssText: string }> = [];
  const attemptedFilePaths = new Set<string>();

  for (const importRecord of await collectStylesheetPackageCssImportRecords({
    rootDir: input.rootDir,
    nodeModulesRootsByStartDir,
    cssSources: [...cssSourcesByPath.values()],
    knownStylesheetFilePaths: new Set(cssSourcesByPath.keys()),
    discovery: input.discovery,
  })) {
    pendingImports.push(importRecord);
  }

  while (pendingImports.length > 0) {
    const importRecord = pendingImports.shift();
    if (!importRecord) {
      continue;
    }

    importsByKey.set(createImportKey(importRecord), importRecord);
    if (attemptedFilePaths.has(importRecord.resolvedFilePath)) {
      continue;
    }

    attemptedFilePaths.add(importRecord.resolvedFilePath);
    const cssSource = await readPackageCssSource({
      rootDir: input.rootDir,
      importRecord,
      diagnostics: input.diagnostics,
    });
    if (!cssSource) {
      continue;
    }

    loadedPackageCssSources.push(cssSource);
    cssSourcesByPath.set(cssSource.filePath, cssSource);
    pendingImports.push(
      ...(await collectStylesheetPackageCssImportRecords({
        rootDir: input.rootDir,
        nodeModulesRootsByStartDir,
        cssSources: [cssSource],
        knownStylesheetFilePaths: new Set(cssSourcesByPath.keys()),
        discovery: input.discovery,
      })),
    );
  }

  const loadedCssFilePaths = new Set(
    loadedPackageCssSources.map((cssSource) => cssSource.filePath),
  );

  return {
    cssSources: loadedPackageCssSources.sort((left, right) =>
      left.filePath.localeCompare(right.filePath),
    ),
    imports: [...importsByKey.values()]
      .filter((importRecord) => loadedCssFilePaths.has(importRecord.resolvedFilePath))
      .sort(comparePackageCssImports),
  };
}

async function collectSourcePackageCssImportRecords(input: {
  rootDir: string;
  nodeModulesRootsByStartDir: Map<string, string[]>;
  sourceFiles: Array<{ filePath: string; sourceText: string }>;
  knownStylesheetFilePaths: ReadonlySet<string>;
  discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
}): Promise<PackageCssImportRecord[]> {
  const imports: PackageCssImportRecord[] = [];

  for (const sourceFile of input.sourceFiles) {
    const parsedSourceFile = ts.createSourceFile(
      sourceFile.filePath,
      sourceFile.sourceText,
      ts.ScriptTarget.Latest,
      true,
      getScriptKind(sourceFile.filePath),
    );

    for (const statement of parsedSourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }

      const specifier = statement.moduleSpecifier.text;
      const resolvedImport = await resolvePackageCssImport({
        rootDir: input.rootDir,
        importerFilePath: sourceFile.filePath,
        nodeModulesRootsByStartDir: input.nodeModulesRootsByStartDir,
        knownStylesheetFilePaths: input.knownStylesheetFilePaths,
        discovery: input.discovery,
        specifier,
      });
      if (!resolvedImport) {
        continue;
      }

      imports.push({
        importerKind: "source",
        importerFilePath: sourceFile.filePath,
        specifier,
        resolvedFilePath: resolvedImport.filePath,
        resolvedAbsolutePath: resolvedImport.absolutePath,
      });
    }
  }

  return imports.sort(comparePackageCssImports);
}

async function collectStylesheetPackageCssImportRecords(input: {
  rootDir: string;
  nodeModulesRootsByStartDir: Map<string, string[]>;
  cssSources: Array<{ filePath: string; cssText: string }>;
  knownStylesheetFilePaths: ReadonlySet<string>;
  discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
}): Promise<PackageCssImportRecord[]> {
  const imports: PackageCssImportRecord[] = [];

  for (const cssSource of input.cssSources) {
    for (const specifier of extractCssImportSpecifiers(cssSource.cssText)) {
      const resolvedImport = await resolvePackageCssImport({
        rootDir: input.rootDir,
        importerFilePath: cssSource.filePath,
        nodeModulesRootsByStartDir: input.nodeModulesRootsByStartDir,
        knownStylesheetFilePaths: input.knownStylesheetFilePaths,
        discovery: input.discovery,
        specifier,
      });
      if (!resolvedImport) {
        continue;
      }

      imports.push({
        importerKind: "stylesheet",
        importerFilePath: cssSource.filePath,
        specifier,
        resolvedFilePath: resolvedImport.filePath,
        resolvedAbsolutePath: resolvedImport.absolutePath,
      });
    }
  }

  return imports.sort(comparePackageCssImports);
}

async function readPackageCssSource(input: {
  rootDir: string;
  importRecord: PackageCssImportRecord;
  diagnostics: ScanDiagnostic[];
}): Promise<{ filePath: string; cssText: string } | undefined> {
  try {
    return {
      filePath: input.importRecord.resolvedFilePath,
      cssText: await readFile(input.importRecord.resolvedAbsolutePath, "utf8"),
    };
  } catch (error) {
    input.diagnostics.push({
      code: "loading.package-css-import-read-failed",
      severity: "warning",
      phase: "loading",
      filePath: input.importRecord.importerFilePath,
      message: `failed to load package CSS import "${input.importRecord.specifier}" from ${input.importRecord.importerFilePath} at ${input.importRecord.resolvedAbsolutePath}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

async function resolvePackageCssImport(input: {
  rootDir: string;
  importerFilePath: string;
  nodeModulesRootsByStartDir: Map<string, string[]>;
  knownStylesheetFilePaths: ReadonlySet<string>;
  discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
  specifier: string;
}): Promise<{ filePath: string; absolutePath: string } | undefined> {
  const normalizedSpecifier = input.specifier.replace(/\\/g, "/");
  if (!isPackageCssImportSpecifier(normalizedSpecifier)) {
    return undefined;
  }

  const projectResolution = resolveWorkspaceSpecifier({
    importerFilePath: input.importerFilePath,
    specifier: normalizedSpecifier,
    targetKind: "stylesheet",
    knownStylesheetFilePaths: input.knownStylesheetFilePaths,
    discovery: input.discovery,
  });
  if (projectResolution.status === "resolved" && projectResolution.kind === "project") {
    return undefined;
  }

  const importerAbsolutePath = path.resolve(input.rootDir, input.importerFilePath);
  const startDir = path.dirname(importerAbsolutePath);
  let nodeModulesRoots = input.nodeModulesRootsByStartDir.get(startDir);
  if (!nodeModulesRoots) {
    nodeModulesRoots = await findNodeModulesRoots(startDir);
    input.nodeModulesRootsByStartDir.set(startDir, nodeModulesRoots);
  }

  const candidateRoots =
    nodeModulesRoots.length > 0 ? nodeModulesRoots : [path.resolve(startDir, "node_modules")];
  const candidates = candidateRoots
    .map((nodeModulesRoot) => ({
      nodeModulesRoot,
      absolutePath: path.resolve(nodeModulesRoot, normalizedSpecifier),
    }))
    .filter((candidate) => isPathInsideRoot(candidate.nodeModulesRoot, candidate.absolutePath));

  for (const candidate of candidates) {
    if (await isFile(candidate.absolutePath)) {
      return {
        absolutePath: candidate.absolutePath,
        filePath: normalizeProjectPath(path.relative(input.rootDir, candidate.absolutePath)),
      };
    }
  }

  const fallback = candidates[0];
  return fallback
    ? {
        absolutePath: fallback.absolutePath,
        filePath: normalizeProjectPath(path.relative(input.rootDir, fallback.absolutePath)),
      }
    : undefined;
}

async function findNodeModulesRoots(rootDir: string): Promise<string[]> {
  let currentDir = path.resolve(rootDir);
  let nearestPackageJsonDir: string | undefined;
  const roots: string[] = [];

  while (true) {
    if (!nearestPackageJsonDir && (await isFile(path.join(currentDir, "package.json")))) {
      nearestPackageJsonDir = currentDir;
    }

    const candidate = path.join(currentDir, "node_modules");
    if (await isDirectory(candidate)) {
      roots.push(candidate);
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      if (roots.length > 0) {
        return roots;
      }
      return nearestPackageJsonDir ? [path.join(nearestPackageJsonDir, "node_modules")] : [];
    }

    currentDir = parentDir;
  }
}

async function isFile(absolutePath: string): Promise<boolean> {
  try {
    return (await stat(absolutePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(absolutePath: string): Promise<boolean> {
  try {
    return (await stat(absolutePath)).isDirectory();
  } catch {
    return false;
  }
}

function isPackageCssImportSpecifier(specifier: string): boolean {
  if (!/\.(?:css|less|scss|sass)$/i.test(specifier)) {
    return false;
  }

  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(specifier)
  ) {
    return false;
  }

  return !specifier.split("/").some((segment) => segment === "." || segment === "..");
}

function extractCssImportSpecifiers(cssText: string): string[] {
  const specifiers: string[] = [];
  const importPattern =
    /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^"')\s;]+))(?:\s*\))?[^;]*;/gi;
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(cssText)) !== null) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return [...new Set(specifiers)].sort((left, right) => left.localeCompare(right));
}

function createImportKey(importRecord: PackageCssImportRecord): string {
  return [
    importRecord.importerKind,
    importRecord.importerFilePath,
    importRecord.specifier,
    importRecord.resolvedFilePath,
  ].join(":");
}

function comparePackageCssImports(
  left: PackageCssImportRecord,
  right: PackageCssImportRecord,
): number {
  return createImportKey(left).localeCompare(createImportKey(right));
}

function isPathInsideRoot(rootDir: string, absolutePath: string): boolean {
  const relativePath = path.relative(rootDir, absolutePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function getScriptKind(filePath: string): ts.ScriptKind {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".tsx") {
    return ts.ScriptKind.TSX;
  }
  if (extension === ".jsx") {
    return ts.ScriptKind.JSX;
  }
  if (extension === ".js") {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}
