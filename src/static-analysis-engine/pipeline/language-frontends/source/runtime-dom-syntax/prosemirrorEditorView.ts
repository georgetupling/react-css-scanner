import ts from "typescript";

import type { ModuleFactsImportRecord } from "../../../module-facts/types.js";
import type { RuntimeDomClassSite, RuntimeDomLibraryHint } from "../../types.js";
import {
  buildRuntimeDomClassSite,
  findObjectPropertyValue,
  isStaticStringExpression,
  type RuntimeDomFrontendAdapterContext,
} from "./shared.js";

const ADAPTER_NAME = "prosemirror-editor-view";
const PROSEMIRROR_VIEW_PACKAGE = "prosemirror-view";

export function collectProseMirrorEditorViewRuntimeDomSites(input: {
  node: ts.Node;
  context: RuntimeDomFrontendAdapterContext;
  imports: ModuleFactsImportRecord[];
}): RuntimeDomClassSite[] {
  if (!ts.isNewExpression(input.node)) {
    return [];
  }

  const importBindings = collectProseMirrorViewBindings(input.imports);
  const runtimeLibraryHint = getProseMirrorEditorViewImportHint(
    input.node.expression,
    importBindings,
  );
  if (!isEditorViewConstructor(input.node.expression, importBindings)) {
    return [];
  }

  return collectEditorViewAttributeClassSites(input.node, input.context, runtimeLibraryHint);
}

function collectEditorViewAttributeClassSites(
  expression: ts.NewExpression,
  context: RuntimeDomFrontendAdapterContext,
  runtimeLibraryHint: RuntimeDomLibraryHint | undefined,
): RuntimeDomClassSite[] {
  const sites: RuntimeDomClassSite[] = [];
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

      sites.push(
        buildRuntimeDomClassSite({
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

  return sites;
}

function isEditorViewConstructor(
  expression: ts.Expression,
  importBindings: ProseMirrorViewBindings,
): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === "EditorView" || importBindings.namedImports.has(expression.text);
  }

  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "EditorView" &&
    ts.isIdentifier(expression.expression) &&
    importBindings.namespaceImports.has(expression.expression.text)
  );
}

function getProseMirrorEditorViewImportHint(
  expression: ts.Expression,
  importBindings: ProseMirrorViewBindings,
): RuntimeDomLibraryHint | undefined {
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

type ProseMirrorViewBindings = {
  namedImports: Map<string, string>;
  namespaceImports: Set<string>;
};

function collectProseMirrorViewBindings(
  imports: ModuleFactsImportRecord[],
): ProseMirrorViewBindings {
  const namedImports = new Map<string, string>();
  const namespaceImports = new Set<string>();

  for (const importRecord of imports) {
    if (importRecord.specifier !== PROSEMIRROR_VIEW_PACKAGE) {
      continue;
    }

    for (const importName of importRecord.importNames) {
      if (importName.kind === "named" && importName.importedName === "EditorView") {
        namedImports.set(importName.localName, importName.importedName);
      }

      if (importName.kind === "namespace") {
        namespaceImports.add(importName.localName);
      }
    }
  }

  return { namedImports, namespaceImports };
}
