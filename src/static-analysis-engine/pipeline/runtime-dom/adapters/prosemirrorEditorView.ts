import ts from "typescript";

import type {
  RuntimeDomAdapter,
  RuntimeDomAdapterContext,
  RuntimeDomClassReference,
} from "../types.js";
import {
  buildRuntimeDomClassReference,
  findObjectPropertyValue,
  isStaticStringExpression,
} from "./shared.js";

const ADAPTER_NAME = "prosemirror-editor-view";

export const prosemirrorEditorViewAdapter: RuntimeDomAdapter = {
  adapterName: ADAPTER_NAME,
  collectReferences(node, context) {
    if (!ts.isNewExpression(node) || !isEditorViewConstructor(node.expression)) {
      return [];
    }

    return collectEditorViewAttributeClassReferences(node, context);
  },
};

function collectEditorViewAttributeClassReferences(
  expression: ts.NewExpression,
  context: RuntimeDomAdapterContext,
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
