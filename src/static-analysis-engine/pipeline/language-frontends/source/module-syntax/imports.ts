import ts from "typescript";

import type {
  SourceImportSyntaxKind,
  SourceImportSyntaxName,
  SourceImportSyntaxRecord,
} from "./types.js";
import { isStylesheetPath } from "../../../../libraries/stylesheets/cssModulePaths.js";
import { compareImportNames } from "./shared.js";

export function collectImports(
  filePath: string,
  sourceFile: ts.SourceFile,
): SourceImportSyntaxRecord[] {
  const imports: SourceImportSyntaxRecord[] = [];

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
      importLoading: "static",
      importNames,
    });
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const specifier = node.arguments[0].text;
      imports.push({
        filePath,
        specifier,
        importKind: classifyImportKind(specifier, []),
        importLoading: "dynamic",
        importNames: [],
      });
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return imports.sort(compareImportRecords);
}

function collectImportNames(statement: ts.ImportDeclaration): SourceImportSyntaxName[] {
  const importClause = statement.importClause;
  if (!importClause) {
    return [];
  }

  const importNames: SourceImportSyntaxName[] = [];
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

function classifyImportKind(
  specifier: string,
  importNames: SourceImportSyntaxName[],
): SourceImportSyntaxKind {
  if (importNames.length > 0 && importNames.every((importName) => importName.typeOnly)) {
    return "type-only";
  }

  if (isStylesheetPath(specifier)) {
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

function compareImportRecords(
  left: SourceImportSyntaxRecord,
  right: SourceImportSyntaxRecord,
): number {
  return (
    left.specifier.localeCompare(right.specifier) ||
    left.importLoading.localeCompare(right.importLoading) ||
    compareImportNames(left.importNames[0], right.importNames[0])
  );
}
