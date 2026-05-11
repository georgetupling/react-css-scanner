import type {
  ProjectEvidenceAssemblyResult,
  ProjectEvidenceId,
  SelectorBranchAnalysis,
} from "../project-evidence/index.js";
import type { SelectorBranchNode } from "../fact-graph/index.js";
import type {
  SelectorBranchMatch,
  SelectorMatchCertainty,
  SelectorReachabilityResult,
} from "../selector-reachability/index.js";
import { buildSelectorReachability } from "../selector-reachability/index.js";
import type { RenderModel } from "../render-structure/index.js";
import type { CssScopeSelectorRequirementFact } from "../../types/css.js";
import { parseSelectorBranch } from "../../libraries/selector-parsing/parseSelectorBranch.js";
import { normalizeAtRuleConditions } from "./atRuleConditions.js";
import { getDeclarationLayer } from "./cascadeKeys.js";
import { createConditionSet, mapMatchCertainty } from "./conditions.js";
import { cascadeDeclarationCandidateId } from "./ids.js";
import { compareById } from "./candidateComparison.js";
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
  const scopeMatcher = createScopeSelectorMatcher(input.renderModel);
  const cssModuleLocalClassMatches = buildCssModuleLocalClassMatches({
    projectEvidence: input.projectEvidence,
    renderModel: input.renderModel,
  });

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

      const matches = findMatchesForSelectorBranch({
        selectorBranch,
        selectorReachability: input.selectorReachability,
        projectEvidence: input.projectEvidence,
        cssModuleLocalClassMatches,
      });
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
          scopeMatcher,
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
  scopeMatcher: ScopeSelectorMatcher;
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
      scopeMatcher: input.scopeMatcher,
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
  scopeMatcher: ScopeSelectorMatcher;
}): number | undefined {
  let distance = 0;
  let elementId: string | undefined = input.elementId;

  while (elementId) {
    if (
      distance > 0 &&
      input.limitRequirements &&
      elementMatchesAnyScopeRequirement(input.scopeMatcher, elementId, input.limitRequirements)
    ) {
      return undefined;
    }
    if (elementMatchesAnyScopeRequirement(input.scopeMatcher, elementId, input.rootRequirements)) {
      return distance;
    }
    elementId = input.renderModel.indexes.elementById.get(elementId)?.parentElementId;
    distance += 1;
  }
  return undefined;
}

function elementMatchesAnyScopeRequirement(
  scopeMatcher: ScopeSelectorMatcher,
  elementId: string,
  requirements: CssScopeSelectorRequirementFact[],
): boolean {
  return requirements.some((requirement) => scopeMatcher.elementMatches(elementId, requirement));
}

type ScopeSelectorMatcher = {
  elementMatches(elementId: string, requirement: CssScopeSelectorRequirementFact): boolean;
};

function createScopeSelectorMatcher(renderModel: RenderModel): ScopeSelectorMatcher {
  const definiteElementIdsBySelectorText = new Map<string, Set<string>>();

  return {
    elementMatches(elementId, requirement) {
      return getScopeSelectorMatchedElementIds({
        renderModel,
        requirement,
        definiteElementIdsBySelectorText,
      }).has(elementId);
    },
  };
}

function getScopeSelectorMatchedElementIds(input: {
  renderModel: RenderModel;
  requirement: CssScopeSelectorRequirementFact;
  definiteElementIdsBySelectorText: Map<string, Set<string>>;
}): Set<string> {
  const cached = input.definiteElementIdsBySelectorText.get(input.requirement.selectorText);
  if (cached) {
    return cached;
  }

  const branch = createSyntheticScopeSelectorBranch(input.requirement);
  const reachability = buildSelectorReachability(
    {
      renderModel: input.renderModel,
      selectorBranches: [branch],
    },
    { includeTraces: false },
  );
  const matchedElementIds = new Set(
    reachability.branchMatches
      .filter((match) => match.certainty === "definite")
      .map((match) => match.subjectElementId),
  );
  input.definiteElementIdsBySelectorText.set(input.requirement.selectorText, matchedElementIds);
  return matchedElementIds;
}

function createSyntheticScopeSelectorBranch(
  requirement: CssScopeSelectorRequirementFact,
): SelectorBranchNode {
  const parsedBranch = parseSelectorBranch(requirement.selectorText);
  const idPart = normalizeScopeSelectorIdPart(requirement.selectorText);

  return {
    id: `scope-selector-branch:${idPart}`,
    kind: "selector-branch",
    selectorNodeId: `scope-selector:${idPart}`,
    selectorText: requirement.selectorText,
    selectorListText: requirement.selectorText,
    branchIndex: 0,
    branchCount: 1,
    ruleKey: `@scope:${requirement.selectorText}`,
    requiredClassNames: parsedBranch?.requiredClassNames ?? requirement.requiredClassNames,
    subjectClassNames: parsedBranch?.subjectClassNames ?? requirement.requiredClassNames,
    classAttributePredicates: parsedBranch?.classAttributePredicates ?? [],
    attributePredicates: parsedBranch?.attributePredicates ?? [],
    contextClassNames: parsedBranch?.contextClassNames ?? [],
    negativeClassNames: parsedBranch?.negativeClassNames ?? [],
    hasDescendantClassNames: parsedBranch?.hasDescendantClassNames ?? [],
    matchKind: parsedBranch?.matchKind ?? "complex",
    hasUnknownSemantics: parsedBranch?.hasUnknownSemantics ?? true,
    atRuleContext: [],
    sourceQuery: {
      selectorText: requirement.selectorText,
      source: {
        kind: "direct-query",
      },
    },
    confidence: parsedBranch?.hasUnknownSemantics ? "medium" : "high",
    provenance: [
      {
        stage: "fact-graph",
        summary: "Synthetic selector branch for @scope root or limit matching",
      },
    ],
  };
}

function normalizeScopeSelectorIdPart(selectorText: string): string {
  return (
    selectorText
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "empty"
  );
}

type CssModuleLocalClassElementMatch = {
  elementId: string;
  classNames: string[];
  emissionSiteIds: string[];
  renderPathIds: string[];
  placementConditionIds: string[];
  certainty: SelectorMatchCertainty;
};

type CssModuleLocalClassMatchIndex = Map<string, CssModuleLocalClassElementMatch[]>;
type MutableCssModuleLocalClassElementMatch = {
  elementId: string;
  classNames: Set<string>;
  emissionSiteIds: Set<string>;
  renderPathIds: Set<string>;
  placementConditionIds: Set<string>;
  certainty: SelectorMatchCertainty;
};

function buildCssModuleLocalClassMatches(input: {
  projectEvidence: ProjectEvidenceAssemblyResult;
  renderModel: RenderModel;
}): CssModuleLocalClassMatchIndex {
  const classNamesByStylesheetAndExportName = new Map<string, Set<string>>();
  const cssModuleMemberReferenceById = new Map(
    input.projectEvidence.entities.cssModuleMemberReferences.map((reference) => [
      reference.id,
      reference,
    ]),
  );
  for (const match of input.projectEvidence.relations.cssModuleMemberMatches) {
    if (match.status !== "matched") {
      continue;
    }

    const key = createCssModuleExportLookupKey(match.stylesheetId, match.exportName);
    const classNames = classNamesByStylesheetAndExportName.get(key) ?? new Set<string>();
    classNames.add(match.className);
    classNamesByStylesheetAndExportName.set(key, classNames);
  }

  const matchesByStylesheetAndClassName = new Map<
    string,
    Map<string, Map<string, MutableCssModuleLocalClassElementMatch>>
  >();

  for (const emissionSite of input.renderModel.emissionSites) {
    if (!emissionSite.elementId) {
      continue;
    }

    const element = input.renderModel.indexes.elementById.get(emissionSite.elementId);
    if (!element) {
      continue;
    }

    for (const contribution of emissionSite.cssModuleContributions) {
      if (!contribution.stylesheetFilePath) {
        continue;
      }

      const stylesheetId = input.projectEvidence.indexes.stylesheetIdByPath.get(
        normalizeProjectPath(contribution.stylesheetFilePath),
      );
      if (!stylesheetId) {
        continue;
      }

      const exportedClassNames = classNamesByStylesheetAndExportName.get(
        createCssModuleExportLookupKey(stylesheetId, contribution.exportName),
      );
      if (!exportedClassNames || exportedClassNames.size === 0) {
        continue;
      }

      for (const className of exportedClassNames) {
        addCssModuleLocalClassElementMatch({
          matchesByStylesheetAndClassName,
          stylesheetId,
          className,
          element,
          emissionSite,
          certainty: getCssModuleEmissionCertainty({
            renderModel: input.renderModel,
            element,
            emissionSite,
            contribution,
          }),
        });
      }
    }
  }

  for (const memberMatch of input.projectEvidence.relations.cssModuleMemberMatches) {
    if (memberMatch.status !== "matched") {
      continue;
    }

    const reference = cssModuleMemberReferenceById.get(memberMatch.referenceId);
    if (!reference) {
      continue;
    }

    for (const emissionSite of input.renderModel.emissionSites) {
      if (
        !emissionSite.elementId ||
        !anchorsOverlap(reference.location, emissionSite.sourceLocation)
      ) {
        continue;
      }

      const element = input.renderModel.indexes.elementById.get(emissionSite.elementId);
      if (!element) {
        continue;
      }

      addCssModuleLocalClassElementMatch({
        matchesByStylesheetAndClassName,
        stylesheetId: memberMatch.stylesheetId,
        className: memberMatch.className,
        element,
        emissionSite,
        certainty: getRenderEmissionCertainty({
          renderModel: input.renderModel,
          element,
          emissionSite,
        }),
      });
    }
  }

  const result: CssModuleLocalClassMatchIndex = new Map();
  for (const [stylesheetId, stylesheetMatches] of matchesByStylesheetAndClassName) {
    for (const [className, classMatches] of stylesheetMatches) {
      result.set(
        createCssModuleExportLookupKey(stylesheetId, className),
        [...classMatches.values()]
          .map((match) => ({
            elementId: match.elementId,
            classNames: [...match.classNames].sort(compareStrings),
            emissionSiteIds: [...match.emissionSiteIds].sort(compareStrings),
            renderPathIds: [...match.renderPathIds].sort(compareStrings),
            placementConditionIds: [...match.placementConditionIds].sort(compareStrings),
            certainty: match.certainty,
          }))
          .sort((left, right) => left.elementId.localeCompare(right.elementId)),
      );
    }
  }
  return result;
}

function addCssModuleLocalClassElementMatch(input: {
  matchesByStylesheetAndClassName: Map<
    string,
    Map<string, Map<string, MutableCssModuleLocalClassElementMatch>>
  >;
  stylesheetId: string;
  className: string;
  element: RenderModel["elements"][number];
  emissionSite: RenderModel["emissionSites"][number];
  certainty: SelectorMatchCertainty;
}): void {
  const stylesheetMatches =
    input.matchesByStylesheetAndClassName.get(input.stylesheetId) ??
    new Map<string, Map<string, MutableCssModuleLocalClassElementMatch>>();
  const classMatches =
    stylesheetMatches.get(input.className) ??
    new Map<string, MutableCssModuleLocalClassElementMatch>();
  const existing = classMatches.get(input.emissionSite.elementId ?? "") ?? {
    elementId: input.emissionSite.elementId ?? "",
    classNames: new Set<string>(),
    emissionSiteIds: new Set<string>(),
    renderPathIds: new Set<string>(),
    placementConditionIds: new Set<string>(),
    certainty: "definite" as SelectorMatchCertainty,
  };
  if (!existing.elementId) {
    return;
  }

  existing.classNames.add(input.className);
  existing.emissionSiteIds.add(input.emissionSite.id);
  existing.renderPathIds.add(input.element.renderPathId);
  for (const placementConditionId of [
    ...input.element.placementConditionIds,
    ...input.emissionSite.placementConditionIds,
  ]) {
    existing.placementConditionIds.add(placementConditionId);
  }
  existing.certainty = combineMatchCertainty(existing.certainty, input.certainty);
  classMatches.set(existing.elementId, existing);
  stylesheetMatches.set(input.className, classMatches);
  input.matchesByStylesheetAndClassName.set(input.stylesheetId, stylesheetMatches);
}

function getCssModuleEmissionCertainty(input: {
  renderModel: RenderModel;
  element: RenderModel["elements"][number];
  emissionSite: RenderModel["emissionSites"][number];
  contribution: RenderModel["emissionSites"][number]["cssModuleContributions"][number];
}): SelectorMatchCertainty {
  const hasAlwaysToken = input.emissionSite.tokens.some(
    (token) =>
      token.tokenKind === "css-module-export" &&
      token.contributionId === input.contribution.id &&
      token.presence === "always",
  );
  const renderPath = input.renderModel.indexes.renderPathById.get(input.element.renderPathId);
  if (
    input.element.certainty === "definite" &&
    input.element.placementConditionIds.length === 0 &&
    input.emissionSite.placementConditionIds.length === 0 &&
    hasAlwaysToken &&
    (!renderPath || renderPath.certainty === "definite")
  ) {
    return "definite";
  }
  return "possible";
}

function getRenderEmissionCertainty(input: {
  renderModel: RenderModel;
  element: RenderModel["elements"][number];
  emissionSite: RenderModel["emissionSites"][number];
}): SelectorMatchCertainty {
  const renderPath = input.renderModel.indexes.renderPathById.get(input.element.renderPathId);
  if (
    input.element.certainty === "definite" &&
    input.element.placementConditionIds.length === 0 &&
    input.emissionSite.placementConditionIds.length === 0 &&
    (!renderPath || renderPath.certainty === "definite")
  ) {
    return "definite";
  }
  return "possible";
}

function combineMatchCertainty(
  left: SelectorMatchCertainty,
  right: SelectorMatchCertainty,
): SelectorMatchCertainty {
  if (left === "unknown-context" || right === "unknown-context") {
    return "unknown-context";
  }
  if (left === "possible" || right === "possible") {
    return "possible";
  }
  if (left === "impossible" || right === "impossible") {
    return "impossible";
  }
  return "definite";
}

function createCssModuleExportLookupKey(stylesheetId: string, exportName: string): string {
  return `${stylesheetId}\0${exportName}`;
}

function findMatchesForSelectorBranch(input: {
  selectorBranch: SelectorBranchAnalysis;
  selectorReachability: SelectorReachabilityResult;
  projectEvidence: ProjectEvidenceAssemblyResult;
  cssModuleLocalClassMatches: CssModuleLocalClassMatchIndex;
}): SelectorBranchMatch[] {
  const cssModuleMatches = findCssModuleLocalMatchesForSelectorBranch(input);
  if (cssModuleMatches) {
    return cssModuleMatches;
  }

  const matchIds =
    input.selectorReachability.indexes.matchIdsBySelectorBranchNodeId.get(
      input.selectorBranch.selectorBranchNodeId,
    ) ?? [];
  return matchIds
    .map((matchId) => input.selectorReachability.indexes.matchById.get(matchId))
    .filter((match): match is SelectorBranchMatch => Boolean(match))
    .filter((match) => match.certainty !== "impossible")
    .sort(compareById);
}

function findCssModuleLocalMatchesForSelectorBranch(input: {
  selectorBranch: SelectorBranchAnalysis;
  selectorReachability: SelectorReachabilityResult;
  projectEvidence: ProjectEvidenceAssemblyResult;
  cssModuleLocalClassMatches: CssModuleLocalClassMatchIndex;
}): SelectorBranchMatch[] | undefined {
  const stylesheetId = input.selectorBranch.stylesheetId;
  if (!stylesheetId) {
    return undefined;
  }

  const stylesheet = input.projectEvidence.indexes.stylesheetsById.get(stylesheetId);
  if (stylesheet?.origin !== "css-module") {
    return undefined;
  }

  const branchReachability =
    input.selectorReachability.indexes.branchReachabilityBySelectorBranchNodeId.get(
      input.selectorBranch.selectorBranchNodeId,
    );
  if (
    !branchReachability ||
    branchReachability.requirement.kind !== "same-node-class-conjunction" ||
    branchReachability.subject.classAttributePredicates.length > 0 ||
    branchReachability.subject.unsupportedParts.length > 0
  ) {
    return undefined;
  }

  const requiredClassNames = [...branchReachability.requirement.classNames].sort(compareStrings);
  if (requiredClassNames.length === 0) {
    return undefined;
  }

  const candidateMatches = requiredClassNames.map(
    (className) =>
      input.cssModuleLocalClassMatches.get(
        createCssModuleExportLookupKey(stylesheetId, className),
      ) ?? [],
  );
  if (candidateMatches.some((matches) => matches.length === 0)) {
    return [];
  }

  const matchesByElementId = intersectCssModuleElementMatches(candidateMatches);
  const forbiddenClassNames = branchReachability.requirement.forbiddenClassNames ?? [];
  return [...matchesByElementId.values()]
    .filter((match) =>
      forbiddenClassNames.every((className) => !match.classNames.includes(className)),
    )
    .map((match) => ({
      id: ["css-module-selector-branch-match", input.selectorBranch.id, match.elementId].join(":"),
      selectorBranchNodeId: input.selectorBranch.selectorBranchNodeId,
      subjectElementId: match.elementId,
      elementMatchIds: [],
      supportingEmissionSiteIds: match.emissionSiteIds,
      requiredClassNames,
      matchedClassNames: match.classNames,
      renderPathIds: match.renderPathIds,
      placementConditionIds: match.placementConditionIds,
      certainty: match.certainty,
      confidence: match.certainty === "definite" ? "high" : "medium",
      traces: [],
    }))
    .sort(compareById);
}

function intersectCssModuleElementMatches(
  candidateMatches: CssModuleLocalClassElementMatch[][],
): Map<string, CssModuleLocalClassElementMatch> {
  const [firstMatches, ...restMatches] = candidateMatches;
  const matchesByElementId = new Map<string, CssModuleLocalClassElementMatch>();
  for (const match of firstMatches ?? []) {
    matchesByElementId.set(match.elementId, {
      elementId: match.elementId,
      classNames: [...match.classNames],
      emissionSiteIds: [...match.emissionSiteIds],
      renderPathIds: [...match.renderPathIds],
      placementConditionIds: [...match.placementConditionIds],
      certainty: match.certainty,
    });
  }

  for (const matches of restMatches) {
    const currentIds = new Set(matches.map((match) => match.elementId));
    for (const elementId of [...matchesByElementId.keys()]) {
      if (!currentIds.has(elementId)) {
        matchesByElementId.delete(elementId);
      }
    }
    for (const match of matches) {
      const existing = matchesByElementId.get(match.elementId);
      if (!existing) {
        continue;
      }
      existing.classNames = [...new Set([...existing.classNames, ...match.classNames])].sort(
        compareStrings,
      );
      existing.emissionSiteIds = [
        ...new Set([...existing.emissionSiteIds, ...match.emissionSiteIds]),
      ].sort(compareStrings);
      existing.renderPathIds = [
        ...new Set([...existing.renderPathIds, ...match.renderPathIds]),
      ].sort(compareStrings);
      existing.placementConditionIds = [
        ...new Set([...existing.placementConditionIds, ...match.placementConditionIds]),
      ].sort(compareStrings);
      existing.certainty = combineMatchCertainty(existing.certainty, match.certainty);
    }
  }

  return matchesByElementId;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function anchorsOverlap(
  left: {
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine?: number;
    endColumn?: number;
  },
  right: {
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine?: number;
    endColumn?: number;
  },
): boolean {
  if (normalizeProjectPath(left.filePath) !== normalizeProjectPath(right.filePath)) {
    return false;
  }

  const leftStart = toAnchorPositionValue(left.startLine, left.startColumn);
  const leftEnd = toAnchorPositionValue(
    left.endLine ?? left.startLine,
    left.endColumn ?? left.startColumn,
  );
  const rightStart = toAnchorPositionValue(right.startLine, right.startColumn);
  const rightEnd = toAnchorPositionValue(
    right.endLine ?? right.startLine,
    right.endColumn ?? right.startColumn,
  );

  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function toAnchorPositionValue(line: number, column: number): number {
  return line * 1_000_000 + column;
}
