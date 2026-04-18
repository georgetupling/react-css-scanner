import ts from "typescript";
import type { EngineModuleId, EngineSymbolId, SourceAnchor } from "../../types/core.js";
import type { EngineSymbol, SymbolKind } from "./types.js";

export function collectTopLevelSymbols(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  moduleId: EngineModuleId;
}): Map<EngineSymbolId, EngineSymbol> {
  const symbols = new Map<EngineSymbolId, EngineSymbol>();

  for (const statement of input.parsedSourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      collectImportSymbols(statement, input, symbols);
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const symbol = createSymbol({
        moduleId: input.moduleId,
        localName: statement.name.text,
        kind: /^[A-Z]/.test(statement.name.text) ? "component" : "function",
        declaration: toSourceAnchor(statement.name, input.parsedSourceFile, input.filePath),
        exportedNames: isExported(statement) ? [statement.name.text] : [],
        resolution: { kind: "local" },
      });
      symbols.set(symbol.id, symbol);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      const exported = isExported(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }

        const localName = declaration.name.text;
        const kind = classifyVariableKind(localName, statement.declarationList.flags);
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

  return symbols;
}

function collectImportSymbols(
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

export function createSymbolId(moduleId: EngineModuleId, localName: string): EngineSymbolId {
  return `symbol:${moduleId}:${localName}`;
}

function classifyVariableKind(localName: string, declarationFlags: ts.NodeFlags): SymbolKind {
  const isConst = (declarationFlags & ts.NodeFlags.Const) !== 0;
  if (/^[A-Z]/.test(localName)) {
    return "component";
  }

  return isConst ? "constant" : "variable";
}

function isExported(
  statement: ts.Statement & { modifiers?: ts.NodeArray<ts.ModifierLike> },
): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
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
