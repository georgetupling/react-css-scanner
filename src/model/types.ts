import type { ResolvedReactCssScannerConfig } from "../config/types.js";
import type {
  ClassReferenceFact,
  CssClassDefinitionFact,
  CssFileFact,
  CssModuleImportFact,
  ExternalCssFact,
  ProjectFactExtractionResult,
  SourceImportFact,
} from "../facts/types.js";

export type CssOwnership =
  | "component"
  | "page"
  | "global"
  | "utility"
  | "external"
  | "unclassified";

export type CssResourceCategory = "local" | "global" | "external";

export type SourceFileNode = {
  path: string;
  sourceImports: SourceImportFact[];
  cssImports: SourceImportFact[];
  externalCssImports: SourceImportFact[];
  cssModuleImports: CssModuleImportFact[];
  classReferences: ClassReferenceFact[];
  helperImports: string[];
};

export type CssFileNode = {
  path: string;
  category: CssResourceCategory;
  ownership: CssOwnership;
  classDefinitions: CssClassDefinitionFact[];
  imports: CssFileFact["imports"];
};

export type ExternalCssResourceNode = {
  specifier: string;
  resolvedPath: string;
  importedBy: string[];
  category: "external";
  ownership: "external";
  classDefinitions: CssClassDefinitionFact[];
  imports: ExternalCssFact["imports"];
};

export type ProjectGraphEdgeType =
  | "source-import"
  | "css-import"
  | "external-css-import"
  | "css-module-import"
  | "class-definition"
  | "class-reference";

export type ProjectGraphEdge = {
  type: ProjectGraphEdgeType;
  from: string;
  to: string;
  metadata?: Record<string, unknown>;
};

export type ProjectGraph = {
  sourceFiles: SourceFileNode[];
  cssFiles: CssFileNode[];
  externalCssResources: ExternalCssResourceNode[];
  edges: ProjectGraphEdge[];
};

export type ProjectIndexes = {
  sourceFileByPath: Map<string, SourceFileNode>;
  cssFileByPath: Map<string, CssFileNode>;
  externalCssBySpecifier: Map<string, ExternalCssResourceNode>;
  classDefinitionsByName: Map<
    string,
    Array<{
      cssFile: string;
      externalSpecifier?: string;
      ownership: CssOwnership;
      category: CssResourceCategory;
      definition: CssClassDefinitionFact;
    }>
  >;
  classReferencesByName: Map<
    string,
    Array<{
      sourceFile: string;
      reference: ClassReferenceFact;
    }>
  >;
  reachabilityBySourceFile: Map<string, ReachabilityInfo>;
  cssModuleImportsBySourceFile: Map<string, CssModuleImportFact[]>;
};

export type ReachabilityInfo = {
  localCss: Set<string>;
  globalCss: Set<string>;
  externalCss: Set<string>;
};

export type ProjectModel = {
  config: ResolvedReactCssScannerConfig;
  facts: ProjectFactExtractionResult;
  graph: ProjectGraph;
  indexes: ProjectIndexes;
  reachability: Map<string, ReachabilityInfo>;
};

export type BuildProjectModelInput = {
  config: ResolvedReactCssScannerConfig;
  facts: ProjectFactExtractionResult;
};
