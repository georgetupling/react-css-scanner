import ts from "typescript";

import type {
  CssModuleLocalsConvention,
  CssModuleAliasAnalysis,
  CssModuleDestructuredBindingAnalysis,
  CssModuleImportAnalysis,
  CssModuleMemberMatchRelation,
  CssModuleMemberReferenceAnalysis,
  CssModuleReferenceDiagnosticAnalysis,
  ProjectEvidenceBuildInput,
  ProjectEvidenceBuilderIndexes,
} from "../analysisTypes.js";
import { buildCssModuleAliases } from "../../language-frontends/source/css-module-syntax/analyzeCssModuleAliases.js";
import { getCssModuleDestructuring } from "../../language-frontends/source/css-module-syntax/analyzeCssModuleDestructuring.js";
import { getCssModuleMemberAccess } from "../../language-frontends/source/css-module-syntax/analyzeCssModuleMemberAccess.js";
import {
  createCssModuleTrace,
  toSourceAnchor,
} from "../../language-frontends/source/css-module-syntax/shared.js";
import type { ResolvedCssModuleNamespaceBinding } from "../../language-frontends/source/css-module-syntax/types.js";
import {
  compareById,
  createCssModuleAliasId,
  createCssModuleDestructuredBindingId,
  createCssModuleDiagnosticId,
  createCssModuleImportId,
  createCssModuleImportLookupKey,
  createCssModuleMemberReferenceId,
  mergeTraces,
  normalizeProjectPath,
  uniqueSorted,
} from "../internal/shared.js";

export function buildCssModuleImports(
  input: ProjectEvidenceBuildInput,
  indexes: ProjectEvidenceBuilderIndexes,
): CssModuleImportAnalysis[] {
  const imports: CssModuleImportAnalysis[] = [];

  for (const sourceFile of input.factGraph.frontends.source.files) {
    for (const importSyntax of sourceFile.moduleSyntax.imports) {
      if (importSyntax.importKind !== "css") {
        continue;
      }
      const stylesheetFilePath = findResolvedStylesheetImportPath({
        sourceFilePath: sourceFile.filePath,
        specifier: importSyntax.specifier,
        input,
      });
      if (!stylesheetFilePath || !isCssModuleStylesheet(stylesheetFilePath, input)) {
        continue;
      }

      const sourceFileId = indexes.sourceFileIdByPath.get(sourceFile.filePath.replace(/\\/g, "/"));
      const stylesheetId = indexes.stylesheetIdByPath.get(stylesheetFilePath.replace(/\\/g, "/"));
      if (!sourceFileId || !stylesheetId) {
        continue;
      }

      for (const binding of importSyntax.importNames) {
        imports.push({
          id: createCssModuleImportId({
            sourceFilePath: sourceFile.filePath,
            stylesheetFilePath,
            localName: binding.localName,
          }),
          sourceFileId,
          stylesheetId,
          sourceFilePath: sourceFile.filePath.replace(/\\/g, "/"),
          stylesheetFilePath: stylesheetFilePath.replace(/\\/g, "/"),
          specifier: importSyntax.specifier,
          localName: binding.localName,
          importKind: binding.kind,
        });
      }
    }
  }

  return imports.sort(compareById);
}

function findResolvedStylesheetImportPath(input: {
  sourceFilePath: string;
  specifier: string;
  input: ProjectEvidenceBuildInput;
}): string | undefined {
  const normalizedSourceFilePath = normalizeProjectPath(input.sourceFilePath);
  return input.input.factGraph.graph.edges.imports.find(
    (edge) =>
      edge.importerKind === "source" &&
      normalizeProjectPath(edge.importerFilePath) === normalizedSourceFilePath &&
      edge.importKind === "css" &&
      edge.specifier === input.specifier,
  )?.resolvedFilePath;
}

function isCssModuleStylesheet(
  stylesheetFilePath: string,
  input: ProjectEvidenceBuildInput,
): boolean {
  return (
    input.factGraph.snapshot.files.stylesheets.find(
      (stylesheet) =>
        normalizeProjectPath(stylesheet.filePath) === normalizeProjectPath(stylesheetFilePath),
    )?.cssKind === "css-module"
  );
}

export function buildCssModuleMemberReferences(input: {
  projectInput: ProjectEvidenceBuildInput;
  imports: CssModuleImportAnalysis[];
  indexes: ProjectEvidenceBuilderIndexes;
  includeTraces: boolean;
}): {
  aliases: CssModuleAliasAnalysis[];
  destructuredBindings: CssModuleDestructuredBindingAnalysis[];
  memberReferences: CssModuleMemberReferenceAnalysis[];
  diagnostics: CssModuleReferenceDiagnosticAnalysis[];
} {
  const importBySourceLocalName = new Map<string, CssModuleImportAnalysis[]>();
  const importByLookupKey = new Map<string, CssModuleImportAnalysis>();
  for (const cssImport of input.imports) {
    const key = `${normalizeProjectPath(cssImport.sourceFilePath)}:${cssImport.localName}`;
    const values = importBySourceLocalName.get(key) ?? [];
    values.push(cssImport);
    importBySourceLocalName.set(key, values);
    importByLookupKey.set(
      createCssModuleImportLookupKey({
        sourceFilePath: cssImport.sourceFilePath,
        stylesheetFilePath: cssImport.stylesheetFilePath,
        localName: cssImport.localName,
      }),
      cssImport,
    );
  }

  const aliases: CssModuleAliasAnalysis[] = [];
  const destructuredBindings: CssModuleDestructuredBindingAnalysis[] = [];
  const memberReferences: CssModuleMemberReferenceAnalysis[] = [];
  const diagnostics: CssModuleReferenceDiagnosticAnalysis[] = [];

  const sourceFiles = input.projectInput.factGraph?.frontends.source.files ?? [];
  for (const sourceFile of sourceFiles) {
    const directNamespaceBindingsByLocalName = new Map<
      string,
      {
        sourceFilePath: string;
        stylesheetFilePath: string;
        specifier: string;
        localName: string;
        originLocalName: string;
        importKind: "default" | "namespace" | "named";
        sourceKind: "direct-import" | "alias";
        location: {
          filePath: string;
          startLine: number;
          startColumn: number;
          endLine?: number;
          endColumn?: number;
        };
        rawExpressionText: string;
        traces: ReturnType<typeof mergeTraces>;
      }
    >();

    for (const cssImport of input.imports) {
      if (
        normalizeProjectPath(cssImport.sourceFilePath) !== normalizeProjectPath(sourceFile.filePath)
      ) {
        continue;
      }
      directNamespaceBindingsByLocalName.set(cssImport.localName, {
        sourceFilePath: cssImport.sourceFilePath,
        stylesheetFilePath: cssImport.stylesheetFilePath,
        specifier: cssImport.specifier,
        localName: cssImport.localName,
        originLocalName: cssImport.localName,
        importKind: cssImport.importKind,
        sourceKind: "direct-import",
        location: {
          filePath: cssImport.sourceFilePath,
          startLine: 1,
          startColumn: 1,
        },
        rawExpressionText: cssImport.localName,
        traces: [],
      });
    }

    const aliasResult = buildCssModuleAliases({
      parsedSourceFile: sourceFile.legacy.parsedFile.parsedSourceFile,
      sourceFilePath: sourceFile.filePath,
      directNamespaceBindingsByLocalName,
      includeTraces: input.includeTraces,
    });

    const namespaceBindings = new Map(directNamespaceBindingsByLocalName);
    for (const aliasBinding of aliasResult.aliases) {
      namespaceBindings.set(aliasBinding.localName, aliasBinding);
      const importLookupKey = createCssModuleImportLookupKey({
        sourceFilePath: aliasBinding.sourceFilePath,
        stylesheetFilePath: aliasBinding.stylesheetFilePath,
        localName: aliasBinding.originLocalName,
      });
      const cssImport = importByLookupKey.get(importLookupKey);
      if (!cssImport) {
        continue;
      }
      aliases.push({
        id: createCssModuleAliasId(aliasBinding.location, cssImport.id, aliasBinding.localName),
        importId: cssImport.id,
        sourceFileId: cssImport.sourceFileId,
        stylesheetId: cssImport.stylesheetId,
        localName: aliasBinding.originLocalName,
        aliasName: aliasBinding.localName,
        location: aliasBinding.location,
        rawExpressionText: aliasBinding.rawExpressionText,
        traces: input.includeTraces ? mergeTraces(aliasBinding.traces) : [],
      });
    }

    const boundHelpersByLocalName = buildBoundCssModuleHelpers({
      parsedSourceFile: sourceFile.legacy.parsedFile.parsedSourceFile,
      sourceFilePath: sourceFile.filePath,
      namespaceBindings,
      classNamesBindLocalNames: collectClassNamesBindLocalNames(sourceFile.moduleSyntax.imports),
      includeTraces: input.includeTraces,
    });

    for (const aliasDiagnostic of aliasResult.diagnostics) {
      const importLookupKey = createCssModuleImportLookupKey({
        sourceFilePath: aliasDiagnostic.sourceFilePath,
        stylesheetFilePath: aliasDiagnostic.stylesheetFilePath,
        localName: aliasDiagnostic.originLocalName,
      });
      const cssImport = importByLookupKey.get(importLookupKey);
      if (!cssImport) {
        continue;
      }
      diagnostics.push({
        id: createCssModuleDiagnosticId(aliasDiagnostic.location, cssImport.id),
        importId: cssImport.id,
        sourceFileId: cssImport.sourceFileId,
        stylesheetId: cssImport.stylesheetId,
        localName: aliasDiagnostic.localName,
        reason: aliasDiagnostic.reason,
        location: aliasDiagnostic.location,
        rawExpressionText: aliasDiagnostic.rawExpressionText,
        traces: input.includeTraces ? mergeTraces(aliasDiagnostic.traces) : [],
      });
    }

    const visit = (node: import("typescript").Node): void => {
      const destructuringResult = getCssModuleDestructuring({
        node,
        parsedSourceFile: sourceFile.legacy.parsedFile.parsedSourceFile,
        sourceFilePath: sourceFile.filePath,
        namespaceBindings,
        includeTraces: input.includeTraces,
      });
      if (destructuringResult) {
        for (const binding of destructuringResult.bindings) {
          const importLookupKey = createCssModuleImportLookupKey({
            sourceFilePath: binding.sourceFilePath,
            stylesheetFilePath: binding.stylesheetFilePath,
            localName: binding.originLocalName,
          });
          const cssImport = importByLookupKey.get(importLookupKey);
          if (!cssImport) {
            continue;
          }
          destructuredBindings.push({
            id: createCssModuleDestructuredBindingId(
              binding.location,
              cssImport.id,
              binding.memberName,
              binding.localName,
            ),
            importId: cssImport.id,
            sourceFileId: cssImport.sourceFileId,
            stylesheetId: cssImport.stylesheetId,
            localName: binding.originLocalName,
            memberName: binding.memberName,
            bindingName: binding.localName,
            location: binding.location,
            rawExpressionText: binding.rawExpressionText,
            traces: input.includeTraces ? mergeTraces(binding.traces) : [],
          });
        }
        for (const reference of destructuringResult.references) {
          const importsForBinding =
            importBySourceLocalName.get(
              `${normalizeProjectPath(sourceFile.filePath)}:${reference.originLocalName}`,
            ) ?? [];
          for (const cssImport of importsForBinding) {
            memberReferences.push({
              id: createCssModuleMemberReferenceId(
                reference.location,
                cssImport.id,
                reference.memberName,
              ),
              importId: cssImport.id,
              sourceFileId: cssImport.sourceFileId,
              stylesheetId: cssImport.stylesheetId,
              localName: reference.originLocalName,
              memberName: reference.memberName,
              accessKind: "destructured-binding",
              location: reference.location,
              rawExpressionText: reference.rawExpressionText,
              traces: input.includeTraces ? mergeTraces(reference.traces) : [],
            });
          }
        }
        for (const diagnostic of destructuringResult.diagnostics) {
          const importLookupKey = createCssModuleImportLookupKey({
            sourceFilePath: diagnostic.sourceFilePath,
            stylesheetFilePath: diagnostic.stylesheetFilePath,
            localName: diagnostic.originLocalName,
          });
          const cssImport = importByLookupKey.get(importLookupKey);
          if (!cssImport) {
            continue;
          }
          diagnostics.push({
            id: createCssModuleDiagnosticId(diagnostic.location, cssImport.id),
            importId: cssImport.id,
            sourceFileId: cssImport.sourceFileId,
            stylesheetId: cssImport.stylesheetId,
            localName: diagnostic.localName,
            reason: diagnostic.reason,
            location: diagnostic.location,
            rawExpressionText: diagnostic.rawExpressionText,
            traces: input.includeTraces ? mergeTraces(diagnostic.traces) : [],
          });
        }
      }

      const memberAccessResult = getCssModuleMemberAccess({
        node,
        parsedSourceFile: sourceFile.legacy.parsedFile.parsedSourceFile,
        sourceFilePath: sourceFile.filePath,
        namespaceBindings,
        includeTraces: input.includeTraces,
      });
      if (memberAccessResult?.kind === "reference") {
        const importsForBinding =
          importBySourceLocalName.get(
            `${normalizeProjectPath(sourceFile.filePath)}:${memberAccessResult.reference.originLocalName}`,
          ) ?? [];
        for (const cssImport of importsForBinding) {
          memberReferences.push({
            id: createCssModuleMemberReferenceId(
              memberAccessResult.reference.location,
              cssImport.id,
              memberAccessResult.reference.memberName,
            ),
            importId: cssImport.id,
            sourceFileId: cssImport.sourceFileId,
            stylesheetId: cssImport.stylesheetId,
            localName: memberAccessResult.reference.originLocalName,
            memberName: memberAccessResult.reference.memberName,
            accessKind: memberAccessResult.reference.accessKind,
            location: memberAccessResult.reference.location,
            rawExpressionText: memberAccessResult.reference.rawExpressionText,
            traces: input.includeTraces ? mergeTraces(memberAccessResult.reference.traces) : [],
          });
        }
      } else if (memberAccessResult?.kind === "diagnostic") {
        const importLookupKey = createCssModuleImportLookupKey({
          sourceFilePath: memberAccessResult.diagnostic.sourceFilePath,
          stylesheetFilePath: memberAccessResult.diagnostic.stylesheetFilePath,
          localName: memberAccessResult.diagnostic.originLocalName,
        });
        const cssImport = importByLookupKey.get(importLookupKey);
        if (cssImport) {
          diagnostics.push({
            id: createCssModuleDiagnosticId(memberAccessResult.diagnostic.location, cssImport.id),
            importId: cssImport.id,
            sourceFileId: cssImport.sourceFileId,
            stylesheetId: cssImport.stylesheetId,
            localName: memberAccessResult.diagnostic.localName,
            reason: memberAccessResult.diagnostic.reason,
            location: memberAccessResult.diagnostic.location,
            rawExpressionText: memberAccessResult.diagnostic.rawExpressionText,
            traces: input.includeTraces ? mergeTraces(memberAccessResult.diagnostic.traces) : [],
          });
        }
      }

      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const boundHelper = boundHelpersByLocalName.get(node.expression.text);
        if (boundHelper) {
          const boundReferences = collectBoundCssModuleHelperReferences({
            callExpression: node,
            parsedSourceFile: sourceFile.legacy.parsedFile.parsedSourceFile,
            sourceFilePath: sourceFile.filePath,
            binding: boundHelper,
            includeTraces: input.includeTraces,
          });
          const importsForBinding =
            importBySourceLocalName.get(
              `${normalizeProjectPath(sourceFile.filePath)}:${boundHelper.originLocalName}`,
            ) ?? [];
          for (const reference of boundReferences) {
            for (const cssImport of importsForBinding) {
              memberReferences.push({
                id: createCssModuleMemberReferenceId(
                  reference.location,
                  cssImport.id,
                  reference.memberName,
                ),
                importId: cssImport.id,
                sourceFileId: cssImport.sourceFileId,
                stylesheetId: cssImport.stylesheetId,
                localName: reference.originLocalName,
                memberName: reference.memberName,
                accessKind: "string-literal-element",
                location: reference.location,
                rawExpressionText: reference.rawExpressionText,
                traces: input.includeTraces ? mergeTraces(reference.traces) : [],
              });
            }
          }
        }
      }

      node.forEachChild(visit);
    };

    visit(sourceFile.legacy.parsedFile.parsedSourceFile);
  }

  for (const classSite of input.projectInput.factGraph?.graph.nodes.classExpressionSites ?? []) {
    if (classSite.classExpressionSiteKind !== "css-module-member") {
      continue;
    }
    const expressionNode = input.projectInput.factGraph?.graph.indexes.nodesById.get(
      classSite.expressionNodeId,
    );
    if (!expressionNode || expressionNode.kind !== "expression-syntax") {
      continue;
    }

    const resolved = resolveCssModuleExpressionReference({
      expressionNode,
      factGraph: input.projectInput.factGraph?.graph,
    });
    if (!resolved) {
      continue;
    }

    const importsForBinding =
      importBySourceLocalName.get(
        `${normalizeProjectPath(classSite.filePath)}:${resolved.localName}`,
      ) ?? [];
    for (const cssImport of importsForBinding) {
      memberReferences.push({
        id: createCssModuleMemberReferenceId(classSite.location, cssImport.id, resolved.memberName),
        importId: cssImport.id,
        sourceFileId: cssImport.sourceFileId,
        stylesheetId: cssImport.stylesheetId,
        localName: resolved.localName,
        memberName: resolved.memberName,
        accessKind: resolved.accessKind,
        location: classSite.location,
        rawExpressionText: classSite.rawExpressionText,
        traces: [],
      });
    }
  }

  return {
    aliases: dedupeById(aliases).sort(compareById),
    destructuredBindings: dedupeById(destructuredBindings).sort(compareById),
    memberReferences: dedupeById(memberReferences).sort(compareById),
    diagnostics: dedupeById(diagnostics).sort(compareById),
  };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function collectClassNamesBindLocalNames(
  imports: ProjectEvidenceBuildInput["factGraph"]["frontends"]["source"]["files"][number]["moduleSyntax"]["imports"],
): Set<string> {
  const localNames = new Set<string>();
  for (const importSyntax of imports) {
    if (
      importSyntax.importKind !== "source" ||
      (importSyntax.specifier !== "classnames/bind" && importSyntax.specifier !== "classnames")
    ) {
      continue;
    }
    for (const importName of importSyntax.importNames) {
      if (importName.typeOnly) {
        continue;
      }
      if (
        importName.kind === "default" ||
        importName.kind === "namespace" ||
        importName.importedName === "bind"
      ) {
        localNames.add(importName.localName);
      }
    }
  }
  return localNames;
}

function buildBoundCssModuleHelpers(input: {
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  namespaceBindings: Map<string, ResolvedCssModuleNamespaceBinding>;
  classNamesBindLocalNames: Set<string>;
  includeTraces: boolean;
}): Map<string, ResolvedCssModuleNamespaceBinding> {
  const helpers = new Map<string, ResolvedCssModuleNamespaceBinding>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isConstVariableDeclaration(node)
    ) {
      const binding = resolveBoundCssModuleHelperBinding({
        initializer: node.initializer,
        namespaceBindings: input.namespaceBindings,
        classNamesBindLocalNames: input.classNamesBindLocalNames,
      });
      if (binding) {
        helpers.set(node.name.text, binding);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(input.parsedSourceFile);
  return new Map([...helpers.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

function isConstVariableDeclaration(node: ts.VariableDeclaration): boolean {
  return Boolean(
    ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0,
  );
}

function resolveBoundCssModuleHelperBinding(input: {
  initializer: ts.Expression;
  namespaceBindings: Map<string, ResolvedCssModuleNamespaceBinding>;
  classNamesBindLocalNames: Set<string>;
}): ResolvedCssModuleNamespaceBinding | undefined {
  const initializer = unwrapExpression(input.initializer);
  if (!ts.isCallExpression(initializer) || initializer.arguments.length !== 1) {
    return undefined;
  }

  const callee = unwrapExpression(initializer.expression);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== "bind" ||
    !ts.isIdentifier(callee.expression) ||
    !input.classNamesBindLocalNames.has(callee.expression.text)
  ) {
    return undefined;
  }

  const namespaceArgument = unwrapExpression(initializer.arguments[0]);
  if (!ts.isIdentifier(namespaceArgument)) {
    return undefined;
  }

  return input.namespaceBindings.get(namespaceArgument.text);
}

function collectBoundCssModuleHelperReferences(input: {
  callExpression: ts.CallExpression;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  binding: ResolvedCssModuleNamespaceBinding;
  includeTraces: boolean;
}): Array<{
  originLocalName: string;
  memberName: string;
  location: {
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine?: number;
    endColumn?: number;
  };
  rawExpressionText: string;
  traces: ReturnType<typeof mergeTraces>;
}> {
  return input.callExpression.arguments.flatMap((argument) =>
    collectBoundCssModuleHelperArgumentReferences({
      expression: argument,
      parsedSourceFile: input.parsedSourceFile,
      sourceFilePath: input.sourceFilePath,
      binding: input.binding,
      includeTraces: input.includeTraces,
    }),
  );
}

function collectBoundCssModuleHelperArgumentReferences(input: {
  expression: ts.Expression;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  binding: ResolvedCssModuleNamespaceBinding;
  includeTraces: boolean;
}): Array<{
  originLocalName: string;
  memberName: string;
  location: {
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine?: number;
    endColumn?: number;
  };
  rawExpressionText: string;
  traces: ReturnType<typeof mergeTraces>;
}> {
  const expression = unwrapExpression(input.expression);
  if (ts.isStringLiteralLike(expression)) {
    return expression.text
      .split(/\s+/)
      .filter(Boolean)
      .map((memberName) =>
        createBoundCssModuleReference({
          node: expression,
          memberName,
          parsedSourceFile: input.parsedSourceFile,
          sourceFilePath: input.sourceFilePath,
          binding: input.binding,
          includeTraces: input.includeTraces,
        }),
      );
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) => {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
        return [];
      }
      return collectBoundCssModuleHelperArgumentReferences({
        ...input,
        expression: element,
      });
    });
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        return [];
      }
      const memberName = getStaticPropertyName(property.name);
      if (!memberName) {
        return [];
      }
      return [
        createBoundCssModuleReference({
          node: property.name,
          memberName,
          parsedSourceFile: input.parsedSourceFile,
          sourceFilePath: input.sourceFilePath,
          binding: input.binding,
          includeTraces: input.includeTraces,
        }),
      ];
    });
  }

  if (ts.isConditionalExpression(expression)) {
    return [
      ...collectBoundCssModuleHelperArgumentReferences({
        ...input,
        expression: expression.whenTrue,
      }),
      ...collectBoundCssModuleHelperArgumentReferences({
        ...input,
        expression: expression.whenFalse,
      }),
    ];
  }

  return [];
}

function createBoundCssModuleReference(input: {
  node: ts.Node;
  memberName: string;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  binding: ResolvedCssModuleNamespaceBinding;
  includeTraces: boolean;
}): {
  originLocalName: string;
  memberName: string;
  location: {
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine?: number;
    endColumn?: number;
  };
  rawExpressionText: string;
  traces: ReturnType<typeof mergeTraces>;
} {
  const location = toSourceAnchor(input.node, input.parsedSourceFile, input.sourceFilePath);
  return {
    originLocalName: input.binding.originLocalName,
    memberName: input.memberName,
    location,
    rawExpressionText: input.node.getText(input.parsedSourceFile),
    traces: input.includeTraces
      ? mergeTraces([
          createCssModuleTrace({
            traceId: `css-module:bound-helper-reference:${location.filePath}:${location.startLine}:${location.startColumn}:${input.memberName}`,
            summary: `CSS Module member "${input.memberName}" was read through bound helper for "${input.binding.originLocalName}"`,
            anchor: location,
            metadata: {
              stylesheetFilePath: input.binding.stylesheetFilePath,
              localName: input.binding.originLocalName,
              memberName: input.memberName,
            },
          }),
        ])
      : [],
  };
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function getStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

export function buildCssModuleMemberMatches(input: {
  references: CssModuleMemberReferenceAnalysis[];
  indexes: ProjectEvidenceBuilderIndexes;
  localsConvention?: CssModuleLocalsConvention;
  includeTraces: boolean;
}): CssModuleMemberMatchRelation[] {
  const matches: CssModuleMemberMatchRelation[] = [];

  for (const reference of input.references) {
    const definitionIds = input.indexes.definitionsByStylesheetId.get(reference.stylesheetId) ?? [];
    const definitionId = definitionIds.find((candidateId) => {
      const definition = input.indexes.classDefinitionsById.get(candidateId);
      return (
        definition &&
        getCssModuleExportNames(definition.className, input.localsConvention).includes(
          reference.memberName,
        )
      );
    });

    if (definitionId) {
      const definition = input.indexes.classDefinitionsById.get(definitionId);
      const originalClassName = definition?.className ?? reference.memberName;
      matches.push({
        id: `css-module-member-match:${reference.id}:${definitionId}`,
        referenceId: reference.id,
        importId: reference.importId,
        stylesheetId: reference.stylesheetId,
        definitionId,
        className: originalClassName,
        exportName: reference.memberName,
        status: "matched",
        reasons: [
          `CSS Module member "${reference.memberName}" matched exported class "${originalClassName}"`,
        ],
        traces: input.includeTraces ? mergeTraces(reference.traces) : [],
      });
      continue;
    }

    matches.push({
      id: `css-module-member-match:${reference.id}:missing`,
      referenceId: reference.id,
      importId: reference.importId,
      stylesheetId: reference.stylesheetId,
      className: reference.memberName,
      exportName: reference.memberName,
      status: "missing",
      reasons: [`CSS Module member "${reference.memberName}" has no exported class`],
      traces: input.includeTraces ? mergeTraces(reference.traces) : [],
    });
  }

  return matches.sort(compareById);
}

export function getCssModuleExportNames(
  className: string,
  localsConvention: CssModuleLocalsConvention | undefined,
): string[] {
  const resolvedLocalsConvention = localsConvention ?? "camelCase";
  const exportNames =
    resolvedLocalsConvention === "asIs"
      ? [className]
      : resolvedLocalsConvention === "camelCaseOnly"
        ? [toCamelCaseClassName(className)]
        : [className, toCamelCaseClassName(className)];

  return uniqueSorted(exportNames);
}

export function toCamelCaseClassName(className: string): string {
  return className.replace(/[-_]+([a-zA-Z0-9])/g, (_match, character: string) =>
    character.toUpperCase(),
  );
}

function resolveCssModuleExpressionReference(input: {
  expressionNode: {
    expressionKind: string;
    objectExpressionId?: string;
    propertyName?: string;
    argumentExpressionId?: string;
  };
  factGraph?: NonNullable<ProjectEvidenceBuildInput["factGraph"]>["graph"];
}):
  | { localName: string; memberName: string; accessKind: "property" | "string-literal-element" }
  | undefined {
  const expressionNode = input.expressionNode;
  const nodesById = input.factGraph?.indexes.nodesById;
  if (!nodesById) {
    return undefined;
  }

  if (expressionNode.expressionKind === "member-access" && expressionNode.propertyName) {
    const objectNodeId = expressionNode.objectExpressionId
      ? input.factGraph?.indexes.expressionSyntaxNodeIdByExpressionId.get(
          expressionNode.objectExpressionId,
        )
      : undefined;
    const objectNode = objectNodeId ? nodesById.get(objectNodeId) : undefined;
    if (
      !objectNode ||
      objectNode.kind !== "expression-syntax" ||
      objectNode.expressionKind !== "identifier"
    ) {
      return undefined;
    }
    return {
      localName: objectNode.name,
      memberName: expressionNode.propertyName,
      accessKind: "property",
    };
  }

  if (expressionNode.expressionKind === "element-access" && expressionNode.argumentExpressionId) {
    const objectNodeId = expressionNode.objectExpressionId
      ? input.factGraph?.indexes.expressionSyntaxNodeIdByExpressionId.get(
          expressionNode.objectExpressionId,
        )
      : undefined;
    const objectNode = objectNodeId ? nodesById.get(objectNodeId) : undefined;
    const argumentNodeId = input.factGraph?.indexes.expressionSyntaxNodeIdByExpressionId.get(
      expressionNode.argumentExpressionId,
    );
    const argumentNode = argumentNodeId ? nodesById.get(argumentNodeId) : undefined;
    if (
      !objectNode ||
      objectNode.kind !== "expression-syntax" ||
      objectNode.expressionKind !== "identifier" ||
      !argumentNode ||
      argumentNode.kind !== "expression-syntax" ||
      argumentNode.expressionKind !== "string-literal"
    ) {
      return undefined;
    }
    return {
      localName: objectNode.name,
      memberName: argumentNode.value,
      accessKind: "string-literal-element",
    };
  }

  return undefined;
}
