import ts from "typescript";

export function collectExportedExpressionBindings(
  parsedSourceFile: ts.SourceFile,
): Map<string, ts.Expression> {
  const bindings = new Map<string, ts.Expression>();
  const topLevelConstBindings = new Map<string, ts.Expression>();

  for (const statement of parsedSourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }

      topLevelConstBindings.set(declaration.name.text, declaration.initializer);

      if (!isExportedStatement(statement)) {
        continue;
      }

      bindings.set(declaration.name.text, declaration.initializer);
    }
  }

  for (const statement of parsedSourceFile.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) {
      continue;
    }

    if (ts.isIdentifier(statement.expression)) {
      const expression = topLevelConstBindings.get(statement.expression.text);
      if (expression) {
        bindings.set("default", expression);
      }

      continue;
    }

    bindings.set("default", statement.expression);
  }

  return bindings;
}

function isExportedStatement(
  statement: ts.Statement & { modifiers?: ts.NodeArray<ts.ModifierLike> },
): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}
