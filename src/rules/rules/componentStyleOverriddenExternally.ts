import type {
  CascadeDeclarationCandidate,
  ComponentAnalysis,
  StyleOwnerCandidate,
} from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";
import {
  collectDefiniteCascadeLosses,
  formatCandidateSource,
  type DefiniteCascadeLoss,
} from "./cascadeRuleUtils.js";

const PRIVATE_OWNER_REASONS = new Set([
  "sibling-basename-convention",
  "component-folder-convention",
]);

export const componentStyleOverriddenExternallyRule: RuleDefinition = {
  id: "component-style-overridden-externally",
  run(context) {
    return dedupeExternalOverrideLosses(
      collectDefiniteCascadeLosses(context.analysisEvidence)
        .map((loss) => resolveExternalOverride(context, loss))
        .filter((loss): loss is ExternalOverrideLoss => Boolean(loss)),
    )
      .map((loss) => buildFinding(context, loss))
      .sort((left, right) => left.id.localeCompare(right.id));
  },
};

type ExternalOverrideLoss = {
  loss: DefiniteCascadeLoss;
  ownerComponent: ComponentAnalysis;
  overridingComponent: ComponentAnalysis;
};

function resolveExternalOverride(
  context: RuleContext,
  loss: DefiniteCascadeLoss,
): ExternalOverrideLoss | undefined {
  const ownerComponent = resolvePrivateStylesheetOwnerComponent(
    context,
    loss.declaration.stylesheetId,
  );
  if (!ownerComponent) {
    return undefined;
  }

  const overridingComponent = resolveOverridingComponent(context, loss.winningCandidate);
  if (!overridingComponent || overridingComponent.id === ownerComponent.id) {
    return undefined;
  }

  return { loss, ownerComponent, overridingComponent };
}

function resolvePrivateStylesheetOwnerComponent(
  context: RuleContext,
  stylesheetId: string,
): ComponentAnalysis | undefined {
  const stylesheetOwnership = getStylesheetOwnershipByStylesheetId(
    context.analysisEvidence,
    stylesheetId,
  );
  if (!stylesheetOwnership) {
    return undefined;
  }

  const ownerCandidates = stylesheetOwnership.ownerCandidateIds
    .map((candidateId) =>
      context.analysisEvidence.ownershipInference?.indexes.ownerCandidateById.get(candidateId),
    )
    .filter((candidate): candidate is StyleOwnerCandidate => Boolean(candidate));
  const ownerCandidate = findPrivateComponentOwnerCandidate(ownerCandidates);
  const ownerComponentId = ownerCandidate ? getOwnerCandidateId(ownerCandidate) : undefined;
  return ownerComponentId
    ? context.analysisEvidence.projectEvidence.indexes.componentsById.get(ownerComponentId)
    : undefined;
}

function resolveOverridingComponent(
  context: RuleContext,
  candidate: CascadeDeclarationCandidate,
): ComponentAnalysis | undefined {
  if (candidate.declarationId) {
    const declaration = context.analysisEvidence.projectEvidence.indexes.cssDeclarationsById.get(
      candidate.declarationId,
    );
    if (!declaration) {
      return undefined;
    }
    return resolvePrivateStylesheetOwnerComponent(context, declaration.stylesheetId);
  }

  const element = context.analysisEvidence.selectorReachability.indexes.renderElementById.get(
    candidate.elementId,
  );
  const componentNodeId = element?.placementComponentNodeId ?? element?.emittingComponentNodeId;
  const componentId = componentNodeId
    ? projectComponentIdFromNodeId(context, componentNodeId)
    : undefined;
  return componentId
    ? context.analysisEvidence.projectEvidence.indexes.componentsById.get(componentId)
    : undefined;
}

function projectComponentIdFromNodeId(
  context: RuleContext,
  componentNodeId: string,
): string | undefined {
  const prefix = "component:";
  if (!componentNodeId.startsWith(prefix)) {
    return undefined;
  }
  const componentKey = componentNodeId.slice(prefix.length).split("\\").join("/");
  return context.analysisEvidence.projectEvidence.entities.components.find(
    (component) => component.componentKey === componentKey,
  )?.id;
}

function dedupeExternalOverrideLosses(losses: ExternalOverrideLoss[]): ExternalOverrideLoss[] {
  const seen = new Set<string>();
  const result: ExternalOverrideLoss[] = [];
  for (const loss of losses) {
    const key = [
      loss.loss.declaration.id,
      loss.loss.winningCandidate.declarationId ?? loss.loss.winningCandidate.inlineStyleId,
      loss.loss.candidate.property,
    ].join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(loss);
  }
  return result;
}

function buildFinding(context: RuleContext, override: ExternalOverrideLoss): UnresolvedFinding {
  const { loss, ownerComponent, overridingComponent } = override;
  const stylesheet = context.analysisEvidence.projectEvidence.indexes.stylesheetsById.get(
    loss.declaration.stylesheetId,
  );

  return {
    id: `component-style-overridden-externally:${loss.declaration.id}:${loss.winningCandidate.id}`,
    ruleId: "component-style-overridden-externally",
    confidence: "high",
    message: `${ownerComponent.componentName}'s declaration "${formatCandidateSource(loss.candidate)}" is overridden by ${overridingComponent.componentName}'s stronger cascade candidate.`,
    subject: {
      kind: "css-declaration",
      id: loss.declaration.id,
    },
    location: loss.declaration.location,
    evidence: [
      { kind: "component", id: ownerComponent.id },
      { kind: "component", id: overridingComponent.id },
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
              traceId: `rule-evaluation:component-style-overridden-externally:${loss.declaration.id}:${loss.winningCandidate.id}`,
              category: "rule-evaluation",
              summary: `component-owned declaration lost to a different component-owned cascade candidate`,
              anchor: loss.declaration.location,
              children: loss.outcome.traces,
              metadata: {
                ruleId: "component-style-overridden-externally",
                ownerComponentId: ownerComponent.id,
                overridingComponentId: overridingComponent.id,
                losingCandidateId: loss.candidate.id,
                winningCandidateId: loss.winningCandidate.id,
              },
            },
          ],
    data: {
      ownerComponentId: ownerComponent.id,
      ownerComponentName: ownerComponent.componentName,
      ownerComponentFilePath: ownerComponent.filePath,
      overridingComponentId: overridingComponent.id,
      overridingComponentName: overridingComponent.componentName,
      overridingComponentFilePath: overridingComponent.filePath,
      stylesheetId: loss.declaration.stylesheetId,
      stylesheetFilePath: stylesheet?.filePath,
      declarationId: loss.declaration.id,
      winningDeclarationId: loss.winningDeclaration?.id,
      winningInlineStyleId: loss.winningCandidate.inlineStyleId,
      selectorText: loss.declaration.selectorText,
      property: loss.candidate.property,
      losingValue: loss.candidate.value,
      winningValue: loss.winningCandidate.value,
      outcomeReason: loss.outcome.reason,
    },
  };
}

function getStylesheetOwnershipByStylesheetId(
  analysis: RuleContext["analysisEvidence"],
  stylesheetId: string,
) {
  return analysis.ownershipInference?.indexes.stylesheetOwnershipByStylesheetId.get(stylesheetId);
}

function findPrivateComponentOwnerCandidate(
  candidates: StyleOwnerCandidate[],
): StyleOwnerCandidate | undefined {
  return candidates.find(
    (candidate) =>
      candidate.ownerKind === "component" &&
      getOwnerCandidateId(candidate) &&
      candidate.confidence === "high" &&
      candidate.reasons.some((reason) => PRIVATE_OWNER_REASONS.has(reason)),
  );
}

function getOwnerCandidateId(candidate: StyleOwnerCandidate): string | undefined {
  return candidate.ownerId ?? candidate.id;
}
