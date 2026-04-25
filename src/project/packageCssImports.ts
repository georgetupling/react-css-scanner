import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { normalizeProjectPath } from "./pathUtils.js";
import type { ScanDiagnostic } from "./types.js";

export type PackageCssImportRecord = {
  importerKind: "source" | "stylesheet";
  importerFilePath: string;
  specifier: string;
  resolvedFilePath: string;
};

export type LoadedPackageCssImports = {
  cssSources: Array<{ filePath: string; cssText: string }>;
  imports: PackageCssImportRecord[];
};

export async function loadPackageCssImports(input: {
  rootDir: string;
  sourceFiles: Array<{ filePath: string; sourceText: string }>;
  cssSources: Array<{ filePath: string; cssText: string }>;
  diagnostics: ScanDiagnostic[];
}): Promise<LoadedPackageCssImports> {
  const importsByKey = new Map<string, PackageCssImportRecord>();
  const cssSourcesByPath = new Map(
    input.cssSources.map((cssSource) => [cssSource.filePath, cssSource]),
  );
  const pendingImports = collectSourcePackageCssImportRecords(input);
  const loadedPackageCssSources: Array<{ filePath: string; cssText: string }> = [];
  const attemptedFilePaths = new Set<string>();

  for (const importRecord of collectStylesheetPackageCssImportRecords({
    rootDir: input.rootDir,
    cssSources: [...cssSourcesByPath.values()],
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
      ...collectStylesheetPackageCssImportRecords({
        rootDir: input.rootDir,
        cssSources: [cssSource],
      }),
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

function collectSourcePackageCssImportRecords(input: {
  rootDir: string;
  sourceFiles: Array<{ filePath: string; sourceText: string }>;
}): PackageCssImportRecord[] {
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
      const resolvedFilePath = resolvePackageCssImport({
        rootDir: input.rootDir,
        specifier,
      });
      if (!resolvedFilePath) {
        continue;
      }

      imports.push({
        importerKind: "source",
        importerFilePath: sourceFile.filePath,
        specifier,
        resolvedFilePath,
      });
    }
  }

  return imports.sort(comparePackageCssImports);
}

function collectStylesheetPackageCssImportRecords(input: {
  rootDir: string;
  cssSources: Array<{ filePath: string; cssText: string }>;
}): PackageCssImportRecord[] {
  const imports: PackageCssImportRecord[] = [];

  for (const cssSource of input.cssSources) {
    for (const specifier of extractCssImportSpecifiers(cssSource.cssText)) {
      const resolvedFilePath = resolvePackageCssImport({
        rootDir: input.rootDir,
        specifier,
      });
      if (!resolvedFilePath) {
        continue;
      }

      imports.push({
        importerKind: "stylesheet",
        importerFilePath: cssSource.filePath,
        specifier,
        resolvedFilePath,
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
  const absolutePath = path.resolve(input.rootDir, input.importRecord.resolvedFilePath);
  try {
    return {
      filePath: input.importRecord.resolvedFilePath,
      cssText: await readFile(absolutePath, "utf8"),
    };
  } catch (error) {
    input.diagnostics.push({
      code: "loading.package-css-import-read-failed",
      severity: "warning",
      phase: "loading",
      filePath: input.importRecord.importerFilePath,
      message: `failed to load package CSS import "${input.importRecord.specifier}" from ${input.importRecord.importerFilePath}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

function resolvePackageCssImport(input: {
  rootDir: string;
  specifier: string;
}): string | undefined {
  const normalizedSpecifier = input.specifier.replace(/\\/g, "/");
  if (!isPackageCssImportSpecifier(normalizedSpecifier)) {
    return undefined;
  }

  const absolutePath = path.resolve(input.rootDir, "node_modules", normalizedSpecifier);
  const nodeModulesRoot = path.resolve(input.rootDir, "node_modules");
  if (!isPathInsideRoot(nodeModulesRoot, absolutePath)) {
    return undefined;
  }

  return normalizeProjectPath(path.relative(input.rootDir, absolutePath));
}

function isPackageCssImportSpecifier(specifier: string): boolean {
  if (!specifier.endsWith(".css")) {
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
