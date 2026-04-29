import ts from "typescript";

import type { ModuleFacts } from "../../module-facts/index.js";
import type { ParsedProjectFile } from "../../../entry/stages/types.js";
import type {
  ResolvedCssModuleBindingDiagnostic,
  ResolvedCssModuleImport,
  ResolvedCssModuleMemberBinding,
  ResolvedCssModuleMemberReference,
  ResolvedCssModuleNamespaceBinding,
} from "../types.js";
import { buildCssModuleAliases } from "../../language-frontends/source/css-module-syntax/analyzeCssModuleAliases.js";
import { getCssModuleDestructuring } from "../../language-frontends/source/css-module-syntax/analyzeCssModuleDestructuring.js";
import { getCssModuleMemberAccess } from "../../language-frontends/source/css-module-syntax/analyzeCssModuleMemberAccess.js";
import { collectResolvedCssModuleImportsByFilePath } from "./collectResolvedCssModuleImports.js";
import {
  createCssModuleMemberBindingKey,
  createCssModuleDiagnosticKey,
  createCssModuleMemberReferenceKey,
  createCssModuleTrace,
  deduplicateByKey,
  findImportBindingAnchor,
} from "./shared.js";

export function collectResolvedCssModuleBindings(input: {
  parsedFiles: ParsedProjectFile[];
  moduleFacts: ModuleFacts;
  knownCssModuleFilePaths?: ReadonlySet<string>;
  includeTraces?: boolean;
}): {
  resolvedCssModuleImportsByFilePath: Map<string, ResolvedCssModuleImport[]>;
  resolvedCssModuleNamespaceBindingsByFilePath: Map<
    string,
    Map<string, ResolvedCssModuleNamespaceBinding>
  >;
  resolvedCssModuleMemberBindingsByFilePath: Map<
    string,
    Map<string, ResolvedCssModuleMemberBinding>
  >;
  resolvedCssModuleMemberReferencesByFilePath: Map<string, ResolvedCssModuleMemberReference[]>;
  resolvedCssModuleBindingDiagnosticsByFilePath: Map<string, ResolvedCssModuleBindingDiagnostic[]>;
} {
  const includeTraces = input.includeTraces ?? true;
  const resolvedCssModuleImportsByFilePath = collectResolvedCssModuleImportsByFilePath({
    moduleFacts: input.moduleFacts,
    knownCssModuleFilePaths: input.knownCssModuleFilePaths,
  });
  const resolvedCssModuleNamespaceBindingsByFilePath = new Map<
    string,
    Map<string, ResolvedCssModuleNamespaceBinding>
  >();
  const resolvedCssModuleMemberBindingsByFilePath = new Map<
    string,
    Map<string, ResolvedCssModuleMemberBinding>
  >();
  const resolvedCssModuleMemberReferencesByFilePath = new Map<
    string,
    ResolvedCssModuleMemberReference[]
  >();
  const resolvedCssModuleBindingDiagnosticsByFilePath = new Map<
    string,
    ResolvedCssModuleBindingDiagnostic[]
  >();

  for (const parsedFile of input.parsedFiles) {
    const cssModuleImports = resolvedCssModuleImportsByFilePath.get(parsedFile.filePath) ?? [];
    const resolvedBindingsForFile = resolveCssModuleBindingsForFile({
      parsedFile,
      imports: cssModuleImports,
      includeTraces,
    });
    resolvedCssModuleNamespaceBindingsByFilePath.set(
      parsedFile.filePath,
      resolvedBindingsForFile.namespaceBindings,
    );
    resolvedCssModuleMemberBindingsByFilePath.set(
      parsedFile.filePath,
      resolvedBindingsForFile.memberBindings,
    );
    resolvedCssModuleMemberReferencesByFilePath.set(
      parsedFile.filePath,
      resolvedBindingsForFile.memberReferences,
    );
    resolvedCssModuleBindingDiagnosticsByFilePath.set(
      parsedFile.filePath,
      resolvedBindingsForFile.diagnostics,
    );
  }

  return {
    resolvedCssModuleImportsByFilePath,
    resolvedCssModuleNamespaceBindingsByFilePath,
    resolvedCssModuleMemberBindingsByFilePath,
    resolvedCssModuleMemberReferencesByFilePath,
    resolvedCssModuleBindingDiagnosticsByFilePath,
  };
}

function resolveCssModuleBindingsForFile(input: {
  parsedFile: ParsedProjectFile;
  imports: ResolvedCssModuleImport[];
  includeTraces: boolean;
}): {
  namespaceBindings: Map<string, ResolvedCssModuleNamespaceBinding>;
  memberBindings: Map<string, ResolvedCssModuleMemberBinding>;
  memberReferences: ResolvedCssModuleMemberReference[];
  diagnostics: ResolvedCssModuleBindingDiagnostic[];
} {
  const directNamespaceBindingsByLocalName = new Map<string, ResolvedCssModuleNamespaceBinding>();

  for (const cssModuleImport of input.imports) {
    if (cssModuleImport.importKind === "named") {
      continue;
    }
    const importKind = cssModuleImport.importKind;

    const location = findImportBindingAnchor(
      input.parsedFile.parsedSourceFile,
      input.parsedFile.filePath,
      cssModuleImport.localName,
    );
    if (!location) {
      continue;
    }

    directNamespaceBindingsByLocalName.set(cssModuleImport.localName, {
      ...cssModuleImport,
      originLocalName: cssModuleImport.localName,
      importKind,
      sourceKind: "import",
      location,
      rawExpressionText: cssModuleImport.localName,
      traces: input.includeTraces
        ? [
            createCssModuleTrace({
              traceId: `css-module:namespace-import:${location.filePath}:${location.startLine}:${location.startColumn}`,
              summary: `CSS Module binding "${cssModuleImport.localName}" resolved to "${cssModuleImport.stylesheetFilePath}"`,
              anchor: location,
              metadata: {
                stylesheetFilePath: cssModuleImport.stylesheetFilePath,
                localName: cssModuleImport.localName,
                importKind: cssModuleImport.importKind,
              },
            }),
          ]
        : [],
    });
  }

  const aliasAnalysis = buildCssModuleAliases({
    parsedSourceFile: input.parsedFile.parsedSourceFile,
    sourceFilePath: input.parsedFile.filePath,
    directNamespaceBindingsByLocalName,
    includeTraces: input.includeTraces,
  });

  const namespaceBindings = new Map<string, ResolvedCssModuleNamespaceBinding>();
  for (const binding of [
    ...directNamespaceBindingsByLocalName.values(),
    ...aliasAnalysis.aliases,
  ]) {
    if (!namespaceBindings.has(binding.localName)) {
      namespaceBindings.set(binding.localName, binding);
    }
  }

  const memberBindings: ResolvedCssModuleMemberBinding[] = [];
  const memberReferences: ResolvedCssModuleMemberReference[] = [];
  const diagnostics = [...aliasAnalysis.diagnostics];

  const visit = (node: ts.Node): void => {
    const memberAccess = getCssModuleMemberAccess({
      node,
      parsedSourceFile: input.parsedFile.parsedSourceFile,
      sourceFilePath: input.parsedFile.filePath,
      namespaceBindings,
      includeTraces: input.includeTraces,
    });
    if (memberAccess?.kind === "reference") {
      memberReferences.push(memberAccess.reference);
    } else if (memberAccess?.kind === "diagnostic") {
      diagnostics.push(memberAccess.diagnostic);
    }

    const destructuring = getCssModuleDestructuring({
      node,
      parsedSourceFile: input.parsedFile.parsedSourceFile,
      sourceFilePath: input.parsedFile.filePath,
      namespaceBindings,
      includeTraces: input.includeTraces,
    });
    if (destructuring) {
      memberBindings.push(...destructuring.bindings);
      memberReferences.push(...destructuring.references);
      diagnostics.push(...destructuring.diagnostics);
    }

    ts.forEachChild(node, visit);
  };

  visit(input.parsedFile.parsedSourceFile);

  return {
    namespaceBindings,
    memberBindings: new Map(
      deduplicateByKey(memberBindings, createCssModuleMemberBindingKey).map((binding) => [
        binding.localName,
        binding,
      ]),
    ),
    memberReferences: deduplicateByKey(memberReferences, createCssModuleMemberReferenceKey).sort(
      (left, right) =>
        createCssModuleMemberReferenceKey(left).localeCompare(
          createCssModuleMemberReferenceKey(right),
        ),
    ),
    diagnostics: deduplicateByKey(diagnostics, createCssModuleDiagnosticKey).sort((left, right) =>
      createCssModuleDiagnosticKey(left).localeCompare(createCssModuleDiagnosticKey(right)),
    ),
  };
}
