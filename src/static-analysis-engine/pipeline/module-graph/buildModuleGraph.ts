import ts from "typescript";
import { normalizeFilePath } from "../project-resolution/pathUtils.js";
import { resolveSourceSpecifier } from "../project-resolution/resolveSourceSpecifier.js";
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

    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isVariableStatement(statement) ||
      ts.isExportAssignment(statement)
    ) {
      exports.push(...buildLocalExportRecords(statement, moduleId));
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
    topLevelSymbols: collectTopLevelSymbolIds({
      moduleId,
      parsedSourceFile: input.parsedSourceFile,
    }),
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
  }>,
): ModuleGraph {
  const modulesById = new Map<EngineModuleId, ModuleNode>();
  const importEdges: ModuleGraph["importEdges"] = [];
  const exportEdges: ModuleGraph["exportEdges"] = [];
  const knownFilePaths = new Set(inputs.map((entry) => normalizeFilePath(entry.filePath)));
  const resolveImportSpecifier = (fromFilePath: string, specifier: string) => {
    const resolvedFilePath = resolveSourceSpecifier({
      fromFilePath,
      specifier,
      knownFilePaths,
    });
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
  if (!ts.isStringLiteral(statement.moduleSpecifier)) {
    throw new Error("buildImportRecord requires a string-literal module specifier");
  }

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

function buildLocalExportRecords(
  statement: ts.FunctionDeclaration | ts.VariableStatement | ts.ExportAssignment,
  moduleId: EngineModuleId,
): ModuleExportRecord[] {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    const localSymbolId = createTopLevelSymbolId(moduleId, statement.name.text);
    const records: ModuleExportRecord[] = [];
    if (isExported(statement)) {
      records.push({
        exportedName: statement.name.text,
        sourceExportedName: statement.name.text,
        localSymbolId,
      });
    }

    if (isDefaultExported(statement)) {
      records.push({
        exportedName: "default",
        sourceExportedName: statement.name.text,
        localSymbolId,
      });
    }

    return records;
  }

  if (ts.isVariableStatement(statement)) {
    if (!isExported(statement)) {
      return [];
    }

    return statement.declarationList.declarations.flatMap((declaration) => {
      if (!ts.isIdentifier(declaration.name)) {
        return [];
      }

      return [
        {
          exportedName: declaration.name.text,
          sourceExportedName: declaration.name.text,
          localSymbolId: createTopLevelSymbolId(moduleId, declaration.name.text),
        },
      ];
    });
  }

  if (ts.isFunctionDeclaration(statement)) {
    return isDefaultExported(statement) ? [{ exportedName: "default" }] : [];
  }

  if (!ts.isExportAssignment(statement)) {
    return [];
  }

  if (statement.isExportEquals) {
    return [];
  }

  const { expression } = statement;
  if (ts.isIdentifier(expression)) {
    return [
      {
        exportedName: "default",
        sourceExportedName: expression.text,
        localSymbolId: createTopLevelSymbolId(moduleId, expression.text),
      },
    ];
  }

  return [{ exportedName: "default" }];
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

function createTopLevelSymbolId(moduleId: EngineModuleId, localName: string): string {
  return `symbol:${moduleId}:${localName}`;
}

function collectTopLevelSymbolIds(input: {
  moduleId: EngineModuleId;
  parsedSourceFile: ts.SourceFile;
}): string[] {
  const symbolIds = new Set<string>();

  for (const statement of input.parsedSourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      collectImportSymbolIds(statement.importClause, input.moduleId, symbolIds);
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      symbolIds.add(createTopLevelSymbolId(input.moduleId, statement.name.text));
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          symbolIds.add(createTopLevelSymbolId(input.moduleId, declaration.name.text));
        }
      }
    }
  }

  return [...symbolIds].sort((left, right) => left.localeCompare(right));
}

function collectImportSymbolIds(
  importClause: ts.ImportClause,
  moduleId: EngineModuleId,
  symbolIds: Set<string>,
): void {
  if (importClause.name) {
    symbolIds.add(createTopLevelSymbolId(moduleId, importClause.name.text));
  }

  if (!importClause.namedBindings) {
    return;
  }

  if (ts.isNamedImports(importClause.namedBindings)) {
    for (const element of importClause.namedBindings.elements) {
      symbolIds.add(createTopLevelSymbolId(moduleId, element.name.text));
    }
    return;
  }

  symbolIds.add(createTopLevelSymbolId(moduleId, importClause.namedBindings.name.text));
}

function isExported(
  statement:
    | ts.FunctionDeclaration
    | ts.VariableStatement
    | (ts.Statement & { modifiers?: ts.NodeArray<ts.ModifierLike> }),
): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}

function isDefaultExported(
  statement:
    | ts.FunctionDeclaration
    | (ts.Statement & { modifiers?: ts.NodeArray<ts.ModifierLike> }),
): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false
  );
}
