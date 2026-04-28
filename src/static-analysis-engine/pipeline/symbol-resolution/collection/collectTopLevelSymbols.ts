import ts from "typescript";

import { collectComponentLikeDefinitions } from "../../../libraries/react-components/index.js";
import {
  getExportedNamesByLocalName,
  getResolvedModuleFacts,
  getTopLevelBindingFacts,
} from "../../module-facts/index.js";
import type { ModuleFacts, ResolvedTopLevelBindingFact } from "../../module-facts/types.js";
import type { EngineModuleId, EngineSymbolId, SourceAnchor } from "../../../types/core.js";
import type { EngineSymbol, SymbolKind } from "../types.js";
import {
  collectSourceDeclarationIndex,
  type SourceDeclarationIndex,
  type SourceValueDeclaration,
} from "./collectSourceDeclarations.js";

export function collectTopLevelSymbols(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  moduleId: EngineModuleId;
  moduleFacts?: ModuleFacts;
}): Map<EngineSymbolId, EngineSymbol> {
  const symbols = new Map<EngineSymbolId, EngineSymbol>();
  const declarationIndex = collectSourceDeclarationIndex(input.parsedSourceFile);
  const componentLikeNames = new Set(
    collectComponentLikeDefinitions({
      filePath: input.filePath,
      parsedSourceFile: input.parsedSourceFile,
    }).map((definition) => definition.componentName),
  );
  const resolvedModuleFacts = input.moduleFacts
    ? getResolvedModuleFacts({
        moduleFacts: input.moduleFacts,
        filePath: input.filePath,
      })
    : undefined;

  if (!resolvedModuleFacts) {
    collectLegacyTopLevelSymbols(input, symbols);
    return symbols;
  }

  const exportedNamesByLocalName = input.moduleFacts
    ? getExportedNamesByLocalName({
        moduleFacts: input.moduleFacts,
        filePath: input.filePath,
      })
    : new Map<string, string[]>();

  for (const binding of getTopLevelBindingFacts({
    moduleFacts: input.moduleFacts!,
    filePath: input.filePath,
  })) {
    const symbolKind = toSymbolKind(
      binding.bindingKind,
      declarationIndex,
      binding.localName,
      componentLikeNames,
    );
    const declaration = toDeclarationAnchor({
      localName: binding.localName,
      bindingKind: binding.bindingKind,
      declarationIndex,
      parsedSourceFile: input.parsedSourceFile,
      filePath: input.filePath,
    });
    if (!declaration) {
      continue;
    }

    const symbol = createSymbol({
      moduleId: input.moduleId,
      localName: binding.localName,
      kind: symbolKind,
      declaration,
      exportedNames: exportedNamesByLocalName.get(binding.localName) ?? [],
      resolution:
        binding.bindingKind === "import-default" ||
        binding.bindingKind === "import-named" ||
        binding.bindingKind === "import-namespace"
          ? { kind: "imported" as const }
          : { kind: "local" as const },
    });
    symbols.set(symbol.id, symbol);
  }

  for (const [localName, declaration] of declarationIndex.typeAliases.entries()) {
    const symbol = createSymbol({
      moduleId: input.moduleId,
      localName,
      kind: "type-alias",
      declaration: toSourceAnchor(declaration.name, input.parsedSourceFile, input.filePath),
      exportedNames: exportedNamesByLocalName.get(localName) ?? [],
      resolution: { kind: "local" },
    });
    symbols.set(symbol.id, symbol);
  }

  for (const [localName, declaration] of declarationIndex.interfaces.entries()) {
    const symbol = createSymbol({
      moduleId: input.moduleId,
      localName,
      kind: "interface",
      declaration: toSourceAnchor(declaration.name, input.parsedSourceFile, input.filePath),
      exportedNames: exportedNamesByLocalName.get(localName) ?? [],
      resolution: { kind: "local" },
    });
    symbols.set(symbol.id, symbol);
  }

  return symbols;
}

export function createSymbolId(moduleId: EngineModuleId, localName: string): EngineSymbolId {
  return `symbol:${moduleId}:${localName}`;
}

function toDeclarationAnchor(input: {
  localName: string;
  bindingKind: ResolvedTopLevelBindingFact["bindingKind"];
  declarationIndex: SourceDeclarationIndex;
  parsedSourceFile: ts.SourceFile;
  filePath: string;
}): SourceAnchor | undefined {
  if (
    input.bindingKind === "import-default" ||
    input.bindingKind === "import-named" ||
    input.bindingKind === "import-namespace"
  ) {
    return findImportAnchor(input.parsedSourceFile, input.filePath, input.localName);
  }

  const declaration = input.declarationIndex.valueDeclarations.get(input.localName);
  if (!declaration) {
    return undefined;
  }

  return toValueDeclarationAnchor(declaration, input.parsedSourceFile, input.filePath);
}

function toValueDeclarationAnchor(
  declaration: SourceValueDeclaration,
  parsedSourceFile: ts.SourceFile,
  filePath: string,
): SourceAnchor {
  switch (declaration.kind) {
    case "function":
    case "class":
    case "enum":
    case "const-enum":
      return declaration.node.name
        ? toSourceAnchor(declaration.node.name, parsedSourceFile, filePath)
        : toSourceAnchor(declaration.node, parsedSourceFile, filePath);
    case "namespace":
      return ts.isIdentifier(declaration.node.name)
        ? toSourceAnchor(declaration.node.name, parsedSourceFile, filePath)
        : toSourceAnchor(declaration.node, parsedSourceFile, filePath);
    case "const":
    case "let":
    case "var":
      return toSourceAnchor(declaration.node.name, parsedSourceFile, filePath);
  }
}

function findImportAnchor(
  sourceFile: ts.SourceFile,
  filePath: string,
  localName: string,
): SourceAnchor | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) {
      continue;
    }

    const importClause = statement.importClause;
    if (importClause.name?.text === localName) {
      return toSourceAnchor(importClause.name, sourceFile, filePath);
    }

    if (!importClause.namedBindings) {
      continue;
    }

    if (ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        if (element.name.text === localName) {
          return toSourceAnchor(element.name, sourceFile, filePath);
        }
      }
      continue;
    }

    if (importClause.namedBindings.name.text === localName) {
      return toSourceAnchor(importClause.namedBindings.name, sourceFile, filePath);
    }
  }

  return undefined;
}

function toSymbolKind(
  bindingKind: ResolvedTopLevelBindingFact["bindingKind"],
  declarationIndex: SourceDeclarationIndex,
  localName: string,
  componentLikeNames: ReadonlySet<string>,
): SymbolKind {
  switch (bindingKind) {
    case "import-default":
    case "import-named":
    case "import-namespace":
      return "imported-binding";
    case "function":
      return componentLikeNames.has(localName) ? "component" : "function";
    case "class":
      return componentLikeNames.has(localName) ? "component" : "class";
    case "enum":
      return "enum";
    case "namespace":
      return "namespace";
    case "variable":
      return classifyVariableKind(
        declarationIndex.valueDeclarations.get(localName),
        localName,
        componentLikeNames,
      );
  }
}

function classifyVariableKind(
  declaration: SourceValueDeclaration | undefined,
  localName: string,
  componentLikeNames: ReadonlySet<string>,
): SymbolKind {
  const isConst = declaration?.kind === "const";
  if (componentLikeNames.has(localName)) {
    return "component";
  }

  return isConst ? "constant" : "variable";
}

function collectLegacyTopLevelSymbols(
  input: {
    filePath: string;
    parsedSourceFile: ts.SourceFile;
    moduleId: EngineModuleId;
  },
  symbols: Map<EngineSymbolId, EngineSymbol>,
): void {
  for (const statement of input.parsedSourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      collectLegacyImportSymbols(statement, input, symbols);
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const symbol = createSymbol({
        moduleId: input.moduleId,
        localName: statement.name.text,
        kind: /^[A-Z]/.test(statement.name.text) ? "component" : "function",
        declaration: toSourceAnchor(statement.name, input.parsedSourceFile, input.filePath),
        exportedNames: hasExportModifier(statement) ? [statement.name.text] : [],
        resolution: { kind: "local" },
      });
      symbols.set(symbol.id, symbol);
      continue;
    }

    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    const exported = hasExportModifier(statement);
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue;
      }

      const localName = declaration.name.text;
      const kind = /^[A-Z]/.test(localName)
        ? "component"
        : (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
          ? "constant"
          : "variable";
      const symbol = createSymbol({
        moduleId: input.moduleId,
        localName,
        kind,
        declaration: toSourceAnchor(declaration.name, input.parsedSourceFile, input.filePath),
        exportedNames: exported ? [localName] : [],
        resolution: { kind: "local" },
      });
      symbols.set(symbol.id, symbol);
    }
  }
}

function collectLegacyImportSymbols(
  statement: ts.ImportDeclaration,
  input: {
    filePath: string;
    parsedSourceFile: ts.SourceFile;
    moduleId: EngineModuleId;
  },
  symbols: Map<EngineSymbolId, EngineSymbol>,
) {
  const importClause = statement.importClause;
  if (!importClause) {
    return;
  }

  if (importClause.name) {
    const symbol = createSymbol({
      moduleId: input.moduleId,
      localName: importClause.name.text,
      kind: "imported-binding",
      declaration: toSourceAnchor(importClause.name, input.parsedSourceFile, input.filePath),
      exportedNames: [],
      resolution: { kind: "imported" },
    });
    symbols.set(symbol.id, symbol);
  }

  if (!importClause.namedBindings) {
    return;
  }

  if (ts.isNamedImports(importClause.namedBindings)) {
    for (const element of importClause.namedBindings.elements) {
      const symbol = createSymbol({
        moduleId: input.moduleId,
        localName: element.name.text,
        kind: "imported-binding",
        declaration: toSourceAnchor(element.name, input.parsedSourceFile, input.filePath),
        exportedNames: [],
        resolution: { kind: "imported" },
      });
      symbols.set(symbol.id, symbol);
    }
    return;
  }

  const symbol = createSymbol({
    moduleId: input.moduleId,
    localName: importClause.namedBindings.name.text,
    kind: "imported-binding",
    declaration: toSourceAnchor(
      importClause.namedBindings.name,
      input.parsedSourceFile,
      input.filePath,
    ),
    exportedNames: [],
    resolution: { kind: "imported" },
  });
  symbols.set(symbol.id, symbol);
}

function createSymbol(input: Omit<EngineSymbol, "id">): EngineSymbol {
  return {
    ...input,
    id: createSymbolId(input.moduleId, input.localName),
  };
}

function hasExportModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}

function toSourceAnchor(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): SourceAnchor {
  const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
  const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

  return {
    filePath,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}
