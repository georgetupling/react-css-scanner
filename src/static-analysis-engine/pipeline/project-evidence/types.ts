import type { AnalysisTrace } from "../../types/analysis.js";
import type { FactNodeId } from "../fact-graph/index.js";
import type {
  ClassContextAnalysis,
  ClassDefinitionAnalysis,
  ClassReferenceAnalysis,
  ClassReferenceMatchRelation,
  ComponentAnalysis,
  ComponentRenderRelation,
  CssModuleAliasAnalysis,
  CssModuleDestructuredBindingAnalysis,
  CssModuleImportAnalysis,
  CssModuleMemberMatchRelation,
  CssModuleMemberReferenceAnalysis,
  CssModuleReferenceDiagnosticAnalysis,
  ModuleImportRelation,
  ProjectEvidenceId,
  ProviderClassSatisfactionRelation,
  ProviderBackedStylesheetRelation,
  RenderSubtreeAnalysis,
  SelectorBranchAnalysis,
  SelectorMatchRelation,
  SelectorQueryAnalysis,
  SourceFileAnalysis,
  StaticallySkippedClassReferenceAnalysis,
  StylesheetAnalysis,
  StylesheetReachabilityRelation,
  UnsupportedClassReferenceAnalysis,
} from "./analysisTypes.js";

export type ProjectEvidenceDiagnosticId = string;

export type ProjectEvidenceAssemblyResult = {
  meta: ProjectEvidenceAssemblyMeta;
  entities: ProjectEvidenceEntities;
  relations: ProjectEvidenceRelations;
  diagnostics: ProjectEvidenceDiagnostic[];
  indexes: ProjectEvidenceIndexes;
};

export type ProjectEvidenceAssemblyMeta = {
  generatedAtStage: "project-evidence-assembly";
  sourceFileCount: number;
  componentCount: number;
  stylesheetCount: number;
  classDefinitionCount: number;
  classReferenceCount: number;
  relationCount: number;
  diagnosticCount: number;
};

export type ProjectEvidenceEntities = {
  sourceFiles: SourceFileAnalysis[];
  stylesheets: StylesheetAnalysis[];
  components: ComponentAnalysis[];
  renderSubtrees: RenderSubtreeAnalysis[];
  classDefinitions: ClassDefinitionAnalysis[];
  classContexts: ClassContextAnalysis[];
  classReferences: ClassReferenceAnalysis[];
  staticallySkippedClassReferences: StaticallySkippedClassReferenceAnalysis[];
  selectorQueries: SelectorQueryAnalysis[];
  selectorBranches: SelectorBranchAnalysis[];
  unsupportedClassReferences: UnsupportedClassReferenceAnalysis[];
  cssModuleImports: CssModuleImportAnalysis[];
  cssModuleAliases: CssModuleAliasAnalysis[];
  cssModuleDestructuredBindings: CssModuleDestructuredBindingAnalysis[];
  cssModuleMemberReferences: CssModuleMemberReferenceAnalysis[];
  cssModuleReferenceDiagnostics: CssModuleReferenceDiagnosticAnalysis[];
};

export type ProjectEvidenceRelations = {
  moduleImports: ModuleImportRelation[];
  componentRenders: ComponentRenderRelation[];
  stylesheetReachability: StylesheetReachabilityRelation[];
  referenceMatches: ClassReferenceMatchRelation[];
  selectorMatches: SelectorMatchRelation[];
  providerClassSatisfactions: ProviderClassSatisfactionRelation[];
  providerBackedStylesheets: ProviderBackedStylesheetRelation[];
  cssModuleMemberMatches: CssModuleMemberMatchRelation[];
};

export type ProjectEvidenceDiagnostic = {
  id: ProjectEvidenceDiagnosticId;
  targetKind: ProjectEvidenceDiagnosticTargetKind;
  targetId?: ProjectEvidenceId | FactNodeId;
  severity: "debug" | "warning";
  code: ProjectEvidenceDiagnosticCode;
  message: string;
  traces: AnalysisTrace[];
};

export type ProjectEvidenceDiagnosticTargetKind =
  | "project"
  | "source-file"
  | "stylesheet"
  | "class-reference"
  | "class-definition"
  | "selector-branch";

export type ProjectEvidenceDiagnosticCode =
  | "missing-project-evidence"
  | "contradictory-project-evidence";

export type ProjectEvidenceIndexes = {
  sourceFilesById: Map<ProjectEvidenceId, SourceFileAnalysis>;
  sourceFileIdByPath: Map<string, ProjectEvidenceId>;
  stylesheetsById: Map<ProjectEvidenceId, StylesheetAnalysis>;
  stylesheetIdByPath: Map<string, ProjectEvidenceId>;
  componentsById: Map<ProjectEvidenceId, ComponentAnalysis>;
  componentIdsBySourceFileId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  classDefinitionsById: Map<ProjectEvidenceId, ClassDefinitionAnalysis>;
  classDefinitionIdsByClassName: Map<string, ProjectEvidenceId[]>;
  classDefinitionIdsByStylesheetId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  classReferencesById: Map<ProjectEvidenceId, ClassReferenceAnalysis>;
  classReferenceIdsByClassName: Map<string, ProjectEvidenceId[]>;
  classReferenceIdsBySourceFileId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  classReferenceMatchIdsByDefinitionId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  classReferenceMatchIdsByReferenceId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  stylesheetReachabilityIdsByStylesheetId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  selectorBranchIdsByStylesheetId: Map<ProjectEvidenceId, ProjectEvidenceId[]>;
  diagnosticById: Map<ProjectEvidenceDiagnosticId, ProjectEvidenceDiagnostic>;
  diagnosticsByTargetId: Map<ProjectEvidenceId | FactNodeId, ProjectEvidenceDiagnosticId[]>;
};
