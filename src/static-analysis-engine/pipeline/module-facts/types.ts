import type ts from "typescript";
import type { EngineModuleId, EngineSymbolId } from "../../types/core.js";

export type ModuleFactsImportKind = "source" | "css" | "external-css" | "type-only" | "unknown";

export type ModuleFactsImportName = {
  kind: "default" | "named" | "namespace";
  importedName: string;
  localName: string;
  typeOnly: boolean;
};

export type ModuleFactsImportRecord = {
  filePath: string;
  specifier: string;
  importKind: ModuleFactsImportKind;
  importNames: ModuleFactsImportName[];
};

export type ModuleFactsCssSemantics = "global" | "module";

export type ResolvedModuleImportFact = {
  specifier: string;
  importKind: ModuleFactsImportKind;
  cssSemantics?: ModuleFactsCssSemantics;
  importedBindings: Array<{
    importedName: string;
    localName: string;
    bindingKind: "default" | "named" | "namespace";
    typeOnly: boolean;
    localBindingId: EngineSymbolId;
  }>;
  resolution: {
    status: "resolved" | "unresolved" | "external" | "unsupported";
    resolvedFilePath?: string;
    resolvedModuleId?: EngineModuleId;
    confidence?: ModuleFactsConfidence;
    reason?: string;
  };
};

export type ModuleFactsExportRecord = {
  filePath: string;
  exportedName: string;
  sourceExportedName?: string;
  localName?: string;
  specifier?: string;
  reexportKind?: "named" | "namespace" | "star";
  typeOnly: boolean;
  declarationKind: "type" | "value" | "unknown";
};

export type ResolvedModuleExportFact = {
  exportedName: string;
  sourceExportedName?: string;
  localName?: string;
  localBindingId?: EngineSymbolId;
  exportKind: "local" | "re-export" | "export-all" | "default-expression";
  declarationKind: "type" | "value" | "unknown";
  typeOnly: boolean;
  reexportKind?: "named" | "namespace" | "star";
  reexport: {
    status: "resolved" | "unresolved" | "none";
    specifier?: string;
    resolvedFilePath?: string;
    resolvedModuleId?: EngineModuleId;
    confidence?: ModuleFactsConfidence;
    reason?: string;
  };
};

export type ModuleFactsValueDeclaration =
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
    }
  | {
      kind: "enum" | "const-enum";
      name: string;
      node: ts.EnumDeclaration;
    }
  | {
      kind: "namespace";
      name: string;
      node: ts.ModuleDeclaration;
    };

export type ModuleFactsDeclarationIndex = {
  typeAliases: Map<string, ts.TypeAliasDeclaration>;
  interfaces: Map<string, ts.InterfaceDeclaration>;
  valueDeclarations: Map<string, ModuleFactsValueDeclaration>;
  exportedLocalNames: Map<string, string>;
  reExports: ModuleFactsExportRecord[];
};

export type ResolvedTopLevelBindingFact = {
  localName: string;
  bindingId: EngineSymbolId;
  bindingKind:
    | "import-default"
    | "import-named"
    | "import-namespace"
    | "function"
    | "variable"
    | "class"
    | "enum"
    | "namespace";
};

export type ModuleFactsStatus =
  | "resolved"
  | "not-found"
  | "ambiguous"
  | "unsupported"
  | "cycle"
  | "budget-exceeded";

export type ModuleFactsConfidence = "exact" | "heuristic";

export type ModuleFactsCacheEntry<T> = {
  status: ModuleFactsStatus;
  confidence?: ModuleFactsConfidence;
  value?: T;
  reason?: string;
};

export type ModuleFactsCaches = {
  moduleSpecifiers: Map<string, ModuleFactsCacheEntry<string>>;
  importedBindings: Map<string, ModuleFactsCacheEntry<unknown>>;
  finiteTypeEvidence: Map<string, ModuleFactsCacheEntry<readonly string[]>>;
};

export type ModuleFactsTypescriptResolution = {
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

export type ResolvedModuleFacts = {
  filePath: string;
  moduleId: EngineModuleId;
  moduleKind: "source";
  imports: ResolvedModuleImportFact[];
  exports: ResolvedModuleExportFact[];
  topLevelBindings: ResolvedTopLevelBindingFact[];
};

export type ModuleFacts = {
  resolvedModuleFactsByFilePath: Map<string, ResolvedModuleFacts>;
};

export type ModuleFactsStore = ModuleFacts & {
  parsedSourceFilesByFilePath: Map<string, ts.SourceFile>;
  importsByFilePath: Map<string, ModuleFactsImportRecord[]>;
  exportsByFilePath: Map<string, ModuleFactsExportRecord[]>;
  declarationsByFilePath: Map<string, ModuleFactsDeclarationIndex>;
  workspacePackageEntryPointsByPackageName: Map<string, WorkspacePackageEntryPoint[]>;
  typescriptResolution?: ModuleFactsTypescriptResolution;
  caches: ModuleFactsCaches;
};
