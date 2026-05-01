import ts from "typescript";

import type { EngineModuleId, EngineSymbolId } from "../../../../types/core.js";
import type { EngineSymbol, ScopeId, ScopeKind, SourceScope, SymbolKind } from "./types.js";
import { collectSourceDeclarationIndex } from "./collectSourceDeclarations.js";
import {
  createScopeId,
  createSymbolId,
  hasExportModifier,
  toSourceAnchor,
  toSourceFileAnchor,
} from "./shared.js";

type CollectedSourceSymbols = {
  symbols: Map<EngineSymbolId, EngineSymbol>;
  scopes: Map<ScopeId, SourceScope>;
  moduleScopeId: ScopeId;
};

type FunctionLikeWithBody =
  | (ts.FunctionDeclaration & { body: ts.FunctionBody })
  | ts.FunctionExpression
  | ts.ArrowFunction
  | (ts.MethodDeclaration & { body: ts.Block })
  | (ts.GetAccessorDeclaration & { body: ts.Block })
  | (ts.SetAccessorDeclaration & { body: ts.Block })
  | (ts.ConstructorDeclaration & { body: ts.Block });

export function collectSourceSymbols(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  moduleId: EngineModuleId;
}): CollectedSourceSymbols {
  const moduleScopeSymbols = collectModuleScopeSymbols(input);
  const symbols = new Map(moduleScopeSymbols);
  const scopes = new Map<ScopeId, SourceScope>();
  const moduleScopeRange = toSourceFileAnchor(input.parsedSourceFile, input.filePath);
  const moduleScopeId = createScopeId(input.moduleId, "module", moduleScopeRange);
  scopes.set(moduleScopeId, {
    id: moduleScopeId,
    filePath: input.filePath,
    kind: "module",
    range: moduleScopeRange,
    declaredSymbolIds: [...moduleScopeSymbols.keys()],
    childScopeIds: [],
  });

  for (const statement of input.parsedSourceFile.statements) {
    visitNode({
      node: statement,
      lexicalScopeId: moduleScopeId,
      functionScopeId: undefined,
      input,
      symbols,
      scopes,
      moduleScopeId,
      isTopLevelStatement: true,
    });
  }

  return {
    symbols,
    scopes,
    moduleScopeId,
  };
}

function collectModuleScopeSymbols(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  moduleId: EngineModuleId;
}): Map<EngineSymbolId, EngineSymbol> {
  const symbols = new Map<EngineSymbolId, EngineSymbol>();
  const moduleScopeId = createScopeId(
    input.moduleId,
    "module",
    toSourceFileAnchor(input.parsedSourceFile, input.filePath),
  );
  const declarationIndex = collectSourceDeclarationIndex(input.parsedSourceFile);
  const exportedNamesByLocalName = new Map<string, string[]>();
  collectLegacyModuleScopeSymbols(input, symbols, moduleScopeId);

  for (const [localName, declaration] of declarationIndex.typeAliases.entries()) {
    const symbol = createModuleScopeSymbol({
      moduleId: input.moduleId,
      localName,
      kind: "type-alias",
      symbolSpace: "type",
      scopeId: moduleScopeId,
      declaration: toSourceAnchor(declaration.name, input.parsedSourceFile, input.filePath),
      exportedNames: exportedNamesByLocalName.get(localName) ?? [],
      resolution: { kind: "local" },
    });
    symbols.set(symbol.id, symbol);
  }

  for (const [localName, declaration] of declarationIndex.interfaces.entries()) {
    const symbol = createModuleScopeSymbol({
      moduleId: input.moduleId,
      localName,
      kind: "interface",
      symbolSpace: "type",
      scopeId: moduleScopeId,
      declaration: toSourceAnchor(declaration.name, input.parsedSourceFile, input.filePath),
      exportedNames: exportedNamesByLocalName.get(localName) ?? [],
      resolution: { kind: "local" },
    });
    symbols.set(symbol.id, symbol);
  }

  return symbols;
}

function visitNode(input: {
  node: ts.Node;
  lexicalScopeId: ScopeId;
  functionScopeId?: ScopeId;
  input: {
    filePath: string;
    parsedSourceFile: ts.SourceFile;
    moduleId: EngineModuleId;
  };
  symbols: Map<EngineSymbolId, EngineSymbol>;
  scopes: Map<ScopeId, SourceScope>;
  moduleScopeId: ScopeId;
  isTopLevelStatement?: boolean;
}): void {
  if (isFunctionLikeWithBody(input.node)) {
    visitFunctionLike({
      ...input,
      node: input.node,
    });
    return;
  }

  if (ts.isBlock(input.node)) {
    if (ts.isFunctionLike(input.node.parent)) {
      for (const statement of input.node.statements) {
        visitNode({
          ...input,
          node: statement,
          isTopLevelStatement: false,
        });
      }
      return;
    }

    const blockScopeId = createChildScope({
      kind: "block",
      node: input.node,
      parentScopeId: input.lexicalScopeId,
      context: input,
    });
    for (const statement of input.node.statements) {
      visitNode({
        ...input,
        node: statement,
        lexicalScopeId: blockScopeId,
        functionScopeId: input.functionScopeId,
        isTopLevelStatement: false,
      });
    }
    return;
  }

  if (ts.isCatchClause(input.node)) {
    const catchScopeId = createChildScope({
      kind: "catch",
      node: input.node,
      parentScopeId: input.lexicalScopeId,
      context: input,
    });

    if (input.node.variableDeclaration) {
      collectBindingNameSymbols({
        name: input.node.variableDeclaration.name,
        scopeId: catchScopeId,
        symbolKind: "variable",
        context: input,
        metadata: {
          declarationKind: "catch-variable",
        },
      });
    }

    visitNode({
      ...input,
      node: input.node.block,
      lexicalScopeId: catchScopeId,
      functionScopeId: input.functionScopeId,
      isTopLevelStatement: false,
    });
    return;
  }

  if (ts.isVariableStatement(input.node)) {
    visitVariableStatement({
      ...input,
      node: input.node,
    });
    return;
  }

  ts.forEachChild(input.node, (child) =>
    visitNode({
      ...input,
      node: child,
      isTopLevelStatement: false,
    }),
  );
}

function visitVariableStatement(input: {
  node: ts.VariableStatement;
  lexicalScopeId: ScopeId;
  functionScopeId?: ScopeId;
  input: {
    filePath: string;
    parsedSourceFile: ts.SourceFile;
    moduleId: EngineModuleId;
  };
  symbols: Map<EngineSymbolId, EngineSymbol>;
  scopes: Map<ScopeId, SourceScope>;
  moduleScopeId: ScopeId;
  isTopLevelStatement?: boolean;
}): void {
  const declarationKind = getVariableStatementKind(input.node);
  const shouldCollectDeclarations =
    input.lexicalScopeId !== input.moduleScopeId && declarationKind === "const";

  for (const declaration of input.node.declarationList.declarations) {
    if (shouldCollectDeclarations) {
      collectBindingNameSymbols({
        name: declaration.name,
        scopeId: input.lexicalScopeId,
        symbolKind: inferVariableSymbolKind(declaration, declarationKind),
        context: input,
        metadata: {
          declarationKind,
          functionLikeInitializer:
            declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) ||
              ts.isFunctionExpression(declaration.initializer))
              ? declaration.initializer.kind === ts.SyntaxKind.ArrowFunction
                ? "arrow-function"
                : "function-expression"
              : undefined,
        },
      });
    }

    if (declaration.initializer) {
      visitNode({
        ...input,
        node: declaration.initializer,
        isTopLevelStatement: false,
      });
    }
  }
}

function visitFunctionLike(input: {
  node: FunctionLikeWithBody;
  lexicalScopeId: ScopeId;
  functionScopeId?: ScopeId;
  input: {
    filePath: string;
    parsedSourceFile: ts.SourceFile;
    moduleId: EngineModuleId;
  };
  symbols: Map<EngineSymbolId, EngineSymbol>;
  scopes: Map<ScopeId, SourceScope>;
  moduleScopeId: ScopeId;
  isTopLevelStatement?: boolean;
}): void {
  const isTopLevelFunctionDeclaration =
    input.isTopLevelStatement &&
    ts.isFunctionDeclaration(input.node) &&
    Boolean(input.node.name) &&
    input.lexicalScopeId === input.moduleScopeId;

  if (
    !isTopLevelFunctionDeclaration &&
    ts.isFunctionDeclaration(input.node) &&
    input.node.name &&
    input.lexicalScopeId !== input.moduleScopeId
  ) {
    registerSymbol({
      moduleId: input.input.moduleId,
      localName: input.node.name.text,
      kind: inferFunctionSymbolKind(input.node.name.text),
      symbolSpace: "value",
      scopeId: input.lexicalScopeId,
      declaration: toSourceAnchor(
        input.node.name,
        input.input.parsedSourceFile,
        input.input.filePath,
      ),
      exportedNames: [],
      resolution: { kind: "local" },
      metadata: {
        declarationKind: "function",
      },
      symbols: input.symbols,
      scopes: input.scopes,
    });
  }

  const functionScopeId = createChildScope({
    kind: "function",
    node: input.node,
    parentScopeId: input.lexicalScopeId,
    context: input,
  });
  const parameterScopeId = createChildScope({
    kind: "parameter",
    node: input.node,
    parentScopeId: functionScopeId,
    context: input,
  });

  if (ts.isFunctionExpression(input.node) && input.node.name && input.node.name.text.length > 0) {
    registerSymbol({
      moduleId: input.input.moduleId,
      localName: input.node.name.text,
      kind: inferFunctionSymbolKind(input.node.name.text),
      symbolSpace: "value",
      scopeId: functionScopeId,
      declaration: toSourceAnchor(
        input.node.name,
        input.input.parsedSourceFile,
        input.input.filePath,
      ),
      exportedNames: [],
      resolution: { kind: "local" },
      metadata: {
        declarationKind: "function-expression-name",
      },
      symbols: input.symbols,
      scopes: input.scopes,
    });
  }

  input.node.parameters.forEach((parameter, index) => {
    collectBindingNameSymbols({
      name: parameter.name,
      scopeId: parameterScopeId,
      symbolKind: "prop",
      context: input,
      metadata: {
        declarationKind: "parameter",
        functionParameterIndex: index,
      },
    });

    if (parameter.initializer) {
      visitNode({
        ...input,
        node: parameter.initializer,
        lexicalScopeId: parameterScopeId,
        functionScopeId,
        isTopLevelStatement: false,
      });
    }
  });

  if (!input.node.body) {
    return;
  }

  if (ts.isBlock(input.node.body)) {
    const bodyScopeId = createChildScope({
      kind: "block",
      node: input.node.body,
      parentScopeId: parameterScopeId,
      context: input,
    });
    for (const statement of input.node.body.statements) {
      visitNode({
        ...input,
        node: statement,
        lexicalScopeId: bodyScopeId,
        functionScopeId,
        isTopLevelStatement: false,
      });
    }
    return;
  }

  visitNode({
    ...input,
    node: input.node.body,
    lexicalScopeId: parameterScopeId,
    functionScopeId,
    isTopLevelStatement: false,
  });
}

function collectBindingNameSymbols(input: {
  name: ts.BindingName;
  scopeId: ScopeId;
  symbolKind: SymbolKind;
  context: {
    input: {
      filePath: string;
      parsedSourceFile: ts.SourceFile;
      moduleId: EngineModuleId;
    };
    symbols: Map<EngineSymbolId, EngineSymbol>;
    scopes: Map<ScopeId, SourceScope>;
  };
  metadata?: Record<string, unknown>;
}): void {
  if (ts.isIdentifier(input.name)) {
    registerSymbol({
      moduleId: input.context.input.moduleId,
      localName: input.name.text,
      kind: input.symbolKind,
      symbolSpace: "value",
      scopeId: input.scopeId,
      declaration: toSourceAnchor(
        input.name,
        input.context.input.parsedSourceFile,
        input.context.input.filePath,
      ),
      exportedNames: [],
      resolution: { kind: "local" },
      metadata: input.metadata,
      symbols: input.context.symbols,
      scopes: input.context.scopes,
    });
    return;
  }

  if (ts.isObjectBindingPattern(input.name)) {
    for (const element of input.name.elements) {
      collectBindingNameSymbols({
        ...input,
        name: element.name,
      });
    }
    return;
  }

  for (const element of input.name.elements) {
    if (!ts.isBindingElement(element)) {
      continue;
    }
    collectBindingNameSymbols({
      ...input,
      name: element.name,
    });
  }
}

function registerSymbol(
  input: Omit<EngineSymbol, "id"> & {
    symbols: Map<EngineSymbolId, EngineSymbol>;
    scopes: Map<ScopeId, SourceScope>;
  },
): void {
  const symbol: EngineSymbol = {
    moduleId: input.moduleId,
    kind: input.kind,
    symbolSpace: input.symbolSpace,
    localName: input.localName,
    scopeId: input.scopeId,
    exportedNames: input.exportedNames,
    declaration: input.declaration,
    resolution: input.resolution,
    metadata: input.metadata,
    id: createSymbolId(input.moduleId, input.localName, {
      declaration: input.declaration,
      symbolSpace: input.symbolSpace,
    }),
  };

  input.symbols.set(symbol.id, symbol);
  input.scopes.get(input.scopeId)?.declaredSymbolIds.push(symbol.id);
}

function createChildScope(input: {
  kind: ScopeKind;
  node: ts.Node;
  parentScopeId: ScopeId;
  context: {
    input: {
      filePath: string;
      parsedSourceFile: ts.SourceFile;
      moduleId: EngineModuleId;
    };
    scopes: Map<ScopeId, SourceScope>;
  };
}): ScopeId {
  const range = toSourceAnchor(
    input.node,
    input.context.input.parsedSourceFile,
    input.context.input.filePath,
  );
  const scopeId = createScopeId(input.context.input.moduleId, input.kind, range);
  input.context.scopes.set(scopeId, {
    id: scopeId,
    filePath: input.context.input.filePath,
    kind: input.kind,
    parentScopeId: input.parentScopeId,
    range,
    declaredSymbolIds: [],
    childScopeIds: [],
  });
  input.context.scopes.get(input.parentScopeId)?.childScopeIds.push(scopeId);
  return scopeId;
}

function isFunctionLikeWithBody(node: ts.Node): node is FunctionLikeWithBody {
  return (
    (ts.isFunctionDeclaration(node) && Boolean(node.body)) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    (ts.isMethodDeclaration(node) && Boolean(node.body)) ||
    (ts.isGetAccessorDeclaration(node) && Boolean(node.body)) ||
    (ts.isSetAccessorDeclaration(node) && Boolean(node.body)) ||
    (ts.isConstructorDeclaration(node) && Boolean(node.body))
  );
}

function inferVariableSymbolKind(
  declaration: ts.VariableDeclaration,
  declarationKind: "const" | "let" | "var",
): SymbolKind {
  if (ts.isIdentifier(declaration.name) && /^[A-Z]/.test(declaration.name.text)) {
    return "component";
  }

  return declarationKind === "const" ? "constant" : "variable";
}

function inferFunctionSymbolKind(localName: string): SymbolKind {
  return /^[A-Z]/.test(localName) ? "component" : "function";
}

function getVariableStatementKind(statement: ts.VariableStatement): "const" | "let" | "var" {
  if ((statement.declarationList.flags & ts.NodeFlags.Const) !== 0) {
    return "const";
  }
  if ((statement.declarationList.flags & ts.NodeFlags.Let) !== 0) {
    return "let";
  }
  return "var";
}

function collectLegacyModuleScopeSymbols(
  input: {
    filePath: string;
    parsedSourceFile: ts.SourceFile;
    moduleId: EngineModuleId;
  },
  symbols: Map<EngineSymbolId, EngineSymbol>,
  moduleScopeId: ScopeId,
): void {
  for (const statement of input.parsedSourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      collectLegacyImportSymbols(statement, input, symbols, moduleScopeId);
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const symbol = createModuleScopeSymbol({
        moduleId: input.moduleId,
        localName: statement.name.text,
        kind: /^[A-Z]/.test(statement.name.text) ? "component" : "function",
        symbolSpace: "value",
        scopeId: moduleScopeId,
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
      const symbol = createModuleScopeSymbol({
        moduleId: input.moduleId,
        localName,
        kind: /^[A-Z]/.test(localName)
          ? "component"
          : (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
            ? "constant"
            : "variable",
        symbolSpace: "value",
        scopeId: moduleScopeId,
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
  moduleScopeId: ScopeId,
): void {
  const importClause = statement.importClause;
  if (!importClause) {
    return;
  }

  if (importClause.name) {
    const symbol = createModuleScopeSymbol({
      moduleId: input.moduleId,
      localName: importClause.name.text,
      kind: "imported-binding",
      symbolSpace: "value",
      scopeId: moduleScopeId,
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
      const symbol = createModuleScopeSymbol({
        moduleId: input.moduleId,
        localName: element.name.text,
        kind: "imported-binding",
        symbolSpace: "value",
        scopeId: moduleScopeId,
        declaration: toSourceAnchor(element.name, input.parsedSourceFile, input.filePath),
        exportedNames: [],
        resolution: { kind: "imported" },
      });
      symbols.set(symbol.id, symbol);
    }
    return;
  }

  const symbol = createModuleScopeSymbol({
    moduleId: input.moduleId,
    localName: importClause.namedBindings.name.text,
    kind: "imported-binding",
    symbolSpace: "value",
    scopeId: moduleScopeId,
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

function createModuleScopeSymbol(input: Omit<EngineSymbol, "id">): EngineSymbol {
  return {
    ...input,
    id: createSymbolId(input.moduleId, input.localName, {
      declaration: input.declaration,
      symbolSpace: input.symbolSpace,
    }),
  };
}
