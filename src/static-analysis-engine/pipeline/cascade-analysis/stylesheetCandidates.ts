import type {
  ProjectEvidenceAssemblyResult,
  ProjectEvidenceId,
  SelectorBranchAnalysis,
} from "../project-evidence/index.js";
import type {
  SelectorBranchMatch,
  SelectorReachabilityResult,
} from "../selector-reachability/index.js";
import type { RenderModel } from "../render-structure/index.js";
import type { CssScopeSelectorRequirementFact } from "../../types/css.js";
import { normalizeAtRuleConditions } from "./atRuleConditions.js";
import { getDeclarationLayer } from "./cascadeKeys.js";
import { createConditionSet, mapMatchCertainty } from "./conditions.js";
import { cascadeDeclarationCandidateId } from "./ids.js";
import { compareById } from "./outcomes.js";
import { getCssPropertyEffectsForDeclaration } from "./propertyEffects.js";
import type { RuntimeStylesheetOrder } from "./runtimeStylesheetOrder.js";
import { calculateSelectorSpecificity } from "./specificity.js";
import type {
  CascadeAnalysisDiagnostic,
  CascadeAnalysisDiagnosticCode,
  CascadeConditionSet,
  CascadeDeclarationCandidate,
  CssDeclarationCascadeRecord,
} from "./types.js";

export function buildStylesheetCascadeDeclarations(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  stylesheetOrderById: RuntimeStylesheetOrder["stylesheetOrderById"];
  layerOrderByName: Map<string, number>;
  diagnostics: CascadeAnalysisDiagnostic[];
  createDiagnostic: (input: {
    code: CascadeAnalysisDiagnosticCode;
    message: string;
    declarationId?: ProjectEvidenceId;
    selectorBranchId?: ProjectEvidenceId;
    elementId?: string;
    location?: CascadeAnalysisDiagnostic["location"];
    traces: CascadeAnalysisDiagnostic["traces"];
  }) => CascadeAnalysisDiagnostic;
}): CssDeclarationCascadeRecord[] {
  return input.projectEvidence.entities.cssDeclarations.map((declaration) => {
    const specificity = calculateSelectorSpecificity(declaration.selectorText);
    if (!specificity.supported) {
      input.diagnostics.push(
        input.createDiagnostic({
          code: "unsupported-selector-specificity",
          message: `Selector specificity could not be calculated for "${declaration.selectorText}".`,
          declarationId: declaration.id,
          location: declaration.location,
          traces: [],
        }),
      );
    }

    const stylesheetSourceOrder = input.stylesheetOrderById.get(declaration.stylesheetId);
    const layer = getDeclarationLayer(declaration.atRuleContext, input.layerOrderByName);
    return {
      declarationId: declaration.id,
      property: declaration.property,
      value: declaration.value,
      important: declaration.important,
      cascadeKey: {
        origin: "author",
        important: declaration.important,
        layer,
        specificity: specificity.specificity,
        sourceOrder:
          (stylesheetSourceOrder ?? 0) * 1_000_000 +
          declaration.ruleSourceOrder * 1000 +
          declaration.declarationIndex,
        orderKnown: stylesheetSourceOrder !== undefined,
      },
    } satisfies CssDeclarationCascadeRecord;
  });
}

export function buildStylesheetDeclarationCandidates(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  renderModel: RenderModel;
  runtimeStylesheetOrder: RuntimeStylesheetOrder;
  selectorReachability: SelectorReachabilityResult;
  declarations: CssDeclarationCascadeRecord[];
  conditionSetsById: Map<string, CascadeConditionSet>;
  diagnostics: CascadeAnalysisDiagnostic[];
  includeTraces: boolean;
  createDiagnostic: (input: {
    code: CascadeAnalysisDiagnosticCode;
    message: string;
    declarationId?: ProjectEvidenceId;
    selectorBranchId?: ProjectEvidenceId;
    elementId?: string;
    location?: CascadeAnalysisDiagnostic["location"];
    traces: CascadeAnalysisDiagnostic["traces"];
  }) => CascadeAnalysisDiagnostic;
}): CascadeDeclarationCandidate[] {
  const candidates: CascadeDeclarationCandidate[] = [];

  for (const declaration of input.projectEvidence.entities.cssDeclarations) {
    const atRuleConditions = normalizeAtRuleConditions(declaration.atRuleContext);
    if (atRuleConditions.applicability === "impossible") {
      continue;
    }

    if (!declaration.location) {
      input.diagnostics.push(
        input.createDiagnostic({
          code: "missing-declaration-location",
          message: `Declaration "${declaration.property}" has no source location.`,
          declarationId: declaration.id,
          traces: [],
        }),
      );
    }

    const declarationRecord = input.declarations.find(
      (record) => record.declarationId === declaration.id,
    );
    if (!declarationRecord) {
      continue;
    }

    for (const selectorBranchId of declaration.selectorBranchIds) {
      const selectorBranch =
        input.projectEvidence.indexes.selectorBranchesById.get(selectorBranchId);
      if (!selectorBranch) {
        input.diagnostics.push(
          input.createDiagnostic({
            code: "missing-selector-branch-match",
            message: `Declaration "${declaration.property}" could not be linked to selector branch evidence.`,
            declarationId: declaration.id,
            selectorBranchId,
            location: declaration.location,
            traces: [],
          }),
        );
        continue;
      }
      const branchSpecificity = calculateSelectorSpecificity(selectorBranch.selectorText);
      if (!branchSpecificity.supported) {
        input.diagnostics.push(
          input.createDiagnostic({
            code: "unsupported-selector-specificity",
            message: `Selector specificity could not be calculated for "${selectorBranch.selectorText}".`,
            declarationId: declaration.id,
            selectorBranchId,
            location: selectorBranch.location ?? declaration.location,
            traces: [],
          }),
        );
      }

      const propertyEffects = getCssPropertyEffectsForDeclaration(declaration);

      const matches = findMatchesForSelectorBranch(selectorBranch, input.selectorReachability);
      if (matches.length === 0) {
        input.diagnostics.push(
          input.createDiagnostic({
            code: "missing-selector-branch-match",
            message: `Selector branch "${selectorBranch.selectorText}" has no matched render elements for cascade analysis.`,
            declarationId: declaration.id,
            selectorBranchId,
            location: selectorBranch.location ?? declaration.location,
            traces: input.includeTraces ? selectorBranch.traces : [],
          }),
        );
        continue;
      }

      for (const match of matches) {
        const scopeProximity = getScopeProximityForElement({
          atRuleContext: declaration.atRuleContext,
          elementId: match.subjectElementId,
          renderModel: input.renderModel,
        });
        if (scopeProximity.applicability === "impossible") {
          continue;
        }

        const runtimeContexts = getRuntimeContextsForCandidate({
          declarationStylesheetId: declaration.stylesheetId,
          match,
          renderModel: input.renderModel,
          runtimeStylesheetOrder: input.runtimeStylesheetOrder,
        });

        for (const runtimeContext of runtimeContexts) {
          const conditionSet = createConditionSet({
            declaration,
            selectorText: selectorBranch.selectorText,
            match,
            ...(runtimeContext.runtimeContextId
              ? { runtimeContextIds: [runtimeContext.runtimeContextId] }
              : {}),
            includeTraces: input.includeTraces,
          });
          input.conditionSetsById.set(conditionSet.id, conditionSet);
          for (const propertyEffect of propertyEffects) {
            const cascadeKey = {
              ...declarationRecord.cascadeKey,
              ...runtimeContext.cascadeKeyOverride,
              specificity: branchSpecificity.specificity,
              ...(scopeProximity.scopeProximity
                ? { scopeProximity: scopeProximity.scopeProximity }
                : {}),
            };
            candidates.push({
              id: cascadeDeclarationCandidateId({
                declarationId: declaration.id,
                selectorBranchId,
                elementId: match.subjectElementId,
                ...(runtimeContext.runtimeContextId
                  ? { runtimeContextId: runtimeContext.runtimeContextId }
                  : {}),
                property: propertyEffect.property,
              }),
              declarationId: declaration.id,
              elementId: match.subjectElementId,
              selectorBranchId,
              property: propertyEffect.property,
              value: propertyEffect.value,
              declaredProperty: declaration.property,
              declaredValue: declaration.value,
              propertyEffectSource: propertyEffect.source,
              propertyEffectSupported: propertyEffect.supported,
              ...(propertyEffect.reason ? { propertyEffectReason: propertyEffect.reason } : {}),
              ...(propertyEffect.customPropertyDependencies
                ? { customPropertyDependencies: propertyEffect.customPropertyDependencies }
                : {}),
              cascadeKey: runtimeContext.cascadeKeyOverride
                ? applyDeclarationLocalOrder({
                    cascadeKey,
                    ruleSourceOrder: declaration.ruleSourceOrder,
                    declarationIndex: declaration.declarationIndex,
                  })
                : cascadeKey,
              conditionSetId: conditionSet.id,
              matchCertainty: mapMatchCertainty(match.certainty),
              reasons: [
                `selector branch "${selectorBranch.selectorText}" matched rendered element`,
                ...(runtimeContext.runtimeContextId
                  ? [
                      `stylesheet is available in runtime CSS context "${runtimeContext.runtimeContextId}"`,
                    ]
                  : []),
                ...(propertyEffect.source === "shorthand"
                  ? [`"${declaration.property}" contributes to "${propertyEffect.property}"`]
                  : []),
              ],
              traces: input.includeTraces ? match.traces : [],
            });
          }
        }
      }
    }
  }

  return candidates;
}

function getRuntimeContextsForCandidate(input: {
  declarationStylesheetId: ProjectEvidenceId;
  match: SelectorBranchMatch;
  renderModel: RenderModel;
  runtimeStylesheetOrder: RuntimeStylesheetOrder;
}): Array<{
  runtimeContextId?: string;
  cascadeKeyOverride?: Pick<
    CascadeDeclarationCandidate["cascadeKey"],
    "sourceOrder" | "orderKnown"
  >;
}> {
  const renderedElement = input.renderModel.indexes.elementById.get(input.match.subjectElementId);
  const sourceFilePath = renderedElement?.sourceLocation.filePath.replace(/\\/g, "/");
  const runtimeContextIds = sourceFilePath
    ? (input.runtimeStylesheetOrder.contextIdsBySourceFilePath.get(sourceFilePath) ?? [])
    : [];

  if (runtimeContextIds.length === 0) {
    return [{}];
  }

  const contexts = runtimeContextIds
    .map((runtimeContextId) => input.runtimeStylesheetOrder.contextById.get(runtimeContextId))
    .filter((context): context is NonNullable<typeof context> => Boolean(context))
    .map((context) => {
      const stylesheetSourceOrder = context.stylesheetOrderById.get(input.declarationStylesheetId);
      if (stylesheetSourceOrder === undefined) {
        return undefined;
      }
      return {
        ...(context.loading === "lazy" ? { runtimeContextId: context.id } : {}),
        cascadeKeyOverride: {
          sourceOrder: stylesheetSourceOrder,
          orderKnown: true,
        },
      };
    })
    .filter((context): context is NonNullable<typeof context> => Boolean(context));

  if (contexts.length > 0) {
    return contexts;
  }

  return input.runtimeStylesheetOrder.contexts.length > 0 ? [] : [{}];
}

/*
 * Runtime stylesheet ordering is normalized at stylesheet granularity. Declaration
 * order remains local to the stylesheet and is added after choosing the runtime
 * context-specific stylesheet order.
 */
function applyDeclarationLocalOrder(input: {
  cascadeKey: CascadeDeclarationCandidate["cascadeKey"];
  ruleSourceOrder: number;
  declarationIndex: number;
}): CascadeDeclarationCandidate["cascadeKey"] {
  if (!input.cascadeKey.orderKnown) {
    return input.cascadeKey;
  }
  return {
    ...input.cascadeKey,
    sourceOrder:
      (input.cascadeKey.sourceOrder ?? 0) * 1_000_000 +
      input.ruleSourceOrder * 1000 +
      input.declarationIndex,
  };
}

function getScopeProximityForElement(input: {
  atRuleContext: ProjectEvidenceAssemblyResult["entities"]["cssDeclarations"][number]["atRuleContext"];
  elementId: string;
  renderModel: RenderModel;
}): {
  applicability: "applies" | "impossible";
  scopeProximity?: CascadeDeclarationCandidate["cascadeKey"]["scopeProximity"];
} {
  const scopeContexts = input.atRuleContext.filter((entry) => entry.name === "scope");
  if (scopeContexts.length === 0) {
    return {
      applicability: "applies",
    };
  }

  let distance = 0;
  for (const scopeContext of scopeContexts) {
    const rootRequirements =
      scopeContext.scopeRootRequirements ??
      (scopeContext.scopeRootClassName
        ? [
            {
              selectorText: `.${scopeContext.scopeRootClassName}`,
              requiredClassNames: [scopeContext.scopeRootClassName],
            },
          ]
        : undefined);
    const limitRequirements =
      scopeContext.scopeLimitRequirements ??
      (scopeContext.scopeLimitClassName
        ? [
            {
              selectorText: `.${scopeContext.scopeLimitClassName}`,
              requiredClassNames: [scopeContext.scopeLimitClassName],
            },
          ]
        : undefined);
    if (!scopeContext.scopeSupported || !rootRequirements || rootRequirements.length === 0) {
      return {
        applicability: "impossible",
      };
    }
    const scopeDistance = findScopeDistance({
      rootRequirements,
      limitRequirements,
      elementId: input.elementId,
      renderModel: input.renderModel,
    });
    if (scopeDistance === undefined) {
      return {
        applicability: "impossible",
      };
    }
    distance += scopeDistance;
  }

  return {
    applicability: "applies",
    scopeProximity: {
      distance,
      known: true,
    },
  };
}

function findScopeDistance(input: {
  rootRequirements: CssScopeSelectorRequirementFact[];
  limitRequirements?: CssScopeSelectorRequirementFact[];
  elementId: string;
  renderModel: RenderModel;
}): number | undefined {
  let distance = 0;
  let elementId: string | undefined = input.elementId;

  while (elementId) {
    if (
      distance > 0 &&
      input.limitRequirements &&
      elementMatchesAnyScopeRequirement(input.renderModel, elementId, input.limitRequirements)
    ) {
      return undefined;
    }
    if (elementMatchesAnyScopeRequirement(input.renderModel, elementId, input.rootRequirements)) {
      return distance;
    }
    elementId = input.renderModel.indexes.elementById.get(elementId)?.parentElementId;
    distance += 1;
  }
  return undefined;
}

function elementMatchesAnyScopeRequirement(
  renderModel: RenderModel,
  elementId: string,
  requirements: CssScopeSelectorRequirementFact[],
): boolean {
  return requirements.some((requirement) =>
    elementMatchesScopeRequirement(renderModel, elementId, requirement),
  );
}

function elementMatchesScopeRequirement(
  renderModel: RenderModel,
  elementId: string,
  requirement: CssScopeSelectorRequirementFact,
): boolean {
  return (
    requirement.requiredClassNames.every((className) =>
      elementHasClass(renderModel, elementId, className),
    ) &&
    !(requirement.forbiddenClassNames ?? []).some((className) =>
      elementHasClass(renderModel, elementId, className),
    )
  );
}

function elementHasClass(renderModel: RenderModel, elementId: string, className: string): boolean {
  const emissionSiteIds = renderModel.indexes.emissionSiteIdsByElementId.get(elementId) ?? [];
  return emissionSiteIds.some((emissionSiteId) => {
    const emissionSite = renderModel.indexes.emissionSiteById.get(emissionSiteId);
    return emissionSite?.tokens.some(
      (token) =>
        token.token === className &&
        token.tokenKind !== "css-module-export" &&
        token.presence === "always",
    );
  });
}

function findMatchesForSelectorBranch(
  selectorBranch: SelectorBranchAnalysis,
  selectorReachability: SelectorReachabilityResult,
): SelectorBranchMatch[] {
  const matchIds =
    selectorReachability.indexes.matchIdsBySelectorBranchNodeId.get(
      selectorBranch.selectorBranchNodeId,
    ) ?? [];
  return matchIds
    .map((matchId) => selectorReachability.indexes.matchById.get(matchId))
    .filter((match): match is SelectorBranchMatch => Boolean(match))
    .filter((match) => match.certainty !== "impossible")
    .sort(compareById);
}
