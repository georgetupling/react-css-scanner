import type { ClassExpressionSummary } from "../../symbolic-evaluation/class-values/types.js";
import { getAllResolvedModuleFacts } from "../../module-facts/index.js";
import type { ReachabilityAvailability } from "../../reachability/types.js";
import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SourceAnchor } from "../../../types/core.js";
import type {
  ClassDefinitionAnalysis,
  ClassDefinitionSelectorKind,
  ClassReferenceAnalysis,
  ClassReferenceExpressionKind,
  DeclarationForSignature,
  ProjectEvidenceBuildInput,
  ProjectEvidenceId,
  ProjectEvidenceBuilderIndexes,
  SelectorQueryAnalysis,
  StylesheetOrigin,
  StylesheetReachabilityRelation,
  StaticallySkippedClassReferenceAnalysis,
  ClassContextAnalysis,
  ProjectEvidenceStylesheetInput,
} from "../analysisTypes.js";

export function getStylesheetOrigin(
  filePath: string | undefined,
  input: ProjectEvidenceBuildInput,
): StylesheetOrigin {
  if (!filePath) {
    return "unknown";
  }
  if (isCssModuleStylesheet(filePath)) {
    return "css-module";
  }
  if (isExternalStylesheet(filePath, input)) {
    return "external-import";
  }
  return "project-css";
}

export function getStylesheetOriginFromInventory(
  stylesheet: ProjectEvidenceStylesheetInput | undefined,
  filePath: string | undefined,
  input: ProjectEvidenceBuildInput,
): StylesheetOrigin {
  if (!stylesheet) {
    return getStylesheetOrigin(filePath, input);
  }

  if (stylesheet.cssKind === "css-module") {
    return "css-module";
  }

  if (stylesheet.origin === "package" || stylesheet.origin === "remote") {
    return "external-import";
  }

  if (filePath && isExternalStylesheet(filePath, input)) {
    return "external-import";
  }

  return "project-css";
}

export function isCssModuleStylesheetFromInventory(
  stylesheet: ProjectEvidenceStylesheetInput | undefined,
  filePath: string | undefined,
): boolean {
  return stylesheet ? stylesheet.cssKind === "css-module" : isCssModuleStylesheet(filePath);
}

export function isExternalStylesheet(filePath: string, input: ProjectEvidenceBuildInput): boolean {
  const normalizedFilePath = normalizeProjectPath(filePath);
  for (const moduleFacts of getAllResolvedModuleFacts({
    moduleFacts: input.moduleFacts,
  })) {
    if (
      moduleFacts.imports.some(
        (importFact) =>
          (importFact.importKind === "external-css" ||
            (importFact.importKind === "css" && importFact.resolution.status === "external")) &&
          normalizeProjectPath(importFact.specifier) === normalizedFilePath,
      )
    ) {
      return true;
    }
  }

  return input.externalCssSummary.externalStylesheetFilePaths
    .map(normalizeProjectPath)
    .includes(normalizedFilePath);
}

export function getDefinitionSelectorKind(
  definition: ClassDefinitionAnalysis["sourceDefinition"],
): ClassDefinitionSelectorKind {
  return getSelectorBranchKind(definition.selectorBranch);
}

export function getSelectorBranchKind(
  selectorBranch: ClassDefinitionAnalysis["sourceDefinition"]["selectorBranch"],
): ClassDefinitionSelectorKind {
  if (selectorBranch.hasUnknownSemantics) {
    return "unsupported";
  }
  if (selectorBranch.matchKind === "standalone" && !selectorBranch.hasSubjectModifiers) {
    return "simple-root";
  }
  if (selectorBranch.matchKind === "compound") {
    return "compound";
  }
  if (selectorBranch.matchKind === "contextual") {
    return "contextual";
  }
  return "complex";
}

export function getReferenceExpressionKind(
  classExpression: ClassExpressionSummary,
): ClassReferenceExpressionKind {
  if (classExpression.value.kind === "string-exact") {
    return "exact-string";
  }
  if (classExpression.value.kind === "string-set") {
    return "string-set";
  }
  if (classExpression.classes.unknownDynamic) {
    return "dynamic";
  }
  return "unsupported";
}

export function getReferenceConfidence(classExpression: ClassExpressionSummary) {
  if (classExpression.classes.unknownDynamic) {
    return "low";
  }
  if (classExpression.classes.possible.length > 0) {
    return "medium";
  }
  return "high";
}

export function collectReferenceClassNames(reference: ClassReferenceAnalysis): string[] {
  return [...new Set([...reference.definiteClassNames, ...reference.possibleClassNames])].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function collectSkippedReferenceClassNames(
  reference: StaticallySkippedClassReferenceAnalysis,
): string[] {
  return [...new Set([...reference.definiteClassNames, ...reference.possibleClassNames])].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function getBestReachabilityForReference(input: {
  reference: ClassReferenceAnalysis;
  stylesheetId: ProjectEvidenceId;
  reachabilityByStylesheetAndSource: Map<string, StylesheetReachabilityRelation[]>;
  reachabilityByStylesheet: Map<ProjectEvidenceId, StylesheetReachabilityRelation[]>;
}): {
  availability: ReachabilityAvailability;
  traces: AnalysisTrace[];
} {
  const candidateRelations = [
    ...getReachabilityRelations({
      stylesheetId: input.stylesheetId,
      kind: "source",
      id: input.reference.sourceFileId,
      reachabilityByStylesheetAndSource: input.reachabilityByStylesheetAndSource,
    }),
    ...(input.reference.componentId
      ? getReachabilityRelations({
          stylesheetId: input.stylesheetId,
          kind: "component",
          id: input.reference.componentId,
          reachabilityByStylesheetAndSource: input.reachabilityByStylesheetAndSource,
        })
      : []),
  ];
  const stylesheetRelations = input.reachabilityByStylesheet.get(input.stylesheetId) ?? [];

  const definiteRelations = candidateRelations.filter(
    (relation) => relation.availability === "definite",
  );
  if (definiteRelations.length > 0) {
    return {
      availability: "definite",
      traces: mergeTraces(definiteRelations.flatMap((relation) => relation.traces)),
    };
  }

  const possibleRelations = candidateRelations.filter(
    (relation) => relation.availability === "possible",
  );
  if (possibleRelations.length > 0) {
    return {
      availability: "possible",
      traces: mergeTraces(possibleRelations.flatMap((relation) => relation.traces)),
    };
  }

  const unavailableRelations =
    candidateRelations.length > 0
      ? candidateRelations.filter((relation) => relation.availability === "unavailable")
      : stylesheetRelations.filter((relation) => relation.availability === "unavailable");
  if (unavailableRelations.length > 0) {
    return {
      availability: "unavailable",
      traces: mergeTraces(unavailableRelations.flatMap((relation) => relation.traces)),
    };
  }

  return {
    availability: "unknown",
    traces: mergeTraces(candidateRelations.flatMap((relation) => relation.traces)),
  };
}

export function getReachabilityRelations(input: {
  stylesheetId: ProjectEvidenceId;
  kind: "source" | "component";
  id: ProjectEvidenceId;
  reachabilityByStylesheetAndSource: Map<string, StylesheetReachabilityRelation[]>;
}): StylesheetReachabilityRelation[] {
  return (
    input.reachabilityByStylesheetAndSource.get(
      createReachabilityContextKey(input.stylesheetId, input.kind, input.id),
    ) ?? []
  );
}

export function getSourceFileIdForContext(
  contextRecord: StylesheetReachabilityRelation["contexts"][number],
  indexes: ProjectEvidenceBuilderIndexes,
): ProjectEvidenceId | undefined {
  const context = contextRecord.context;
  if (
    context.kind === "source-file" ||
    context.kind === "component" ||
    context.kind === "render-subtree-root" ||
    context.kind === "render-region"
  ) {
    return indexes.sourceFileIdByPath.get(normalizeProjectPath(context.filePath));
  }

  return undefined;
}

export function getComponentIdForContext(
  contextRecord: StylesheetReachabilityRelation["contexts"][number],
  indexes: ProjectEvidenceBuilderIndexes,
): ProjectEvidenceId | undefined {
  const context = contextRecord.context;
  if (
    (context.kind === "component" ||
      context.kind === "render-subtree-root" ||
      context.kind === "render-region") &&
    (context.componentKey || context.componentName)
  ) {
    if (context.componentKey) {
      return indexes.componentIdByComponentKey.get(context.componentKey);
    }

    if (context.componentName) {
      return indexes.componentIdByFilePathAndName.get(
        createComponentKey(normalizeProjectPath(context.filePath), context.componentName),
      );
    }
  }

  return undefined;
}

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

export function isCssModuleStylesheet(filePath: string | undefined): boolean {
  return Boolean(filePath?.match(/\.module\.[cm]?css$/i));
}

export function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function normalizeOptionalProjectPath(filePath: string | undefined): string | undefined {
  return filePath ? normalizeProjectPath(filePath) : undefined;
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function normalizeAnchor(anchor: SourceAnchor): SourceAnchor {
  return {
    ...anchor,
    filePath: normalizeProjectPath(anchor.filePath),
  };
}

export function normalizeOptionalAnchor(
  anchor: SourceAnchor | undefined,
): SourceAnchor | undefined {
  return anchor ? normalizeAnchor(anchor) : undefined;
}

export function pushMapValue<TKey, TValue>(
  map: Map<TKey, TValue[]>,
  key: TKey,
  value: TValue,
): void {
  const existing = map.get(key) ?? [];
  existing.push(value);
  map.set(key, existing);
}

export function pushUniqueMapValue<TKey, TValue>(
  map: Map<TKey, TValue[]>,
  key: TKey,
  value: TValue,
): void {
  const existing = map.get(key) ?? [];
  if (!existing.includes(value)) {
    existing.push(value);
  }
  map.set(key, existing);
}

export function mergeTraces(traces: AnalysisTrace[]): AnalysisTrace[] {
  const tracesByKey = new Map<string, AnalysisTrace>();
  for (const trace of traces) {
    tracesByKey.set(serializeTraceKey(trace), trace);
  }

  return [...tracesByKey.values()].sort((left, right) => left.traceId.localeCompare(right.traceId));
}

const traceKeyCache = new WeakMap<AnalysisTrace, string>();

export function serializeTraceKey(trace: AnalysisTrace): string {
  const cachedKey = traceKeyCache.get(trace);
  if (cachedKey) {
    return cachedKey;
  }

  const anchor = trace.anchor
    ? [
        trace.anchor.filePath,
        trace.anchor.startLine,
        trace.anchor.startColumn,
        trace.anchor.endLine ?? "",
        trace.anchor.endColumn ?? "",
      ].join(":")
    : "";

  const key = `${trace.traceId}:${trace.category}:${anchor}`;
  traceKeyCache.set(trace, key);
  return key;
}

export function sortIndexValues(map: Map<string, string[]>): void {
  for (const [key, values] of map.entries()) {
    map.set(
      key,
      [...values].sort((left, right) => left.localeCompare(right)),
    );
  }
}

export function compareById<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

export function compareReachabilityRelations(
  left: StylesheetReachabilityRelation,
  right: StylesheetReachabilityRelation,
): number {
  return `${left.stylesheetId}:${left.sourceFileId ?? ""}:${left.componentId ?? ""}:${left.availability}`.localeCompare(
    `${right.stylesheetId}:${right.sourceFileId ?? ""}:${right.componentId ?? ""}:${right.availability}`,
  );
}

export function compareAnchors(left: SourceAnchor, right: SourceAnchor): number {
  return (
    normalizeProjectPath(left.filePath).localeCompare(normalizeProjectPath(right.filePath)) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    (left.endLine ?? 0) - (right.endLine ?? 0) ||
    (left.endColumn ?? 0) - (right.endColumn ?? 0)
  );
}

export function compareStringRecords(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }

  return serializeStringRecord(left).localeCompare(serializeStringRecord(right));
}

export function serializeStringRecord(record: Record<string, string>): string {
  return Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

export function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
