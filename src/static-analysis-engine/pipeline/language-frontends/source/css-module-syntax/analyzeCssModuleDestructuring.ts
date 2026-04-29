import ts from "typescript";

import type {
  ResolvedCssModuleBindingDiagnostic,
  ResolvedCssModuleMemberBinding,
  ResolvedCssModuleMemberReference,
  ResolvedCssModuleNamespaceBinding,
} from "../../../symbol-resolution/types.js";
import {
  createCssModuleDiagnostic,
  createCssModuleTrace,
  toSourceAnchor,
} from "../../../symbol-resolution/css-module-resolution/shared.js";

export function getCssModuleDestructuring(input: {
  node: ts.Node;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  namespaceBindings: Map<string, ResolvedCssModuleNamespaceBinding>;
  includeTraces: boolean;
}):
  | {
      bindings: ResolvedCssModuleMemberBinding[];
      references: ResolvedCssModuleMemberReference[];
      diagnostics: ResolvedCssModuleBindingDiagnostic[];
    }
  | undefined {
  if (
    !ts.isVariableDeclaration(input.node) ||
    !ts.isObjectBindingPattern(input.node.name) ||
    !input.node.initializer ||
    !ts.isIdentifier(input.node.initializer)
  ) {
    return undefined;
  }

  const namespaceBinding = input.namespaceBindings.get(input.node.initializer.text);
  if (!namespaceBinding) {
    return undefined;
  }

  const bindings: ResolvedCssModuleMemberBinding[] = [];
  const references: ResolvedCssModuleMemberReference[] = [];
  const diagnostics: ResolvedCssModuleBindingDiagnostic[] = [];

  for (const element of input.node.name.elements) {
    if (element.dotDotDotToken) {
      diagnostics.push(
        createCssModuleDiagnostic({
          reason: "rest-css-module-destructuring",
          node: element,
          parsedSourceFile: input.parsedSourceFile,
          sourceFilePath: input.sourceFilePath,
          binding: namespaceBinding,
          summary:
            "CSS Module destructuring used a rest binding that cannot be resolved statically",
          includeTraces: input.includeTraces,
        }),
      );
      continue;
    }

    const memberName = getBindingElementMemberName(element);
    if (memberName.kind === "computed") {
      diagnostics.push(
        createCssModuleDiagnostic({
          reason: "computed-css-module-destructuring",
          node: element,
          parsedSourceFile: input.parsedSourceFile,
          sourceFilePath: input.sourceFilePath,
          binding: namespaceBinding,
          summary:
            "CSS Module destructuring used a computed member name that cannot be resolved statically",
          includeTraces: input.includeTraces,
        }),
      );
      continue;
    }

    if (!ts.isIdentifier(element.name)) {
      diagnostics.push(
        createCssModuleDiagnostic({
          reason: "nested-css-module-destructuring",
          node: element,
          parsedSourceFile: input.parsedSourceFile,
          sourceFilePath: input.sourceFilePath,
          binding: namespaceBinding,
          summary:
            "CSS Module destructuring used a nested binding pattern that cannot be resolved statically",
          includeTraces: input.includeTraces,
        }),
      );
      continue;
    }

    const location = toSourceAnchor(element, input.parsedSourceFile, input.sourceFilePath);
    const traces = input.includeTraces
      ? [
          createCssModuleTrace({
            traceId: `css-module:destructured-binding:${location.filePath}:${location.startLine}:${location.startColumn}`,
            summary: `CSS Module member "${memberName.text}" was destructured from binding "${namespaceBinding.localName}"`,
            anchor: location,
            metadata: {
              stylesheetFilePath: namespaceBinding.stylesheetFilePath,
              localName: namespaceBinding.localName,
              memberName: memberName.text,
              bindingName: element.name.text,
            },
          }),
        ]
      : [];
    const rawExpressionText = element.getText(input.parsedSourceFile);

    bindings.push({
      sourceFilePath: input.sourceFilePath,
      stylesheetFilePath: namespaceBinding.stylesheetFilePath,
      specifier: namespaceBinding.specifier,
      localName: element.name.text,
      originLocalName: namespaceBinding.originLocalName,
      memberName: memberName.text,
      sourceKind: "destructured-binding",
      location,
      rawExpressionText,
      traces,
    });
    references.push({
      sourceFilePath: input.sourceFilePath,
      stylesheetFilePath: namespaceBinding.stylesheetFilePath,
      specifier: namespaceBinding.specifier,
      localName: namespaceBinding.localName,
      originLocalName: namespaceBinding.originLocalName,
      memberName: memberName.text,
      accessKind: "destructured-binding",
      location,
      rawExpressionText,
      traces,
    });
  }

  return {
    bindings,
    references,
    diagnostics,
  };
}

function getBindingElementMemberName(
  element: ts.BindingElement,
): { kind: "static"; text: string } | { kind: "computed" } {
  if (!element.propertyName) {
    return ts.isIdentifier(element.name)
      ? { kind: "static", text: element.name.text }
      : { kind: "computed" };
  }

  if (ts.isComputedPropertyName(element.propertyName)) {
    return { kind: "computed" };
  }

  if (
    ts.isIdentifier(element.propertyName) ||
    ts.isStringLiteral(element.propertyName) ||
    ts.isNumericLiteral(element.propertyName)
  ) {
    return { kind: "static", text: element.propertyName.text };
  }

  return { kind: "computed" };
}
