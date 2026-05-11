import { getSelectorBranchById, getStylesheetById } from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import {
  collectDefiniteCascadeLosses,
  dedupeLossesByKey,
  type DefiniteCascadeLoss,
} from "./cascadeRuleUtils.js";

export const selectorSpecificityConflictRule: RuleDefinition = {
  id: "selector-specificity-conflict",
  run(context) {
    return dedupeLossesByKey(
      collectDefiniteCascadeLosses(context.analysisEvidence).filter(
        (loss) => loss.outcome.reason === "specificity" && Boolean(loss.candidate.selectorBranchId),
      ),
      (loss) =>
        [
          loss.candidate.selectorBranchId,
          loss.winningCandidate.selectorBranchId ?? loss.winningCandidate.declarationId,
          loss.candidate.property,
        ].join(":"),
    )
      .map((loss) => buildFinding(context, loss))
      .filter((finding): finding is UnresolvedFinding => Boolean(finding))
      .sort((left, right) => left.id.localeCompare(right.id));
  },
};

function buildFinding(
  context: RuleContext,
  loss: DefiniteCascadeLoss,
): UnresolvedFinding | undefined {
  if (!loss.candidate.selectorBranchId) {
    return undefined;
  }

  const selectorBranch = getSelectorBranchById(
    context.analysisEvidence,
    loss.candidate.selectorBranchId,
  );
  if (!selectorBranch) {
    return undefined;
  }

  const winningSelectorBranch = loss.winningCandidate.selectorBranchId
    ? getSelectorBranchById(context.analysisEvidence, loss.winningCandidate.selectorBranchId)
    : undefined;
  const stylesheet = selectorBranch.stylesheetId
    ? getStylesheetById(context.analysisEvidence, selectorBranch.stylesheetId)
    : undefined;

  return {
    id: `selector-specificity-conflict:${selectorBranch.id}:${loss.winningCandidate.id}:${loss.candidate.property}`,
    ruleId: "selector-specificity-conflict",
    confidence: "high",
    message: `Selector "${selectorBranch.selectorText}" conflicts with a more specific selector for "${loss.candidate.property}" and loses the cascade.`,
    subject: {
      kind: "selector-branch",
      id: selectorBranch.id,
    },
    location: selectorBranch.location,
    evidence: [
      { kind: "selector-branch", id: selectorBranch.id },
      { kind: "css-declaration", id: loss.declaration.id },
      ...(winningSelectorBranch
        ? [{ kind: "selector-branch" as const, id: winningSelectorBranch.id }]
        : []),
      ...(loss.winningDeclaration
        ? [{ kind: "css-declaration" as const, id: loss.winningDeclaration.id }]
        : []),
    ],
    traces:
      context.includeTraces === false
        ? []
        : [
            {
              traceId: `rule-evaluation:selector-specificity-conflict:${selectorBranch.id}:${loss.winningCandidate.id}`,
              category: "rule-evaluation",
              summary: `selector "${selectorBranch.selectorText}" lost by specificity`,
              anchor: selectorBranch.location,
              children: loss.outcome.traces,
              metadata: {
                ruleId: "selector-specificity-conflict",
                outcomeId: loss.outcome.id,
                losingSpecificity: loss.candidate.cascadeKey.specificity,
                winningSpecificity: loss.winningCandidate.cascadeKey.specificity,
              },
            },
          ],
    data: {
      selectorBranchId: selectorBranch.id,
      selectorText: selectorBranch.selectorText,
      winningSelectorBranchId: winningSelectorBranch?.id,
      winningSelectorText: winningSelectorBranch?.selectorText,
      stylesheetId: selectorBranch.stylesheetId,
      stylesheetFilePath: stylesheet?.filePath,
      property: loss.candidate.property,
      losingValue: loss.candidate.value,
      winningValue: loss.winningCandidate.value,
      losingSpecificity: loss.candidate.cascadeKey.specificity,
      winningSpecificity: loss.winningCandidate.cascadeKey.specificity,
      losingCandidateId: loss.candidate.id,
      winningCandidateId: loss.winningCandidate.id,
    },
  };
}
