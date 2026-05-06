import { styleClassificationEvidenceId, styleOwnerCandidateId } from "./ids.js";
import { selectorBranchSourceKey } from "../selector-reachability/index.js";
import type { ProjectEvidenceAssemblyResult } from "../project-evidence/index.js";
import type {
  SelectorBranchReachability,
  SelectorReachabilityResult,
} from "../selector-reachability/index.js";
import type {
  ClassDefinitionConsumerEvidence,
  ClassOwnershipEvidence,
  OwnershipInferenceResult,
  StyleClassificationEvidence,
  StyleOwnerCandidate,
} from "./types.js";

export function applySelectorContextEvidence(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  selectorReachability: SelectorReachabilityResult;
  classOwnership: ClassOwnershipEvidence[];
  definitionConsumers: ClassDefinitionConsumerEvidence[];
  ownerCandidates: StyleOwnerCandidate[];
  classifications: StyleClassificationEvidence[];
  includeTraces: boolean;
}): Pick<
  OwnershipInferenceResult,
  "classOwnership" | "definitionConsumers" | "ownerCandidates" | "classifications"
> {
  const branchEvidenceByClassDefinitionId = buildSelectorBranchEvidenceByDefinition(input);
  const selectorEvidence = buildSelectorClassificationsAndCandidates({
    projectEvidence: input.projectEvidence,
    classOwnership: input.classOwnership,
    ownerCandidates: input.ownerCandidates,
    branchEvidenceByClassDefinitionId,
    includeTraces: input.includeTraces,
  });
  const contextualOwnerCandidateIdsByDefinitionId = groupCandidateIdsByTarget(
    selectorEvidence.ownerCandidates,
  );

  return {
    classOwnership: input.classOwnership.map((ownership) => ({
      ...ownership,
      ownerCandidateIds: uniqueSorted([
        ...ownership.ownerCandidateIds,
        ...(contextualOwnerCandidateIdsByDefinitionId.get(ownership.classDefinitionId) ?? []),
      ]),
      classificationIds: uniqueSorted([
        ...ownership.classificationIds,
        ...selectorEvidence.classifications
          .filter(
            (classification) =>
              classification.targetKind === "class-definition" &&
              classification.targetId === ownership.classDefinitionId,
          )
          .map((classification) => classification.id),
      ]),
    })),
    definitionConsumers: input.definitionConsumers.map((consumer) => {
      const branchEvidence = branchEvidenceByClassDefinitionId.get(consumer.classDefinitionId);
      if (!branchEvidence) {
        return consumer;
      }
      return {
        ...consumer,
        selectorBranchNodeIds: branchEvidence.selectorBranchNodeIds,
        selectorMatchIds: branchEvidence.selectorMatchIds,
        consumptionKind:
          consumer.consumptionKind === "direct-reference" && branchEvidence.contextual
            ? "selector-context"
            : consumer.consumptionKind,
        confidence: branchEvidence.unknownOnly
          ? minConfidence(consumer.confidence, "medium")
          : consumer.confidence,
      };
    }),
    ownerCandidates: dedupeOwnerCandidates([
      ...input.ownerCandidates,
      ...selectorEvidence.ownerCandidates,
    ]),
    classifications: dedupeClassifications([
      ...input.classifications,
      ...selectorEvidence.classifications,
    ]),
  };
}

function buildSelectorBranchEvidenceByDefinition(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  selectorReachability: SelectorReachabilityResult;
}): Map<
  string,
  {
    selectorBranchNodeIds: string[];
    selectorMatchIds: string[];
    contextual: boolean;
    unknownOnly: boolean;
    branches: SelectorBranchReachability[];
  }
> {
  const result = new Map<
    string,
    {
      selectorBranchNodeIds: string[];
      selectorMatchIds: string[];
      contextual: boolean;
      unknownOnly: boolean;
      branches: SelectorBranchReachability[];
    }
  >();

  for (const definition of input.projectEvidence.entities.classDefinitions) {
    const projectBranches = input.projectEvidence.entities.selectorBranches.filter(
      (branch) =>
        branch.stylesheetId === definition.stylesheetId &&
        branch.selectorText === definition.selectorText,
    );
    const branches = projectBranches
      .map((branch) =>
        input.selectorReachability.indexes.branchReachabilityBySourceKey.get(
          selectorBranchSourceKey({
            ruleKey: branch.ruleKey,
            branchIndex: branch.branchIndex,
            selectorText: branch.selectorText,
            location: branch.location,
          }),
        ),
      )
      .filter((branch): branch is SelectorBranchReachability => Boolean(branch))
      .filter((branch) => branch.status !== "unsupported");

    if (branches.length === 0) {
      continue;
    }

    const contextual = branches.some(isContextualSelectorBranch);
    result.set(definition.id, {
      selectorBranchNodeIds: uniqueSorted(branches.map((branch) => branch.selectorBranchNodeId)),
      selectorMatchIds: uniqueSorted(
        branches.flatMap((branch) =>
          branch.status === "only-matches-in-unknown-context" ? [] : branch.matchIds,
        ),
      ),
      contextual,
      unknownOnly: branches.every(
        (branch) =>
          branch.status === "only-matches-in-unknown-context" || branch.status === "not-matchable",
      ),
      branches,
    });
  }

  return result;
}

function buildSelectorClassificationsAndCandidates(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  classOwnership: ClassOwnershipEvidence[];
  ownerCandidates: StyleOwnerCandidate[];
  branchEvidenceByClassDefinitionId: Map<
    string,
    {
      selectorBranchNodeIds: string[];
      selectorMatchIds: string[];
      contextual: boolean;
      unknownOnly: boolean;
      branches: SelectorBranchReachability[];
    }
  >;
  includeTraces: boolean;
}): {
  ownerCandidates: StyleOwnerCandidate[];
  classifications: StyleClassificationEvidence[];
} {
  const classifications: StyleClassificationEvidence[] = [];
  const ownerCandidates: StyleOwnerCandidate[] = [];
  const ownerCandidateById = new Map(
    input.ownerCandidates.map((candidate) => [candidate.id, candidate]),
  );

  for (const ownership of input.classOwnership) {
    const definition = input.projectEvidence.indexes.classDefinitionsById.get(
      ownership.classDefinitionId,
    );
    if (!definition) {
      continue;
    }

    const branchEvidence = input.branchEvidenceByClassDefinitionId.get(ownership.classDefinitionId);
    if (!branchEvidence?.contextual && definition.selectorKind !== "contextual") {
      continue;
    }

    const ownerCandidate = ownership.ownerCandidateIds
      .map((candidateId) => ownerCandidateById.get(candidateId))
      .find((candidate) => candidate?.ownerKind === "component" && candidate.ownerId);
    const primitiveOverride = isPrimitiveOverride({
      className: ownership.className,
      contextClassNames: definition.sourceDefinition.selectorBranch.contextClassNames,
      ownerCandidate,
      projectEvidence: input.projectEvidence,
      stylesheetId: ownership.stylesheetId,
    });
    const classification: StyleClassificationEvidence = {
      id: styleClassificationEvidenceId({
        targetKind: "class-definition",
        targetId: ownership.classDefinitionId,
        classification: primitiveOverride ? "primitive-override" : "contextual",
        className: ownership.className,
      }),
      targetKind: "class-definition",
      targetId: ownership.classDefinitionId,
      className: ownership.className,
      classification: primitiveOverride ? "primitive-override" : "contextual",
      confidence: branchEvidence?.unknownOnly ? "low" : primitiveOverride ? "high" : "medium",
      reasons: primitiveOverride ? ["selector-context-owner"] : ["selector-context-owner"],
      traces: input.includeTraces
        ? [
            {
              traceId: `ownership:selector-context:${ownership.classDefinitionId}`,
              category: "rule-evaluation",
              summary: `selector context evidence was collected for class "${ownership.className}"`,
              children: branchEvidence?.branches.flatMap((branch) => branch.traces) ?? [],
              metadata: {
                classDefinitionId: ownership.classDefinitionId,
                className: ownership.className,
                selectorBranchNodeIds: branchEvidence?.selectorBranchNodeIds ?? [],
                selectorMatchIds: branchEvidence?.selectorMatchIds ?? [],
                classification: primitiveOverride ? "primitive-override" : "contextual",
              },
            },
          ]
        : [],
    };
    classifications.push(classification);

    if (ownerCandidate?.ownerId && !branchEvidence?.unknownOnly) {
      ownerCandidates.push({
        id: styleOwnerCandidateId({
          targetKind: "class-definition",
          targetId: ownership.classDefinitionId,
          ownerKind: "component",
          ownerId: ownerCandidate.ownerId,
          reasonKey: "selector-context-owner",
        }),
        targetKind: "class-definition",
        targetId: ownership.classDefinitionId,
        ownerKind: "component",
        ownerId: ownerCandidate.ownerId,
        ownerPath: ownerCandidate.ownerPath,
        confidence: primitiveOverride ? "medium" : "low",
        actable: false,
        reasons: ["selector-context-owner"],
        traces: classification.traces,
      });
    }
  }

  return {
    ownerCandidates: dedupeOwnerCandidates(ownerCandidates),
    classifications: dedupeClassifications(classifications),
  };
}

function isContextualSelectorBranch(branch: SelectorBranchReachability): boolean {
  switch (branch.requirement.kind) {
    case "ancestor-descendant":
    case "parent-child":
    case "sibling":
    case "has-descendant":
      return true;
    case "same-node-class-conjunction":
      return branch.requirement.classNames.length > 1;
    case "unsupported":
      return false;
  }
}

function isPrimitiveOverride(input: {
  className: string;
  contextClassNames: string[];
  ownerCandidate: StyleOwnerCandidate | undefined;
  projectEvidence: ProjectEvidenceAssemblyResult;
  stylesheetId: string;
}): boolean {
  if (!input.ownerCandidate?.ownerId || input.contextClassNames.length === 0) {
    return false;
  }
  const component = input.projectEvidence.indexes.componentsById.get(input.ownerCandidate.ownerId);
  const stylesheet = input.projectEvidence.indexes.stylesheetsById.get(input.stylesheetId);
  const ownerBlocks = getOwnerBlockNames({
    ownerComponentName: component?.componentName,
    stylesheetFilePath: stylesheet?.filePath,
  });
  return (
    ownerBlocks.length > 0 &&
    input.contextClassNames.some((className) => belongsToAnyOwnerBlock(className, ownerBlocks)) &&
    !belongsToAnyOwnerBlock(input.className, ownerBlocks)
  );
}

function getOwnerBlockNames(input: {
  ownerComponentName: string | undefined;
  stylesheetFilePath: string | undefined;
}): string[] {
  const blocks = new Set<string>();
  if (input.ownerComponentName) {
    const normalizedComponentName = normalizeName(input.ownerComponentName);
    if (normalizedComponentName) {
      blocks.add(normalizedComponentName);
    }
  }
  if (input.stylesheetFilePath) {
    const normalizedStylesheetName = normalizeName(
      getBaseNameWithoutExtension(input.stylesheetFilePath),
    );
    if (normalizedStylesheetName) {
      blocks.add(normalizedStylesheetName);
    }
  }
  return [...blocks].sort((left, right) => left.localeCompare(right));
}

function belongsToAnyOwnerBlock(className: string, ownerBlocks: string[]): boolean {
  const normalizedClassName = normalizeName(className);
  return ownerBlocks.some(
    (block) =>
      normalizedClassName === block ||
      normalizedClassName.startsWith(`${block}-`) ||
      normalizedClassName.startsWith(`${block}__`) ||
      normalizedClassName.startsWith(`${block}--`),
  );
}

function normalizeName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function getBaseNameWithoutExtension(filePath: string): string {
  const normalized = filePath.split("\\").join("/");
  const fileName = normalized.split("/").at(-1) ?? normalized;
  return fileName.replace(/\.[^.]+$/, "");
}

function groupCandidateIdsByTarget(candidates: StyleOwnerCandidate[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const candidate of candidates) {
    if (candidate.targetKind !== "class-definition") {
      continue;
    }
    const ids = result.get(candidate.targetId) ?? [];
    ids.push(candidate.id);
    result.set(candidate.targetId, ids);
  }
  for (const [targetId, ids] of result.entries()) {
    result.set(targetId, uniqueSorted(ids));
  }
  return result;
}

function minConfidence(left: "low" | "medium" | "high", right: "low" | "medium" | "high") {
  const rank = { low: 0, medium: 1, high: 2 };
  return rank[left] <= rank[right] ? left : right;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function dedupeOwnerCandidates(candidates: StyleOwnerCandidate[]): StyleOwnerCandidate[] {
  const byId = new Map<string, StyleOwnerCandidate>();
  for (const candidate of candidates) {
    byId.set(candidate.id, candidate);
  }
  return [...byId.values()].sort(compareById);
}

function dedupeClassifications(
  classifications: StyleClassificationEvidence[],
): StyleClassificationEvidence[] {
  const byId = new Map<string, StyleClassificationEvidence>();
  for (const classification of classifications) {
    byId.set(classification.id, classification);
  }
  return [...byId.values()].sort(compareById);
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
