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
import { isCssModulePath } from "../../../libraries/stylesheets/cssModulePaths.js";
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
      if (importSyntax.importKind !== "css" || !isCssModuleSpecifier(importSyntax.specifier)) {
        continue;
      }
      const stylesheetFilePath = findResolvedStylesheetImportPath({
        sourceFilePath: sourceFile.filePath,
        specifier: importSyntax.specifier,
        input,
      });
      if (!stylesheetFilePath) {
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

function isCssModuleSpecifier(specifier: string): boolean {
  return isCssModulePath(specifier);
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
