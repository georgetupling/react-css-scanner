import type {
  CssModuleLocalsConvention,
  CssModuleAliasAnalysis,
  CssModuleDestructuredBindingAnalysis,
  CssModuleImportAnalysis,
  CssModuleMemberMatchRelation,
  CssModuleMemberReferenceAnalysis,
  CssModuleReferenceDiagnosticAnalysis,
  ProjectAnalysisBuildInput,
  ProjectAnalysisIndexes,
} from "../../project-analysis/index.js";
import {
  getCssModuleBindingsForFile,
  getSymbolResolutionFilePaths,
} from "../../symbol-resolution/index.js";
import {
  compareById,
  createCssModuleAliasId,
  createCssModuleDestructuredBindingId,
  createCssModuleDiagnosticId,
  createCssModuleImportId,
  createCssModuleImportLookupKey,
  createCssModuleMemberReferenceId,
  mergeTraces,
  normalizeAnchor,
  normalizeProjectPath,
  uniqueSorted,
} from "../internal/shared.js";

export function buildCssModuleImports(
  input: ProjectAnalysisBuildInput,
  indexes: ProjectAnalysisIndexes,
): CssModuleImportAnalysis[] {
  return getSymbolResolutionFilePaths({
    symbolResolution: input.symbolResolution,
  })
    .flatMap(
      (filePath) =>
        getCssModuleBindingsForFile({
          symbolResolution: input.symbolResolution,
          filePath,
        }).imports,
    )
    .map((cssModuleImport) => {
      const sourceFilePath = normalizeProjectPath(cssModuleImport.sourceFilePath);
      const stylesheetFilePath = normalizeProjectPath(cssModuleImport.stylesheetFilePath);
      const sourceFileId = indexes.sourceFileIdByPath.get(sourceFilePath);
      const stylesheetId = indexes.stylesheetIdByPath.get(stylesheetFilePath);

      if (!sourceFileId || !stylesheetId) {
        return undefined;
      }

      return {
        id: createCssModuleImportId({
          sourceFilePath,
          stylesheetFilePath,
          localName: cssModuleImport.localName,
        }),
        sourceFileId,
        stylesheetId,
        sourceFilePath,
        stylesheetFilePath,
        specifier: cssModuleImport.specifier,
        localName: cssModuleImport.localName,
        importKind: cssModuleImport.importKind,
      };
    })
    .filter((cssModuleImport): cssModuleImport is CssModuleImportAnalysis =>
      Boolean(cssModuleImport),
    )
    .sort(compareById);
}

export function buildCssModuleMemberReferences(input: {
  projectInput: ProjectAnalysisBuildInput;
  imports: CssModuleImportAnalysis[];
  indexes: ProjectAnalysisIndexes;
  includeTraces: boolean;
}): {
  aliases: CssModuleAliasAnalysis[];
  destructuredBindings: CssModuleDestructuredBindingAnalysis[];
  memberReferences: CssModuleMemberReferenceAnalysis[];
  diagnostics: CssModuleReferenceDiagnosticAnalysis[];
} {
  const importsBySourceStylesheetAndLocalName = new Map<string, CssModuleImportAnalysis>();
  for (const cssModuleImport of input.imports) {
    importsBySourceStylesheetAndLocalName.set(
      createCssModuleImportLookupKey({
        sourceFilePath: cssModuleImport.sourceFilePath,
        stylesheetFilePath: cssModuleImport.stylesheetFilePath,
        localName: cssModuleImport.localName,
      }),
      cssModuleImport,
    );
  }

  const cssModuleBindingsByFilePath = new Map(
    getSymbolResolutionFilePaths({
      symbolResolution: input.projectInput.symbolResolution,
    }).map((filePath) => [
      filePath,
      getCssModuleBindingsForFile({
        symbolResolution: input.projectInput.symbolResolution,
        filePath,
      }),
    ]),
  );

  return {
    aliases: [...cssModuleBindingsByFilePath.values()]
      .flatMap((bindings) => bindings.namespaceBindings)
      .filter((binding) => binding.sourceKind === "alias")
      .map((alias) => {
        const cssModuleImport = importsBySourceStylesheetAndLocalName.get(
          createCssModuleImportLookupKey({
            sourceFilePath: alias.sourceFilePath,
            stylesheetFilePath: alias.stylesheetFilePath,
            localName: alias.originLocalName,
          }),
        );
        if (!cssModuleImport) {
          return undefined;
        }

        return {
          id: createCssModuleAliasId(alias.location, cssModuleImport.id, alias.localName),
          importId: cssModuleImport.id,
          sourceFileId: cssModuleImport.sourceFileId,
          stylesheetId: cssModuleImport.stylesheetId,
          localName: alias.originLocalName,
          aliasName: alias.localName,
          location: normalizeAnchor(alias.location),
          rawExpressionText: alias.rawExpressionText,
          traces: input.includeTraces ? [...alias.traces] : [],
        };
      })
      .filter((alias): alias is CssModuleAliasAnalysis => Boolean(alias))
      .sort(compareById),
    destructuredBindings: [...cssModuleBindingsByFilePath.values()]
      .flatMap((bindings) => bindings.memberBindings)
      .map((binding) => {
        const cssModuleImport = importsBySourceStylesheetAndLocalName.get(
          createCssModuleImportLookupKey({
            sourceFilePath: binding.sourceFilePath,
            stylesheetFilePath: binding.stylesheetFilePath,
            localName: binding.originLocalName,
          }),
        );
        if (!cssModuleImport) {
          return undefined;
        }

        return {
          id: createCssModuleDestructuredBindingId(
            binding.location,
            cssModuleImport.id,
            binding.memberName,
            binding.localName,
          ),
          importId: cssModuleImport.id,
          sourceFileId: cssModuleImport.sourceFileId,
          stylesheetId: cssModuleImport.stylesheetId,
          localName: binding.originLocalName,
          memberName: binding.memberName,
          bindingName: binding.localName,
          location: normalizeAnchor(binding.location),
          rawExpressionText: binding.rawExpressionText,
          traces: input.includeTraces ? [...binding.traces] : [],
        };
      })
      .filter((binding): binding is CssModuleDestructuredBindingAnalysis => Boolean(binding))
      .sort(compareById),
    memberReferences: [...cssModuleBindingsByFilePath.values()]
      .flatMap((bindings) => bindings.memberReferences)
      .map((reference) => {
        const cssModuleImport = importsBySourceStylesheetAndLocalName.get(
          createCssModuleImportLookupKey({
            sourceFilePath: reference.sourceFilePath,
            stylesheetFilePath: reference.stylesheetFilePath,
            localName: reference.originLocalName,
          }),
        );
        if (!cssModuleImport) {
          return undefined;
        }

        return {
          id: createCssModuleMemberReferenceId(
            reference.location,
            cssModuleImport.id,
            reference.memberName,
          ),
          importId: cssModuleImport.id,
          sourceFileId: cssModuleImport.sourceFileId,
          stylesheetId: cssModuleImport.stylesheetId,
          localName: reference.originLocalName,
          memberName: reference.memberName,
          accessKind: reference.accessKind,
          location: normalizeAnchor(reference.location),
          rawExpressionText: reference.rawExpressionText,
          traces: input.includeTraces ? [...reference.traces] : [],
        };
      })
      .filter((reference): reference is CssModuleMemberReferenceAnalysis => Boolean(reference))
      .sort(compareById),
    diagnostics: [...cssModuleBindingsByFilePath.values()]
      .flatMap((bindings) => bindings.diagnostics)
      .map((diagnostic) => {
        const cssModuleImport = importsBySourceStylesheetAndLocalName.get(
          createCssModuleImportLookupKey({
            sourceFilePath: diagnostic.sourceFilePath,
            stylesheetFilePath: diagnostic.stylesheetFilePath,
            localName: diagnostic.originLocalName,
          }),
        );
        if (!cssModuleImport) {
          return undefined;
        }

        return {
          id: createCssModuleDiagnosticId(diagnostic.location, cssModuleImport.id),
          importId: cssModuleImport.id,
          sourceFileId: cssModuleImport.sourceFileId,
          stylesheetId: cssModuleImport.stylesheetId,
          localName: diagnostic.originLocalName,
          reason: diagnostic.reason,
          location: normalizeAnchor(diagnostic.location),
          rawExpressionText: diagnostic.rawExpressionText,
          traces: input.includeTraces ? [...diagnostic.traces] : [],
        };
      })
      .filter((diagnostic): diagnostic is CssModuleReferenceDiagnosticAnalysis =>
        Boolean(diagnostic),
      )
      .sort(compareById),
  };
}

export function buildCssModuleMemberMatches(input: {
  references: CssModuleMemberReferenceAnalysis[];
  indexes: ProjectAnalysisIndexes;
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
