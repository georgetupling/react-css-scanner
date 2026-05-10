import type {
  AnalysisTrace,
  CascadeDeclarationCandidate,
  CascadeOutcome,
  CssDeclarationAnalysis,
} from "../../static-analysis-engine/index.js";
import { getStylesheetById } from "../analysisQueries.js";
import type {
  AnalysisEntityRef,
  RuleContext,
  RuleDefinition,
  UnresolvedFinding,
} from "../types.js";

export const declarationAlwaysShadowedRule: RuleDefinition = {
  id: "declaration-always-shadowed",
  run(context) {
    return runDeclarationAlwaysShadowedRule(context);
  },
};

function runDeclarationAlwaysShadowedRule(context: RuleContext): UnresolvedFinding[] {
  return context.analysisEvidence.projectEvidence.entities.cssDeclarations
    .map((declaration) => buildDeclarationAlwaysShadowedFinding({ context, declaration }))
    .filter((finding): finding is UnresolvedFinding => Boolean(finding))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildDeclarationAlwaysShadowedFinding(input: {
  context: RuleContext;
  declaration: CssDeclarationAnalysis;
}): UnresolvedFinding | undefined {
  const cascade = input.context.analysisEvidence.cascadeAnalysis;
  const diagnosticIds = cascade.indexes.diagnosticIdsByDeclarationId.get(input.declaration.id);
  if (diagnosticIds && diagnosticIds.length > 0) {
    return undefined;
  }

  const candidates = resolveDeclarationCandidates({
    context: input.context,
    declaration: input.declaration,
  });
  if (
    candidates.length === 0 ||
    candidates.some((candidate) => candidate.matchCertainty !== "definite")
  ) {
    return undefined;
  }

  const losses = candidates
    .map((candidate) => resolveDefiniteLoss({ context: input.context, candidate }))
    .filter((loss): loss is DefiniteLoss => Boolean(loss));
  if (losses.length !== candidates.length) {
    return undefined;
  }

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
  const inlineWinnerCount = winningCandidates.filter((candidate) => candidate.inlineStyleId).length;
  const stylesheet = getStylesheetById(
    input.context.analysisEvidence,
    input.declaration.stylesheetId,
  );

  return {
    id: `declaration-always-shadowed:${input.declaration.id}`,
    ruleId: "declaration-always-shadowed",
    confidence: "high",
    message: `Declaration "${formatDeclaration(input.declaration)}" is always shadowed by stronger cascade candidates where it can apply.`,
    subject: {
      kind: "css-declaration",
      id: input.declaration.id,
    },
    location: input.declaration.location,
    evidence: buildEvidence({
      declaration: input.declaration,
      winningDeclarationIds,
    }),
    traces:
      input.context.includeTraces === false
        ? []
        : buildDeclarationAlwaysShadowedTraces({
            declaration: input.declaration,
            stylesheetFilePath: stylesheet?.filePath,
            losses,
          }),
    data: {
      declarationId: input.declaration.id,
      stylesheetId: input.declaration.stylesheetId,
      stylesheetFilePath: stylesheet?.filePath,
      selectorText: input.declaration.selectorText,
      property: input.declaration.property,
      value: input.declaration.value,
      important: input.declaration.important,
      candidateIds: candidates.map((candidate) => candidate.id),
      winningCandidateIds: winningCandidates.map((candidate) => candidate.id),
      winningDeclarationIds,
      inlineWinnerCount,
    },
  };
}

type DefiniteLoss = {
  candidate: CascadeDeclarationCandidate;
  outcome: CascadeOutcome;
  winningCandidate: CascadeDeclarationCandidate;
};

function resolveDeclarationCandidates(input: {
  context: RuleContext;
  declaration: CssDeclarationAnalysis;
}): CascadeDeclarationCandidate[] {
  const cascade = input.context.analysisEvidence.cascadeAnalysis;
  return (cascade.indexes.candidateIdsByDeclarationId.get(input.declaration.id) ?? [])
    .map((candidateId) => cascade.indexes.candidateById.get(candidateId))
    .filter((candidate): candidate is CascadeDeclarationCandidate => Boolean(candidate))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function resolveDefiniteLoss(input: {
  context: RuleContext;
  candidate: CascadeDeclarationCandidate;
}): DefiniteLoss | undefined {
  const cascade = input.context.analysisEvidence.cascadeAnalysis;
  const outcome = cascade.outcomes.find(
    (candidateOutcome) =>
      candidateOutcome.elementId === input.candidate.elementId &&
      candidateOutcome.property === input.candidate.property,
  );
  if (
    !outcome ||
    outcome.certainty !== "definite" ||
    outcome.unresolvedCandidateIds.length > 0 ||
    outcome.winningCandidateId === input.candidate.id ||
    !outcome.losingCandidateIds.includes(input.candidate.id) ||
    !outcome.winningCandidateId
  ) {
    return undefined;
  }

  const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
  if (!winningCandidate) {
    return undefined;
  }

  return {
    candidate: input.candidate,
    outcome,
    winningCandidate,
  };
}

function buildEvidence(input: {
  declaration: CssDeclarationAnalysis;
  winningDeclarationIds: string[];
}): AnalysisEntityRef[] {
  return [
    {
      kind: "stylesheet",
      id: input.declaration.stylesheetId,
    },
    {
      kind: "css-declaration",
      id: input.declaration.id,
    },
    ...input.declaration.selectorBranchIds.map((selectorBranchId) => ({
      kind: "selector-branch" as const,
      id: selectorBranchId,
    })),
    ...input.winningDeclarationIds.map((declarationId) => ({
      kind: "css-declaration" as const,
      id: declarationId,
    })),
  ];
}

function buildDeclarationAlwaysShadowedTraces(input: {
  declaration: CssDeclarationAnalysis;
  stylesheetFilePath?: string;
  losses: DefiniteLoss[];
}): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:declaration-always-shadowed:${input.declaration.id}`,
      category: "rule-evaluation",
      summary: `declaration "${formatDeclaration(input.declaration)}" lost every definite cascade comparison`,
      anchor: input.declaration.location,
      children: input.losses.map((loss) => ({
        traceId: `rule-evaluation:declaration-always-shadowed:${input.declaration.id}:${loss.candidate.id}`,
        category: "rule-evaluation" as const,
        summary: `candidate for "${loss.candidate.property}" lost by ${loss.outcome.reason}`,
        anchor: input.declaration.location,
        children: [],
        metadata: {
          losingCandidateId: loss.candidate.id,
          winningCandidateId: loss.winningCandidate.id,
          winningDeclarationId: loss.winningCandidate.declarationId,
          winningInlineStyleId: loss.winningCandidate.inlineStyleId,
          outcomeId: loss.outcome.id,
          comparisonReason: loss.outcome.reason,
        },
      })),
      metadata: {
        ruleId: "declaration-always-shadowed",
        declarationId: input.declaration.id,
        stylesheetId: input.declaration.stylesheetId,
        stylesheetFilePath: input.stylesheetFilePath,
        selectorText: input.declaration.selectorText,
        property: input.declaration.property,
        value: input.declaration.value,
      },
    },
  ];
}

function formatDeclaration(declaration: CssDeclarationAnalysis): string {
  return `${declaration.property}: ${declaration.value}${declaration.important ? " !important" : ""}`;
}
