import ts from "typescript";
import type { EngineModuleId } from "../../types/core.js";
import type {
  ModuleExportRecord,
  ModuleGraph,
  ModuleImportKind,
  ModuleImportRecord,
  ModuleNode,
} from "./types.js";

export function buildModuleGraphFromSource(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  topLevelSymbolIds: string[];
  resolveImportSpecifier?: (fromFilePath: string, specifier: string) => EngineModuleId | undefined;
}): ModuleGraph {
  const moduleId = createModuleId(input.filePath);
  const imports: ModuleImportRecord[] = [];
  const exports: ModuleExportRecord[] = [];

  for (const statement of input.parsedSourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(buildImportRecord(statement, input.filePath, input.resolveImportSpecifier));
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      exports.push(...buildExportRecords(statement, input.filePath, input.resolveImportSpecifier));
      continue;
    }
  }

  const moduleNode: ModuleNode = {
    id: moduleId,
    filePath: input.filePath,
    kind: "source",
    imports,
    exports,
    topLevelSymbols: input.topLevelSymbolIds,
  };

  return {
    modulesById: new Map([[moduleId, moduleNode]]),
    importEdges: imports
      .filter((entry) => entry.resolvedModuleId)
      .map((entry) => ({
        fromModuleId: moduleId,
        toModuleId: entry.resolvedModuleId as EngineModuleId,
        kind: entry.importKind,
      })),
    exportEdges: exports
      .filter((entry) => entry.reexportedModuleId)
      .map((entry) => ({
        fromModuleId: moduleId,
        toModuleId: entry.reexportedModuleId as EngineModuleId,
        exportedName: entry.exportedName,
      })),
  };
}

export function buildModuleGraphFromSources(
  inputs: Array<{
    filePath: string;
    parsedSourceFile: ts.SourceFile;
    topLevelSymbolIds: string[];
  }>,
): ModuleGraph {
  const modulesById = new Map<EngineModuleId, ModuleNode>();
  const importEdges: ModuleGraph["importEdges"] = [];
  const exportEdges: ModuleGraph["exportEdges"] = [];
  const knownFilePaths = new Set(inputs.map((entry) => normalizeProjectPath(entry.filePath)));
  const resolveImportSpecifier = (fromFilePath: string, specifier: string) => {
    const resolvedFilePath = resolveRelativeSourceSpecifier(
      fromFilePath,
      specifier,
      knownFilePaths,
    );
    return resolvedFilePath ? createModuleId(resolvedFilePath) : undefined;
  };

  for (const input of inputs) {
    const partialGraph = buildModuleGraphFromSource({
      ...input,
      resolveImportSpecifier,
    });

    for (const [moduleId, moduleNode] of partialGraph.modulesById.entries()) {
      modulesById.set(moduleId, moduleNode);
    }

    importEdges.push(...partialGraph.importEdges);
    exportEdges.push(...partialGraph.exportEdges);
  }

  return {
    modulesById,
    importEdges,
    exportEdges,
  };
}

export function createModuleId(filePath: string): EngineModuleId {
  return `module:${filePath}`;
}

function buildImportRecord(
  statement: ts.ImportDeclaration,
  fromFilePath: string,
  resolveImportSpecifier?: (fromFilePath: string, specifier: string) => EngineModuleId | undefined,
): ModuleImportRecord {
  const specifier = statement.moduleSpecifier.text;
  const importClause = statement.importClause;
  const importedNames: ModuleImportRecord["importedNames"] = [];

  if (importClause?.name) {
    importedNames.push({
      importedName: "default",
      localName: importClause.name.text,
    });
  }

  if (importClause?.namedBindings) {
    if (ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        importedNames.push({
          importedName: element.propertyName?.text ?? element.name.text,
          localName: element.name.text,
        });
      }
    } else {
      importedNames.push({
        importedName: "*",
        localName: importClause.namedBindings.name.text,
      });
    }
  }

  return {
    specifier,
    resolvedModuleId: specifier.startsWith(".")
      ? (resolveImportSpecifier?.(fromFilePath, specifier) ?? createModuleId(specifier))
      : undefined,
    importKind: classifyImportKind(specifier, importClause?.isTypeOnly === true),
    importedNames,
  };
}

function buildExportRecords(
  statement: ts.ExportDeclaration,
  fromFilePath: string,
  resolveImportSpecifier?: (fromFilePath: string, specifier: string) => EngineModuleId | undefined,
): ModuleExportRecord[] {
  if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
    return [
      {
        exportedName: statement.exportClause.name.text,
        sourceExportedName: "*",
        reexportedModuleId:
          statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
            ? (resolveImportSpecifier?.(fromFilePath, statement.moduleSpecifier.text) ??
              createModuleId(statement.moduleSpecifier.text))
            : undefined,
        reexportKind: "namespace",
      },
    ];
  }

  if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
    return statement.exportClause.elements.map((element) => ({
      exportedName: element.name.text,
      sourceExportedName: element.propertyName?.text ?? element.name.text,
      reexportedModuleId:
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? (resolveImportSpecifier?.(fromFilePath, statement.moduleSpecifier.text) ??
            createModuleId(statement.moduleSpecifier.text))
          : undefined,
      reexportKind: "named",
    }));
  }

  if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
    return [
      {
        exportedName: "*",
        reexportedModuleId:
          resolveImportSpecifier?.(fromFilePath, statement.moduleSpecifier.text) ??
          createModuleId(statement.moduleSpecifier.text),
        reexportKind: "star",
      },
    ];
  }

  return [];
}

function classifyImportKind(specifier: string, isTypeOnly: boolean): ModuleImportKind {
  if (isTypeOnly) {
    return "type-only";
  }

  if (specifier.endsWith(".css")) {
    return specifier.startsWith(".") ? "css" : "external-css";
  }

  return "source";
}

function resolveRelativeSourceSpecifier(
  fromFilePath: string,
  specifier: string,
  knownFilePaths: Set<string>,
): string | undefined {
  const normalizedFromFilePath = normalizeProjectPath(fromFilePath);
  const fromSegments = normalizedFromFilePath.split("/");
  fromSegments.pop();
  const baseSegments = specifier.split("/").filter((segment) => segment.length > 0);
  const candidateBasePath = normalizeSegments([...fromSegments, ...baseSegments]);

  const candidatePaths = [
    candidateBasePath,
    `${candidateBasePath}.ts`,
    `${candidateBasePath}.tsx`,
    `${candidateBasePath}.js`,
    `${candidateBasePath}.jsx`,
    `${candidateBasePath}/index.ts`,
    `${candidateBasePath}/index.tsx`,
    `${candidateBasePath}/index.js`,
    `${candidateBasePath}/index.jsx`,
  ];

  return candidatePaths.find((candidatePath) => knownFilePaths.has(candidatePath));
}

function normalizeSegments(segments: string[]): string {
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      normalized.pop();
      continue;
    }

    normalized.push(segment);
  }

  return normalized.join("/");
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
