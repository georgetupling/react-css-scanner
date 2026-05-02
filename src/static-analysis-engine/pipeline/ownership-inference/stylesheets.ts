import {
  styleClassificationEvidenceId,
  styleOwnerCandidateId,
  stylesheetOwnershipEvidenceId,
} from "./ids.js";
import type { ProjectEvidenceAssemblyResult } from "../project-evidence/index.js";
import type { OwnershipInferenceOptions } from "./buildOwnershipInference.js";
import type {
  IntentionalSharedEvidenceKind,
  OwnershipCandidateReason,
  OwnershipInferenceResult,
  StyleClassificationEvidence,
  StyleOwnerCandidate,
  StylesheetConsumerDirectoryRelation,
  StylesheetOwnershipBroadness,
  StylesheetOwnershipEvidence,
} from "./types.js";

const BROAD_STYLESHEET_SEGMENTS = new Set([
  "common",
  "design-system",
  "designsystem",
  "global",
  "globals",
  "layout",
  "layouts",
  "shared",
  "theme",
  "themes",
  "tokens",
  "utilities",
  "utility",
]);

const GLOBAL_STYLESHEET_SEGMENTS = new Set(["global", "globals", "theme", "themes", "tokens"]);

export function buildStylesheetOwnership(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  options?: OwnershipInferenceOptions;
}): Pick<OwnershipInferenceResult, "stylesheetOwnership" | "ownerCandidates" | "classifications"> {
  const importerEvidence = collectImporterEvidence(input.projectEvidence);
  const stylesheetOwnership: StylesheetOwnershipEvidence[] = [];
  const ownerCandidates: StyleOwnerCandidate[] = [];
  const classifications: StyleClassificationEvidence[] = [];
  const includeTraces = input.options?.includeTraces ?? true;
  const sharedCssPatterns = input.options?.sharedCssPatterns ?? [];
  const sharingPolicy = input.options?.sharingPolicy ?? "balanced";
  const rootHtmlEntryLinkedStylesheetPaths = new Set(
    (input.options?.rootHtmlEntryLinkedStylesheetPaths ?? []).map((filePath) =>
      normalizeProjectPath(filePath),
    ),
  );

  for (const stylesheet of input.projectEvidence.entities.stylesheets) {
    const importer = importerEvidence.get(stylesheet.id) ?? {
      componentIds: [],
      sourceFileIds: [],
    };
    const configuredShared = isConfiguredSharedStylesheetPath({
      filePath: stylesheet.filePath,
      sharedCssPatterns,
    });
    const broadPath = isIntentionallyBroadStylesheetPath(stylesheet.filePath);
    const broadness = getStylesheetBroadness({
      filePath: stylesheet.filePath,
      configuredShared,
      broadPath,
      importerComponentCount: importer.componentIds.length,
    });
    const reasons = getStylesheetReasons({ configuredShared, broadPath, broadness });
    const stylesheetOwnerCandidateIds: string[] = [];

    if (configuredShared || broadPath) {
      const candidate = createStylesheetOwnerCandidate({
        stylesheetId: stylesheet.id,
        ownerKind: "shared-layer",
        ownerPath: stylesheet.filePath,
        confidence: configuredShared ? "high" : "medium",
        reasons,
        includeTraces,
      });
      ownerCandidates.push(candidate);
      stylesheetOwnerCandidateIds.push(candidate.id);
    }

    for (const componentId of importer.componentIds) {
      const candidate = createStylesheetOwnerCandidate({
        stylesheetId: stylesheet.id,
        ownerKind: "component",
        ownerId: componentId,
        confidence: importer.componentIds.length === 1 ? "high" : "medium",
        reasons:
          importer.componentIds.length === 1 ? ["single-importing-component"] : ["multi-consumer"],
        includeTraces,
      });
      ownerCandidates.push(candidate);
      stylesheetOwnerCandidateIds.push(candidate.id);
    }

    const classification = createStylesheetClassification({
      stylesheetId: stylesheet.id,
      classification: getStylesheetClassification({ configuredShared, broadness }),
      confidence:
        configuredShared || broadPath || importer.componentIds.length === 1 ? "high" : "low",
      reasons,
      includeTraces,
    });
    classifications.push(classification);

    const consumerDirectoryRelations = buildConsumerDirectoryRelations({
      stylesheetId: stylesheet.id,
      stylesheetFilePath: stylesheet.filePath,
      importerComponentIds: importer.componentIds,
      projectEvidence: input.projectEvidence,
    });
    const intentionalSharedEvidenceKinds = getIntentionalSharedEvidenceKinds({
      configuredShared,
      broadPath,
      rootHtmlEntryLinkedStylesheetPaths,
      stylesheetFilePath: stylesheet.filePath,
      consumerDirectoryRelations,
      consumerComponentNames: importer.componentIds
        .map(
          (componentId) =>
            input.projectEvidence.indexes.componentsById.get(componentId)?.componentName,
        )
        .filter((componentName): componentName is string => Boolean(componentName)),
    });
    const isHtmlEntryLinked =
      stylesheet.filePath !== undefined &&
      rootHtmlEntryLinkedStylesheetPaths.has(normalizeProjectPath(stylesheet.filePath));
    const isIntentionallySharedByPolicy = evaluateIntentionallySharedByPolicy({
      sharingPolicy,
      intentionalSharedEvidenceKinds,
      importerComponentCount: importer.componentIds.length,
      consumerDirectoryRelations,
    });

    stylesheetOwnership.push({
      id: stylesheetOwnershipEvidenceId({ stylesheetId: stylesheet.id }),
      stylesheetId: stylesheet.id,
      importerComponentIds: importer.componentIds,
      importerSourceFileIds: importer.sourceFileIds,
      ownerCandidateIds: [...new Set(stylesheetOwnerCandidateIds)].sort((left, right) =>
        left.localeCompare(right),
      ),
      broadness,
      configuredShared,
      sharingPolicy,
      intentionalSharedEvidenceKinds,
      consumerDirectoryRelations,
      isHtmlEntryLinked,
      isIntentionallySharedByPolicy,
      confidence:
        configuredShared || broadPath || importer.componentIds.length === 1 ? "high" : "low",
      traces: includeTraces
        ? [
            {
              traceId: `ownership:stylesheet:${stylesheet.id}`,
              category: "rule-evaluation",
              summary: `ownership evidence was collected for stylesheet "${stylesheet.filePath ?? stylesheet.id}"`,
              children: [],
              metadata: {
                stylesheetId: stylesheet.id,
                stylesheetFilePath: stylesheet.filePath,
                importerComponentIds: importer.componentIds,
                importerSourceFileIds: importer.sourceFileIds,
                broadness,
                configuredShared,
                reasons,
                sharingPolicy,
                intentionalSharedEvidenceKinds,
                consumerDirectoryRelations,
                isHtmlEntryLinked,
                isIntentionallySharedByPolicy,
              },
            },
          ]
        : [],
    });
  }

  return {
    stylesheetOwnership: stylesheetOwnership.sort(compareById),
    ownerCandidates: dedupeOwnerCandidates(ownerCandidates),
    classifications: classifications.sort(compareById),
  };
}

function collectImporterEvidence(
  projectEvidence: ProjectEvidenceAssemblyResult,
): Map<string, { componentIds: string[]; sourceFileIds: string[] }> {
  const result = new Map<string, { componentIds: string[]; sourceFileIds: string[] }>();

  for (const importRelation of projectEvidence.relations.moduleImports) {
    if (importRelation.importKind !== "css" && importRelation.importKind !== "external-css") {
      continue;
    }

    const stylesheetId = resolveStylesheetImportId({
      projectEvidence,
      sourceFileId: importRelation.fromSourceFileId,
      specifier: importRelation.specifier,
      resolvedFilePath: importRelation.resolvedFilePath,
    });
    if (!stylesheetId) {
      continue;
    }

    pushUniqueImporterEvidence({
      result,
      stylesheetId,
      sourceFileId: importRelation.fromSourceFileId,
      componentIds:
        projectEvidence.indexes.componentIdsBySourceFileId.get(importRelation.fromSourceFileId) ??
        [],
    });
  }

  for (const cssModuleImport of projectEvidence.entities.cssModuleImports) {
    pushUniqueImporterEvidence({
      result,
      stylesheetId: cssModuleImport.stylesheetId,
      sourceFileId: cssModuleImport.sourceFileId,
      componentIds:
        projectEvidence.indexes.componentIdsBySourceFileId.get(cssModuleImport.sourceFileId) ?? [],
    });
  }

  for (const evidence of result.values()) {
    evidence.componentIds.sort((left, right) => left.localeCompare(right));
    evidence.sourceFileIds.sort((left, right) => left.localeCompare(right));
  }

  return result;
}

function resolveStylesheetImportId(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  sourceFileId: string;
  specifier: string;
  resolvedFilePath?: string;
}): string | undefined {
  if (input.resolvedFilePath) {
    const stylesheetId = input.projectEvidence.indexes.stylesheetIdByPath.get(
      normalizeProjectPath(input.resolvedFilePath),
    );
    if (stylesheetId) {
      return stylesheetId;
    }
  }

  if (!input.specifier.startsWith(".")) {
    return undefined;
  }

  const sourceFile = input.projectEvidence.indexes.sourceFilesById.get(input.sourceFileId);
  if (!sourceFile) {
    return undefined;
  }

  const sourceSegments = normalizeProjectPath(sourceFile.filePath).split("/");
  sourceSegments.pop();
  const specifierSegments = input.specifier.split("/").filter(Boolean);
  const candidateBasePath = normalizeSegments([...sourceSegments, ...specifierSegments]);
  const candidatePaths = [candidateBasePath, `${candidateBasePath}.css`];

  for (const candidatePath of candidatePaths) {
    const stylesheetId = input.projectEvidence.indexes.stylesheetIdByPath.get(candidatePath);
    if (stylesheetId) {
      return stylesheetId;
    }
  }

  return undefined;
}

function pushUniqueImporterEvidence(input: {
  result: Map<string, { componentIds: string[]; sourceFileIds: string[] }>;
  stylesheetId: string;
  sourceFileId: string;
  componentIds: string[];
}): void {
  const evidence = input.result.get(input.stylesheetId) ?? {
    componentIds: [],
    sourceFileIds: [],
  };
  if (!evidence.sourceFileIds.includes(input.sourceFileId)) {
    evidence.sourceFileIds.push(input.sourceFileId);
  }
  for (const componentId of input.componentIds) {
    if (!evidence.componentIds.includes(componentId)) {
      evidence.componentIds.push(componentId);
    }
  }
  input.result.set(input.stylesheetId, evidence);
}

function createStylesheetOwnerCandidate(input: {
  stylesheetId: string;
  ownerKind: StyleOwnerCandidate["ownerKind"];
  ownerId?: string;
  ownerPath?: string;
  confidence: StyleOwnerCandidate["confidence"];
  reasons: OwnershipCandidateReason[];
  includeTraces: boolean;
}): StyleOwnerCandidate {
  return {
    id: styleOwnerCandidateId({
      targetKind: "stylesheet",
      targetId: input.stylesheetId,
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      ownerPath: input.ownerPath,
      reasonKey: input.reasons.join("|"),
    }),
    targetKind: "stylesheet",
    targetId: input.stylesheetId,
    ownerKind: input.ownerKind,
    ownerId: input.ownerId,
    ownerPath: input.ownerPath,
    confidence: input.confidence,
    actable: input.confidence !== "low",
    reasons: input.reasons,
    traces: input.includeTraces
      ? [
          {
            traceId: `ownership:stylesheet-candidate:${input.stylesheetId}:${input.ownerKind}:${input.ownerId ?? input.ownerPath ?? "unknown"}`,
            category: "rule-evaluation",
            summary: `stylesheet owner candidate was inferred from ${input.reasons.join(", ")}`,
            children: [],
            metadata: {
              stylesheetId: input.stylesheetId,
              ownerKind: input.ownerKind,
              ownerId: input.ownerId,
              ownerPath: input.ownerPath,
              reasons: input.reasons,
            },
          },
        ]
      : [],
  };
}

function createStylesheetClassification(input: {
  stylesheetId: string;
  classification: StyleClassificationEvidence["classification"];
  confidence: StyleClassificationEvidence["confidence"];
  reasons: OwnershipCandidateReason[];
  includeTraces: boolean;
}): StyleClassificationEvidence {
  return {
    id: styleClassificationEvidenceId({
      targetKind: "stylesheet",
      targetId: input.stylesheetId,
      classification: input.classification,
    }),
    targetKind: "stylesheet",
    targetId: input.stylesheetId,
    classification: input.classification,
    confidence: input.confidence,
    reasons: input.reasons,
    traces: input.includeTraces
      ? [
          {
            traceId: `ownership:stylesheet-classification:${input.stylesheetId}:${input.classification}`,
            category: "rule-evaluation",
            summary: `stylesheet was classified as ${input.classification}`,
            children: [],
            metadata: {
              stylesheetId: input.stylesheetId,
              classification: input.classification,
              reasons: input.reasons,
            },
          },
        ]
      : [],
  };
}

function getStylesheetReasons(input: {
  configuredShared: boolean;
  broadPath: boolean;
  broadness: StylesheetOwnershipBroadness;
}): OwnershipCandidateReason[] {
  const reasons: OwnershipCandidateReason[] = [];
  if (input.configuredShared) {
    reasons.push("configured-shared-css");
  }
  if (input.broadPath) {
    reasons.push("broad-stylesheet-segment");
  }
  if (input.broadness === "unknown") {
    reasons.push("unknown");
  }
  return reasons.sort((left, right) => left.localeCompare(right));
}

function getStylesheetBroadness(input: {
  filePath?: string;
  configuredShared: boolean;
  broadPath: boolean;
  importerComponentCount: number;
}): StylesheetOwnershipBroadness {
  if (input.configuredShared) {
    return "shared-like";
  }
  if (isGlobalLikeStylesheetPath(input.filePath)) {
    return "global-like";
  }
  if (input.broadPath) {
    return "shared-like";
  }
  if (isFeatureLikeStylesheetPath(input.filePath)) {
    return "feature-like";
  }
  if (input.importerComponentCount === 1) {
    return "private-component-like";
  }
  return "unknown";
}

function getStylesheetClassification(input: {
  configuredShared: boolean;
  broadness: StylesheetOwnershipBroadness;
}): StyleClassificationEvidence["classification"] {
  if (input.configuredShared) {
    return "shared";
  }
  switch (input.broadness) {
    case "global-like":
    case "shared-like":
      return "broad";
    case "feature-like":
      return "shared";
    case "private-component-like":
      return "private";
    case "unknown":
      return "unresolved";
  }
}

function buildConsumerDirectoryRelations(input: {
  stylesheetId: string;
  stylesheetFilePath: string | undefined;
  importerComponentIds: string[];
  projectEvidence: ProjectEvidenceAssemblyResult;
}): StylesheetConsumerDirectoryRelation[] {
  if (!input.stylesheetFilePath) {
    return [];
  }

  const stylesheetDirectoryPath = getDirectoryPath(input.stylesheetFilePath);
  const relations: StylesheetConsumerDirectoryRelation[] = [];

  for (const componentId of input.importerComponentIds) {
    const component = input.projectEvidence.indexes.componentsById.get(componentId);
    const consumerDirectoryPath = component?.filePath
      ? getDirectoryPath(component.filePath)
      : undefined;
    relations.push({
      stylesheetId: input.stylesheetId,
      consumerComponentId: componentId,
      relation: getDirectoryRelation({
        stylesheetDirectoryPath,
        consumerDirectoryPath,
      }),
      stylesheetDirectoryPath,
      consumerDirectoryPath,
    });
  }

  return relations.sort((left, right) =>
    `${left.stylesheetId}:${left.consumerComponentId}:${left.relation}:${left.stylesheetDirectoryPath ?? ""}:${left.consumerDirectoryPath ?? ""}`.localeCompare(
      `${right.stylesheetId}:${right.consumerComponentId}:${right.relation}:${right.stylesheetDirectoryPath ?? ""}:${right.consumerDirectoryPath ?? ""}`,
    ),
  );
}

function getIntentionalSharedEvidenceKinds(input: {
  configuredShared: boolean;
  broadPath: boolean;
  rootHtmlEntryLinkedStylesheetPaths: Set<string>;
  stylesheetFilePath: string | undefined;
  consumerDirectoryRelations: StylesheetConsumerDirectoryRelation[];
  consumerComponentNames: string[];
}): IntentionalSharedEvidenceKind[] {
  const kinds = new Set<IntentionalSharedEvidenceKind>();
  if (input.configuredShared) {
    kinds.add("configured-shared-css");
  }
  if (input.broadPath) {
    kinds.add("broad-stylesheet-segment");
  }
  if (
    input.stylesheetFilePath &&
    input.rootHtmlEntryLinkedStylesheetPaths.has(normalizeProjectPath(input.stylesheetFilePath))
  ) {
    kinds.add("html-entry-linked");
  }
  if (input.consumerDirectoryRelations.some((relation) => relation.relation === "same-directory")) {
    kinds.add("consumer-same-directory");
  }
  if (
    input.consumerDirectoryRelations.some((relation) => relation.relation === "ancestor-directory")
  ) {
    kinds.add("consumer-ancestor-directory");
  }
  if (
    isGenericFamilyStylesheetForConsumers({
      stylesheetFilePath: input.stylesheetFilePath,
      consumerComponentNames: input.consumerComponentNames,
    })
  ) {
    kinds.add("generic-family-stylesheet");
  }
  return [...kinds].sort((left, right) => left.localeCompare(right));
}

function evaluateIntentionallySharedByPolicy(input: {
  sharingPolicy: "strict" | "balanced" | "permissive";
  intentionalSharedEvidenceKinds: IntentionalSharedEvidenceKind[];
  importerComponentCount: number;
  consumerDirectoryRelations: StylesheetConsumerDirectoryRelation[];
}): boolean {
  const evidenceKinds = new Set(input.intentionalSharedEvidenceKinds);

  if (input.sharingPolicy === "permissive") {
    return input.importerComponentCount !== 1;
  }

  if (input.sharingPolicy === "strict") {
    return evidenceKinds.has("configured-shared-css") || evidenceKinds.has("html-entry-linked");
  }

  const hasDirectoryEvidence =
    evidenceKinds.has("consumer-same-directory") ||
    evidenceKinds.has("consumer-ancestor-directory");
  const allConsumersInAllowedDirectoryScope =
    input.consumerDirectoryRelations.length > 0 &&
    input.consumerDirectoryRelations.every(
      (relation) =>
        relation.relation === "same-directory" || relation.relation === "ancestor-directory",
    );

  return (
    evidenceKinds.has("configured-shared-css") ||
    evidenceKinds.has("broad-stylesheet-segment") ||
    evidenceKinds.has("generic-family-stylesheet") ||
    (hasDirectoryEvidence && allConsumersInAllowedDirectoryScope)
  );
}

function getDirectoryRelation(input: {
  stylesheetDirectoryPath: string | undefined;
  consumerDirectoryPath: string | undefined;
}):
  | "same-directory"
  | "ancestor-directory"
  | "descendant-directory"
  | "sibling-directory"
  | "cousin-directory"
  | "unknown" {
  if (!input.stylesheetDirectoryPath || !input.consumerDirectoryPath) {
    return "unknown";
  }
  const stylesheetPath = normalizeProjectPath(input.stylesheetDirectoryPath);
  const consumerPath = normalizeProjectPath(input.consumerDirectoryPath);
  if (stylesheetPath === consumerPath) {
    return "same-directory";
  }
  if (consumerPath.startsWith(`${stylesheetPath}/`)) {
    return "ancestor-directory";
  }
  if (stylesheetPath.startsWith(`${consumerPath}/`)) {
    return "descendant-directory";
  }
  const stylesheetParentPath = getDirectoryPath(stylesheetPath);
  const consumerParentPath = getDirectoryPath(consumerPath);
  if (stylesheetParentPath && stylesheetParentPath === consumerParentPath) {
    return "sibling-directory";
  }
  return "cousin-directory";
}

function isConfiguredSharedStylesheetPath(input: {
  filePath: string | undefined;
  sharedCssPatterns: string[];
}): boolean {
  if (!input.filePath || input.sharedCssPatterns.length === 0) {
    return false;
  }

  const normalizedFilePath = normalizeProjectPath(input.filePath);
  return input.sharedCssPatterns.some((pattern) =>
    globToRegExp(normalizeProjectPath(pattern)).test(normalizedFilePath),
  );
}

function isIntentionallyBroadStylesheetPath(filePath: string | undefined): boolean {
  return stylesheetPathHasSegment(filePath, BROAD_STYLESHEET_SEGMENTS);
}

function isGlobalLikeStylesheetPath(filePath: string | undefined): boolean {
  return stylesheetPathHasSegment(filePath, GLOBAL_STYLESHEET_SEGMENTS);
}

function isFeatureLikeStylesheetPath(filePath: string | undefined): boolean {
  return Boolean(filePath && normalizeProjectPath(filePath).split("/").includes("features"));
}

function stylesheetPathHasSegment(filePath: string | undefined, segments: Set<string>): boolean {
  if (!filePath) {
    return false;
  }

  const normalized = normalizeProjectPath(filePath).toLowerCase();
  const pathSegments = normalized.split("/").filter(Boolean);
  const baseName = pathSegments.at(-1)?.replace(/\.[^.]+$/, "");
  return (
    pathSegments.some((segment) => segments.has(segment)) ||
    Boolean(baseName && segments.has(baseName))
  );
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

function getDirectoryPath(filePath: string): string {
  const normalized = normalizeProjectPath(filePath);
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function isGenericFamilyStylesheetForConsumers(input: {
  stylesheetFilePath: string | undefined;
  consumerComponentNames: string[];
}): boolean {
  if (!input.stylesheetFilePath || input.consumerComponentNames.length < 2) {
    return false;
  }
  const stylesheetBaseName = normalizeName(getBaseNameWithoutExtension(input.stylesheetFilePath));
  if (!stylesheetBaseName) {
    return false;
  }
  const consumerNames = input.consumerComponentNames.map(normalizeName).filter(Boolean);
  if (consumerNames.length < 2) {
    return false;
  }
  return (
    consumerNames.every((consumerName) => consumerName.endsWith(stylesheetBaseName)) &&
    consumerNames.some((consumerName) => consumerName !== stylesheetBaseName)
  );
}

function getBaseNameWithoutExtension(filePath: string): string {
  const normalized = normalizeProjectPath(filePath);
  const fileName = normalized.split("/").at(-1) ?? normalized;
  return fileName.replace(/\.[^.]+$/, "");
}

function normalizeName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function normalizeSegments(segments: string[]): string {
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }
    if (segment === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized.join("/");
}

function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const nextChar = glob[index + 1];

    if (char === "*" && nextChar === "*") {
      const afterGlobstar = glob[index + 2];
      if (afterGlobstar === "/") {
        source += "(?:.*/)?";
        index += 2;
        continue;
      }

      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeOwnerCandidates(candidates: StyleOwnerCandidate[]): StyleOwnerCandidate[] {
  const byId = new Map<string, StyleOwnerCandidate>();
  for (const candidate of candidates) {
    byId.set(candidate.id, candidate);
  }
  return [...byId.values()].sort(compareById);
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
