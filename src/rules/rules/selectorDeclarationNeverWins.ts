import type {
  AnalysisTrace,
  CascadeConditionalOutcomeBranch,
  CascadeDeclarationCandidate,
  CascadeOutcome,
  CssDeclarationAnalysis,
  SelectorBranchAnalysis,
} from "../../static-analysis-engine/index.js";
import { getStylesheetById } from "../analysisQueries.js";
import type {
  AnalysisEntityRef,
  RuleContext,
  RuleDefinition,
  UnresolvedFinding,
} from "../types.js";

export const selectorDeclarationNeverWinsRule: RuleDefinition = {
  id: "selector-declaration-never-wins",
  run(context) {
    return runSelectorDeclarationNeverWinsRule(context);
  },
};

function runSelectorDeclarationNeverWinsRule(context: RuleContext): UnresolvedFinding[] {
  return context.analysisEvidence.projectEvidence.entities.selectorBranches
    .map((selectorBranch) => buildSelectorDeclarationNeverWinsFinding({ context, selectorBranch }))
    .filter((finding): finding is UnresolvedFinding => Boolean(finding))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildSelectorDeclarationNeverWinsFinding(input: {
  context: RuleContext;
  selectorBranch: SelectorBranchAnalysis;
}): UnresolvedFinding | undefined {
  const cascade = input.context.analysisEvidence.cascadeAnalysis;
  const diagnosticIds = cascade.indexes.diagnosticIdsBySelectorBranchId.get(
    input.selectorBranch.id,
  );
  if (diagnosticIds && diagnosticIds.length > 0) {
    return undefined;
  }

  const candidates = resolveSelectorBranchCandidates({
    context: input.context,
    selectorBranch: input.selectorBranch,
  });
  if (
    candidates.length === 0 ||
    candidates.some((candidate) => candidate.matchCertainty !== "definite")
  ) {
    return undefined;
  }

  const losses = candidates
    .map((candidate) => resolveCandidateLoss({ context: input.context, candidate }))
    .filter((loss): loss is CandidateLoss => Boolean(loss));
  if (losses.length !== candidates.length) {
    return undefined;
  }

  const declarations = resolveSelectorBranchDeclarations({
    context: input.context,
    selectorBranch: input.selectorBranch,
  });
  const winningCandidates = losses
    .map((loss) => loss.winningCandidate)
    .sort((left, right) => left.id.localeCompare(right.id));
  const winningDeclarationIds = [
    ...new Set(
      winningCandidates
        .map((candidate) => candidate.declarationId)
        .filter((declarationId): declarationId is string => Boolean(declarationId)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const stylesheet = input.selectorBranch.stylesheetId
    ? getStylesheetById(input.context.analysisEvidence, input.selectorBranch.stylesheetId)
    : undefined;

  return {
    id: `selector-declaration-never-wins:${input.selectorBranch.id}`,
    ruleId: "selector-declaration-never-wins",
    confidence: "high",
    message: `Selector "${input.selectorBranch.selectorText}" produces declarations that never win the cascade for any modeled match.`,
    subject: {
      kind: "selector-branch",
      id: input.selectorBranch.id,
    },
    location: input.selectorBranch.location,
    evidence: buildEvidence({
      selectorBranch: input.selectorBranch,
      declarationIds: declarations.map((declaration) => declaration.id),
      winningDeclarationIds,
    }),
    traces:
      input.context.includeTraces === false
        ? []
        : buildSelectorDeclarationNeverWinsTraces({
            selectorBranch: input.selectorBranch,
            losses,
          }),
    data: {
      selectorText: input.selectorBranch.selectorText,
      selectorListText: input.selectorBranch.selectorListText,
      stylesheetId: input.selectorBranch.stylesheetId,
      stylesheetFilePath: stylesheet?.filePath,
      candidateIds: candidates.map((candidate) => candidate.id),
      declarationIds: declarations.map((declaration) => declaration.id),
      properties: [...new Set(candidates.map((candidate) => candidate.property))].sort(
        (left, right) => left.localeCompare(right),
      ),
      winningCandidateIds: winningCandidates.map((candidate) => candidate.id),
      winningDeclarationIds,
    },
  };
}

type CandidateLoss = {
  candidate: CascadeDeclarationCandidate;
  outcome: CascadeOutcome;
  winningCandidate: CascadeDeclarationCandidate;
  branch?: CascadeConditionalOutcomeBranch;
};

function resolveSelectorBranchCandidates(input: {
  context: RuleContext;
  selectorBranch: SelectorBranchAnalysis;
}): CascadeDeclarationCandidate[] {
  const cascade = input.context.analysisEvidence.cascadeAnalysis;
  return (cascade.indexes.candidateIdsBySelectorBranchId.get(input.selectorBranch.id) ?? [])
    .map((candidateId) => cascade.indexes.candidateById.get(candidateId))
    .filter((candidate): candidate is CascadeDeclarationCandidate => Boolean(candidate))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function resolveSelectorBranchDeclarations(input: {
  context: RuleContext;
  selectorBranch: SelectorBranchAnalysis;
}): CssDeclarationAnalysis[] {
  const projectEvidence = input.context.analysisEvidence.projectEvidence;
  return (
    projectEvidence.indexes.cssDeclarationIdsBySelectorBranchId.get(input.selectorBranch.id) ?? []
  )
    .map((declarationId) => projectEvidence.indexes.cssDeclarationsById.get(declarationId))
    .filter((declaration): declaration is CssDeclarationAnalysis => Boolean(declaration))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function resolveCandidateLoss(input: {
  context: RuleContext;
  candidate: CascadeDeclarationCandidate;
}): CandidateLoss | undefined {
  const cascade = input.context.analysisEvidence.cascadeAnalysis;
  const outcome = cascade.outcomes.find(
    (candidateOutcome) =>
      candidateOutcome.elementId === input.candidate.elementId &&
      candidateOutcome.property === input.candidate.property,
  );
  if (!outcome || outcome.unresolvedCandidateIds.length > 0) {
    return undefined;
  }

  const directLoss = resolveDirectOutcomeLoss({
    context: input.context,
    candidate: input.candidate,
    outcome,
  });
  if (directLoss) {
    return directLoss;
  }

  return resolveConditionalBranchLoss({
    context: input.context,
    candidate: input.candidate,
    outcome,
  });
}

function resolveDirectOutcomeLoss(input: {
  context: RuleContext;
  candidate: CascadeDeclarationCandidate;
  outcome: CascadeOutcome;
}): CandidateLoss | undefined {
  if (
    input.outcome.winningCandidateId === input.candidate.id ||
    !input.outcome.losingCandidateIds.includes(input.candidate.id) ||
    !input.outcome.winningCandidateId ||
    input.outcome.unresolvedCandidateIds.length > 0 ||
    (input.outcome.certainty !== "definite" &&
      (input.outcome.certainty !== "possible" ||
        Boolean(input.outcome.conditionalBranches?.length)))
  ) {
    return undefined;
  }

  const winningCandidate = input.context.analysisEvidence.cascadeAnalysis.indexes.candidateById.get(
    input.outcome.winningCandidateId,
  );
  if (!winningCandidate) {
    return undefined;
  }

  return {
    candidate: input.candidate,
    outcome: input.outcome,
    winningCandidate,
  };
}

function resolveConditionalBranchLoss(input: {
  context: RuleContext;
  candidate: CascadeDeclarationCandidate;
  outcome: CascadeOutcome;
}): CandidateLoss | undefined {
  const applicableBranches = (input.outcome.conditionalBranches ?? []).filter(
    (branch) =>
      branch.losingCandidateIds.includes(input.candidate.id) ||
      branch.winningCandidateId === input.candidate.id,
  );
  if (applicableBranches.length === 0) {
    return undefined;
  }

  const winningCandidates: CascadeDeclarationCandidate[] = [];
  for (const branch of applicableBranches) {
    if (
      branch.winningCandidateId === input.candidate.id ||
      !branch.losingCandidateIds.includes(input.candidate.id) ||
      branch.unresolvedCandidateIds.length > 0 ||
      !branch.winningCandidateId
    ) {
      return undefined;
    }
    const winningCandidate =
      input.context.analysisEvidence.cascadeAnalysis.indexes.candidateById.get(
        branch.winningCandidateId,
      );
    if (!winningCandidate) {
      return undefined;
    }
    winningCandidates.push(winningCandidate);
  }

  if (input.outcome.winningCandidateId === input.candidate.id) {
    return undefined;
  }
  if (input.outcome.losingCandidateIds.includes(input.candidate.id)) {
    const directLoss = resolveDirectOutcomeLoss({
      context: input.context,
      candidate: input.candidate,
      outcome: input.outcome,
    });
    if (!directLoss) {
      return undefined;
    }
  }

  return {
    candidate: input.candidate,
    outcome: input.outcome,
    winningCandidate: winningCandidates.sort((left, right) => left.id.localeCompare(right.id))[0],
    branch: applicableBranches.sort((left, right) =>
      left.conditionSetId.localeCompare(right.conditionSetId),
    )[0],
  };
}

function buildEvidence(input: {
  selectorBranch: SelectorBranchAnalysis;
  declarationIds: string[];
  winningDeclarationIds: string[];
}): AnalysisEntityRef[] {
  return [
    ...(input.selectorBranch.stylesheetId
      ? [
          {
            kind: "stylesheet" as const,
            id: input.selectorBranch.stylesheetId,
          },
        ]
      : []),
    {
      kind: "selector-branch",
      id: input.selectorBranch.id,
    },
    ...input.declarationIds.map((declarationId) => ({
      kind: "css-declaration" as const,
      id: declarationId,
    })),
    ...input.winningDeclarationIds.map((declarationId) => ({
      kind: "css-declaration" as const,
      id: declarationId,
    })),
  ];
}

function buildSelectorDeclarationNeverWinsTraces(input: {
  selectorBranch: SelectorBranchAnalysis;
  losses: CandidateLoss[];
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:selector-declaration-never-wins:${input.selectorBranch.id}`,
      category: "rule-evaluation",
      summary: `selector "${input.selectorBranch.selectorText}" lost every definite cascade comparison`,
      anchor: input.selectorBranch.location,
      children: input.losses.map((loss) => ({
        traceId: `rule-evaluation:selector-declaration-never-wins:${input.selectorBranch.id}:${loss.candidate.id}`,
        category: "rule-evaluation" as const,
        summary: `candidate for "${loss.candidate.property}" lost by ${loss.branch?.reason ?? loss.outcome.reason}`,
        anchor: input.selectorBranch.location,
        children: [],
        metadata: {
          losingCandidateId: loss.candidate.id,
          winningCandidateId: loss.winningCandidate.id,
          winningDeclarationId: loss.winningCandidate.declarationId,
          winningInlineStyleId: loss.winningCandidate.inlineStyleId,
          outcomeId: loss.outcome.id,
          conditionalBranchId: loss.branch?.conditionSetId,
        },
      })),
      metadata: {
        ruleId: "selector-declaration-never-wins",
        selectorBranchId: input.selectorBranch.id,
        selectorText: input.selectorBranch.selectorText,
      },
    },
  ];
}
