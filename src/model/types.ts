import type { ResolvedScanReactCssConfig } from "../config/types.js";
import type {
  ClassReferenceFact,
  CssClassDefinitionFact,
  CssFileFact,
  CssModuleImportFact,
  ExternalCssFact,
  ProjectFactExtractionResult,
  SourceFileFact,
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
  renderedComponents: SourceFileFact["renderedComponents"];
  helperImports: string[];
};

export type CssFileNode = {
  path: string;
  category: CssResourceCategory;
  ownership: CssOwnership;
  styleRules: CssFileFact["styleRules"];
  classDefinitions: CssClassDefinitionFact[];
  imports: CssFileFact["imports"];
};

export type ExternalCssResourceNode = {
  specifier: string;
  resolvedPath: string;
  importedBy: string[];
  category: "external";
  ownership: "external";
  styleRules: ExternalCssFact["styleRules"];
  classDefinitions: CssClassDefinitionFact[];
  imports: ExternalCssFact["imports"];
};

export type ActiveExternalCssProvider = {
  provider: string;
  match: string[];
  classPrefixes: string[];
  classNames: string[];
  matchedStylesheets: Array<{
    filePath: string;
    href: string;
    isRemote: boolean;
  }>;
};

export type ProjectGraphEdgeType =
  | "source-import"
  | "render"
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
  activeExternalCssProviders: Map<string, ActiveExternalCssProvider>;
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
  directLocalCss: Set<string>;
  importContextLocalCss: Set<string>;
  localCss: Set<string>;
  renderContextDefiniteLocalCss: Set<string>;
  renderContextPossibleLocalCss: Set<string>;
  globalCss: Set<string>;
  externalCss: Set<string>;
};

export type ProjectModel = {
  config: ResolvedScanReactCssConfig;
  facts: ProjectFactExtractionResult;
  graph: ProjectGraph;
  indexes: ProjectIndexes;
  reachability: Map<string, ReachabilityInfo>;
};

export type BuildProjectModelInput = {
  config: ResolvedScanReactCssConfig;
  facts: ProjectFactExtractionResult;
};
