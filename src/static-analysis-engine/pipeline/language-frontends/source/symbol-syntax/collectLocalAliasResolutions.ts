import ts from "typescript";

import type { EngineSymbolId } from "../../../../types/core.js";
import type {
  EngineSymbol,
  LocalAliasResolution,
  SymbolReference,
} from "../../../symbol-resolution/types.js";
import { toSourceAnchor } from "./shared.js";

export function collectLocalAliasResolutions(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  symbols: Map<EngineSymbolId, EngineSymbol>;
  references: SymbolReference[];
}): LocalAliasResolution[] {
  const aliases: LocalAliasResolution[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      if (isConst) {
        for (const declaration of node.declarationList.declarations) {
          aliases.push(
            ...collectVariableDeclarationAliases({
              declaration,
              filePath: input.filePath,
              parsedSourceFile: input.parsedSourceFile,
              symbols: input.symbols,
              references: input.references,
            }),
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(input.parsedSourceFile);
  return aliases;
}

function collectVariableDeclarationAliases(input: {
  declaration: ts.VariableDeclaration;
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  symbols: Map<EngineSymbolId, EngineSymbol>;
  references: SymbolReference[];
}): LocalAliasResolution[] {
  const initializer = input.declaration.initializer;
  if (!initializer || !ts.isIdentifier(initializer)) {
    return [];
  }

  const targetReference = findReferenceAtNode({
    node: initializer,
    parsedSourceFile: input.parsedSourceFile,
    filePath: input.filePath,
    references: input.references,
  });

  if (ts.isIdentifier(input.declaration.name)) {
    return [
      createIdentifierAliasResolution({
        filePath: input.filePath,
        parsedSourceFile: input.parsedSourceFile,
        localNameNode: input.declaration.name,
        initializerNode: initializer,
        symbols: input.symbols,
        targetReference,
      }),
    ];
  }

  if (ts.isObjectBindingPattern(input.declaration.name)) {
    return collectObjectBindingAliases({
      bindingPattern: input.declaration.name,
      sourceIdentifier: initializer,
      filePath: input.filePath,
      parsedSourceFile: input.parsedSourceFile,
      symbols: input.symbols,
      targetReference,
    });
  }

  return [
    {
      kind: "unresolved-alias",
      sourceFilePath: input.filePath,
      aliasKind: "object-destructuring",
      location: toSourceAnchor(input.declaration.name, input.parsedSourceFile, input.filePath),
      reason: "unsupported-local-alias",
    },
  ];
}

function createIdentifierAliasResolution(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  localNameNode: ts.Identifier;
  initializerNode: ts.Identifier;
  symbols: Map<EngineSymbolId, EngineSymbol>;
  targetReference?: SymbolReference;
}): LocalAliasResolution {
  const sourceSymbol = findSymbolAtDeclaration({
    symbols: input.symbols,
    filePath: input.filePath,
    localName: input.localNameNode.text,
    line: toSourceAnchor(input.localNameNode, input.parsedSourceFile, input.filePath).startLine,
    column: toSourceAnchor(input.localNameNode, input.parsedSourceFile, input.filePath).startColumn,
  });
  const location = toSourceAnchor(input.localNameNode, input.parsedSourceFile, input.filePath);

  if (!sourceSymbol) {
    return {
      kind: "unresolved-alias",
      sourceFilePath: input.filePath,
      aliasKind: "identifier",
      location,
      reason: "binding-not-found",
    };
  }

  if (input.targetReference?.resolvedSymbolId === sourceSymbol.id) {
    return {
      kind: "unresolved-alias",
      sourceFilePath: input.filePath,
      sourceSymbolId: sourceSymbol.id,
      aliasKind: "identifier",
      location,
      reason: "self-referential-local-alias",
    };
  }

  if (!input.targetReference?.resolvedSymbolId) {
    return {
      kind: "unresolved-alias",
      sourceFilePath: input.filePath,
      sourceSymbolId: sourceSymbol.id,
      aliasKind: "identifier",
      location,
      reason: input.targetReference?.reason ?? "binding-not-found",
    };
  }

  return {
    kind: "resolved-alias",
    sourceFilePath: input.filePath,
    sourceSymbolId: sourceSymbol.id,
    targetSymbolId: input.targetReference.resolvedSymbolId,
    aliasKind: "identifier",
    location,
  };
}

function collectObjectBindingAliases(input: {
  bindingPattern: ts.ObjectBindingPattern;
  sourceIdentifier: ts.Identifier;
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  symbols: Map<EngineSymbolId, EngineSymbol>;
  targetReference?: SymbolReference;
}): LocalAliasResolution[] {
  const aliases: LocalAliasResolution[] = [];

  for (const element of input.bindingPattern.elements) {
    const memberName = getBindingElementMemberName(element);
    const location = toSourceAnchor(element.name, input.parsedSourceFile, input.filePath);

    if (element.dotDotDotToken) {
      aliases.push({
        kind: "unresolved-alias",
        sourceFilePath: input.filePath,
        aliasKind: "object-destructuring",
        location,
        memberName,
        reason: "rest-local-destructuring",
      });
      continue;
    }

    if (!ts.isIdentifier(element.name)) {
      aliases.push({
        kind: "unresolved-alias",
        sourceFilePath: input.filePath,
        aliasKind: "object-destructuring",
        location,
        memberName,
        reason: "nested-local-destructuring",
      });
      continue;
    }

    const sourceSymbol = findSymbolAtDeclaration({
      symbols: input.symbols,
      filePath: input.filePath,
      localName: element.name.text,
      line: location.startLine,
      column: location.startColumn,
    });

    if (!sourceSymbol) {
      aliases.push({
        kind: "unresolved-alias",
        sourceFilePath: input.filePath,
        aliasKind: "object-destructuring",
        location,
        memberName,
        reason: "binding-not-found",
      });
      continue;
    }

    if (!input.targetReference?.resolvedSymbolId) {
      aliases.push({
        kind: "unresolved-alias",
        sourceFilePath: input.filePath,
        sourceSymbolId: sourceSymbol.id,
        aliasKind: "object-destructuring",
        location,
        memberName,
        reason: input.targetReference?.reason ?? "binding-not-found",
      });
      continue;
    }

    aliases.push({
      kind: "resolved-alias",
      sourceFilePath: input.filePath,
      sourceSymbolId: sourceSymbol.id,
      targetSymbolId: input.targetReference.resolvedSymbolId,
      aliasKind: "object-destructuring",
      location,
      memberName,
    });
  }

  return aliases;
}

function findReferenceAtNode(input: {
  node: ts.Identifier;
  parsedSourceFile: ts.SourceFile;
  filePath: string;
  references: SymbolReference[];
}): SymbolReference | undefined {
  const location = toSourceAnchor(input.node, input.parsedSourceFile, input.filePath);
  return input.references.find(
    (reference) =>
      reference.location.startLine === location.startLine &&
      reference.location.startColumn === location.startColumn &&
      reference.location.endLine === location.endLine &&
      reference.location.endColumn === location.endColumn &&
      reference.localName === input.node.text,
  );
}

function findSymbolAtDeclaration(input: {
  symbols: Map<EngineSymbolId, EngineSymbol>;
  filePath: string;
  localName: string;
  line: number;
  column: number;
}): EngineSymbol | undefined {
  return [...input.symbols.values()].find(
    (symbol) =>
      symbol.symbolSpace === "value" &&
      symbol.localName === input.localName &&
      symbol.declaration.filePath === input.filePath &&
      symbol.declaration.startLine === input.line &&
      symbol.declaration.startColumn === input.column,
  );
}

function getBindingElementMemberName(element: ts.BindingElement): string | undefined {
  if (!element.propertyName) {
    return ts.isIdentifier(element.name) ? element.name.text : undefined;
  }

  if (ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)) {
    return element.propertyName.text;
  }

  return undefined;
}
