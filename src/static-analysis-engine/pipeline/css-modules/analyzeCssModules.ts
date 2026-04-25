import ts from "typescript";
import type { ParsedProjectFile } from "../../entry/stages/types.js";
import type { AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type { ExperimentalCssFileAnalysis } from "../css-analysis/types.js";
import type { ModuleGraph } from "../module-graph/types.js";
import type {
  CssModuleAnalysis,
  CssModuleAnalysisOptions,
  CssModuleDestructuredBindingRecord,
  CssModuleImportRecord,
  CssModuleMemberReferenceRecord,
  CssModuleReferenceDiagnosticRecord,
} from "./types.js";

export function analyzeCssModules(input: {
  parsedFiles: ParsedProjectFile[];
  moduleGraph: ModuleGraph;
  cssFiles: ExperimentalCssFileAnalysis[];
  options?: CssModuleAnalysisOptions;
}): CssModuleAnalysis {
  const options = normalizeCssModuleAnalysisOptions(input.options);
  const imports = buildCssModuleImports(input);
  const { destructuredBindings, memberReferences, diagnostics } = buildCssModuleMemberReferences({
    parsedFiles: input.parsedFiles,
    imports,
  });

  return {
    options,
    imports,
    destructuredBindings,
    memberReferences,
    diagnostics,
  };
}

function normalizeCssModuleAnalysisOptions(
  options: CssModuleAnalysisOptions | undefined,
): Required<CssModuleAnalysisOptions> {
  return {
    localsConvention: options?.localsConvention ?? "camelCase",
  };
}

function buildCssModuleImports(input: {
  moduleGraph: ModuleGraph;
  cssFiles: ExperimentalCssFileAnalysis[];
}): CssModuleImportRecord[] {
  const imports: CssModuleImportRecord[] = [];
  const cssModuleFilePaths = new Set(
    input.cssFiles
      .map((cssFile) => normalizeOptionalProjectPath(cssFile.filePath))
      .filter(
        (filePath): filePath is string => Boolean(filePath) && isCssModuleStylesheet(filePath),
      ),
  );

  for (const moduleNode of input.moduleGraph.modulesById.values()) {
    if (moduleNode.kind !== "source") {
      continue;
    }

    const sourceFilePath = normalizeProjectPath(moduleNode.filePath);

    for (const importRecord of moduleNode.imports) {
      if (importRecord.importKind !== "css") {
        continue;
      }

      const stylesheetFilePath = resolveCssModuleSpecifier({
        fromFilePath: sourceFilePath,
        specifier: importRecord.specifier,
        knownCssModuleFilePaths: cssModuleFilePaths,
      });
      if (!stylesheetFilePath) {
        continue;
      }

      for (const importedName of importRecord.importedNames) {
        imports.push({
          sourceFilePath,
          stylesheetFilePath,
          specifier: importRecord.specifier,
          localName: importedName.localName,
          importKind: getCssModuleImportKind(importedName.importedName),
        });
      }
    }
  }

  return imports.sort((left, right) =>
    `${left.sourceFilePath}:${left.stylesheetFilePath}:${left.localName}`.localeCompare(
      `${right.sourceFilePath}:${right.stylesheetFilePath}:${right.localName}`,
    ),
  );
}

function buildCssModuleMemberReferences(input: {
  parsedFiles: ParsedProjectFile[];
  imports: CssModuleImportRecord[];
}): {
  destructuredBindings: CssModuleDestructuredBindingRecord[];
  memberReferences: CssModuleMemberReferenceRecord[];
  diagnostics: CssModuleReferenceDiagnosticRecord[];
} {
  const importsBySourceAndLocalName = new Map<string, CssModuleImportRecord>();
  for (const cssModuleImport of input.imports) {
    importsBySourceAndLocalName.set(
      createCssModuleLocalKey(cssModuleImport.sourceFilePath, cssModuleImport.localName),
      cssModuleImport,
    );
  }

  const destructuredBindings: CssModuleDestructuredBindingRecord[] = [];
  const memberReferences: CssModuleMemberReferenceRecord[] = [];
  const diagnostics: CssModuleReferenceDiagnosticRecord[] = [];

  for (const parsedFile of input.parsedFiles) {
    const sourceFilePath = normalizeProjectPath(parsedFile.filePath);

    const visit = (node: ts.Node): void => {
      const memberAccess = getCssModuleMemberAccess({
        node,
        parsedSourceFile: parsedFile.parsedSourceFile,
        sourceFilePath,
        importsBySourceAndLocalName,
      });

      if (memberAccess?.kind === "reference") {
        memberReferences.push(memberAccess.reference);
      } else if (memberAccess?.kind === "diagnostic") {
        diagnostics.push(memberAccess.diagnostic);
      }

      const destructuring = getCssModuleDestructuring({
        node,
        parsedSourceFile: parsedFile.parsedSourceFile,
        sourceFilePath,
        importsBySourceAndLocalName,
      });
      if (destructuring) {
        destructuredBindings.push(...destructuring.bindings);
        memberReferences.push(...destructuring.references);
        diagnostics.push(...destructuring.diagnostics);
      }

      ts.forEachChild(node, visit);
    };

    visit(parsedFile.parsedSourceFile);
  }

  return {
    destructuredBindings: deduplicateByKey(destructuredBindings, createDestructuredBindingKey).sort(
      compareDestructuredBindings,
    ),
    memberReferences: deduplicateByKey(memberReferences, createMemberReferenceKey).sort(
      compareMemberReferences,
    ),
    diagnostics: deduplicateByKey(diagnostics, createDiagnosticKey).sort(compareDiagnostics),
  };
}

type CssModuleMemberAccess =
  | { kind: "reference"; reference: CssModuleMemberReferenceRecord }
  | { kind: "diagnostic"; diagnostic: CssModuleReferenceDiagnosticRecord };

function getCssModuleMemberAccess(input: {
  node: ts.Node;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  importsBySourceAndLocalName: Map<string, CssModuleImportRecord>;
}): CssModuleMemberAccess | undefined {
  if (ts.isPropertyAccessExpression(input.node) && ts.isIdentifier(input.node.expression)) {
    const cssModuleImport = input.importsBySourceAndLocalName.get(
      createCssModuleLocalKey(input.sourceFilePath, input.node.expression.text),
    );
    if (!cssModuleImport) {
      return undefined;
    }

    const location = toSourceAnchor(input.node, input.parsedSourceFile, input.sourceFilePath);
    return {
      kind: "reference",
      reference: {
        sourceFilePath: input.sourceFilePath,
        stylesheetFilePath: cssModuleImport.stylesheetFilePath,
        localName: cssModuleImport.localName,
        memberName: input.node.name.text,
        accessKind: "property",
        location,
        rawExpressionText: input.node.getText(input.parsedSourceFile),
        traces: [
          createCssModuleTrace({
            traceId: `css-module:member-reference:${location.filePath}:${location.startLine}:${location.startColumn}`,
            summary: `CSS Module member "${input.node.name.text}" was read from import "${cssModuleImport.localName}"`,
            anchor: location,
            metadata: {
              stylesheetFilePath: cssModuleImport.stylesheetFilePath,
              memberName: input.node.name.text,
            },
          }),
        ],
      },
    };
  }

  if (ts.isElementAccessExpression(input.node) && ts.isIdentifier(input.node.expression)) {
    const cssModuleImport = input.importsBySourceAndLocalName.get(
      createCssModuleLocalKey(input.sourceFilePath, input.node.expression.text),
    );
    if (!cssModuleImport) {
      return undefined;
    }

    const location = toSourceAnchor(input.node, input.parsedSourceFile, input.sourceFilePath);
    if (ts.isStringLiteralLike(input.node.argumentExpression)) {
      return {
        kind: "reference",
        reference: {
          sourceFilePath: input.sourceFilePath,
          stylesheetFilePath: cssModuleImport.stylesheetFilePath,
          localName: cssModuleImport.localName,
          memberName: input.node.argumentExpression.text,
          accessKind: "string-literal-element",
          location,
          rawExpressionText: input.node.getText(input.parsedSourceFile),
          traces: [
            createCssModuleTrace({
              traceId: `css-module:member-reference:${location.filePath}:${location.startLine}:${location.startColumn}`,
              summary: `CSS Module member "${input.node.argumentExpression.text}" was read from import "${cssModuleImport.localName}"`,
              anchor: location,
              metadata: {
                stylesheetFilePath: cssModuleImport.stylesheetFilePath,
                memberName: input.node.argumentExpression.text,
              },
            }),
          ],
        },
      };
    }

    return {
      kind: "diagnostic",
      diagnostic: {
        sourceFilePath: input.sourceFilePath,
        stylesheetFilePath: cssModuleImport.stylesheetFilePath,
        localName: cssModuleImport.localName,
        reason: "computed-css-module-member",
        location,
        rawExpressionText: input.node.getText(input.parsedSourceFile),
        traces: [
          createCssModuleTrace({
            traceId: `css-module:diagnostic:computed-member:${location.filePath}:${location.startLine}:${location.startColumn}`,
            summary:
              "CSS Module member access used a computed expression that cannot be resolved statically",
            anchor: location,
            metadata: {
              stylesheetFilePath: cssModuleImport.stylesheetFilePath,
              reason: "computed-css-module-member",
            },
          }),
        ],
      },
    };
  }

  return undefined;
}

function getCssModuleDestructuring(input: {
  node: ts.Node;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  importsBySourceAndLocalName: Map<string, CssModuleImportRecord>;
}):
  | {
      bindings: CssModuleDestructuredBindingRecord[];
      references: CssModuleMemberReferenceRecord[];
      diagnostics: CssModuleReferenceDiagnosticRecord[];
    }
  | undefined {
  if (
    !ts.isVariableDeclaration(input.node) ||
    !ts.isObjectBindingPattern(input.node.name) ||
    !input.node.initializer ||
    !ts.isIdentifier(input.node.initializer)
  ) {
    return undefined;
  }

  const cssModuleImport = input.importsBySourceAndLocalName.get(
    createCssModuleLocalKey(input.sourceFilePath, input.node.initializer.text),
  );
  if (!cssModuleImport) {
    return undefined;
  }

  const bindings: CssModuleDestructuredBindingRecord[] = [];
  const references: CssModuleMemberReferenceRecord[] = [];
  const diagnostics: CssModuleReferenceDiagnosticRecord[] = [];

  for (const element of input.node.name.elements) {
    if (element.dotDotDotToken) {
      diagnostics.push(
        createCssModuleDestructuringDiagnostic({
          reason: "rest-css-module-destructuring",
          element,
          parsedSourceFile: input.parsedSourceFile,
          sourceFilePath: input.sourceFilePath,
          cssModuleImport,
          summary:
            "CSS Module destructuring used a rest binding that cannot be resolved statically",
        }),
      );
      continue;
    }

    const memberName = getBindingElementMemberName(element);
    if (memberName.kind === "computed") {
      diagnostics.push(
        createCssModuleDestructuringDiagnostic({
          reason: "computed-css-module-destructuring",
          element,
          parsedSourceFile: input.parsedSourceFile,
          sourceFilePath: input.sourceFilePath,
          cssModuleImport,
          summary:
            "CSS Module destructuring used a computed member name that cannot be resolved statically",
        }),
      );
      continue;
    }

    if (!ts.isIdentifier(element.name)) {
      diagnostics.push(
        createCssModuleDestructuringDiagnostic({
          reason: "nested-css-module-destructuring",
          element,
          parsedSourceFile: input.parsedSourceFile,
          sourceFilePath: input.sourceFilePath,
          cssModuleImport,
          summary:
            "CSS Module destructuring used a nested binding pattern that cannot be resolved statically",
        }),
      );
      continue;
    }

    const location = toSourceAnchor(element, input.parsedSourceFile, input.sourceFilePath);
    const trace = createCssModuleTrace({
      traceId: `css-module:destructured-binding:${location.filePath}:${location.startLine}:${location.startColumn}`,
      summary: `CSS Module member "${memberName.text}" was destructured from import "${cssModuleImport.localName}"`,
      anchor: location,
      metadata: {
        stylesheetFilePath: cssModuleImport.stylesheetFilePath,
        memberName: memberName.text,
        bindingName: element.name.text,
      },
    });
    const rawExpressionText = element.getText(input.parsedSourceFile);

    bindings.push({
      sourceFilePath: input.sourceFilePath,
      stylesheetFilePath: cssModuleImport.stylesheetFilePath,
      localName: cssModuleImport.localName,
      memberName: memberName.text,
      bindingName: element.name.text,
      location,
      rawExpressionText,
      traces: [trace],
    });
    references.push({
      sourceFilePath: input.sourceFilePath,
      stylesheetFilePath: cssModuleImport.stylesheetFilePath,
      localName: cssModuleImport.localName,
      memberName: memberName.text,
      accessKind: "destructured-binding",
      location,
      rawExpressionText,
      traces: [trace],
    });
  }

  return { bindings, references, diagnostics };
}

function getBindingElementMemberName(
  element: ts.BindingElement,
): { kind: "static"; text: string } | { kind: "computed" } {
  if (!element.propertyName) {
    return ts.isIdentifier(element.name)
      ? { kind: "static", text: element.name.text }
      : { kind: "computed" };
  }

  if (ts.isComputedPropertyName(element.propertyName)) {
    return { kind: "computed" };
  }

  if (
    ts.isIdentifier(element.propertyName) ||
    ts.isStringLiteral(element.propertyName) ||
    ts.isNumericLiteral(element.propertyName)
  ) {
    return { kind: "static", text: element.propertyName.text };
  }

  return { kind: "computed" };
}

function createCssModuleDestructuringDiagnostic(input: {
  reason: CssModuleReferenceDiagnosticRecord["reason"];
  element: ts.BindingElement;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  cssModuleImport: CssModuleImportRecord;
  summary: string;
}): CssModuleReferenceDiagnosticRecord {
  const location = toSourceAnchor(input.element, input.parsedSourceFile, input.sourceFilePath);
  return {
    sourceFilePath: input.sourceFilePath,
    stylesheetFilePath: input.cssModuleImport.stylesheetFilePath,
    localName: input.cssModuleImport.localName,
    reason: input.reason,
    location,
    rawExpressionText: input.element.getText(input.parsedSourceFile),
    traces: [
      createCssModuleTrace({
        traceId: `css-module:diagnostic:${input.reason}:${location.filePath}:${location.startLine}:${location.startColumn}`,
        summary: input.summary,
        anchor: location,
        metadata: {
          stylesheetFilePath: input.cssModuleImport.stylesheetFilePath,
          reason: input.reason,
        },
      }),
    ],
  };
}

function resolveCssModuleSpecifier(input: {
  fromFilePath: string;
  specifier: string;
  knownCssModuleFilePaths: Set<string>;
}): string | undefined {
  if (!input.specifier.startsWith(".")) {
    return undefined;
  }

  const fromSegments = normalizeProjectPath(input.fromFilePath).split("/");
  fromSegments.pop();
  const baseSegments = input.specifier.split("/").filter((segment) => segment.length > 0);
  const candidateBasePath = normalizeSegments([...fromSegments, ...baseSegments]);
  const candidatePaths = [candidateBasePath, `${candidateBasePath}.css`];

  return candidatePaths.find((candidatePath) => input.knownCssModuleFilePaths.has(candidatePath));
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

function getCssModuleImportKind(importedName: string): CssModuleImportRecord["importKind"] {
  if (importedName === "default") {
    return "default";
  }

  return importedName === "*" ? "namespace" : "named";
}

function createCssModuleLocalKey(sourceFilePath: string, localName: string): string {
  return `${normalizeProjectPath(sourceFilePath)}:${localName}`;
}

function createMemberReferenceKey(reference: CssModuleMemberReferenceRecord): string {
  return [
    reference.sourceFilePath,
    reference.stylesheetFilePath,
    reference.memberName,
    reference.location.startLine,
    reference.location.startColumn,
  ].join(":");
}

function createDestructuredBindingKey(binding: CssModuleDestructuredBindingRecord): string {
  return [
    binding.sourceFilePath,
    binding.stylesheetFilePath,
    binding.memberName,
    binding.bindingName,
    binding.location.startLine,
    binding.location.startColumn,
  ].join(":");
}

function createDiagnosticKey(diagnostic: CssModuleReferenceDiagnosticRecord): string {
  return [
    diagnostic.sourceFilePath,
    diagnostic.stylesheetFilePath,
    diagnostic.reason,
    diagnostic.location.startLine,
    diagnostic.location.startColumn,
  ].join(":");
}

function deduplicateByKey<T>(entries: T[], createKey: (entry: T) => string): T[] {
  return [...new Map(entries.map((entry) => [createKey(entry), entry])).values()];
}

function compareMemberReferences(
  left: CssModuleMemberReferenceRecord,
  right: CssModuleMemberReferenceRecord,
): number {
  return createMemberReferenceKey(left).localeCompare(createMemberReferenceKey(right));
}

function compareDestructuredBindings(
  left: CssModuleDestructuredBindingRecord,
  right: CssModuleDestructuredBindingRecord,
): number {
  return createDestructuredBindingKey(left).localeCompare(createDestructuredBindingKey(right));
}

function compareDiagnostics(
  left: CssModuleReferenceDiagnosticRecord,
  right: CssModuleReferenceDiagnosticRecord,
): number {
  return createDiagnosticKey(left).localeCompare(createDiagnosticKey(right));
}

function toSourceAnchor(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): SourceAnchor {
  const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
  const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());
  return {
    filePath: normalizeProjectPath(filePath),
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function createCssModuleTrace(input: {
  traceId: string;
  summary: string;
  anchor: SourceAnchor;
  metadata: Record<string, unknown>;
}): AnalysisTrace {
  return {
    traceId: input.traceId,
    category: "value-evaluation",
    summary: input.summary,
    anchor: input.anchor,
    children: [],
    metadata: input.metadata,
  };
}

function isCssModuleStylesheet(filePath: string | undefined): boolean {
  return Boolean(filePath?.match(/\.module\.[cm]?css$/i));
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function normalizeOptionalProjectPath(filePath: string | undefined): string | undefined {
  return filePath ? normalizeProjectPath(filePath) : undefined;
}
