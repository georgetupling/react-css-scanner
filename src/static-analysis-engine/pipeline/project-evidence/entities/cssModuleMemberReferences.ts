import ts from "typescript";

import { buildCssModuleAliases } from "../../language-frontends/source/css-module-syntax/analyzeCssModuleAliases.js";
import { getCssModuleDestructuring } from "../../language-frontends/source/css-module-syntax/analyzeCssModuleDestructuring.js";
import { getCssModuleMemberAccess } from "../../language-frontends/source/css-module-syntax/analyzeCssModuleMemberAccess.js";
import type { ResolvedCssModuleNamespaceBinding } from "../../language-frontends/source/css-module-syntax/types.js";
import type {
  CssModuleAliasAnalysis,
  CssModuleDestructuredBindingAnalysis,
  CssModuleImportAnalysis,
  CssModuleMemberReferenceAnalysis,
  CssModuleReferenceDiagnosticAnalysis,
  ProjectEvidenceBuildInput,
  ProjectEvidenceBuilderIndexes,
} from "../analysisTypes.js";
import {
  compareById,
  createCssModuleAliasId,
  createCssModuleDestructuredBindingId,
  createCssModuleDiagnosticId,
  createCssModuleImportLookupKey,
  createCssModuleMemberReferenceId,
  mergeTraces,
  normalizeProjectPath,
} from "../internal/shared.js";
import {
  buildBoundCssModuleHelpers,
  collectBoundCssModuleHelperReferences,
  collectClassNamesBindLocalNames,
} from "./cssModuleBoundHelpers.js";
import { resolveCssModuleExpressionReferences } from "./cssModuleExpressionReferences.js";

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
    const directNamespaceBindingsByLocalName = new Map<string, ResolvedCssModuleNamespaceBinding>();

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
    const expressionNode = input.projectInput.factGraph?.graph.indexes.nodesById.get(
      classSite.expressionNodeId,
    );
    if (!expressionNode || expressionNode.kind !== "expression-syntax") {
      continue;
    }

    const resolvedReferences = resolveCssModuleExpressionReferences({
      expressionNode,
      factGraph: input.projectInput.factGraph?.graph,
    });
    if (resolvedReferences.length === 0) {
      continue;
    }

    for (const resolved of resolvedReferences) {
      const importsForBinding =
        importBySourceLocalName.get(
          `${normalizeProjectPath(classSite.filePath)}:${resolved.localName}`,
        ) ?? [];
      for (const cssImport of importsForBinding) {
        memberReferences.push({
          id: createCssModuleMemberReferenceId(
            classSite.location,
            cssImport.id,
            resolved.memberName,
          ),
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
