import ts from "typescript";

import type {
  RuntimeDomAdapter,
  RuntimeDomAdapterContext,
  RuntimeDomClassReference,
  RuntimeDomLibraryHint,
} from "../types.js";
import {
  buildRuntimeDomClassReference,
  findObjectPropertyValue,
  isStaticStringExpression,
} from "./shared.js";

const ADAPTER_NAME = "prosemirror-editor-view";
const PROSEMIRROR_VIEW_PACKAGE = "prosemirror-view";

export const prosemirrorEditorViewAdapter: RuntimeDomAdapter = {
  adapterName: ADAPTER_NAME,
  collectReferences(node, context) {
    if (!ts.isNewExpression(node)) {
      return [];
    }

    const runtimeLibraryHint = getProseMirrorEditorViewImportHint(node.expression, context);
    if (!isEditorViewConstructor(node.expression)) {
      return [];
    }

    return collectEditorViewAttributeClassReferences(node, context, runtimeLibraryHint);
  },
};

function collectEditorViewAttributeClassReferences(
  expression: ts.NewExpression,
  context: RuntimeDomAdapterContext,
  runtimeLibraryHint: RuntimeDomLibraryHint | undefined,
): RuntimeDomClassReference[] {
  const references: RuntimeDomClassReference[] = [];
  for (const argument of expression.arguments ?? []) {
    if (!ts.isObjectLiteralExpression(argument)) {
      continue;
    }

    const attributes = findObjectPropertyValue(argument, "attributes");
    if (!attributes || !ts.isObjectLiteralExpression(attributes)) {
      continue;
    }

    for (const propertyName of ["class", "className"]) {
      const classExpression = findObjectPropertyValue(attributes, propertyName);
      if (!classExpression || !isStaticStringExpression(classExpression)) {
        continue;
      }

      references.push(
        buildRuntimeDomClassReference({
          kind: "prosemirror-editor-view-attributes",
          expression: classExpression,
          context,
          adapterName: ADAPTER_NAME,
          runtimeLibraryHint,
          traceSummary:
            "runtime DOM class reference was collected from a ProseMirror EditorView attributes object",
        }),
      );
    }
  }

  return references;
}

function isEditorViewConstructor(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === "EditorView";
  }

  return ts.isPropertyAccessExpression(expression) && expression.name.text === "EditorView";
}

function getProseMirrorEditorViewImportHint(
  expression: ts.Expression,
  context: RuntimeDomAdapterContext,
): RuntimeDomLibraryHint | undefined {
  const importBindings = collectProseMirrorViewBindings(context.parsedSourceFile);

  if (ts.isIdentifier(expression)) {
    const importedName = importBindings.namedImports.get(expression.text);
    return importedName
      ? {
          packageName: PROSEMIRROR_VIEW_PACKAGE,
          importedName,
          localName: expression.text,
        }
      : undefined;
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "EditorView" &&
    ts.isIdentifier(expression.expression) &&
    importBindings.namespaceImports.has(expression.expression.text)
  ) {
    return {
      packageName: PROSEMIRROR_VIEW_PACKAGE,
      importedName: "EditorView",
      localName: `${expression.expression.text}.EditorView`,
    };
  }

  return undefined;
}

function collectProseMirrorViewBindings(sourceFile: ts.SourceFile): {
  namedImports: Map<string, string>;
  namespaceImports: Set<string>;
} {
  const namedImports = new Map<string, string>();
  const namespaceImports = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== PROSEMIRROR_VIEW_PACKAGE
    ) {
      continue;
    }

    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings) {
      continue;
    }

    if (ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (importedName === "EditorView") {
          namedImports.set(element.name.text, importedName);
        }
      }
      continue;
    }

    namespaceImports.add(namedBindings.name.text);
  }

  return { namedImports, namespaceImports };
}
