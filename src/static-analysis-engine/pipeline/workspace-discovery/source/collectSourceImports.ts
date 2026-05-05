import ts from "typescript";

import type { DiscoveryConfig } from "../../../../config/index.js";
import type {
  ProjectSourceFile,
  ProjectStylesheetFile,
  SourceImportFact,
  SourceImportKind,
} from "../types.js";
import { isStylesheetPath } from "../../../libraries/stylesheets/cssModulePaths.js";
import { resolveWorkspaceSpecifier } from "../resolution/index.js";

export function collectSourceImports(input: {
  sourceFiles: ProjectSourceFile[];
  stylesheets: ProjectStylesheetFile[];
  discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
}): SourceImportFact[] {
  const knownSourceFilePaths = new Set(input.sourceFiles.map((sourceFile) => sourceFile.filePath));
  const knownStylesheetFilePaths = new Set(
    input.stylesheets.map((stylesheet) => stylesheet.filePath),
  );
  const imports: SourceImportFact[] = [];

  for (const sourceFile of input.sourceFiles) {
    const parsedSourceFile = ts.createSourceFile(
      sourceFile.filePath,
      sourceFile.sourceText,
      ts.ScriptTarget.Latest,
      false,
      getScriptKind(sourceFile.filePath),
    );

    for (const statement of parsedSourceFile.statements) {
      if (ts.isExportDeclaration(statement)) {
        const moduleSpecifier = statement.moduleSpecifier;
        if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) {
          continue;
        }

        const specifier = moduleSpecifier.text;
        imports.push(
          resolveImportFact({
            importerFilePath: sourceFile.filePath,
            specifier,
            importKind: classifyExportKind(statement, specifier),
            importLoading: "static",
            knownSourceFilePaths,
            knownStylesheetFilePaths,
            discovery: input.discovery,
          }),
        );
        continue;
      }

      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }

      const specifier = statement.moduleSpecifier.text;
      const importKind = classifyImportKind(statement, specifier);
      imports.push(
        resolveImportFact({
          importerFilePath: sourceFile.filePath,
          specifier,
          importKind,
          importLoading: "static",
          knownSourceFilePaths,
          knownStylesheetFilePaths,
          discovery: input.discovery,
        }),
      );
    }

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const specifier = node.arguments[0].text;
        imports.push(
          resolveImportFact({
            importerFilePath: sourceFile.filePath,
            specifier,
            importKind: classifyDynamicImportKind(specifier),
            importLoading: "dynamic",
            knownSourceFilePaths,
            knownStylesheetFilePaths,
            discovery: input.discovery,
          }),
        );
      }

      ts.forEachChild(node, visit);
    };
    ts.forEachChild(parsedSourceFile, visit);
  }

  return imports.sort(compareSourceImportFacts);
}

function resolveImportFact(input: {
  importerFilePath: string;
  specifier: string;
  importKind: SourceImportKind;
  importLoading: "static" | "dynamic";
  knownSourceFilePaths: ReadonlySet<string>;
  knownStylesheetFilePaths: ReadonlySet<string>;
  discovery?: Pick<DiscoveryConfig, "aliases" | "stylesheetExtensions">;
}): SourceImportFact {
  if (input.importKind === "external-css") {
    return {
      importerFilePath: input.importerFilePath,
      specifier: input.specifier,
      importKind: input.importKind,
      importLoading: input.importLoading,
      resolutionStatus: "external",
    };
  }

  if (input.importKind === "unknown") {
    return {
      importerFilePath: input.importerFilePath,
      specifier: input.specifier,
      importKind: input.importKind,
      importLoading: input.importLoading,
      resolutionStatus: "unsupported",
    };
  }

  if (input.importKind === "css") {
    const resolution = resolveWorkspaceSpecifier({
      importerFilePath: input.importerFilePath,
      specifier: input.specifier,
      targetKind: "stylesheet",
      knownStylesheetFilePaths: input.knownStylesheetFilePaths,
      discovery: input.discovery,
    });
    return resolution.status === "resolved" && resolution.kind === "project"
      ? {
          importerFilePath: input.importerFilePath,
          specifier: input.specifier,
          importKind: input.importKind,
          importLoading: input.importLoading,
          resolutionStatus: "resolved",
          resolvedFilePath: resolution.filePath,
        }
      : {
          importerFilePath: input.importerFilePath,
          specifier: input.specifier,
          importKind: input.importKind,
          importLoading: input.importLoading,
          resolutionStatus:
            resolution.status === "external" ||
            (resolution.status === "resolved" && resolution.kind === "package")
              ? "external"
              : "unresolved",
        };
  }

  const resolution = resolveWorkspaceSpecifier({
    importerFilePath: input.importerFilePath,
    specifier: input.specifier,
    targetKind: "source",
    knownSourceFilePaths: input.knownSourceFilePaths,
    discovery: input.discovery,
  });

  if (resolution.status !== "resolved" || resolution.kind !== "project") {
    return {
      importerFilePath: input.importerFilePath,
      specifier: input.specifier,
      importKind: input.importKind,
      importLoading: input.importLoading,
      resolutionStatus: resolution.status === "external" ? "external" : "unresolved",
    };
  }

  return {
    importerFilePath: input.importerFilePath,
    specifier: input.specifier,
    importKind: input.importKind,
    importLoading: input.importLoading,
    resolutionStatus: "resolved",
    resolvedFilePath: resolution.filePath,
  };
}

function classifyExportKind(statement: ts.ExportDeclaration, specifier: string): SourceImportKind {
  if (statement.isTypeOnly || exportDeclarationOnlyExportsTypes(statement)) {
    return "type-only";
  }

  return classifyModuleSpecifierKind(specifier);
}

function classifyImportKind(statement: ts.ImportDeclaration, specifier: string): SourceImportKind {
  const importClause = statement.importClause;
  if (
    importClause?.isTypeOnly ||
    (importClause?.name === undefined &&
      importClause?.namedBindings !== undefined &&
      ts.isNamedImports(importClause.namedBindings) &&
      importClause.namedBindings.elements.length > 0 &&
      importClause.namedBindings.elements.every((element) => element.isTypeOnly))
  ) {
    return "type-only";
  }

  return classifyModuleSpecifierKind(specifier);
}

function classifyDynamicImportKind(specifier: string): SourceImportKind {
  return classifyModuleSpecifierKind(specifier);
}

function classifyModuleSpecifierKind(specifier: string): SourceImportKind {
  if (isStylesheetSpecifier(specifier)) {
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

function exportDeclarationOnlyExportsTypes(statement: ts.ExportDeclaration): boolean {
  const exportClause = statement.exportClause;
  return (
    exportClause !== undefined &&
    ts.isNamedExports(exportClause) &&
    exportClause.elements.length > 0 &&
    exportClause.elements.every((element) => element.isTypeOnly)
  );
}

function getScriptKind(filePath: string): ts.ScriptKind {
  if (/\.tsx$/i.test(filePath)) {
    return ts.ScriptKind.TSX;
  }
  if (/\.jsx$/i.test(filePath)) {
    return ts.ScriptKind.JSX;
  }
  if (/\.mts$/i.test(filePath)) {
    return ts.ScriptKind.TS;
  }
  if (/\.cts$/i.test(filePath)) {
    return ts.ScriptKind.TS;
  }
  if (/\.ts$/i.test(filePath)) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}

function isStylesheetSpecifier(specifier: string): boolean {
  return isStylesheetPath(specifier);
}

function compareSourceImportFacts(left: SourceImportFact, right: SourceImportFact): number {
  return (
    left.importerFilePath.localeCompare(right.importerFilePath) ||
    left.specifier.localeCompare(right.specifier) ||
    left.importKind.localeCompare(right.importKind) ||
    left.importLoading.localeCompare(right.importLoading) ||
    left.resolutionStatus.localeCompare(right.resolutionStatus) ||
    (left.resolvedFilePath ?? "").localeCompare(right.resolvedFilePath ?? "")
  );
}
