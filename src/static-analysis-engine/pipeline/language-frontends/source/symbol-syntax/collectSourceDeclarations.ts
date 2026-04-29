import ts from "typescript";

export type SourceValueDeclaration =
  | {
      kind: "const" | "let" | "var";
      name: string;
      node: ts.VariableDeclaration;
      initializer?: ts.Expression;
    }
  | {
      kind: "function";
      name: string;
      node: ts.FunctionDeclaration;
    }
  | {
      kind: "class";
      name: string;
      node: ts.ClassDeclaration;
    }
  | {
      kind: "enum" | "const-enum";
      name: string;
      node: ts.EnumDeclaration;
    }
  | {
      kind: "namespace";
      name: string;
      node: ts.ModuleDeclaration;
    };

export type SourceDeclarationIndex = {
  typeAliases: Map<string, ts.TypeAliasDeclaration>;
  interfaces: Map<string, ts.InterfaceDeclaration>;
  valueDeclarations: Map<string, SourceValueDeclaration>;
};

export function collectSourceDeclarationIndex(sourceFile: ts.SourceFile): SourceDeclarationIndex {
  const declarations: SourceDeclarationIndex = {
    typeAliases: new Map(),
    interfaces: new Map(),
    valueDeclarations: new Map(),
  };

  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      declarations.typeAliases.set(statement.name.text, statement);
      continue;
    }

    if (ts.isInterfaceDeclaration(statement)) {
      declarations.interfaces.set(statement.name.text, statement);
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.valueDeclarations.set(statement.name.text, {
        kind: "function",
        name: statement.name.text,
        node: statement,
      });
      continue;
    }

    if (ts.isClassDeclaration(statement) && statement.name) {
      declarations.valueDeclarations.set(statement.name.text, {
        kind: "class",
        name: statement.name.text,
        node: statement,
      });
      continue;
    }

    if (ts.isEnumDeclaration(statement)) {
      declarations.valueDeclarations.set(statement.name.text, {
        kind: hasConstModifier(statement) ? "const-enum" : "enum",
        name: statement.name.text,
        node: statement,
      });
      continue;
    }

    if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
      declarations.valueDeclarations.set(statement.name.text, {
        kind: "namespace",
        name: statement.name.text,
        node: statement,
      });
      continue;
    }

    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    const declarationKind = getVariableStatementKind(statement);
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue;
      }

      declarations.valueDeclarations.set(declaration.name.text, {
        kind: declarationKind,
        name: declaration.name.text,
        node: declaration,
        initializer: declaration.initializer,
      });
    }
  }

  return declarations;
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

function hasConstModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ConstKeyword) ??
      false)
  );
}
