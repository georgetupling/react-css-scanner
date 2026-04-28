import ts from "typescript";

import type { ParsedProjectFile } from "../../../entry/stages/types.js";
import { getAllResolvedModuleFacts, type ModuleFacts } from "../../module-facts/index.js";
import { createModuleFactsModuleId } from "../../module-facts/normalize/moduleIds.js";
import type { EngineSymbolId } from "../../../types/core.js";
import { attachSymbolResolutionInternals } from "../internals.js";
import { collectModuleScopeSymbolsForFile } from "../api/shared.js";
import { collectExportedExpressionBindings } from "../collectExportedExpressionBindings.js";
import { collectLocalAliasResolutions } from "../collection/collectLocalAliasResolutions.js";
import { collectSymbolReferences } from "../collection/collectSymbolReferences.js";
import { collectSourceSymbols } from "../collection/collectSourceSymbols.js";
import type {
  EngineSymbol,
  ProjectBindingResolution,
  ResolvedImportedBinding,
  ResolvedNamespaceImport,
  SourceScope,
} from "../types.js";
import {
  resolveImportedBindingFailureForSymbol,
  resolveImportedBindingsForFile,
} from "../value-resolution/resolveImportedBindings.js";
import { resolveNamespaceImportsForFile } from "../value-resolution/resolveNamespaceImports.js";
import {
  collectResolvedExportedTypeBindings,
  resolveImportedTypeBindingsForFile,
} from "../type-resolution/resolveTypeBindings.js";
import { collectResolvedCssModuleBindings } from "../css-module-resolution/resolveCssModuleBindings.js";

export function buildProjectBindingResolution(input: {
  parsedFiles: ParsedProjectFile[];
  moduleFacts: ModuleFacts;
  includeTraces?: boolean;
  knownCssModuleFilePaths?: ReadonlySet<string>;
}): ProjectBindingResolution {
  const includeTraces = input.includeTraces ?? true;
  const resolvedImportedBindingsByFilePath = new Map<string, ResolvedImportedBinding[]>();
  const resolvedImportedComponentBindingsByFilePath = new Map<string, ResolvedImportedBinding[]>();
  const resolvedTypeBindingsByFilePath = new Map<
    string,
    Map<string, import("../types.js").ResolvedTypeBinding>
  >();
  const resolvedNamespaceImportsByFilePath = new Map<string, ResolvedNamespaceImport[]>();
  const {
    resolvedCssModuleImportsByFilePath,
    resolvedCssModuleNamespaceBindingsByFilePath,
    resolvedCssModuleMemberBindingsByFilePath,
    resolvedCssModuleMemberReferencesByFilePath,
    resolvedCssModuleBindingDiagnosticsByFilePath,
  } = collectResolvedCssModuleBindings({
    parsedFiles: input.parsedFiles,
    moduleFacts: input.moduleFacts,
    knownCssModuleFilePaths: input.knownCssModuleFilePaths,
    includeTraces,
  });
  const collectedProjectSymbols = collectProjectSymbols({
    parsedFiles: input.parsedFiles,
    moduleFacts: input.moduleFacts,
  });
  const allSymbolsByFilePath = cloneSymbolsByFilePath(collectedProjectSymbols.allSymbolsByFilePath);
  const scopesByFilePath = cloneScopesByFilePath(collectedProjectSymbols.scopesByFilePath);
  const moduleScopeSymbolsByFilePath = cloneSymbolsByFilePath(
    new Map(
      [...allSymbolsByFilePath.keys()].map((filePath) => [
        filePath,
        collectModuleScopeSymbolsForFile({
          symbolsByFilePath: allSymbolsByFilePath,
          scopesByFilePath,
          filePath,
        }),
      ]),
    ),
  );
  const referencesByFilePath = new Map(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectSymbolReferences({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
        symbols: allSymbolsByFilePath.get(parsedFile.filePath) ?? new Map(),
        scopes: scopesByFilePath.get(parsedFile.filePath) ?? new Map(),
      }),
    ]),
  );
  const localAliasesByFilePath = new Map(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectLocalAliasResolutions({
        filePath: parsedFile.filePath,
        parsedSourceFile: parsedFile.parsedSourceFile,
        symbols: allSymbolsByFilePath.get(parsedFile.filePath) ?? new Map(),
        references: referencesByFilePath.get(parsedFile.filePath) ?? [],
      }),
    ]),
  );
  const symbols = new Map<EngineSymbolId, EngineSymbol>();
  const scopes = new Map(collectedProjectSymbols.scopes);
  const resolvedExportedTypeBindingsByFilePath = collectResolvedExportedTypeBindings({
    moduleFacts: input.moduleFacts,
    symbolsByFilePath: moduleScopeSymbolsByFilePath,
    includeTraces,
  });
  const exportedExpressionBindingsByFilePath = new Map<string, Map<string, ts.Expression>>(
    input.parsedFiles.map((parsedFile) => [
      parsedFile.filePath,
      collectExportedExpressionBindings(parsedFile.parsedSourceFile),
    ]),
  );

  for (const moduleFacts of getAllResolvedModuleFacts({
    moduleFacts: input.moduleFacts,
  })) {
    resolvedImportedBindingsByFilePath.set(
      moduleFacts.filePath,
      resolveImportedBindingsForFile({
        filePath: moduleFacts.filePath,
        moduleFacts: input.moduleFacts,
        symbolsByFilePath: moduleScopeSymbolsByFilePath,
        includeTraces,
      }),
    );
    resolvedImportedComponentBindingsByFilePath.set(
      moduleFacts.filePath,
      (resolvedImportedBindingsByFilePath.get(moduleFacts.filePath) ?? []).filter((binding) =>
        isResolvedComponentBinding(binding, moduleScopeSymbolsByFilePath),
      ),
    );
    resolvedTypeBindingsByFilePath.set(
      moduleFacts.filePath,
      resolveImportedTypeBindingsForFile({
        filePath: moduleFacts.filePath,
        moduleFacts: input.moduleFacts,
        symbolsByFilePath: moduleScopeSymbolsByFilePath,
        resolvedExportedTypeBindingsByFilePath,
        includeTraces,
      }),
    );
    resolvedNamespaceImportsByFilePath.set(
      moduleFacts.filePath,
      resolveNamespaceImportsForFile({
        filePath: moduleFacts.filePath,
        moduleFacts: input.moduleFacts,
        symbolsByFilePath: moduleScopeSymbolsByFilePath,
        includeTraces,
      }),
    );

    const fileSymbols = moduleScopeSymbolsByFilePath.get(moduleFacts.filePath);
    if (!fileSymbols) {
      continue;
    }

    const importedBindingsByLocalName = new Map(
      (resolvedImportedBindingsByFilePath.get(moduleFacts.filePath) ?? []).map((binding) => [
        binding.localName,
        binding,
      ]),
    );
    for (const [symbolId, symbol] of fileSymbols.entries()) {
      if (symbol.resolution.kind !== "imported") {
        symbols.set(symbolId, symbol);
        continue;
      }

      const resolvedBinding = importedBindingsByLocalName.get(symbol.localName);
      if (!resolvedBinding) {
        const unresolvedImportedBinding = resolveImportedBindingFailureForSymbol({
          symbol,
          moduleFacts: input.moduleFacts,
          filePath: moduleFacts.filePath,
          includeTraces,
        });
        if (unresolvedImportedBinding) {
          const enrichedSymbol: EngineSymbol = {
            ...symbol,
            resolution: {
              kind: "unresolved",
              reason: unresolvedImportedBinding.reason,
              traces: unresolvedImportedBinding.traces,
            },
          };
          fileSymbols.set(symbolId, enrichedSymbol);
          allSymbolsByFilePath.get(moduleFacts.filePath)?.set(symbolId, enrichedSymbol);
          symbols.set(symbolId, enrichedSymbol);
          continue;
        }

        symbols.set(symbolId, symbol);
        continue;
      }

      const enrichedSymbol: EngineSymbol = {
        ...symbol,
        resolution: {
          kind: "imported",
          targetModuleId: resolvedBinding.targetModuleId,
          targetSymbolId: resolvedBinding.targetSymbolId,
          traces: resolvedBinding.traces,
        },
      };
      fileSymbols.set(symbolId, enrichedSymbol);
      allSymbolsByFilePath.get(moduleFacts.filePath)?.set(symbolId, enrichedSymbol);
      symbols.set(symbolId, enrichedSymbol);
    }
  }

  for (const fileSymbols of allSymbolsByFilePath.values()) {
    for (const [symbolId, symbol] of fileSymbols.entries()) {
      if (!symbols.has(symbolId)) {
        symbols.set(symbolId, symbol);
      }
    }
  }

  return attachSymbolResolutionInternals({
    symbolResolution: {
      symbols,
      scopes,
    },
    internals: {
      allSymbolsByFilePath,
      scopesByFilePath,
      referencesByFilePath,
      localAliasesByFilePath,
      resolvedImportedBindingsByFilePath,
      resolvedImportedComponentBindingsByFilePath,
      resolvedTypeBindingsByFilePath,
      resolvedExportedTypeBindingsByFilePath,
      resolvedNamespaceImportsByFilePath,
      resolvedCssModuleImportsByFilePath,
      resolvedCssModuleNamespaceBindingsByFilePath,
      resolvedCssModuleMemberBindingsByFilePath,
      resolvedCssModuleMemberReferencesByFilePath,
      resolvedCssModuleBindingDiagnosticsByFilePath,
      exportedExpressionBindingsByFilePath,
      importedExpressionBindingsBySymbolIdByFilePath: new Map(
        [...moduleScopeSymbolsByFilePath.keys()].map((filePath) => [
          filePath,
          collectImportedExpressionBindingsBySymbolId({
            filePath,
            symbolsByFilePath: moduleScopeSymbolsByFilePath,
            resolvedImportedBindingsByFilePath,
            exportedExpressionBindingsByFilePath,
          }),
        ]),
      ),
    },
  });
}

function collectProjectSymbols(input: {
  parsedFiles: ParsedProjectFile[];
  moduleFacts: ModuleFacts;
}): {
  allSymbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  scopesByFilePath: Map<string, Map<string, SourceScope>>;
  scopes: Map<string, SourceScope>;
} {
  const allSymbolsByFilePath = new Map<string, Map<EngineSymbolId, EngineSymbol>>();
  const scopesByFilePath = new Map<string, Map<string, SourceScope>>();
  const scopes = new Map<string, SourceScope>();

  for (const parsedFile of input.parsedFiles) {
    const collected = collectSourceSymbols({
      filePath: parsedFile.filePath,
      parsedSourceFile: parsedFile.parsedSourceFile,
      moduleId: createModuleFactsModuleId(parsedFile.filePath),
      moduleFacts: input.moduleFacts,
    });
    allSymbolsByFilePath.set(parsedFile.filePath, collected.symbols);
    scopesByFilePath.set(parsedFile.filePath, collected.scopes);
    for (const [scopeId, scope] of collected.scopes.entries()) {
      scopes.set(scopeId, scope);
    }
  }

  return {
    allSymbolsByFilePath,
    scopesByFilePath,
    scopes,
  };
}

function cloneSymbolsByFilePath(
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>,
): Map<string, Map<EngineSymbolId, EngineSymbol>> {
  return new Map(
    [...symbolsByFilePath.entries()].map(([filePath, fileSymbols]) => [
      filePath,
      new Map(
        [...fileSymbols.entries()].map(([symbolId, symbol]) => [
          symbolId,
          { ...symbol, resolution: { ...symbol.resolution } },
        ]),
      ),
    ]),
  );
}

function cloneScopesByFilePath(
  scopesByFilePath: Map<string, Map<string, SourceScope>>,
): Map<string, Map<string, SourceScope>> {
  return new Map(
    [...scopesByFilePath.entries()].map(([filePath, fileScopes]) => [
      filePath,
      new Map(
        [...fileScopes.entries()].map(([scopeId, scope]) => [
          scopeId,
          {
            ...scope,
            declaredSymbolIds: [...scope.declaredSymbolIds],
            childScopeIds: [...scope.childScopeIds],
          },
        ]),
      ),
    ]),
  );
}

function isResolvedComponentBinding(
  binding: ResolvedImportedBinding,
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>,
): boolean {
  if (!binding.targetSymbolId) {
    return false;
  }

  return (
    symbolsByFilePath.get(binding.targetFilePath)?.get(binding.targetSymbolId)?.kind === "component"
  );
}

function collectImportedExpressionBindingsBySymbolId(input: {
  filePath: string;
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  resolvedImportedBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  exportedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
}): Map<EngineSymbolId, ts.Expression> {
  const bindings = new Map<EngineSymbolId, ts.Expression>();
  const localSymbolsByName = new Map(
    [...(input.symbolsByFilePath.get(input.filePath)?.values() ?? [])]
      .filter((symbol) => symbol.symbolSpace === "value")
      .map((symbol) => [symbol.localName, symbol]),
  );

  for (const resolvedBinding of input.resolvedImportedBindingsByFilePath.get(input.filePath) ??
    []) {
    const importedSymbol = localSymbolsByName.get(resolvedBinding.localName);
    const exportedExpression = input.exportedExpressionBindingsByFilePath
      .get(resolvedBinding.targetFilePath)
      ?.get(resolvedBinding.targetExportName);
    if (!importedSymbol || !exportedExpression) {
      continue;
    }

    bindings.set(importedSymbol.id, exportedExpression);
  }

  return bindings;
}
