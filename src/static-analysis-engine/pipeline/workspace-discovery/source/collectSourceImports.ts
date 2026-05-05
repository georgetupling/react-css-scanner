import ts from "typescript";

import type {
  ProjectSourceFile,
  ProjectStylesheetFile,
  SourceImportFact,
  SourceImportKind,
} from "../types.js";

export function collectSourceImports(input: {
  sourceFiles: ProjectSourceFile[];
  stylesheets: ProjectStylesheetFile[];
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
    if (!isRelativeOrAbsolutePath(input.specifier)) {
      return {
        importerFilePath: input.importerFilePath,
        specifier: input.specifier,
        importKind: input.importKind,
        importLoading: input.importLoading,
        resolutionStatus: "external",
      };
    }

    const resolvedFilePath = resolveStylesheetSpecifierPath({
      fromFilePath: input.importerFilePath,
      specifier: input.specifier,
    });
    return input.knownStylesheetFilePaths.has(resolvedFilePath)
      ? {
          importerFilePath: input.importerFilePath,
          specifier: input.specifier,
          importKind: input.importKind,
          importLoading: input.importLoading,
          resolutionStatus: "resolved",
          resolvedFilePath,
        }
      : {
          importerFilePath: input.importerFilePath,
          specifier: input.specifier,
          importKind: input.importKind,
          importLoading: input.importLoading,
          resolutionStatus: "unresolved",
        };
  }

  if (!input.specifier.startsWith(".")) {
    return {
      importerFilePath: input.importerFilePath,
      specifier: input.specifier,
      importKind: input.importKind,
      importLoading: input.importLoading,
      resolutionStatus: "unresolved",
    };
  }

  const resolvedFilePath = getSourceSpecifierCandidatePaths({
    fromFilePath: input.importerFilePath,
    specifier: input.specifier,
  }).find((candidatePath) => input.knownSourceFilePaths.has(candidatePath));

  return resolvedFilePath
    ? {
        importerFilePath: input.importerFilePath,
        specifier: input.specifier,
        importKind: input.importKind,
        importLoading: input.importLoading,
        resolutionStatus: "resolved",
        resolvedFilePath,
      }
    : {
        importerFilePath: input.importerFilePath,
        specifier: input.specifier,
        importKind: input.importKind,
        importLoading: input.importLoading,
        resolutionStatus: "unresolved",
      };
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

function classifyDynamicImportKind(specifier: string): SourceImportKind {
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

function isRelativeOrAbsolutePath(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

function getSourceSpecifierCandidatePaths(input: {
  fromFilePath: string;
  specifier: string;
}): string[] {
  const fromSegments = input.fromFilePath.replace(/\\/g, "/").split("/");
  fromSegments.pop();
  const baseSegments = input.specifier.split("/").filter((segment) => segment.length > 0);
  const candidateBasePath = normalizeSegments([...fromSegments, ...baseSegments]);

  return [
    candidateBasePath,
    ...getTypeScriptSourceAlternatesForSpecifier(candidateBasePath),
    `${candidateBasePath}.ts`,
    `${candidateBasePath}.tsx`,
    `${candidateBasePath}.js`,
    `${candidateBasePath}.jsx`,
    `${candidateBasePath}/index.ts`,
    `${candidateBasePath}/index.tsx`,
    `${candidateBasePath}/index.js`,
    `${candidateBasePath}/index.jsx`,
  ];
}

function resolveStylesheetSpecifierPath(input: {
  fromFilePath: string;
  specifier: string;
}): string {
  if (input.specifier.startsWith("/")) {
    return input.specifier.replace(/^\/+/, "").replace(/\\/g, "/");
  }

  const fromSegments = input.fromFilePath.replace(/\\/g, "/").split("/");
  fromSegments.pop();
  const specifierSegments = input.specifier.split("/").filter(Boolean);
  return normalizeSegments([...fromSegments, ...specifierSegments]);
}

function getTypeScriptSourceAlternatesForSpecifier(candidateBasePath: string): string[] {
  if (candidateBasePath.endsWith(".js")) {
    return [
      `${candidateBasePath.slice(0, -".js".length)}.ts`,
      `${candidateBasePath.slice(0, -".js".length)}.tsx`,
    ];
  }

  if (candidateBasePath.endsWith(".jsx")) {
    return [`${candidateBasePath.slice(0, -".jsx".length)}.tsx`];
  }

  if (candidateBasePath.endsWith(".mjs") || candidateBasePath.endsWith(".cjs")) {
    return [
      `${candidateBasePath.slice(0, -".mjs".length)}.mts`,
      `${candidateBasePath.slice(0, -".mjs".length)}.cts`,
    ];
  }

  return [];
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
