import type ts from "typescript";

export type ProjectResolutionImportKind =
  | "source"
  | "css"
  | "external-css"
  | "type-only"
  | "unknown";

export type ProjectResolutionImportName = {
  kind: "default" | "named" | "namespace";
  importedName: string;
  localName: string;
  typeOnly: boolean;
};

export type ProjectResolutionImportRecord = {
  filePath: string;
  specifier: string;
  importKind: ProjectResolutionImportKind;
  importNames: ProjectResolutionImportName[];
};

export type ProjectResolutionExportRecord = {
  filePath: string;
  exportedName: string;
  sourceExportedName?: string;
  localName?: string;
  specifier?: string;
  reexportKind?: "named" | "namespace" | "star";
  typeOnly: boolean;
  declarationKind: "type" | "value" | "unknown";
};

export type ProjectResolutionValueDeclaration =
  | {
      kind: "const" | "let" | "var";
      name: string;
      node: ts.VariableDeclaration;
      initializer?: ts.Expression;
    }
  | {
      kind: "function";
      name: string;
      node: ts.FunctionDeclaration;
    }
  | {
      kind: "class";
      name: string;
      node: ts.ClassDeclaration;
    };

export type ProjectResolutionFileDeclarationIndex = {
  typeAliases: Map<string, ts.TypeAliasDeclaration>;
  interfaces: Map<string, ts.InterfaceDeclaration>;
  valueDeclarations: Map<string, ProjectResolutionValueDeclaration>;
  exportedLocalNames: Map<string, string>;
  reExports: ProjectResolutionExportRecord[];
};

export type ProjectResolutionStatus =
  | "resolved"
  | "not-found"
  | "ambiguous"
  | "unsupported"
  | "cycle"
  | "budget-exceeded";

export type ProjectResolutionConfidence = "exact" | "heuristic";

export type ProjectResolutionCacheEntry<T> = {
  status: ProjectResolutionStatus;
  confidence?: ProjectResolutionConfidence;
  value?: T;
  reason?: string;
};

export type ProjectResolutionCaches = {
  moduleSpecifiers: Map<string, ProjectResolutionCacheEntry<string>>;
  importedBindings: Map<string, ProjectResolutionCacheEntry<unknown>>;
  finiteTypeEvidence: Map<string, ProjectResolutionCacheEntry<readonly string[]>>;
};

export type ProjectResolutionTypescriptResolution = {
  projectRoot: string;
  compilerOptions: ts.CompilerOptions;
  moduleResolutionHost: ts.ModuleResolutionHost;
  knownFilePathsByAbsolutePath: Map<string, string>;
};

export type WorkspacePackageEntryPoint = {
  packageName: string;
  filePath: string;
  confidence: "heuristic";
  reason: "discovered-workspace-entrypoint";
};

export type ProjectResolution = {
  parsedSourceFilesByFilePath: Map<string, ts.SourceFile>;
  importsByFilePath: Map<string, ProjectResolutionImportRecord[]>;
  exportsByFilePath: Map<string, ProjectResolutionExportRecord[]>;
  declarationsByFilePath: Map<string, ProjectResolutionFileDeclarationIndex>;
  exportedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  workspacePackageEntryPointsByPackageName: Map<string, WorkspacePackageEntryPoint[]>;
  typescriptResolution?: ProjectResolutionTypescriptResolution;
  caches: ProjectResolutionCaches;
};
