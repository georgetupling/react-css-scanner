import ts from "typescript";

import { collectDeclarations } from "./declarations.js";
import { applyExportEvidenceToDeclarations, collectExports } from "./exports.js";
import { collectImports } from "./imports.js";
import type { SourceModuleSyntaxFacts } from "./types.js";

export type {
  SourceDeclarationSyntaxIndex,
  SourceExportSyntaxRecord,
  SourceImportSyntaxKind,
  SourceImportLoading,
  SourceImportSyntaxName,
  SourceImportSyntaxRecord,
  SourceModuleSyntaxFacts,
} from "./types.js";

export function collectSourceModuleSyntax(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
}): SourceModuleSyntaxFacts {
  const declarations = collectDeclarations(input.sourceFile);
  const exports = collectExports(input.filePath, input.sourceFile);
  applyExportEvidenceToDeclarations(declarations, exports);

  return {
    imports: collectImports(input.filePath, input.sourceFile),
    exports,
    declarations,
  };
}
