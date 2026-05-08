import type { SourceAnchor } from "../../../types/core.js";
import type {
  ClassContextAnalysis,
  ClassDefinitionAnalysis,
  DeclarationForSignature,
  ProjectEvidenceId,
  SelectorQueryAnalysis,
} from "../analysisTypes.js";
import { stableHash } from "./hash.js";
import { normalizeAnchor, normalizeProjectPath } from "./normalization.js";

export function getDeclarationSignature(declarations: DeclarationForSignature[]): string {
  return declarations
    .map((declaration) => `${declaration.property}:${declaration.value}`)
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

export function createClassDefinitionId(
  stylesheetId: ProjectEvidenceId,
  definition: ClassDefinitionAnalysis["sourceDefinition"],
): ProjectEvidenceId {
  return [
    "class-definition",
    stylesheetId,
    definition.className,
    definition.line,
    stableHash(
      `${definition.selector}:${definition.atRuleContext
        .map((entry) => `${entry.name}:${entry.params}`)
        .join("|")}`,
    ),
  ].join(":");
}

export function createClassContextId(
  stylesheetId: ProjectEvidenceId,
  context: ClassContextAnalysis["sourceContext"],
): ProjectEvidenceId {
  return [
    "class-context",
    stylesheetId,
    context.className,
    context.line,
    stableHash(
      `${context.selector}:${context.atRuleContext
        .map((entry) => `${entry.name}:${entry.params}`)
        .join("|")}`,
    ),
  ].join(":");
}

export function createSelectorQueryId(input: {
  location?: SourceAnchor;
  selectorNodeId?: string;
  index: number;
  selectorText: string;
}): ProjectEvidenceId {
  const anchor = input.location;
  return anchor
    ? createAnchorId("selector-query", anchor, input.index)
    : input.selectorNodeId
      ? `selector-query:node:${stableHash(input.selectorNodeId)}`
      : `selector-query:direct:${input.index}:${stableHash(input.selectorText)}`;
}

export function createSelectorBranchId(
  selectorBranch: {
    location?: SourceAnchor;
    branchIndex: number;
    selectorBranchNodeId?: string;
    selectorQueryId: string;
  },
  index: number,
): ProjectEvidenceId {
  const anchor = selectorBranch.location;
  return anchor
    ? createAnchorId("selector-branch", anchor, selectorBranch.branchIndex)
    : selectorBranch.selectorBranchNodeId
      ? `selector-branch:node:${stableHash(selectorBranch.selectorBranchNodeId)}`
      : `selector-branch:${index}:${stableHash(`${selectorBranch.selectorQueryId}:${selectorBranch.branchIndex}`)}`;
}

export function createSelectorRuleKey(selectorQuery: SelectorQueryAnalysis, index: number): string {
  return [
    selectorQuery.stylesheetId ?? "direct-query",
    selectorQuery.location?.startLine ?? index,
    selectorQuery.location?.startColumn ?? 0,
    selectorQuery.selectorText,
  ].join(":");
}

export function createAnchorId(
  kind: string,
  anchor: SourceAnchor,
  index: number,
): ProjectEvidenceId {
  const normalizedAnchor = normalizeAnchor(anchor);
  return [
    kind,
    normalizeProjectPath(normalizedAnchor.filePath),
    normalizedAnchor.startLine,
    normalizedAnchor.startColumn,
    index,
  ].join(":");
}

export function createPathId(kind: string, filePath: string): ProjectEvidenceId {
  return `${kind}:${normalizeProjectPath(filePath)}`;
}

export function createComponentId(filePath: string, componentName: string): ProjectEvidenceId {
  return `component:${filePath}:${componentName}`;
}

export function createComponentIdFromKey(componentKey: string): ProjectEvidenceId {
  return `component:${stableHash(componentKey)}`;
}

export function createComponentKey(filePath: string, componentName: string): string {
  return `${filePath}::${componentName}`;
}

export function createReachabilityContextKey(
  stylesheetId: ProjectEvidenceId,
  kind: "source" | "component",
  id: ProjectEvidenceId,
): string {
  return `${stylesheetId}:${kind}:${id}`;
}

export function createReferenceClassKey(referenceId: ProjectEvidenceId, className: string): string {
  return `${referenceId}:${className}`;
}

export function createStylesheetClassKey(
  stylesheetId: ProjectEvidenceId,
  className: string,
): string {
  return `${stylesheetId}:${className}`;
}

export function createCssModuleImportId(input: {
  sourceFilePath: string;
  stylesheetFilePath: string;
  localName: string;
}): ProjectEvidenceId {
  return [
    "css-module-import",
    normalizeProjectPath(input.sourceFilePath),
    normalizeProjectPath(input.stylesheetFilePath),
    input.localName,
  ].join(":");
}

export function createCssModuleMemberReferenceId(
  location: SourceAnchor,
  importId: ProjectEvidenceId,
  memberName: string,
): ProjectEvidenceId {
  return [
    "css-module-member-reference",
    importId,
    memberName,
    location.startLine,
    location.startColumn,
  ].join(":");
}

export function createCssModuleAliasId(
  location: SourceAnchor,
  importId: ProjectEvidenceId,
  aliasName: string,
): ProjectEvidenceId {
  return ["css-module-alias", importId, aliasName, location.startLine, location.startColumn].join(
    ":",
  );
}

export function createCssModuleDestructuredBindingId(
  location: SourceAnchor,
  importId: ProjectEvidenceId,
  memberName: string,
  bindingName: string,
): ProjectEvidenceId {
  return [
    "css-module-destructured-binding",
    importId,
    memberName,
    bindingName,
    location.startLine,
    location.startColumn,
  ].join(":");
}

export function createCssModuleDiagnosticId(
  location: SourceAnchor,
  importId: ProjectEvidenceId,
): ProjectEvidenceId {
  return [
    "css-module-reference-diagnostic",
    importId,
    location.startLine,
    location.startColumn,
  ].join(":");
}

export function createCssModuleImportLookupKey(input: {
  sourceFilePath: string;
  stylesheetFilePath: string;
  localName: string;
}): string {
  return [
    normalizeProjectPath(input.sourceFilePath),
    normalizeProjectPath(input.stylesheetFilePath),
    input.localName,
  ].join(":");
}
