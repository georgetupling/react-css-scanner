import { getStylesheetById } from "../analysisQueries.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import {
  collectDefiniteCascadeLosses,
  dedupeLossesByKey,
  formatCandidateSource,
  type DefiniteCascadeLoss,
} from "./cascadeRuleUtils.js";

export const samePropertyConflictRule: RuleDefinition = {
  id: "same-property-conflict",
  run(context) {
    return dedupeLossesByKey(collectDefiniteCascadeLosses(context.analysisEvidence), (loss) =>
      [
        loss.declaration.id,
        loss.winningCandidate.declarationId ?? loss.winningCandidate.inlineStyleId,
        loss.candidate.property,
      ].join(":"),
    )
      .map((loss) => buildFinding(context, loss))
      .sort((left, right) => left.id.localeCompare(right.id));
  },
};

function buildFinding(context: RuleContext, loss: DefiniteCascadeLoss): UnresolvedFinding {
  const stylesheet = getStylesheetById(context.analysisEvidence, loss.declaration.stylesheetId);

  return {
    id: `same-property-conflict:${loss.declaration.id}:${loss.winningCandidate.id}`,
    ruleId: "same-property-conflict",
    confidence: "high",
    message: `Declaration "${formatCandidateSource(loss.candidate)}" conflicts with "${formatCandidateSource(loss.winningCandidate)}"; the latter wins the cascade for "${loss.candidate.property}".`,
    subject: {
      kind: "css-declaration",
      id: loss.declaration.id,
    },
    location: loss.declaration.location,
    evidence: [
      { kind: "stylesheet", id: loss.declaration.stylesheetId },
      { kind: "css-declaration", id: loss.declaration.id },
      ...(loss.winningDeclaration
        ? [{ kind: "css-declaration" as const, id: loss.winningDeclaration.id }]
        : []),
    ],
    traces:
      context.includeTraces === false
        ? []
        : [
            {
              traceId: `rule-evaluation:same-property-conflict:${loss.declaration.id}:${loss.winningCandidate.id}`,
              category: "rule-evaluation",
              summary: `definite cascade outcome compared conflicting "${loss.candidate.property}" values`,
              anchor: loss.declaration.location,
              children: loss.outcome.traces,
              metadata: {
                ruleId: "same-property-conflict",
                outcomeId: loss.outcome.id,
                losingCandidateId: loss.candidate.id,
                winningCandidateId: loss.winningCandidate.id,
              },
            },
          ],
    data: {
      declarationId: loss.declaration.id,
      winningDeclarationId: loss.winningDeclaration?.id,
      winningInlineStyleId: loss.winningCandidate.inlineStyleId,
      stylesheetId: loss.declaration.stylesheetId,
      stylesheetFilePath: stylesheet?.filePath,
      selectorText: loss.declaration.selectorText,
      property: loss.candidate.property,
      losingValue: loss.candidate.value,
      winningValue: loss.winningCandidate.value,
      outcomeReason: loss.outcome.reason,
      losingCandidateId: loss.candidate.id,
      winningCandidateId: loss.winningCandidate.id,
    },
  };
}
