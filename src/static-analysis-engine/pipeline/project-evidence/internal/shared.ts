import type { ClassExpressionSummary } from "../../symbolic-evaluation/values/types.js";
import type { ReachabilityAvailability } from "../analysisTypes.js";
import type { AnalysisTrace } from "../../../types/analysis.js";
import type {
  ClassDefinitionAnalysis,
  ClassDefinitionSelectorKind,
  ClassReferenceAnalysis,
  ClassReferenceExpressionKind,
  ProjectEvidenceBuildInput,
  ProjectEvidenceId,
  ProjectEvidenceBuilderIndexes,
  StylesheetOrigin,
  StylesheetReachabilityRelation,
  StaticallySkippedClassReferenceAnalysis,
  ProjectEvidenceStylesheetInput,
} from "../analysisTypes.js";
import { createComponentKey, createReachabilityContextKey } from "./ids.js";
import { isCssModuleStylesheet, normalizeProjectPath } from "./normalization.js";
import { mergeTraces } from "./traces.js";

export {
  compareAnchors,
  compareById,
  compareReachabilityRelations,
  compareStringRecords,
  serializeStringRecord,
} from "./comparators.js";
export { pushMapValue, pushUniqueMapValue, sortIndexValues } from "./collections.js";
export { stableHash } from "./hash.js";
export {
  createAnchorId,
  createClassContextId,
  createClassDefinitionId,
  createComponentId,
  createComponentIdFromKey,
  createComponentKey,
  createCssModuleAliasId,
  createCssModuleDestructuredBindingId,
  createCssModuleDiagnosticId,
  createCssModuleImportId,
  createCssModuleImportLookupKey,
  createCssModuleMemberReferenceId,
  createPathId,
  createReachabilityContextKey,
  createReferenceClassKey,
  createSelectorBranchId,
  createSelectorQueryId,
  createSelectorRuleKey,
  createStylesheetClassKey,
  getDeclarationSignature,
} from "./ids.js";
export {
  isCssModuleStylesheet,
  normalizeAnchor,
  normalizeOptionalAnchor,
  normalizeOptionalProjectPath,
  normalizeProjectPath,
  uniqueSorted,
} from "./normalization.js";
export { mergeTraces, serializeTraceKey } from "./traces.js";

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
  return (
    input.factGraph.snapshot.edges.some(
      (edge) =>
        edge.kind === "package-css-import" &&
        normalizeProjectPath(edge.resolvedFilePath) === normalizedFilePath,
    ) ||
    input.factGraph.graph.edges.imports.some(
      (edge) =>
        edge.importKind === "external-css" &&
        (normalizeProjectPath(edge.specifier) === normalizedFilePath ||
          (edge.resolvedFilePath
            ? normalizeProjectPath(edge.resolvedFilePath) === normalizedFilePath
            : false)),
    )
  );
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
