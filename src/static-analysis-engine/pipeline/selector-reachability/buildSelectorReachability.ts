import { parseSelectorBranch } from "../../libraries/selector-parsing/parseSelectorBranch.js";
import type { RenderStructureResult } from "../render-structure/index.js";
import { getBranchConfidence, getBranchStatus } from "./branchStatus.js";
import { buildDiagnostics } from "./diagnostics.js";
import { buildIndexes, compareSelectorBranches } from "./indexes.js";
import { buildSelectorRenderMatchIndexes } from "./renderMatchIndexes.js";
import { projectSelectorBranchRequirement } from "./selectorRequirements.js";
import {
  buildElementMatchesForClassNames,
  buildSubjectBranchMatches,
  getCandidateElementIds,
} from "./subjectMatches.js";
import {
  buildStructuralMatches,
  projectStructuralConstraintFromRequirement,
} from "./structuralMatches.js";
import type {
  SelectorBranchMatch,
  SelectorBranchReachability,
  SelectorElementMatch,
  SelectorReachabilityDiagnostic,
  SelectorReachabilityResult,
} from "./types.js";
import { uniqueSorted } from "./utils.js";

export function buildSelectorReachability(
  input: RenderStructureResult,
): SelectorReachabilityResult {
  const renderIndexes = buildSelectorRenderMatchIndexes(input.renderModel);
  const selectorBranches: SelectorBranchReachability[] = [];
  const elementMatches: SelectorElementMatch[] = [];
  const branchMatches: SelectorBranchMatch[] = [];
  const diagnostics: SelectorReachabilityDiagnostic[] = [];

  for (const branch of [...input.graph.nodes.selectorBranches].sort(compareSelectorBranches)) {
    const parsedBranch = parseSelectorBranch(branch.selectorText);
    const requirement = projectSelectorBranchRequirement(parsedBranch, { includeTraces: true });
    const structuralConstraint = projectStructuralConstraintFromRequirement(requirement);
    const branchDiagnostics = buildDiagnostics({
      branch,
      parsedBranch,
      requirement,
    });
    diagnostics.push(...branchDiagnostics);

    const branchElementMatches: SelectorElementMatch[] = [];
    if (branch.subjectClassNames.length > 0 && branchDiagnostics.length === 0) {
      branchElementMatches.push(
        ...buildElementMatchesForClassNames({
          branch,
          classNames: branch.subjectClassNames,
          elementIds: getCandidateElementIds({
            classNames: branch.subjectClassNames,
            elementIdsByClassName: renderIndexes.elementIdsByClassName,
            renderIndexes,
          }),
          renderIndexes,
        }),
      );
    }

    const structuralMatches = structuralConstraint
      ? buildStructuralMatches({
          branch,
          constraint: structuralConstraint,
          renderStructure: input,
          renderIndexes,
        })
      : undefined;
    if (structuralMatches) {
      branchElementMatches.push(...structuralMatches.elementMatches);
    }

    const candidateBranchMatches =
      structuralMatches?.branchMatches ??
      buildSubjectBranchMatches({
        branch,
        renderStructure: input,
        elementMatches: branchElementMatches,
      });

    elementMatches.push(...branchElementMatches);
    branchMatches.push(...candidateBranchMatches);

    selectorBranches.push({
      selectorBranchNodeId: branch.id,
      selectorNodeId: branch.selectorNodeId,
      ...(branch.ruleDefinitionNodeId ? { ruleDefinitionNodeId: branch.ruleDefinitionNodeId } : {}),
      ...(branch.stylesheetNodeId ? { stylesheetNodeId: branch.stylesheetNodeId } : {}),
      branchText: branch.selectorText,
      selectorListText: branch.selectorListText,
      branchIndex: branch.branchIndex,
      branchCount: branch.branchCount,
      ruleKey: branch.ruleKey,
      requirement,
      subject: {
        requiredClassNames: uniqueSorted(branch.subjectClassNames),
        unsupportedParts: branchDiagnostics.map((diagnostic) => ({
          reason: diagnostic.message,
          ...(diagnostic.location ? { location: diagnostic.location } : {}),
        })),
      },
      status: getBranchStatus(branchDiagnostics, candidateBranchMatches),
      confidence: getBranchConfidence(branchDiagnostics, candidateBranchMatches),
      matchIds: candidateBranchMatches
        .map((match) => match.id)
        .sort((left, right) => left.localeCompare(right)),
      diagnosticIds: branchDiagnostics.map((diagnostic) => diagnostic.id),
      ...(branch.location ? { location: branch.location } : {}),
      traces: [],
    });
  }

  const indexes = buildIndexes({
    selectorBranches,
    elementMatches,
    branchMatches,
    diagnostics,
  });

  return {
    meta: {
      generatedAtStage: "selector-reachability",
      selectorBranchCount: selectorBranches.length,
      elementMatchCount: elementMatches.length,
      branchMatchCount: branchMatches.length,
      diagnosticCount: diagnostics.length,
    },
    selectorBranches,
    elementMatches,
    branchMatches,
    diagnostics,
    indexes,
  };
}
