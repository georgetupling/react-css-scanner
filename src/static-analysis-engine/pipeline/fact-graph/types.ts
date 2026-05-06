import type { AnalysisConfidence, AnalysisSeverity, AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type { CssAtRuleContextFact, CssStyleRuleFact } from "../../types/css.js";
import type { ExtractedSelectorQuery } from "../../libraries/selector-parsing/queryTypes.js";
import type { LanguageFrontendsResult } from "../language-frontends/index.js";
import type { SourceExpressionSyntaxFact } from "../language-frontends/source/expression-syntax/index.js";
import type {
  ReactComponentPropBindingFact,
  ReactHelperDefinitionFact,
  ReactLocalValueBindingFact,
} from "../language-frontends/source/react-syntax/index.js";
import type { RuntimeDomLibraryHint } from "../language-frontends/types.js";
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
  | "render-prop-invocation"
  | "expression-syntax"
  | "component-prop-binding"
  | "local-value-binding"
  | "helper-definition"
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
  renderPropInvocations: RenderPropInvocationNode[];
  expressionSyntax: ExpressionSyntaxNode[];
  componentPropBindings: ComponentPropBindingNode[];
  localValueBindings: LocalValueBindingNode[];
  helperDefinitions: HelperDefinitionNode[];
  stylesheets: StyleSheetNode[];
  ruleDefinitions: RuleDefinitionNode[];
  selectors: SelectorNode[];
  selectorBranches: SelectorBranchNode[];
  ownerCandidates: OwnerCandidateNode[];
  files: FileResourceNode[];
  externalResources: ExternalResourceNode[];
};

export type FactImportKind = "source" | "css" | "external-css" | "type-only" | "unknown";
export type FactImportLoading = "static" | "dynamic";
export type FactImportResolutionStatus = "resolved" | "unresolved" | "external" | "unsupported";
export type FactCssSemantics = "global" | "module";

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
  componentKey: string;
  componentName: string;
  filePath: string;
  exported: boolean;
  declarationKind: "function" | "variable" | "class";
  location: SourceAnchor;
  rendersChildrenProp?: boolean;
  renderedPropNames?: string[];
};

export type RenderSiteNode = FactNodeBase & {
  kind: "render-site";
  renderSiteKey: string;
  renderSiteKind:
    | "component-root"
    | "jsx-element"
    | "component-reference"
    | "jsx-fragment"
    | "conditional"
    | "helper-return";
  filePath: string;
  location: SourceAnchor;
  emittingComponentNodeId?: FactNodeId;
  placementComponentNodeId?: FactNodeId;
  parentRenderSiteNodeId?: FactNodeId;
  parentRenderRelation?: "jsx-child" | "jsx-attribute-expression" | "nested-render-expression";
  parentRenderAttributeName?: string;
  callbackPropName?: string;
  callbackParameterNames?: string[];
  repeatedRegion?: {
    repeatKind: "array-map" | "array-from";
    sourceText: string;
    sourceLocation: SourceAnchor;
    callbackParameterNames?: string[];
    certainty: "possible" | "unknown";
    mayHaveMultipleIterations?: boolean;
  };
  conditionExpressionId?: string;
  conditionSourceText?: string;
};

export type ElementTemplateNode = FactNodeBase & {
  kind: "element-template";
  templateKey: string;
  templateKind: "intrinsic" | "component-candidate" | "fragment";
  name: string;
  filePath: string;
  location: SourceAnchor;
  renderSiteNodeId: FactNodeId;
  emittingComponentNodeId?: FactNodeId;
  placementComponentNodeId?: FactNodeId;
  resolvedComponentNodeId?: FactNodeId;
};

export type ClassExpressionSiteNode = FactNodeBase & {
  kind: "class-expression-site";
  classExpressionSiteKey: string;
  classExpressionSiteKind:
    | "jsx-class"
    | "component-prop-class"
    | "css-module-member"
    | "runtime-dom-class";
  filePath: string;
  location: SourceAnchor;
  expressionId: string;
  expressionNodeId: FactNodeId;
  rawExpressionText: string;
  runtimeDomClassText?: string;
  runtimeDomLibraryHint?: RuntimeDomLibraryHint;
  componentPropName?: string;
  emittingComponentNodeId?: FactNodeId;
  placementComponentNodeId?: FactNodeId;
  renderSiteNodeId?: FactNodeId;
  elementTemplateNodeId?: FactNodeId;
};

export type RenderPropInvocationNode = FactNodeBase & {
  kind: "render-prop-invocation";
  invocationKey: string;
  componentNodeId: FactNodeId;
  propName: string;
  filePath: string;
  location: SourceAnchor;
  argumentExpressionNodeIds: FactNodeId[];
};

export type ExpressionSyntaxNode = FactNodeBase &
  SourceExpressionSyntaxFact & {
    kind: "expression-syntax";
  };

export type ComponentPropBindingNode = FactNodeBase &
  ReactComponentPropBindingFact & {
    kind: "component-prop-binding";
    componentNodeId: FactNodeId;
  };

export type LocalValueBindingNode = FactNodeBase &
  ReactLocalValueBindingFact & {
    kind: "local-value-binding";
    ownerNodeId: FactNodeId;
    expressionNodeId?: FactNodeId;
    objectExpressionNodeId?: FactNodeId;
    initializerExpressionNodeId?: FactNodeId;
  };

export type HelperDefinitionNode = FactNodeBase &
  ReactHelperDefinitionFact & {
    kind: "helper-definition";
    ownerNodeId: FactNodeId;
    returnExpressionNodeId?: FactNodeId;
    returnExpressionNodeIds?: FactNodeId[];
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
  hasDescendantClassNames: string[];
  matchKind: "standalone" | "compound" | "contextual" | "complex";
  hasUnknownSemantics: boolean;
  atRuleContext: Array<{ kind: "media"; queryText: string }>;
  location?: SourceAnchor;
  sourceQuery: ExtractedSelectorQuery;
};

export type OwnerCandidateNode = FactNodeBase & {
  kind: "owner-candidate";
  ownerCandidateKind: "component" | "source-file" | "directory" | "workspace-package";
  ownerKey: string;
  displayName: string;
  seedReason: string;
};

export type FactNode =
  | FileResourceNode
  | ExternalResourceNode
  | ModuleNode
  | ComponentNode
  | RenderSiteNode
  | ElementTemplateNode
  | ClassExpressionSiteNode
  | RenderPropInvocationNode
  | ExpressionSyntaxNode
  | ComponentPropBindingNode
  | LocalValueBindingNode
  | HelperDefinitionNode
  | StyleSheetNode
  | RuleDefinitionNode
  | SelectorNode
  | SelectorBranchNode
  | OwnerCandidateNode;

export type ImportsEdge = FactEdgeBase & {
  kind: "imports";
  importerKind: "source" | "stylesheet";
  importerFilePath: string;
  importKind: FactImportKind;
  importLoading: FactImportLoading;
  specifier: string;
  resolutionStatus: FactImportResolutionStatus;
  cssSemantics?: FactCssSemantics;
  resolvedFilePath?: string;
  resolvedTargetNodeId?: string;
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
  | "render-site-child-site"
  | "component-render-prop-invocation"
  | "component-prop-binding"
  | "module-local-value-binding"
  | "component-local-value-binding"
  | "component-helper-definition"
  | "helper-local-value-binding"
  | "helper-nested-helper-definition"
  | "module-helper-definition";

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
  componentNodeIdByComponentKey: Map<string, FactNodeId>;
  componentNodeIdsByFilePath: Map<string, FactNodeId[]>;
  renderSiteNodeIdByRenderSiteKey: Map<string, FactNodeId>;
  renderSiteNodeIdsByComponentNodeId: Map<FactNodeId, FactNodeId[]>;
  elementTemplateNodeIdByTemplateKey: Map<string, FactNodeId>;
  classExpressionSiteNodeIdBySiteKey: Map<string, FactNodeId>;
  classExpressionSiteNodeIdsByComponentNodeId: Map<FactNodeId, FactNodeId[]>;
  expressionSyntaxNodeIdByExpressionId: Map<string, FactNodeId>;
  expressionSyntaxNodeIdsByFilePath: Map<string, FactNodeId[]>;
  componentPropBindingNodeIdByBindingKey: Map<string, FactNodeId>;
  componentPropBindingNodeIdByComponentNodeId: Map<FactNodeId, FactNodeId>;
  localValueBindingNodeIdByBindingKey: Map<string, FactNodeId>;
  localValueBindingNodeIdsByOwnerNodeId: Map<FactNodeId, FactNodeId[]>;
  helperDefinitionNodeIdByHelperKey: Map<string, FactNodeId>;
  helperDefinitionNodeIdsByOwnerNodeId: Map<FactNodeId, FactNodeId[]>;
  ownerCandidateNodeIdsByOwnerKind: Map<string, FactNodeId[]>;
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
