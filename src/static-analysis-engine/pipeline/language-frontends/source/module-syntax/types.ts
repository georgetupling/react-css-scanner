import type ts from "typescript";

export type SourceModuleSyntaxFacts = {
  imports: SourceImportSyntaxRecord[];
  exports: SourceExportSyntaxRecord[];
  declarations: SourceDeclarationSyntaxIndex;
};

export type SourceImportSyntaxKind = "source" | "css" | "external-css" | "type-only" | "unknown";

export type SourceImportSyntaxName = {
  kind: "default" | "named" | "namespace";
  importedName: string;
  localName: string;
  typeOnly: boolean;
};

export type SourceImportSyntaxRecord = {
  filePath: string;
  specifier: string;
  importKind: SourceImportSyntaxKind;
  importNames: SourceImportSyntaxName[];
};

export type SourceExportSyntaxRecord = {
  filePath: string;
  exportedName: string;
  sourceExportedName?: string;
  localName?: string;
  specifier?: string;
  reexportKind?: "named" | "namespace" | "star";
  typeOnly: boolean;
  declarationKind: "type" | "value" | "unknown";
};

export type SourceValueDeclaration =
  | {
      kind: "const" | "let" | "var";
      name: string;
      node: ts.VariableDeclaration;
      initializer?: ts.Expression;
    }
  | { kind: "function"; name: string; node: ts.FunctionDeclaration }
  | { kind: "class"; name: string; node: ts.ClassDeclaration }
  | { kind: "enum" | "const-enum"; name: string; node: ts.EnumDeclaration }
  | { kind: "namespace"; name: string; node: ts.ModuleDeclaration };

export type SourceDeclarationSyntaxIndex = {
  typeAliases: Map<string, ts.TypeAliasDeclaration>;
  interfaces: Map<string, ts.InterfaceDeclaration>;
  valueDeclarations: Map<string, SourceValueDeclaration>;
  exportedLocalNames: Map<string, string>;
  reExports: SourceExportSyntaxRecord[];
};
