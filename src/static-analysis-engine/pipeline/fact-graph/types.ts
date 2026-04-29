import type { AnalysisConfidence, AnalysisSeverity, AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type { CssAtRuleContextFact, CssStyleRuleFact } from "../../types/css.js";
import type { LanguageFrontendsResult } from "../language-frontends/index.js";
import type { ExtractedSelectorQuery } from "../selector-analysis/index.js";
import type { ProjectSnapshot } from "../workspace-discovery/index.js";

export type FactGraphInput = {
  snapshot: ProjectSnapshot;
  frontends: LanguageFrontendsResult;
  includeTraces?: boolean;
};

export type FactGraphResult = {
  snapshot: ProjectSnapshot;
  frontends: LanguageFrontendsResult;
  graph: FactGraph;
};

export type FactGraph = {
  meta: FactGraphMeta;
  nodes: FactGraphNodes;
  edges: FactGraphEdges;
  indexes: FactGraphIndexes;
  diagnostics: FactGraphDiagnostic[];
};

export type FactGraphMeta = {
  rootDir: string;
  sourceFileCount: number;
  stylesheetCount: number;
  htmlFileCount: number;
  generatedAtStage: "fact-graph";
};

export type FactNodeId = string;
export type FactEdgeId = string;

export type FactNodeKind =
  | "file-resource"
  | "external-resource"
  | "module"
  | "component"
  | "render-site"
  | "element-template"
  | "class-expression-site"
  | "stylesheet"
  | "rule-definition"
  | "selector"
  | "selector-branch"
  | "owner-candidate";

export type FactEdgeKind =
  | "imports"
  | "renders"
  | "contains"
  | "references-class-expression"
  | "defines-selector"
  | "originates-from-file"
  | "belongs-to-owner-candidate";

export type FactGraphNodes = {
  all: FactNode[];
  modules: ModuleNode[];
  components: ComponentNode[];
  renderSites: RenderSiteNode[];
  elementTemplates: ElementTemplateNode[];
  classExpressionSites: ClassExpressionSiteNode[];
  stylesheets: StyleSheetNode[];
  ruleDefinitions: RuleDefinitionNode[];
  selectors: SelectorNode[];
  selectorBranches: SelectorBranchNode[];
  ownerCandidates: OwnerCandidateNode[];
  files: FileResourceNode[];
  externalResources: ExternalResourceNode[];
};

export type FactGraphEdges = {
  all: FactEdge[];
  imports: ImportsEdge[];
  renders: RendersEdge[];
  contains: ContainsEdge[];
  referencesClassExpression: ReferencesClassExpressionEdge[];
  definesSelector: DefinesSelectorEdge[];
  originatesFromFile: OriginatesFromFileEdge[];
  belongsToOwnerCandidate: BelongsToOwnerCandidateEdge[];
};

export type FactProvenance = {
  stage: "workspace-discovery" | "language-frontends" | "fact-graph";
  filePath?: string;
  anchor?: SourceAnchor;
  upstreamId?: string;
  summary: string;
  traces?: AnalysisTrace[];
};

export type FactNodeBase = {
  id: FactNodeId;
  kind: FactNodeKind;
  provenance: FactProvenance[];
  confidence: AnalysisConfidence;
};

export type FactEdgeBase = {
  id: FactEdgeId;
  kind: FactEdgeKind;
  from: FactNodeId;
  to: FactNodeId;
  provenance: FactProvenance[];
  confidence: AnalysisConfidence;
};

export type FileResourceNode = FactNodeBase & {
  kind: "file-resource";
  filePath: string;
  absolutePath?: string;
  fileKind: "source" | "stylesheet" | "html" | "config";
};

export type ExternalResourceNode = FactNodeBase & {
  kind: "external-resource";
  specifier: string;
  resourceKind: "package" | "remote" | "unknown";
};

export type ModuleNode = FactNodeBase & {
  kind: "module";
  filePath: string;
  absolutePath?: string;
  moduleKind: "source";
  languageKind: "js" | "jsx" | "ts" | "tsx";
  moduleId?: string;
};

export type ComponentNode = FactNodeBase & {
  kind: "component";
};

export type RenderSiteNode = FactNodeBase & {
  kind: "render-site";
};

export type ElementTemplateNode = FactNodeBase & {
  kind: "element-template";
};

export type ClassExpressionSiteNode = FactNodeBase & {
  kind: "class-expression-site";
};

export type StyleSheetNode = FactNodeBase & {
  kind: "stylesheet";
  filePath?: string;
  absolutePath?: string;
  cssKind: "global-css" | "css-module";
  origin: "project" | "html-linked" | "package" | "remote";
};

export type RuleDefinitionNode = FactNodeBase & {
  kind: "rule-definition";
  stylesheetNodeId: FactNodeId;
  filePath?: string;
  selectorText: string;
  declarationProperties: string[];
  declarationSignature: string;
  line: number;
  atRuleContext: CssAtRuleContextFact[];
  location?: SourceAnchor;
  sourceRule: CssStyleRuleFact;
};

export type SelectorNode = FactNodeBase & {
  kind: "selector";
  stylesheetNodeId?: FactNodeId;
  ruleDefinitionNodeId?: FactNodeId;
  selectorText: string;
  selectorListText: string;
  sourceKind: "css-rule" | "direct-query";
  location?: SourceAnchor;
};

export type SelectorBranchNode = FactNodeBase & {
  kind: "selector-branch";
  selectorNodeId: FactNodeId;
  stylesheetNodeId?: FactNodeId;
  ruleDefinitionNodeId?: FactNodeId;
  selectorText: string;
  selectorListText: string;
  branchIndex: number;
  branchCount: number;
  ruleKey: string;
  requiredClassNames: string[];
  subjectClassNames: string[];
  contextClassNames: string[];
  negativeClassNames: string[];
  matchKind: "standalone" | "compound" | "contextual" | "complex";
  hasUnknownSemantics: boolean;
  atRuleContext: Array<{ kind: "media"; queryText: string }>;
  location?: SourceAnchor;
  sourceQuery: ExtractedSelectorQuery;
};

export type OwnerCandidateNode = FactNodeBase & {
  kind: "owner-candidate";
};

export type FactNode =
  | FileResourceNode
  | ExternalResourceNode
  | ModuleNode
  | ComponentNode
  | RenderSiteNode
  | ElementTemplateNode
  | ClassExpressionSiteNode
  | StyleSheetNode
  | RuleDefinitionNode
  | SelectorNode
  | SelectorBranchNode
  | OwnerCandidateNode;

export type ImportsEdge = FactEdgeBase & {
  kind: "imports";
};

export type RendersEdge = FactEdgeBase & {
  kind: "renders";
};

export type ContainsEdgeContainmentKind =
  | "stylesheet-rule"
  | "rule-selector"
  | "selector-branch"
  | "module-component"
  | "component-render-site"
  | "render-site-element-template"
  | "render-site-child-site";

export type ContainsEdge = FactEdgeBase & {
  kind: "contains";
  containmentKind: ContainsEdgeContainmentKind;
};

export type ReferencesClassExpressionEdge = FactEdgeBase & {
  kind: "references-class-expression";
};

export type DefinesSelectorEdge = FactEdgeBase & {
  kind: "defines-selector";
};

export type OriginatesFromFileEdge = FactEdgeBase & {
  kind: "originates-from-file";
};

export type BelongsToOwnerCandidateEdge = FactEdgeBase & {
  kind: "belongs-to-owner-candidate";
};

export type FactEdge =
  | ImportsEdge
  | RendersEdge
  | ContainsEdge
  | ReferencesClassExpressionEdge
  | DefinesSelectorEdge
  | OriginatesFromFileEdge
  | BelongsToOwnerCandidateEdge;

export type FactGraphIndexes = {
  nodesById: Map<FactNodeId, FactNode>;
  edgesById: Map<FactEdgeId, FactEdge>;
  fileNodeIdByPath: Map<string, FactNodeId>;
  moduleNodeIdByFilePath: Map<string, FactNodeId>;
  stylesheetNodeIdByFilePath: Map<string, FactNodeId>;
  ruleDefinitionNodeIdsByStylesheetNodeId: Map<FactNodeId, FactNodeId[]>;
  selectorNodeIdsByStylesheetNodeId: Map<FactNodeId, FactNodeId[]>;
  selectorBranchNodeIdsByStylesheetNodeId: Map<FactNodeId, FactNodeId[]>;
  selectorBranchNodeIdsByRequiredClassName: Map<string, FactNodeId[]>;
};

export type FactGraphDiagnostic = {
  stage: "fact-graph";
  severity: AnalysisSeverity;
  code: "duplicate-graph-id" | "unresolved-graph-edge-target";
  message: string;
  filePath?: string;
  location?: SourceAnchor;
  provenance: FactProvenance[];
};
