import { classDefinitionConsumerEvidenceId } from "./ids.js";
import type { ProjectEvidenceAssemblyResult } from "../project-evidence/index.js";
import type { SelectorReachabilityResult } from "../selector-reachability/index.js";
import type {
  ClassConsumerSummary,
  ClassDefinitionConsumerEvidence,
  ClassOwnershipEvidence,
  OwnershipConsumerAvailability,
  OwnershipConsumptionKind,
} from "./types.js";

export function buildDefinitionConsumers(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  selectorReachability: SelectorReachabilityResult;
}): ClassDefinitionConsumerEvidence[] {
  void input.selectorReachability;

  const referencesById = new Map(
    input.projectEvidence.entities.classReferences.map((reference) => [reference.id, reference]),
  );
  const cssModuleMemberReferencesById = new Map(
    input.projectEvidence.entities.cssModuleMemberReferences.map((reference) => [
      reference.id,
      reference,
    ]),
  );
  const consumers: ClassDefinitionConsumerEvidence[] = [];

  for (const match of input.projectEvidence.relations.referenceMatches) {
    if (match.matchKind !== "reachable-stylesheet") {
      continue;
    }

    const reference = referencesById.get(match.referenceId);
    if (!reference) {
      continue;
    }

    consumers.push({
      id: classDefinitionConsumerEvidenceId({
        classDefinitionId: match.definitionId,
        referenceId: match.referenceId,
        matchId: match.id,
      }),
      classDefinitionId: match.definitionId,
      referenceId: match.referenceId,
      matchId: match.id,
      consumingComponentId:
        reference.classNameComponentIds?.[match.className] ?? reference.componentId,
      emittingComponentId: reference.emittedByComponentId,
      supplyingComponentId: reference.suppliedByComponentId,
      consumingSourceFileId: reference.sourceFileId,
      selectorBranchNodeIds: [],
      selectorMatchIds: [],
      availability: mapReferenceAvailability(match.reachability),
      consumptionKind: getReferenceConsumptionKind(reference),
      confidence: match.referenceClassKind === "definite" ? "high" : "medium",
      traces: match.traces,
    });
  }

  for (const match of input.projectEvidence.relations.cssModuleMemberMatches) {
    if (match.status !== "matched" || !match.definitionId) {
      continue;
    }

    const reference = cssModuleMemberReferencesById.get(match.referenceId);
    if (!reference) {
      continue;
    }

    consumers.push({
      id: classDefinitionConsumerEvidenceId({
        classDefinitionId: match.definitionId,
        referenceId: match.referenceId,
        matchId: match.id,
      }),
      classDefinitionId: match.definitionId,
      referenceId: match.referenceId,
      matchId: match.id,
      consumingSourceFileId: reference.sourceFileId,
      selectorBranchNodeIds: [],
      selectorMatchIds: [],
      availability: "definite",
      consumptionKind: "css-module-member",
      confidence: "high",
      traces: match.traces,
    });
  }

  return consumers.sort(compareById);
}

export function applyConsumerSummariesToClassOwnership(input: {
  classOwnership: ClassOwnershipEvidence[];
  definitionConsumers: ClassDefinitionConsumerEvidence[];
}): ClassOwnershipEvidence[] {
  const consumersByDefinitionId = new Map<string, ClassDefinitionConsumerEvidence[]>();
  for (const consumer of input.definitionConsumers) {
    const consumers = consumersByDefinitionId.get(consumer.classDefinitionId) ?? [];
    consumers.push(consumer);
    consumersByDefinitionId.set(consumer.classDefinitionId, consumers);
  }

  return input.classOwnership.map((ownership) => ({
    ...ownership,
    consumerSummary: buildConsumerSummary({
      ownership,
      consumers: consumersByDefinitionId.get(ownership.classDefinitionId) ?? [],
    }),
  }));
}

function buildConsumerSummary(input: {
  ownership: ClassOwnershipEvidence;
  consumers: ClassDefinitionConsumerEvidence[];
}): ClassConsumerSummary {
  return {
    classDefinitionId: input.ownership.classDefinitionId,
    className: input.ownership.className,
    consumerComponentIds: uniqueSorted(
      input.consumers
        .map(
          (consumer) =>
            consumer.consumingComponentId ??
            consumer.emittingComponentId ??
            consumer.supplyingComponentId,
        )
        .filter((id): id is string => Boolean(id)),
    ),
    consumerSourceFileIds: uniqueSorted(
      input.consumers.map((consumer) => consumer.consumingSourceFileId),
    ),
    referenceIds: uniqueSorted(input.consumers.map((consumer) => consumer.referenceId)),
    matchIds: uniqueSorted(
      input.consumers.map((consumer) => consumer.matchId).filter((id): id is string => Boolean(id)),
    ),
  };
}

function mapReferenceAvailability(availability: string): OwnershipConsumerAvailability {
  switch (availability) {
    case "definite":
    case "possible":
    case "unknown":
    case "unavailable":
      return availability;
    default:
      return "unknown";
  }
}

function getReferenceConsumptionKind(input: {
  suppliedByComponentId?: string;
  renderSubtreeId?: string;
}): OwnershipConsumptionKind {
  if (input.suppliedByComponentId) {
    return "forwarded-prop";
  }
  if (input.renderSubtreeId) {
    return "slot-child";
  }
  return "direct-reference";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
