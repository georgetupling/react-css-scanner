import ts from "typescript";

import { collectSourceDeclarationIndex } from "../../language-frontends/source/symbol-syntax/collectSourceDeclarations.js";
import { getSymbolResolutionInternals } from "../internals.js";
import type { ProjectBindingResolution, ResolvedTypeBinding } from "../types.js";
import { findTypeSymbolByLocalName } from "./shared.js";

export type ResolvedTypeDeclaration =
  | {
      kind: "type-alias";
      declaration: ts.TypeAliasDeclaration;
      binding: ResolvedTypeBinding;
    }
  | {
      kind: "interface";
      declaration: ts.InterfaceDeclaration;
      binding: ResolvedTypeBinding;
    };

export function resolveTypeBinding(input: {
  symbolResolution: ProjectBindingResolution;
  filePath: string;
  localName: string;
}): ResolvedTypeBinding | undefined {
  const internals = getSymbolResolutionInternals(input.symbolResolution);
  const resolvedImportedTypeBinding = internals.resolvedTypeBindingsByFilePath
    .get(input.filePath)
    ?.get(input.localName);
  if (resolvedImportedTypeBinding) {
    return resolvedImportedTypeBinding;
  }

  const localTypeSymbol = findTypeSymbolByLocalName({
    symbolsByFilePath: internals.allSymbolsByFilePath,
    scopesByFilePath: internals.scopesByFilePath,
    requireModuleScope: true,
    filePath: input.filePath,
    localName: input.localName,
  });
  if (!localTypeSymbol) {
    return undefined;
  }

  return {
    localName: input.localName,
    targetModuleId: localTypeSymbol.moduleId,
    targetFilePath: input.filePath,
    targetTypeName: localTypeSymbol.localName,
    targetSymbolId: localTypeSymbol.id,
    traces: [],
  };
}

export function resolveExportedTypeBinding(input: {
  symbolResolution: ProjectBindingResolution;
  filePath: string;
  exportedName: string;
}): ResolvedTypeBinding | undefined {
  return getSymbolResolutionInternals(input.symbolResolution)
    .resolvedExportedTypeBindingsByFilePath.get(input.filePath)
    ?.get(input.exportedName);
}

export function resolveTypeDeclaration(input: {
  symbolResolution: ProjectBindingResolution;
  sourceFilesByFilePath: Map<string, ts.SourceFile>;
  filePath: string;
  localName: string;
}): ResolvedTypeDeclaration | undefined {
  const resolvedBinding = resolveTypeBinding({
    symbolResolution: input.symbolResolution,
    filePath: input.filePath,
    localName: input.localName,
  });
  if (!resolvedBinding) {
    return undefined;
  }

  return resolveBoundTypeDeclaration({
    sourceFilesByFilePath: input.sourceFilesByFilePath,
    binding: resolvedBinding,
  });
}

export function resolveExportedTypeDeclaration(input: {
  symbolResolution: ProjectBindingResolution;
  sourceFilesByFilePath: Map<string, ts.SourceFile>;
  filePath: string;
  exportedName: string;
}): ResolvedTypeDeclaration | undefined {
  const resolvedBinding = resolveExportedTypeBinding({
    symbolResolution: input.symbolResolution,
    filePath: input.filePath,
    exportedName: input.exportedName,
  });
  if (!resolvedBinding) {
    return undefined;
  }

  return resolveBoundTypeDeclaration({
    sourceFilesByFilePath: input.sourceFilesByFilePath,
    binding: resolvedBinding,
  });
}

function resolveBoundTypeDeclaration(input: {
  sourceFilesByFilePath: Map<string, ts.SourceFile>;
  binding: ResolvedTypeBinding;
}): ResolvedTypeDeclaration | undefined {
  const sourceFile = input.sourceFilesByFilePath.get(input.binding.targetFilePath);
  if (!sourceFile) {
    return undefined;
  }

  const declarationIndex = collectSourceDeclarationIndex(sourceFile);
  const typeAliasDeclaration = declarationIndex.typeAliases.get(input.binding.targetTypeName);
  if (typeAliasDeclaration) {
    return {
      kind: "type-alias",
      declaration: typeAliasDeclaration,
      binding: input.binding,
    };
  }

  const interfaceDeclaration = declarationIndex.interfaces.get(input.binding.targetTypeName);
  if (interfaceDeclaration) {
    return {
      kind: "interface",
      declaration: interfaceDeclaration,
      binding: input.binding,
    };
  }

  return undefined;
}
