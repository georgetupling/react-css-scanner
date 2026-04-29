import ts from "typescript";

import type {
  ResolvedCssModuleBindingDiagnostic,
  ResolvedCssModuleMemberReference,
  ResolvedCssModuleNamespaceBinding,
} from "../../../symbol-resolution/types.js";
import {
  createCssModuleDiagnostic,
  createCssModuleTrace,
  toSourceAnchor,
} from "../../../symbol-resolution/css-module-resolution/shared.js";

export type CssModuleMemberAccess =
  | { kind: "reference"; reference: ResolvedCssModuleMemberReference }
  | { kind: "diagnostic"; diagnostic: ResolvedCssModuleBindingDiagnostic };

export function getCssModuleMemberAccess(input: {
  node: ts.Node;
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  namespaceBindings: Map<string, ResolvedCssModuleNamespaceBinding>;
  includeTraces: boolean;
}): CssModuleMemberAccess | undefined {
  if (ts.isPropertyAccessExpression(input.node) && ts.isIdentifier(input.node.expression)) {
    const namespaceBinding = input.namespaceBindings.get(input.node.expression.text);
    if (!namespaceBinding) {
      return undefined;
    }

    const location = toSourceAnchor(input.node, input.parsedSourceFile, input.sourceFilePath);
    return {
      kind: "reference",
      reference: {
        sourceFilePath: input.sourceFilePath,
        stylesheetFilePath: namespaceBinding.stylesheetFilePath,
        specifier: namespaceBinding.specifier,
        localName: namespaceBinding.localName,
        originLocalName: namespaceBinding.originLocalName,
        memberName: input.node.name.text,
        accessKind: "property",
        location,
        rawExpressionText: input.node.getText(input.parsedSourceFile),
        traces: input.includeTraces
          ? [
              createCssModuleTrace({
                traceId: `css-module:member-reference:${location.filePath}:${location.startLine}:${location.startColumn}`,
                summary: `CSS Module member "${input.node.name.text}" was read from binding "${namespaceBinding.localName}"`,
                anchor: location,
                metadata: {
                  stylesheetFilePath: namespaceBinding.stylesheetFilePath,
                  localName: namespaceBinding.localName,
                  memberName: input.node.name.text,
                },
              }),
            ]
          : [],
      },
    };
  }

  if (ts.isElementAccessExpression(input.node) && ts.isIdentifier(input.node.expression)) {
    const namespaceBinding = input.namespaceBindings.get(input.node.expression.text);
    if (!namespaceBinding) {
      return undefined;
    }

    const location = toSourceAnchor(input.node, input.parsedSourceFile, input.sourceFilePath);
    if (ts.isStringLiteralLike(input.node.argumentExpression)) {
      return {
        kind: "reference",
        reference: {
          sourceFilePath: input.sourceFilePath,
          stylesheetFilePath: namespaceBinding.stylesheetFilePath,
          specifier: namespaceBinding.specifier,
          localName: namespaceBinding.localName,
          originLocalName: namespaceBinding.originLocalName,
          memberName: input.node.argumentExpression.text,
          accessKind: "string-literal-element",
          location,
          rawExpressionText: input.node.getText(input.parsedSourceFile),
          traces: input.includeTraces
            ? [
                createCssModuleTrace({
                  traceId: `css-module:member-reference:${location.filePath}:${location.startLine}:${location.startColumn}`,
                  summary: `CSS Module member "${input.node.argumentExpression.text}" was read from binding "${namespaceBinding.localName}"`,
                  anchor: location,
                  metadata: {
                    stylesheetFilePath: namespaceBinding.stylesheetFilePath,
                    localName: namespaceBinding.localName,
                    memberName: input.node.argumentExpression.text,
                  },
                }),
              ]
            : [],
        },
      };
    }

    return {
      kind: "diagnostic",
      diagnostic: createCssModuleDiagnostic({
        reason: "computed-css-module-member",
        node: input.node,
        parsedSourceFile: input.parsedSourceFile,
        sourceFilePath: input.sourceFilePath,
        binding: namespaceBinding,
        summary:
          "CSS Module member access used a computed expression that cannot be resolved statically",
        includeTraces: input.includeTraces,
      }),
    };
  }

  return undefined;
}
