import type { AnalysisTrace } from "../../types/analysis.js";
import type { EngineModuleId, EngineSymbolId, SourceAnchor } from "../../types/core.js";

export type SymbolKind =
  | "component"
  | "function"
  | "class"
  | "constant"
  | "variable"
  | "enum"
  | "namespace"
  | "type-alias"
  | "interface"
  | "prop"
  | "imported-binding"
  | "css-resource"
  | "unknown";

export type SymbolSpace = "value" | "type";

export type ScopeKind = "module" | "function" | "block" | "parameter" | "catch";

export type ScopeId = string;

export type SourceScope = {
  id: ScopeId;
  filePath: string;
  kind: ScopeKind;
  parentScopeId?: ScopeId;
  range: SourceAnchor;
  declaredSymbolIds: EngineSymbolId[];
  childScopeIds: ScopeId[];
};

export type SymbolReference = {
  filePath: string;
  localName: string;
  location: SourceAnchor;
  symbolSpace: SymbolSpace;
  scopeId?: ScopeId;
  resolvedSymbolId?: EngineSymbolId;
  reason?: SymbolResolutionReason;
};

export type LocalAliasResolution =
  | {
      kind: "resolved-alias";
      sourceFilePath: string;
      sourceSymbolId: EngineSymbolId;
      targetSymbolId: EngineSymbolId;
      aliasKind: "identifier" | "object-destructuring";
      location: SourceAnchor;
      memberName?: string;
    }
  | {
      kind: "unresolved-alias";
      sourceFilePath: string;
      sourceSymbolId?: EngineSymbolId;
      aliasKind: "identifier" | "object-destructuring";
      location: SourceAnchor;
      memberName?: string;
      reason: SymbolResolutionReason;
    };

export type EngineSymbol = {
  id: EngineSymbolId;
  moduleId: EngineModuleId;
  kind: SymbolKind;
  symbolSpace: SymbolSpace;
  localName: string;
  scopeId: ScopeId;
  exportedNames: string[];
  declaration: SourceAnchor;
  resolution:
    | { kind: "local" }
    | {
        kind: "imported";
        targetSymbolId?: EngineSymbolId;
        targetModuleId?: EngineModuleId;
        traces?: AnalysisTrace[];
      }
    | { kind: "synthetic" }
    | { kind: "unresolved"; reason: SymbolResolutionReason; traces?: AnalysisTrace[] };
  metadata?: Record<string, unknown>;
};

export type SymbolResolutionReason =
  | "target-module-not-found"
  | "export-not-found"
  | "not-a-type-symbol"
  | "binding-not-found"
  | "external-module"
  | "budget-exceeded"
  | "cycle-detected"
  | "ambiguous-star-export"
  | "unsupported-import-form"
  | "unsupported-css-module-binding"
  | "computed-css-module-member"
  | "computed-css-module-destructuring"
  | "nested-css-module-destructuring"
  | "rest-css-module-destructuring"
  | "reassignable-css-module-alias"
  | "self-referential-css-module-alias"
  | "unresolved-imported-binding"
  | "unsupported-local-alias"
  | "nested-local-destructuring"
  | "rest-local-destructuring"
  | "self-referential-local-alias";

export type ResolvedProjectExport = {
  targetModuleId: EngineModuleId;
  targetFilePath: string;
  targetExportName: string;
  targetSymbolId?: EngineSymbolId;
};

export type ResolvedImportedBinding = {
  localName: string;
  importedName: string;
  targetModuleId: EngineModuleId;
  targetFilePath: string;
  targetExportName: string;
  targetSymbolId?: EngineSymbolId;
  traces: AnalysisTrace[];
};

export type ResolvedTypeBinding = {
  localName: string;
  targetModuleId: EngineModuleId;
  targetFilePath: string;
  targetTypeName: string;
  targetSymbolId?: EngineSymbolId;
  traces: AnalysisTrace[];
};

export type ResolvedNamespaceMemberResult =
  | {
      kind: "resolved";
      target: ResolvedProjectExport;
    }
  | {
      kind: "unresolved";
      reason: SymbolResolutionReason;
      traces?: AnalysisTrace[];
    };

export type ResolvedNamespaceImport = {
  localName: string;
  localSymbolId?: EngineSymbolId;
  members: Map<string, ResolvedNamespaceMemberResult>;
  traces: AnalysisTrace[];
};

export type ResolvedCssModuleImport = {
  sourceFilePath: string;
  stylesheetFilePath: string;
  specifier: string;
  localName: string;
  importKind: "default" | "namespace" | "named";
};

export type ResolvedCssModuleNamespaceBinding = {
  sourceFilePath: string;
  stylesheetFilePath: string;
  specifier: string;
  localName: string;
  originLocalName: string;
  importKind: "default" | "namespace";
  sourceKind: "import" | "alias";
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type ResolvedCssModuleMemberBinding = {
  sourceFilePath: string;
  stylesheetFilePath: string;
  specifier: string;
  localName: string;
  originLocalName: string;
  memberName: string;
  sourceKind: "destructured-binding";
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type ResolvedCssModuleMemberReference = {
  sourceFilePath: string;
  stylesheetFilePath: string;
  specifier: string;
  localName: string;
  originLocalName: string;
  memberName: string;
  accessKind: "property" | "string-literal-element" | "destructured-binding";
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type ResolvedCssModuleBindingDiagnostic = {
  sourceFilePath: string;
  stylesheetFilePath: string;
  specifier: string;
  localName: string;
  originLocalName: string;
  reason:
    | "computed-css-module-member"
    | "computed-css-module-destructuring"
    | "nested-css-module-destructuring"
    | "rest-css-module-destructuring"
    | "reassignable-css-module-alias"
    | "self-referential-css-module-alias";
  location: SourceAnchor;
  rawExpressionText: string;
  traces: AnalysisTrace[];
};

export type ResolvedCssModuleMemberAccessResult =
  | {
      kind: "resolved";
      reference: ResolvedCssModuleMemberReference;
    }
  | {
      kind: "unresolved";
      reason: SymbolResolutionReason;
      traces?: AnalysisTrace[];
    };

export type ProjectBindingResolution = {
  symbols: Map<EngineSymbolId, EngineSymbol>;
  scopes: Map<ScopeId, SourceScope>;
};
