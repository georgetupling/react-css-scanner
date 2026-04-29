import ts from "typescript";

import type {
  ModuleFactsDeclarationIndex,
  ModuleFactsExportRecord,
  ModuleFactsImportKind,
  ModuleFactsImportName,
  ModuleFactsImportRecord,
} from "../../module-facts/types.js";

export type SourceModuleSyntaxFacts = {
  imports: ModuleFactsImportRecord[];
  exports: ModuleFactsExportRecord[];
  declarations: ModuleFactsDeclarationIndex;
};

export function collectSourceModuleSyntax(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
}): SourceModuleSyntaxFacts {
  const declarations = collectDeclarations(input.sourceFile);
  const exports = collectExports(input.filePath, input.sourceFile);
  applyExportEvidenceToDeclarations(declarations, exports);

  return {
    imports: collectImports(input.filePath, input.sourceFile),
    exports,
    declarations,
  };
}

function collectImports(filePath: string, sourceFile: ts.SourceFile): ModuleFactsImportRecord[] {
  const imports: ModuleFactsImportRecord[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const specifier = statement.moduleSpecifier.text;
    const importNames = collectImportNames(statement);
    imports.push({
      filePath,
      specifier,
      importKind: classifyImportKind(specifier, importNames),
      importNames,
    });
  }

  return imports.sort(compareImportRecords);
}

function collectImportNames(statement: ts.ImportDeclaration): ModuleFactsImportName[] {
  const importClause = statement.importClause;
  if (!importClause) {
    return [];
  }

  const importNames: ModuleFactsImportName[] = [];
  if (importClause.name) {
    importNames.push({
      kind: "default",
      importedName: "default",
      localName: importClause.name.text,
      typeOnly: importClause.isTypeOnly,
    });
  }

  const namedBindings = importClause.namedBindings;
  if (!namedBindings) {
    return importNames;
  }

  if (ts.isNamespaceImport(namedBindings)) {
    importNames.push({
      kind: "namespace",
      importedName: "*",
      localName: namedBindings.name.text,
      typeOnly: importClause.isTypeOnly,
    });
    return importNames;
  }

  for (const element of namedBindings.elements) {
    const importedName = element.propertyName?.text ?? element.name.text;
    importNames.push({
      kind: "named",
      importedName,
      localName: element.name.text,
      typeOnly: importClause.isTypeOnly || element.isTypeOnly,
    });
  }

  return importNames.sort(compareImportNames);
}

function collectDeclarations(sourceFile: ts.SourceFile): ModuleFactsDeclarationIndex {
  const declarations = createEmptyDeclarationIndex();

  for (const statement of sourceFile.statements) {
    collectDeclaration(statement, declarations);
  }

  return declarations;
}

function createEmptyDeclarationIndex(): ModuleFactsDeclarationIndex {
  return {
    typeAliases: new Map(),
    interfaces: new Map(),
    valueDeclarations: new Map(),
    exportedLocalNames: new Map(),
    reExports: [],
  };
}

function collectDeclaration(
  statement: ts.Statement,
  declarations: ModuleFactsDeclarationIndex,
): void {
  if (ts.isTypeAliasDeclaration(statement)) {
    declarations.typeAliases.set(statement.name.text, statement);
    return;
  }

  if (ts.isInterfaceDeclaration(statement)) {
    declarations.interfaces.set(statement.name.text, statement);
    return;
  }

  if (ts.isFunctionDeclaration(statement) && statement.name) {
    declarations.valueDeclarations.set(statement.name.text, {
      kind: "function",
      name: statement.name.text,
      node: statement,
    });
    return;
  }

  if (ts.isClassDeclaration(statement) && statement.name) {
    declarations.valueDeclarations.set(statement.name.text, {
      kind: "class",
      name: statement.name.text,
      node: statement,
    });
    return;
  }

  if (ts.isEnumDeclaration(statement)) {
    declarations.valueDeclarations.set(statement.name.text, {
      kind: hasConstModifier(statement) ? "const-enum" : "enum",
      name: statement.name.text,
      node: statement,
    });
    return;
  }

  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
    declarations.valueDeclarations.set(statement.name.text, {
      kind: "namespace",
      name: statement.name.text,
      node: statement,
    });
    return;
  }

  if (!ts.isVariableStatement(statement)) {
    return;
  }

  const declarationKind = getVariableStatementKind(statement);
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) {
      continue;
    }
    declarations.valueDeclarations.set(declaration.name.text, {
      kind: declarationKind,
      name: declaration.name.text,
      node: declaration,
      initializer: declaration.initializer,
    });
  }
}

function collectExports(filePath: string, sourceFile: ts.SourceFile): ModuleFactsExportRecord[] {
  const exports: ModuleFactsExportRecord[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      exports.push(...collectExportDeclaration(filePath, statement));
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      exports.push({
        filePath,
        exportedName: "default",
        localName: ts.isIdentifier(statement.expression) ? statement.expression.text : undefined,
        typeOnly: false,
        declarationKind: "value",
      });
      continue;
    }

    if (!hasExportModifier(statement)) {
      continue;
    }

    exports.push(...collectDeclarationExports(filePath, statement));
  }

  return exports.sort(compareExportRecords);
}

function applyExportEvidenceToDeclarations(
  declarations: ModuleFactsDeclarationIndex,
  exports: ModuleFactsExportRecord[],
): void {
  for (const exportRecord of exports) {
    if (exportRecord.localName) {
      declarations.exportedLocalNames.set(exportRecord.exportedName, exportRecord.localName);
    }
    if (exportRecord.reexportKind) {
      declarations.reExports.push(exportRecord);
    }
  }
}

function collectDeclarationExports(
  filePath: string,
  statement: ts.Statement,
): ModuleFactsExportRecord[] {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    return [
      createLocalExportRecord({
        filePath,
        exportedName: getExportedDeclarationName(statement),
        localName: statement.name.text,
        declarationKind: "value",
      }),
    ];
  }

  if (ts.isFunctionDeclaration(statement) && hasDefaultModifier(statement)) {
    return [
      {
        filePath,
        exportedName: "default",
        typeOnly: false,
        declarationKind: "value",
      },
    ];
  }

  if (ts.isClassDeclaration(statement) && statement.name) {
    return [
      createLocalExportRecord({
        filePath,
        exportedName: getExportedDeclarationName(statement),
        localName: statement.name.text,
        declarationKind: "value",
      }),
    ];
  }

  if (ts.isClassDeclaration(statement) && hasDefaultModifier(statement)) {
    return [
      {
        filePath,
        exportedName: "default",
        typeOnly: false,
        declarationKind: "value",
      },
    ];
  }

  if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
    return [
      createLocalExportRecord({
        filePath,
        exportedName: statement.name.text,
        localName: statement.name.text,
        declarationKind: "type",
      }),
    ];
  }

  if (ts.isEnumDeclaration(statement)) {
    return [
      createLocalExportRecord({
        filePath,
        exportedName: statement.name.text,
        localName: statement.name.text,
        declarationKind: "value",
      }),
    ];
  }

  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
    return [
      createLocalExportRecord({
        filePath,
        exportedName: statement.name.text,
        localName: statement.name.text,
        declarationKind: "value",
      }),
    ];
  }

  if (!ts.isVariableStatement(statement)) {
    return [];
  }

  return statement.declarationList.declarations
    .filter((declaration): declaration is ts.VariableDeclaration & { name: ts.Identifier } =>
      ts.isIdentifier(declaration.name),
    )
    .map((declaration) =>
      createLocalExportRecord({
        filePath,
        exportedName: declaration.name.text,
        localName: declaration.name.text,
        declarationKind: "value",
      }),
    );
}

function collectExportDeclaration(
  filePath: string,
  statement: ts.ExportDeclaration,
): ModuleFactsExportRecord[] {
  const specifier =
    statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined;
  const exportClause = statement.exportClause;

  if (!exportClause) {
    return [
      {
        filePath,
        exportedName: "*",
        specifier,
        reexportKind: "star",
        typeOnly: statement.isTypeOnly,
        declarationKind: "unknown",
      },
    ];
  }

  if (ts.isNamespaceExport(exportClause)) {
    return [
      {
        filePath,
        exportedName: exportClause.name.text,
        specifier,
        reexportKind: "namespace",
        typeOnly: statement.isTypeOnly,
        declarationKind: "unknown",
      },
    ];
  }

  return exportClause.elements
    .map((element) => {
      const localName = element.propertyName?.text ?? element.name.text;
      return {
        filePath,
        exportedName: element.name.text,
        sourceExportedName: localName,
        localName: specifier ? undefined : localName,
        specifier,
        reexportKind: specifier ? ("named" as const) : undefined,
        typeOnly: statement.isTypeOnly || element.isTypeOnly,
        declarationKind:
          statement.isTypeOnly || element.isTypeOnly ? ("type" as const) : ("unknown" as const),
      };
    })
    .sort(compareExportRecords);
}

function createLocalExportRecord(input: {
  filePath: string;
  exportedName: string;
  localName: string;
  declarationKind: "type" | "value";
}): ModuleFactsExportRecord {
  return {
    filePath: input.filePath,
    exportedName: input.exportedName,
    sourceExportedName: input.localName,
    localName: input.localName,
    typeOnly: input.declarationKind === "type",
    declarationKind: input.declarationKind,
  };
}

function classifyImportKind(
  specifier: string,
  importNames: ModuleFactsImportName[],
): ModuleFactsImportKind {
  if (importNames.length > 0 && importNames.every((importName) => importName.typeOnly)) {
    return "type-only";
  }

  if (specifier.endsWith(".css")) {
    return "css";
  }

  if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
    return "external-css";
  }

  if (specifier.startsWith(".") || specifier.startsWith("/") || /^[^./@][^:]*$/.test(specifier)) {
    return "source";
  }

  if (specifier.startsWith("@")) {
    return "source";
  }

  return "unknown";
}

function getExportedDeclarationName(statement: ts.Statement): string {
  if (hasDefaultModifier(statement)) {
    return "default";
  }

  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
    return statement.name.text;
  }

  return "default";
}

function getVariableStatementKind(statement: ts.VariableStatement): "const" | "let" | "var" {
  if ((statement.declarationList.flags & ts.NodeFlags.Const) !== 0) {
    return "const";
  }
  if ((statement.declarationList.flags & ts.NodeFlags.Let) !== 0) {
    return "let";
  }
  return "var";
}

function hasExportModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}

function hasDefaultModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ??
      false)
  );
}

function hasConstModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ConstKeyword) ??
      false)
  );
}

function compareImportRecords(
  left: ModuleFactsImportRecord,
  right: ModuleFactsImportRecord,
): number {
  return (
    left.specifier.localeCompare(right.specifier) ||
    compareImportNames(left.importNames[0], right.importNames[0])
  );
}

function compareImportNames(
  left: ModuleFactsImportName | undefined,
  right: ModuleFactsImportName | undefined,
): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  return (
    left.kind.localeCompare(right.kind) ||
    left.importedName.localeCompare(right.importedName) ||
    left.localName.localeCompare(right.localName)
  );
}

function compareExportRecords(
  left: ModuleFactsExportRecord,
  right: ModuleFactsExportRecord,
): number {
  return (
    left.exportedName.localeCompare(right.exportedName) ||
    (left.sourceExportedName ?? "").localeCompare(right.sourceExportedName ?? "") ||
    (left.specifier ?? "").localeCompare(right.specifier ?? "")
  );
}
