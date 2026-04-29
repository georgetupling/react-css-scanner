import ts from "typescript";

import type {
  ResolvedCssModuleBindingDiagnostic,
  ResolvedCssModuleNamespaceBinding,
} from "../../../symbol-resolution/types.js";
import {
  createCssModuleDiagnostic,
  createCssModuleTrace,
  isConstVariableDeclaration,
  toSourceAnchor,
} from "../../../symbol-resolution/css-module-resolution/shared.js";

export function buildCssModuleAliases(input: {
  parsedSourceFile: ts.SourceFile;
  sourceFilePath: string;
  directNamespaceBindingsByLocalName: Map<string, ResolvedCssModuleNamespaceBinding>;
  includeTraces: boolean;
}): {
  aliases: ResolvedCssModuleNamespaceBinding[];
  diagnostics: ResolvedCssModuleBindingDiagnostic[];
} {
  const aliases: ResolvedCssModuleNamespaceBinding[] = [];
  const diagnostics: ResolvedCssModuleBindingDiagnostic[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer)
    ) {
      const namespaceBinding = input.directNamespaceBindingsByLocalName.get(node.initializer.text);
      if (!namespaceBinding) {
        ts.forEachChild(node, visit);
        return;
      }

      if (node.name.text === node.initializer.text) {
        diagnostics.push(
          createCssModuleDiagnostic({
            reason: "self-referential-css-module-alias",
            node,
            parsedSourceFile: input.parsedSourceFile,
            sourceFilePath: input.sourceFilePath,
            binding: namespaceBinding,
            summary: "CSS Module alias declaration referenced itself and cannot be resolved",
            includeTraces: input.includeTraces,
          }),
        );
      } else if (!isConstVariableDeclaration(node)) {
        diagnostics.push(
          createCssModuleDiagnostic({
            reason: "reassignable-css-module-alias",
            node,
            parsedSourceFile: input.parsedSourceFile,
            sourceFilePath: input.sourceFilePath,
            binding: namespaceBinding,
            summary:
              "CSS Module alias declaration used a reassignable binding and cannot be resolved safely",
            includeTraces: input.includeTraces,
          }),
        );
      } else {
        const location = toSourceAnchor(node, input.parsedSourceFile, input.sourceFilePath);
        aliases.push({
          sourceFilePath: input.sourceFilePath,
          stylesheetFilePath: namespaceBinding.stylesheetFilePath,
          specifier: namespaceBinding.specifier,
          localName: node.name.text,
          originLocalName: namespaceBinding.originLocalName,
          importKind: namespaceBinding.importKind,
          sourceKind: "alias",
          location,
          rawExpressionText: node.getText(input.parsedSourceFile),
          traces: input.includeTraces
            ? [
                createCssModuleTrace({
                  traceId: `css-module:alias:${location.filePath}:${location.startLine}:${location.startColumn}`,
                  summary: `CSS Module binding "${namespaceBinding.originLocalName}" was aliased as "${node.name.text}"`,
                  anchor: location,
                  metadata: {
                    stylesheetFilePath: namespaceBinding.stylesheetFilePath,
                    localName: namespaceBinding.originLocalName,
                    aliasName: node.name.text,
                  },
                }),
              ]
            : [],
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(input.parsedSourceFile);
  return { aliases, diagnostics };
}
