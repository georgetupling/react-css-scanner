import type { FactGraphResult } from "../fact-graph/index.js";
import type {
  ProjectEvidenceAssemblyResult,
  ProjectEvidenceId,
  SelectorBranchAnalysis,
} from "../project-evidence/index.js";
import type {
  RenderModel,
  RenderCertainty,
  RenderedComponentBoundary,
  RenderedElement,
} from "../render-structure/index.js";
import type { RuntimeCssLoadingResult } from "../runtime-css-loading/index.js";
import type {
  SelectorBranchMatch,
  SelectorMatchCertainty,
  SelectorReachabilityResult,
} from "../selector-reachability/index.js";
import { buildCascadeAnalysisIndexes } from "./indexes.js";
import {
  substituteCssCustomProperties,
  type CssCustomPropertyLookupResult,
} from "../../libraries/css-parsing/customPropertySubstitution.js";
import {
  cascadeConditionSetId,
  cascadeDeclarationCandidateId,
  cascadeDiagnosticId,
  cascadeOutcomeId,
  elementPropertyKey,
} from "./ids.js";
import { getCssPropertyEffectsForDeclaration } from "./propertyEffects.js";
import { getCssDeclarationPropertyEffects } from "../../libraries/css-parsing/declarationPropertyEffects.js";
import { calculateSelectorSpecificity, compareSpecificity } from "./specificity.js";
import type {
  SourceExpressionSyntaxFact,
  SourceObjectExpressionProperty,
  SourceObjectLiteralExpressionSyntax,
} from "../language-frontends/source/expression-syntax/index.js";
import {
  getReactInlineStyleDeclarationSemantics,
  type ReactInlineStyleSiteFact,
} from "../language-frontends/source/react-syntax/index.js";
import type { CssDeclarationPropertyEffect } from "../../types/css.js";
import type { SourceFrontendFile } from "../language-frontends/index.js";
import type {
  CascadeAnalysisDiagnostic,
  CascadeAnalysisDiagnosticCode,
  CascadeAnalysisResult,
  CascadeComparisonReason,
  CascadeDeclarationCandidate,
  CascadeConditionSet,
  CascadeOutcome,
  CssDeclarationCascadeRecord,
} from "./types.js";

export type CascadeAnalysisInput = {
  factGraph: FactGraphResult;
  projectEvidence: ProjectEvidenceAssemblyResult;
  renderModel: RenderModel;
  runtimeCssLoading: RuntimeCssLoadingResult;
  selectorReachability: SelectorReachabilityResult;
  options?: {
    includeTraces?: boolean;
  };
};

export function buildCascadeAnalysis(input: CascadeAnalysisInput): CascadeAnalysisResult {
  const includeTraces = input.options?.includeTraces ?? true;
  const diagnostics: CascadeAnalysisDiagnostic[] = [];
  const conditionSetsById = new Map<string, CascadeConditionSet>();
  const stylesheetOrderById = buildRuntimeStylesheetOrder(input);
  const declarations = input.projectEvidence.entities.cssDeclarations.map((declaration) => {
    const specificity = calculateSelectorSpecificity(declaration.selectorText);
    if (!specificity.supported) {
      diagnostics.push(
        createDiagnostic({
          code: "unsupported-selector-specificity",
          message: `Selector specificity could not be calculated for "${declaration.selectorText}".`,
          declarationId: declaration.id,
          location: declaration.location,
          traces: [],
        }),
      );
    }

    const stylesheetSourceOrder = stylesheetOrderById.get(declaration.stylesheetId);
    const layer = getDeclarationLayer(declaration.atRuleContext);
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

  const candidates: CascadeDeclarationCandidate[] = [];
  for (const declaration of input.projectEvidence.entities.cssDeclarations) {
    if (!declaration.location) {
      diagnostics.push(
        createDiagnostic({
          code: "missing-declaration-location",
          message: `Declaration "${declaration.property}" has no source location.`,
          declarationId: declaration.id,
          traces: [],
        }),
      );
    }

    const declarationRecord = declarations.find(
      (record) => record.declarationId === declaration.id,
    );
    if (!declarationRecord) {
      continue;
    }

    for (const selectorBranchId of declaration.selectorBranchIds) {
      const selectorBranch =
        input.projectEvidence.indexes.selectorBranchesById.get(selectorBranchId);
      if (!selectorBranch) {
        diagnostics.push(
          createDiagnostic({
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
        diagnostics.push(
          createDiagnostic({
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
        diagnostics.push(
          createDiagnostic({
            code: "missing-selector-branch-match",
            message: `Selector branch "${selectorBranch.selectorText}" has no matched render elements for cascade analysis.`,
            declarationId: declaration.id,
            selectorBranchId,
            location: selectorBranch.location ?? declaration.location,
            traces: includeTraces ? selectorBranch.traces : [],
          }),
        );
        continue;
      }

      for (const match of matches) {
        const conditionSet = createConditionSet({
          declaration,
          selectorText: selectorBranch.selectorText,
          match,
          includeTraces,
        });
        conditionSetsById.set(conditionSet.id, conditionSet);
        for (const propertyEffect of propertyEffects) {
          candidates.push({
            id: cascadeDeclarationCandidateId({
              declarationId: declaration.id,
              selectorBranchId,
              elementId: match.subjectElementId,
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
            cascadeKey: {
              ...declarationRecord.cascadeKey,
              specificity: branchSpecificity.specificity,
            },
            conditionSetId: conditionSet.id,
            matchCertainty: mapMatchCertainty(match.certainty),
            reasons: [
              `selector branch "${selectorBranch.selectorText}" matched rendered element`,
              ...(propertyEffect.source === "shorthand"
                ? [`"${declaration.property}" contributes to "${propertyEffect.property}"`]
                : []),
            ],
            traces: includeTraces ? match.traces : [],
          });
        }
      }
    }
  }

  candidates.push(
    ...buildInlineStyleCandidates({
      input,
      conditionSetsById,
      includeTraces,
      diagnostics,
      createDiagnostic,
    }),
  );

  const resolvedCandidates = resolveCustomPropertyDependentCandidates({
    candidates,
    projectEvidence: input.projectEvidence,
    conditionSetsById,
  }).sort(compareById);
  emitUnsupportedPropertyDiagnostics({
    candidates: resolvedCandidates,
    projectEvidence: input.projectEvidence,
    diagnostics,
    createDiagnostic,
  });
  const outcomes = buildOutcomes({
    candidates: resolvedCandidates,
    projectEvidence: input.projectEvidence,
    conditionSetsById,
    diagnostics,
  });
  const sortedDiagnostics = diagnostics.sort(compareById);
  const sortedConditionSets = [...conditionSetsById.values()].sort(compareById);
  const sortedDeclarations = declarations.sort((left, right) =>
    left.declarationId.localeCompare(right.declarationId),
  );
  const sortedCandidates = resolvedCandidates.sort(compareById);
  const sortedOutcomes = outcomes.sort(compareById);

  return {
    declarations: sortedDeclarations,
    conditionSets: sortedConditionSets,
    candidates: sortedCandidates,
    outcomes: sortedOutcomes,
    diagnostics: sortedDiagnostics,
    indexes: buildCascadeAnalysisIndexes({
      declarations: sortedDeclarations,
      conditionSets: sortedConditionSets,
      candidates: sortedCandidates,
      outcomes: sortedOutcomes,
      diagnostics: sortedDiagnostics,
    }),
    meta: {
      generatedAtStage: "cascade-analysis",
      declarationCount: sortedDeclarations.length,
      conditionSetCount: sortedConditionSets.length,
      candidateCount: sortedCandidates.length,
      outcomeCount: sortedOutcomes.length,
      diagnosticCount: sortedDiagnostics.length,
    },
  };

  function createDiagnostic(input: {
    code: CascadeAnalysisDiagnosticCode;
    message: string;
    declarationId?: ProjectEvidenceId;
    selectorBranchId?: ProjectEvidenceId;
    elementId?: string;
    location?: CascadeAnalysisDiagnostic["location"];
    traces: CascadeAnalysisDiagnostic["traces"];
  }): CascadeAnalysisDiagnostic {
    return {
      id: cascadeDiagnosticId({
        code: input.code,
        declarationId: input.declarationId,
        selectorBranchId: input.selectorBranchId,
        elementId: input.elementId,
        index: diagnostics.length,
      }),
      code: input.code,
      severity: "debug",
      confidence: "high",
      message: input.message,
      ...(input.location ? { location: input.location } : {}),
      ...(input.declarationId ? { declarationId: input.declarationId } : {}),
      ...(input.selectorBranchId ? { selectorBranchId: input.selectorBranchId } : {}),
      ...(input.elementId ? { elementId: input.elementId } : {}),
      traces: includeTraces ? input.traces : [],
    };
  }
}

function resolveCustomPropertyDependentCandidates(input: {
  candidates: CascadeDeclarationCandidate[];
  projectEvidence: ProjectEvidenceAssemblyResult;
  conditionSetsById: Map<string, CascadeConditionSet>;
}): CascadeDeclarationCandidate[] {
  const customPropertyOutcomes = buildOutcomes({
    candidates: input.candidates
      .filter((candidate) => candidate.property.startsWith("--"))
      .sort(compareById),
    projectEvidence: input.projectEvidence,
    conditionSetsById: input.conditionSetsById,
    diagnostics: [],
  });
  const customPropertyOutcomeByElementProperty = new Map(
    customPropertyOutcomes.map((outcome) => [elementPropertyKey(outcome), outcome] as const),
  );
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const candidateGroups = groupCandidatesBySourceDeclaration(input.candidates);
  const replacedCandidateIds = new Set<string>();
  const resolvedCandidates: CascadeDeclarationCandidate[] = [];

  for (const group of candidateGroups) {
    const representative = group[0];
    if (
      !representative ||
      representative.declaredProperty.startsWith("--") ||
      !group.some((candidate) => (candidate.customPropertyDependencies ?? []).length > 0)
    ) {
      continue;
    }

    for (const candidate of group) {
      replacedCandidateIds.add(candidate.id);
    }

    const substitution = substituteCssCustomProperties({
      value: representative.declaredValue,
      resolveCustomProperty: (name) =>
        resolveCustomPropertyForElement({
          name,
          elementId: representative.elementId,
          customPropertyOutcomeByElementProperty,
          candidateById,
          stack: [],
        }),
    });

    if (substitution.status === "unresolved") {
      resolvedCandidates.push(
        ...group.map((candidate) => ({
          ...candidate,
          propertyEffectSupported: false,
          propertyEffectReason: `The "${candidate.declaredProperty}" declaration depends on unresolved custom property substitution: ${substitution.reason}.`,
        })),
      );
      continue;
    }

    const substitutedEffects = getCssDeclarationPropertyEffects({
      property: representative.declaredProperty,
      value: substitution.value,
    });
    for (const effect of substitutedEffects) {
      const candidateBase = { ...representative };
      delete candidateBase.propertyEffectReason;
      delete candidateBase.customPropertyDependencies;
      resolvedCandidates.push({
        ...candidateBase,
        id: cascadeDeclarationCandidateId({
          declarationId: representative.declarationId,
          inlineStyleId: representative.inlineStyleId,
          selectorBranchId: representative.selectorBranchId,
          elementId: representative.elementId,
          property: effect.property,
        }),
        property: effect.property,
        value: effect.value,
        propertyEffectSource: effect.source,
        propertyEffectSupported: effect.supported,
        ...(effect.reason ? { propertyEffectReason: effect.reason } : {}),
        ...(effect.customPropertyDependencies
          ? { customPropertyDependencies: effect.customPropertyDependencies }
          : {}),
        reasons: [
          ...representative.reasons,
          `custom property substitution resolved "${representative.declaredValue}" to "${substitution.value}"`,
          ...(effect.source === "shorthand"
            ? [
                `"${representative.declaredProperty}" contributes to "${effect.property}" after substitution`,
              ]
            : []),
        ],
      });
    }
  }

  return [
    ...input.candidates.filter((candidate) => !replacedCandidateIds.has(candidate.id)),
    ...resolvedCandidates,
  ];
}

function groupCandidatesBySourceDeclaration(
  candidates: CascadeDeclarationCandidate[],
): CascadeDeclarationCandidate[][] {
  const groups = new Map<string, CascadeDeclarationCandidate[]>();
  for (const candidate of candidates) {
    const key = [
      candidate.declarationId ?? candidate.inlineStyleId ?? "unknown-source",
      candidate.selectorBranchId ?? "direct",
      candidate.elementId,
      candidate.conditionSetId ?? "none",
      candidate.declaredProperty,
      candidate.declaredValue,
    ].join("::");
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups.values()].map((group) => group.sort(compareById));
}

function resolveCustomPropertyForElement(input: {
  name: string;
  elementId: string;
  customPropertyOutcomeByElementProperty: Map<string, CascadeOutcome>;
  candidateById: Map<string, CascadeDeclarationCandidate>;
  stack: string[];
}): CssCustomPropertyLookupResult {
  if (input.stack.includes(input.name)) {
    return {
      status: "unresolved",
      reason: `custom property cycle detected through ${[...input.stack, input.name].join(" -> ")}`,
    };
  }

  const outcome = input.customPropertyOutcomeByElementProperty.get(
    elementPropertyKey({
      elementId: input.elementId,
      property: input.name,
    }),
  );
  if (!outcome) {
    return {
      status: "missing",
    };
  }
  if (
    outcome.certainty !== "definite" ||
    outcome.unresolvedCandidateIds.length > 0 ||
    !outcome.winningCandidateId
  ) {
    return {
      status: "unresolved",
      reason: `custom property ${input.name} does not have a definite cascade winner`,
    };
  }

  const winner = input.candidateById.get(outcome.winningCandidateId);
  if (!winner) {
    return {
      status: "unresolved",
      reason: `custom property ${input.name} winner could not be resolved`,
    };
  }

  return substituteCssCustomProperties({
    value: winner.value,
    resolveCustomProperty: (name) =>
      resolveCustomPropertyForElement({
        ...input,
        name,
        stack: [...input.stack, input.name],
      }),
  });
}

function emitUnsupportedPropertyDiagnostics(input: {
  candidates: CascadeDeclarationCandidate[];
  projectEvidence: ProjectEvidenceAssemblyResult;
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
}): void {
  for (const candidate of input.candidates) {
    if (candidate.propertyEffectSupported) {
      continue;
    }
    const declaration = candidate.declarationId
      ? input.projectEvidence.indexes.cssDeclarationsById.get(candidate.declarationId)
      : undefined;
    input.diagnostics.push(
      input.createDiagnostic({
        code: "unsupported-property-semantics",
        message:
          candidate.propertyEffectReason ??
          `Property semantics are not fully modeled for "${candidate.declaredProperty}".`,
        ...(candidate.declarationId ? { declarationId: candidate.declarationId } : {}),
        ...(candidate.selectorBranchId ? { selectorBranchId: candidate.selectorBranchId } : {}),
        elementId: candidate.elementId,
        location: declaration?.location,
        traces: [],
      }),
    );
  }
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

function buildInlineStyleCandidates(input: {
  input: CascadeAnalysisInput;
  conditionSetsById: Map<string, CascadeConditionSet>;
  includeTraces: boolean;
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
}): CascadeDeclarationCandidate[] {
  const candidates: CascadeDeclarationCandidate[] = [];
  const inlineStyleSites = input.input.factGraph.frontends.source.files.flatMap((sourceFile) =>
    sourceFile.reactSyntax.inlineStyleSites.map((site) => ({ sourceFile, site })),
  );
  const componentStyleSuppliesByBoundaryId = buildComponentStyleSuppliesByBoundaryId({
    inlineStyleSites,
    input: input.input,
  });
  const boundaryById = new Map(
    input.input.renderModel.componentBoundaries.map((boundary) => [boundary.id, boundary] as const),
  );
  const inlineStyleResolutionContext = createInlineStyleResolutionContext(input.input.factGraph);
  const inlineOrderById = new Map(
    inlineStyleSites
      .sort(
        (left, right) =>
          left.site.filePath.localeCompare(right.site.filePath) ||
          left.site.location.startLine - right.site.location.startLine ||
          left.site.location.startColumn - right.site.location.startColumn ||
          left.site.siteKey.localeCompare(right.site.siteKey),
      )
      .map(({ site }, index) => [site.siteKey, index] as const),
  );

  for (const { sourceFile, site } of inlineStyleSites) {
    if (site.kind === "component-prop-style") {
      continue;
    }

    const elementIds = findRenderedElementIdsForInlineStyleSite({
      site,
      graph: input.input.factGraph.graph,
      renderModel: input.input.renderModel,
    });
    if (elementIds.length === 0) {
      input.diagnostics.push(
        input.createDiagnostic({
          code: "unsupported-inline-style",
          message: `Inline style "${site.rawExpressionText}" could not be linked to a rendered element.`,
          location: site.location,
          traces: [],
        }),
      );
      continue;
    }

    for (const elementId of elementIds) {
      const renderedElement = input.input.renderModel.indexes.elementById.get(elementId);
      if (!renderedElement) {
        continue;
      }
      const declarations = resolveInlineStyleDeclarationsForElement({
        site,
        sourceFile,
        renderedElement,
        componentStyleSuppliesByBoundaryId,
        boundaryById,
        resolutionContext: inlineStyleResolutionContext,
      });
      if (declarations.unsupportedReason) {
        input.diagnostics.push(
          input.createDiagnostic({
            code: "unsupported-inline-style",
            message: declarations.unsupportedReason,
            elementId,
            location: site.location,
            traces: [],
          }),
        );
        continue;
      }
      const conditionSet = createConditionSetFromRenderedElement({
        renderedElement,
        includeTraces: input.includeTraces,
      });
      input.conditionSetsById.set(conditionSet.id, conditionSet);

      for (const declaration of declarations.declarations) {
        for (const propertyEffect of declaration.propertyEffects) {
          candidates.push({
            id: cascadeDeclarationCandidateId({
              inlineStyleId: site.siteKey,
              elementId,
              property: propertyEffect.property,
            }),
            inlineStyleId: site.siteKey,
            elementId,
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
            cascadeKey: {
              origin: "inline",
              important: false,
              layer: {
                known: true,
                unlayered: true,
              },
              specificity: { a: 1, b: 0, c: 0 },
              sourceOrder:
                2_000_000_000 + (inlineOrderById.get(site.siteKey) ?? 0) * 1000 + declaration.order,
              orderKnown: true,
            },
            conditionSetId: conditionSet.id,
            matchCertainty:
              declaration.certainty === "possible"
                ? "possible"
                : mapRenderCertainty(renderedElement.certainty),
            reasons: [
              site.componentPropName
                ? `inline style prop "${site.componentPropName}" is supplied to rendered element`
                : "inline style applies directly to rendered element",
              ...(declaration.certainty === "possible"
                ? ["inline style comes from a conditional style object branch"]
                : []),
              ...(propertyEffect.source === "shorthand"
                ? [`"${declaration.property}" contributes to "${propertyEffect.property}"`]
                : []),
            ],
            traces: input.includeTraces ? renderedElement.traces : [],
          });
        }
      }
    }
  }

  return candidates;
}

type InlineStyleSiteWithSourceFile = {
  sourceFile: CascadeAnalysisInput["factGraph"]["frontends"]["source"]["files"][number];
  site: ReactInlineStyleSiteFact;
};

type InlineStyleDeclaration = {
  property: string;
  value: string;
  propertyEffects: CssDeclarationPropertyEffect[];
  location: ReactInlineStyleSiteFact["location"];
  order: number;
  certainty: "definite" | "possible";
};

type InlineStyleResolutionContext = {
  sourceFileByPath: Map<string, SourceFrontendFile>;
  importedLocalByFileAndName: Map<
    string,
    {
      importedName: string;
      resolvedFilePath: string;
    }
  >;
};

type InlineStyleExpressionAlternative = {
  expression: SourceObjectLiteralExpressionSyntax & SourceExpressionSyntaxFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  certainty: "definite" | "possible";
};

type ComponentStyleSupply = InlineStyleSiteWithSourceFile & {
  boundaryId: string;
  componentPropName: string;
};

function buildComponentStyleSuppliesByBoundaryId(input: {
  inlineStyleSites: InlineStyleSiteWithSourceFile[];
  input: CascadeAnalysisInput;
}): Map<string, ComponentStyleSupply[]> {
  const boundariesByReferenceRenderSiteNodeId = new Map<string, RenderedComponentBoundary[]>();
  for (const boundary of input.input.renderModel.componentBoundaries) {
    if (!boundary.referenceRenderSiteNodeId) {
      continue;
    }
    const existing =
      boundariesByReferenceRenderSiteNodeId.get(boundary.referenceRenderSiteNodeId) ?? [];
    existing.push(boundary);
    boundariesByReferenceRenderSiteNodeId.set(boundary.referenceRenderSiteNodeId, existing);
  }

  const suppliesByBoundaryId = new Map<string, ComponentStyleSupply[]>();
  for (const { sourceFile, site } of input.inlineStyleSites) {
    if (site.kind !== "component-prop-style" || !site.renderSiteKey || !site.componentPropName) {
      continue;
    }
    const renderSiteNodeId =
      input.input.factGraph.graph.indexes.renderSiteNodeIdByRenderSiteKey.get(site.renderSiteKey);
    if (!renderSiteNodeId) {
      continue;
    }
    const boundaries = boundariesByReferenceRenderSiteNodeId.get(renderSiteNodeId) ?? [];
    for (const boundary of boundaries) {
      const supplies = suppliesByBoundaryId.get(boundary.id) ?? [];
      supplies.push({
        sourceFile,
        site,
        boundaryId: boundary.id,
        componentPropName: site.componentPropName,
      });
      suppliesByBoundaryId.set(boundary.id, supplies);
    }
  }

  for (const [boundaryId, supplies] of suppliesByBoundaryId.entries()) {
    suppliesByBoundaryId.set(
      boundaryId,
      supplies.sort(
        (left, right) =>
          left.componentPropName.localeCompare(right.componentPropName) ||
          left.site.siteKey.localeCompare(right.site.siteKey),
      ),
    );
  }
  return suppliesByBoundaryId;
}

function createInlineStyleResolutionContext(
  factGraph: FactGraphResult,
): InlineStyleResolutionContext {
  const sourceFileByPath = new Map(
    factGraph.frontends.source.files.map((sourceFile) => [sourceFile.filePath, sourceFile]),
  );
  const importedLocalByFileAndName = new Map<
    string,
    {
      importedName: string;
      resolvedFilePath: string;
    }
  >();

  for (const edge of factGraph.graph.edges.imports) {
    if (
      edge.importerKind !== "source" ||
      edge.importKind !== "source" ||
      edge.importLoading !== "static" ||
      !edge.resolvedFilePath
    ) {
      continue;
    }

    const sourceFile = sourceFileByPath.get(edge.importerFilePath);
    const frontendImport = sourceFile?.moduleSyntax.imports.find(
      (candidate) =>
        candidate.specifier === edge.specifier &&
        candidate.importKind === edge.importKind &&
        candidate.importLoading === edge.importLoading,
    );
    const frontendImportNames =
      frontendImport?.importNames.map((importName) => ({
        bindingKind: importName.kind,
        importedName: importName.importedName,
        localName: importName.localName,
      })) ?? [];
    const importNames =
      edge.importNames && edge.importNames.length > 0 ? edge.importNames : frontendImportNames;

    for (const importName of importNames) {
      if (importName.bindingKind === "namespace") {
        continue;
      }
      importedLocalByFileAndName.set(`${edge.importerFilePath}::${importName.localName}`, {
        importedName: importName.importedName,
        resolvedFilePath: edge.resolvedFilePath,
      });
    }
  }

  return {
    sourceFileByPath,
    importedLocalByFileAndName,
  };
}

function findRenderedElementIdsForInlineStyleSite(input: {
  site: ReactInlineStyleSiteFact;
  graph: CascadeAnalysisInput["factGraph"]["graph"];
  renderModel: RenderModel;
}): string[] {
  if (input.site.elementTemplateKey) {
    const templateNodeId = input.graph.indexes.elementTemplateNodeIdByTemplateKey.get(
      input.site.elementTemplateKey,
    );
    if (templateNodeId) {
      const elementIds = input.renderModel.indexes.elementIdsByTemplateNodeId.get(templateNodeId);
      if (elementIds && elementIds.length > 0) {
        return [...elementIds].sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (input.site.renderSiteKey) {
    const renderSiteNodeId = input.graph.indexes.renderSiteNodeIdByRenderSiteKey.get(
      input.site.renderSiteKey,
    );
    if (renderSiteNodeId) {
      return [
        ...(input.renderModel.indexes.elementIdsByRenderSiteNodeId.get(renderSiteNodeId) ?? []),
      ].sort((left, right) => left.localeCompare(right));
    }
  }

  return [];
}

function resolveInlineStyleDeclarationsForElement(input: {
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  renderedElement: RenderedElement;
  componentStyleSuppliesByBoundaryId: Map<string, ComponentStyleSupply[]>;
  boundaryById: Map<string, RenderedComponentBoundary>;
  resolutionContext: InlineStyleResolutionContext;
}): {
  declarations: InlineStyleDeclaration[];
  unsupportedReason?: string;
} {
  if (input.site.componentPropName) {
    const supplied = resolveComponentStyleDeclarations({
      boundaryId: input.renderedElement.parentBoundaryId,
      propName: input.site.componentPropName,
      componentStyleSuppliesByBoundaryId: input.componentStyleSuppliesByBoundaryId,
      boundaryById: input.boundaryById,
      resolutionContext: input.resolutionContext,
      seen: new Set(),
    });
    if (supplied.declarations.length > 0 || supplied.unsupportedReason) {
      return supplied;
    }
  }

  return extractInlineStyleDeclarations({
    site: input.site,
    sourceFile: input.sourceFile,
    resolutionContext: input.resolutionContext,
    expressionById: expressionSyntaxById(input.sourceFile),
  });
}

function resolveComponentStyleDeclarations(input: {
  boundaryId: string;
  propName: string;
  componentStyleSuppliesByBoundaryId: Map<string, ComponentStyleSupply[]>;
  boundaryById: Map<string, RenderedComponentBoundary>;
  resolutionContext: InlineStyleResolutionContext;
  seen: Set<string>;
}): {
  declarations: InlineStyleDeclaration[];
  unsupportedReason?: string;
} {
  const key = `${input.boundaryId}:${input.propName}`;
  if (input.seen.has(key)) {
    return {
      declarations: [],
      unsupportedReason: `Inline style prop "${input.propName}" forwarding cycle could not be analyzed.`,
    };
  }
  const seen = new Set(input.seen);
  seen.add(key);

  const supply = (input.componentStyleSuppliesByBoundaryId.get(input.boundaryId) ?? []).find(
    (candidate) => candidate.componentPropName === input.propName,
  );
  if (!supply) {
    return {
      declarations: [],
      unsupportedReason: `Inline style prop "${input.propName}" could not be linked to a component style supply.`,
    };
  }

  const direct = extractInlineStyleDeclarations({
    site: supply.site,
    sourceFile: supply.sourceFile,
    resolutionContext: input.resolutionContext,
    expressionById: expressionSyntaxById(supply.sourceFile),
  });
  if (!direct.unsupportedReason) {
    return direct;
  }

  const parentBoundaryId = input.boundaryById.get(input.boundaryId)?.parentBoundaryId;
  if (parentBoundaryId && supply.site.sourceComponentPropName) {
    return resolveComponentStyleDeclarations({
      boundaryId: parentBoundaryId,
      propName: supply.site.sourceComponentPropName,
      componentStyleSuppliesByBoundaryId: input.componentStyleSuppliesByBoundaryId,
      boundaryById: input.boundaryById,
      resolutionContext: input.resolutionContext,
      seen,
    });
  }

  return direct;
}

function expressionSyntaxById(
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"],
): Map<string, SourceExpressionSyntaxFact> {
  return new Map(
    sourceFile.expressionSyntax.map((expression) => [expression.expressionId, expression]),
  );
}

function extractInlineStyleDeclarations(input: {
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  resolutionContext: InlineStyleResolutionContext;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
}): {
  declarations: InlineStyleDeclaration[];
  unsupportedReason?: string;
} {
  const rootAlternatives = resolveInlineStyleObjectAlternatives({
    expressionId: input.site.expressionId,
    site: input.site,
    sourceFile: input.sourceFile,
    expressionById: input.expressionById,
    resolutionContext: input.resolutionContext,
    seenExpressionIds: new Set(),
  });
  if (!rootAlternatives || rootAlternatives.length === 0) {
    return {
      declarations: [],
      unsupportedReason: `Inline style "${input.site.rawExpressionText}" is not a statically analyzable object literal.`,
    };
  }

  const branchDeclarations: InlineStyleDeclaration[][] = [];
  for (const alternative of rootAlternatives) {
    const flattened = flattenInlineStyleObject({
      objectExpression: alternative.expression,
      inheritedCertainty: alternative.certainty,
      site: input.site,
      sourceFile: alternative.sourceFile,
      expressionById: alternative.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds: new Set([alternative.expression.expressionId]),
      orderCounter: { value: 0 },
    });
    if (flattened.unsupportedReason) {
      return flattened;
    }
    branchDeclarations.push(collapseInlineDeclarations(flattened.declarations));
  }

  const merged = mergeInlineStyleAlternatives({
    site: input.site,
    alternatives: branchDeclarations,
  });
  if (merged.unsupportedReason) {
    return merged;
  }
  return merged;
}

function flattenInlineStyleObject(input: {
  objectExpression: SourceObjectLiteralExpressionSyntax & SourceExpressionSyntaxFact;
  inheritedCertainty: "definite" | "possible";
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
  seenExpressionIds: Set<string>;
  orderCounter: { value: number };
}): {
  declarations: InlineStyleDeclaration[];
  unsupportedReason?: string;
} {
  if (input.objectExpression.hasUnsupportedProperty) {
    return {
      declarations: [],
      unsupportedReason: `Inline style "${input.site.rawExpressionText}" contains unsupported object properties.`,
    };
  }

  const declarations: InlineStyleDeclaration[] = [];
  for (const property of input.objectExpression.properties) {
    if (property.propertyKind === "spread") {
      const spreadObject = resolveInlineStyleSpreadObject({
        property,
        site: input.site,
        sourceFile: input.sourceFile,
        expressionById: input.expressionById,
        resolutionContext: input.resolutionContext,
      });
      if (!spreadObject) {
        return {
          declarations: [],
          unsupportedReason: `Inline style "${input.site.rawExpressionText}" contains spread that could not be statically resolved.`,
        };
      }
      if (input.seenExpressionIds.has(spreadObject.expression.expressionId)) {
        return {
          declarations: [],
          unsupportedReason: `Inline style "${input.site.rawExpressionText}" contains cyclic object spread.`,
        };
      }

      const seenExpressionIds = new Set(input.seenExpressionIds);
      seenExpressionIds.add(spreadObject.expression.expressionId);
      const spread = flattenInlineStyleObject({
        objectExpression: spreadObject.expression,
        inheritedCertainty: input.inheritedCertainty,
        site: input.site,
        sourceFile: spreadObject.sourceFile,
        expressionById: spreadObject.expressionById,
        resolutionContext: input.resolutionContext,
        seenExpressionIds,
        orderCounter: input.orderCounter,
      });
      if (spread.unsupportedReason) {
        return spread;
      }
      declarations.push(...spread.declarations);
      continue;
    }

    const declaration = extractInlineStyleDeclaration({
      property,
      expressionById: input.expressionById,
      fallbackLocation: input.site.location,
      order: input.orderCounter.value,
      certainty: input.inheritedCertainty,
    });
    input.orderCounter.value += 1;
    if (declaration) {
      declarations.push(declaration);
    }
  }

  return {
    declarations,
  };
}

function collapseInlineDeclarations(
  declarations: InlineStyleDeclaration[],
): InlineStyleDeclaration[] {
  const declarationsByProperty = new Map<string, InlineStyleDeclaration>();
  for (const declaration of declarations) {
    declarationsByProperty.set(declaration.property, declaration);
  }
  return [...declarationsByProperty.values()].sort((left, right) => left.order - right.order);
}

function mergeInlineStyleAlternatives(input: {
  site: ReactInlineStyleSiteFact;
  alternatives: InlineStyleDeclaration[][];
}): {
  declarations: InlineStyleDeclaration[];
  unsupportedReason?: string;
} {
  if (input.alternatives.length === 1) {
    return {
      declarations: input.alternatives[0],
    };
  }

  const declarationsByProperty = new Map<string, InlineStyleDeclaration[]>();
  for (const declarations of input.alternatives) {
    for (const declaration of declarations) {
      declarationsByProperty.set(declaration.property, [
        ...(declarationsByProperty.get(declaration.property) ?? []),
        declaration,
      ]);
    }
  }

  const merged: InlineStyleDeclaration[] = [];
  for (const [property, declarations] of declarationsByProperty.entries()) {
    const uniqueValues = new Set(declarations.map((declaration) => declaration.value));
    if (uniqueValues.size > 1) {
      return {
        declarations: [],
        unsupportedReason: `Inline style "${input.site.rawExpressionText}" has conditional branches with conflicting "${property}" values.`,
      };
    }
    const first = declarations.sort((left, right) => left.order - right.order)[0];
    merged.push({
      ...first,
      certainty: declarations.length === input.alternatives.length ? "definite" : "possible",
    });
  }

  return {
    declarations: merged.sort((left, right) => left.order - right.order),
  };
}

function resolveInlineStyleObjectAlternatives(input: {
  expressionId: string;
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
  seenExpressionIds: Set<string>;
}): InlineStyleExpressionAlternative[] | undefined {
  if (input.seenExpressionIds.has(input.expressionId)) {
    return undefined;
  }
  const seenExpressionIds = new Set(input.seenExpressionIds);
  seenExpressionIds.add(input.expressionId);

  const expression = unwrapExpressionSyntax(
    input.expressionById.get(input.expressionId),
    input.expressionById,
  );
  if (!expression) {
    return undefined;
  }
  if (expression.expressionKind === "object-literal") {
    return [
      {
        expression,
        sourceFile: input.sourceFile,
        expressionById: input.expressionById,
        certainty: "definite",
      },
    ];
  }
  if (expression.expressionKind === "conditional") {
    const whenTrue = resolveInlineStyleObjectAlternatives({
      ...input,
      expressionId: expression.whenTrueExpressionId,
      seenExpressionIds,
    });
    const whenFalse = resolveInlineStyleObjectAlternatives({
      ...input,
      expressionId: expression.whenFalseExpressionId,
      seenExpressionIds,
    });
    if (!whenTrue || !whenFalse) {
      return undefined;
    }
    return [...whenTrue, ...whenFalse].map((alternative) => ({
      ...alternative,
      certainty: "possible" as const,
    }));
  }
  if (expression.expressionKind === "identifier") {
    const resolved = resolveInlineStyleIdentifier({
      identifierName: expression.name,
      site: input.site,
      sourceFile: input.sourceFile,
      expressionById: input.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds,
    });
    return resolved;
  }
  if (expression.expressionKind === "call" && expression.argumentExpressionIds.length === 0) {
    const callee = unwrapExpressionSyntax(
      input.expressionById.get(expression.calleeExpressionId),
      input.expressionById,
    );
    if (callee?.expressionKind !== "identifier") {
      return undefined;
    }
    const helper = input.sourceFile.reactSyntax.helperDefinitions
      .filter(
        (candidate) =>
          candidate.helperName === callee.name &&
          candidate.filePath === input.site.filePath &&
          candidate.parameters.length === 0 &&
          !candidate.unsupportedReason &&
          isLocationAtOrBefore(candidate.location, input.site.location),
      )
      .sort(
        (left, right) =>
          right.location.startLine - left.location.startLine ||
          right.location.startColumn - left.location.startColumn ||
          right.helperKey.localeCompare(left.helperKey),
      )
      .at(0);
    const returnExpressionIds =
      helper?.returnExpressionIds ??
      (helper?.returnExpressionId ? [helper.returnExpressionId] : []);
    if (returnExpressionIds.length === 0) {
      return undefined;
    }
    const alternatives = returnExpressionIds.flatMap(
      (returnExpressionId): InlineStyleExpressionAlternative[] =>
        resolveInlineStyleObjectAlternatives({
          ...input,
          expressionId: returnExpressionId,
          seenExpressionIds,
        }) ?? [],
    );
    return alternatives.length > 0
      ? alternatives.map((alternative) => ({
          ...alternative,
          certainty: returnExpressionIds.length > 1 ? "possible" : alternative.certainty,
        }))
      : undefined;
  }

  return undefined;
}

function resolveInlineStyleIdentifier(input: {
  identifierName: string;
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
  seenExpressionIds: Set<string>;
}): InlineStyleExpressionAlternative[] | undefined {
  const binding = [...input.sourceFile.reactSyntax.localValueBindings]
    .filter(
      (candidate) =>
        candidate.bindingKind === "const-identifier" &&
        candidate.localName === input.identifierName &&
        candidate.location.filePath === input.site.location.filePath &&
        isLocationAtOrBefore(candidate.location, input.site.location) &&
        (!candidate.assignments || candidate.assignments.length === 0),
    )
    .sort(
      (left, right) =>
        right.location.startLine - left.location.startLine ||
        right.location.startColumn - left.location.startColumn ||
        right.bindingKey.localeCompare(left.bindingKey),
    )
    .at(0);
  const objectExpressionId =
    binding?.expressionId ?? binding?.objectExpressionId ?? binding?.initializerExpressionId;
  if (objectExpressionId) {
    return resolveInlineStyleObjectAlternatives({
      expressionId: objectExpressionId,
      site: input.site,
      sourceFile: input.sourceFile,
      expressionById: input.expressionById,
      resolutionContext: input.resolutionContext,
      seenExpressionIds: input.seenExpressionIds,
    });
  }

  const imported = input.resolutionContext.importedLocalByFileAndName.get(
    `${input.sourceFile.filePath}::${input.identifierName}`,
  );
  if (!imported) {
    return undefined;
  }
  const importedSourceFile = input.resolutionContext.sourceFileByPath.get(
    imported.resolvedFilePath,
  );
  if (!importedSourceFile) {
    return undefined;
  }
  const importedLocalName =
    imported.importedName === "default"
      ? importedSourceFile.moduleSyntax.declarations.exportedLocalNames.get("default")
      : importedSourceFile.moduleSyntax.declarations.exportedLocalNames.get(imported.importedName);
  if (!importedLocalName) {
    return undefined;
  }
  const importedExpressionById = expressionSyntaxById(importedSourceFile);
  const importedBinding = importedSourceFile.reactSyntax.localValueBindings.find(
    (candidate) =>
      candidate.bindingKind === "const-identifier" &&
      candidate.localName === importedLocalName &&
      (!candidate.assignments || candidate.assignments.length === 0),
  );
  const importedExpressionId =
    importedBinding?.expressionId ??
    importedBinding?.objectExpressionId ??
    importedBinding?.initializerExpressionId;
  if (!importedExpressionId) {
    return undefined;
  }

  return resolveInlineStyleObjectAlternatives({
    expressionId: importedExpressionId,
    site: input.site,
    sourceFile: importedSourceFile,
    expressionById: importedExpressionById,
    resolutionContext: input.resolutionContext,
    seenExpressionIds: input.seenExpressionIds,
  });
}

function resolveInlineStyleSpreadObject(input: {
  property: SourceObjectExpressionProperty;
  site: ReactInlineStyleSiteFact;
  sourceFile: InlineStyleSiteWithSourceFile["sourceFile"];
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  resolutionContext: InlineStyleResolutionContext;
}): InlineStyleExpressionAlternative | undefined {
  if (!input.property.spreadExpressionId) {
    return undefined;
  }

  const alternatives = resolveInlineStyleObjectAlternatives({
    expressionId: input.property.spreadExpressionId,
    site: input.site,
    sourceFile: input.sourceFile,
    expressionById: input.expressionById,
    resolutionContext: input.resolutionContext,
    seenExpressionIds: new Set(),
  });
  return alternatives?.length === 1 && alternatives[0].certainty === "definite"
    ? alternatives[0]
    : undefined;
}

function extractInlineStyleDeclaration(input: {
  property: SourceObjectExpressionProperty;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
  fallbackLocation: ReactInlineStyleSiteFact["location"];
  order: number;
  certainty: "definite" | "possible";
}): InlineStyleDeclaration | undefined {
  if (
    input.property.propertyKind !== "property" ||
    input.property.keyKind === "computed" ||
    !input.property.keyText ||
    !input.property.valueExpressionId
  ) {
    return undefined;
  }

  const valueExpression = unwrapExpressionSyntax(
    input.expressionById.get(input.property.valueExpressionId),
    input.expressionById,
  );
  const semantics = getReactInlineStyleDeclarationSemantics({
    propertyName: input.property.keyText,
    valueExpression,
    expressionById: input.expressionById,
  });
  if (!semantics) {
    return undefined;
  }

  return {
    property: semantics.property,
    value: semantics.value,
    propertyEffects: semantics.propertyEffects,
    location: input.property.location ?? input.fallbackLocation,
    order: input.order,
    certainty: input.certainty,
  };
}

function isLocationAtOrBefore(
  left: ReactInlineStyleSiteFact["location"],
  right: ReactInlineStyleSiteFact["location"],
): boolean {
  if (left.filePath !== right.filePath) {
    return false;
  }
  return (
    left.startLine < right.startLine ||
    (left.startLine === right.startLine && left.startColumn <= right.startColumn)
  );
}

function unwrapExpressionSyntax(
  expression: SourceExpressionSyntaxFact | undefined,
  expressionById: Map<string, SourceExpressionSyntaxFact>,
): SourceExpressionSyntaxFact | undefined {
  let current = expression;
  const seen = new Set<string>();
  while (current?.expressionKind === "wrapper" && !seen.has(current.expressionId)) {
    seen.add(current.expressionId);
    current = expressionById.get(current.innerExpressionId);
  }
  return current;
}

function createConditionSetFromRenderedElement(input: {
  renderedElement: RenderedElement;
  includeTraces: boolean;
}): CascadeConditionSet {
  return createConditionSetFromParts({
    atRuleContext: [],
    renderConditionIds: input.renderedElement.placementConditionIds,
    traces: input.includeTraces ? input.renderedElement.traces : [],
  });
}

function createConditionSet(input: {
  declaration: ProjectEvidenceAssemblyResult["entities"]["cssDeclarations"][number];
  selectorText: string;
  match: SelectorBranchMatch;
  includeTraces: boolean;
}): CascadeConditionSet {
  const atRuleContext = input.declaration.atRuleContext
    .filter((entry) => entry.name !== "layer")
    .map((entry) => ({
      name: entry.name,
      params: entry.params,
    }));
  const renderConditionIds = [...input.match.placementConditionIds].sort((left, right) =>
    left.localeCompare(right),
  );
  return createConditionSetFromParts({
    atRuleContext,
    renderConditionIds,
    pseudoStates: extractSelectorPseudoStates(input.selectorText),
    traces: input.includeTraces ? input.match.traces : [],
  });
}

function createConditionSetFromParts(input: {
  atRuleContext: Array<{ name: string; params: string }>;
  renderConditionIds: string[];
  pseudoStates?: string[];
  traces: CascadeConditionSet["traces"];
}): CascadeConditionSet {
  const atRuleContext = [...input.atRuleContext];
  const renderConditionIds = [...input.renderConditionIds].sort((left, right) =>
    left.localeCompare(right),
  );
  const pseudoStates = [...(input.pseudoStates ?? [])].sort((left, right) =>
    left.localeCompare(right),
  );
  const sources = [
    ...(atRuleContext.length > 0 ? (["at-rule"] as const) : []),
    ...(pseudoStates.length > 0 ? (["selector-state"] as const) : []),
    ...(renderConditionIds.length > 0 ? (["render-condition"] as const) : []),
  ];
  const compatibility: CascadeConditionSet["compatibility"] =
    atRuleContext.length > 0 || pseudoStates.length > 0 || renderConditionIds.length > 0
      ? "conditional"
      : "definite";
  const conditionSet: Omit<CascadeConditionSet, "id"> = {
    sources,
    atRuleContext,
    renderConditionIds,
    classEmissionConditionIds: [],
    pseudoStates,
    runtimeContextIds: [],
    compatibility,
    reasons: [
      ...(atRuleContext.length > 0
        ? ["at-rule conditions are modeled as conditional runtime contexts"]
        : []),
      ...(pseudoStates.length > 0
        ? ["selector pseudo-classes are modeled as conditional runtime states"]
        : []),
      ...(renderConditionIds.length > 0
        ? ["render placement conditions may affect applicability"]
        : []),
    ],
    traces: input.traces,
  };
  return {
    id: cascadeConditionSetId(conditionSet),
    ...conditionSet,
  };
}

const MODELED_SELECTOR_PSEUDO_STATES = new Set([
  "active",
  "any-link",
  "autofill",
  "blank",
  "checked",
  "current",
  "default",
  "defined",
  "disabled",
  "empty",
  "enabled",
  "first-child",
  "first-of-type",
  "focus",
  "focus-visible",
  "focus-within",
  "fullscreen",
  "future",
  "hover",
  "in-range",
  "indeterminate",
  "invalid",
  "last-child",
  "last-of-type",
  "link",
  "local-link",
  "modal",
  "muted",
  "only-child",
  "only-of-type",
  "open",
  "optional",
  "out-of-range",
  "past",
  "paused",
  "picture-in-picture",
  "placeholder-shown",
  "playing",
  "popover-open",
  "read-only",
  "read-write",
  "required",
  "root",
  "scope",
  "target",
  "target-within",
  "user-invalid",
  "user-valid",
  "valid",
  "visited",
]);

const SELECTOR_PSEUDO_STATE_CONTAINERS = new Set(["has", "host", "host-context", "is", "not"]);

const SELECTOR_PSEUDO_CLASS_IGNORED_FOR_STATE = new Set([
  "dir",
  "global",
  "lang",
  "nth-child",
  "nth-last-child",
  "nth-last-of-type",
  "nth-of-type",
  "where",
]);

function extractSelectorPseudoStates(selectorText: string): string[] {
  const states = new Set<string>();
  collectSelectorPseudoStates(selectorText, states);
  return [...states].sort((left, right) => left.localeCompare(right));
}

function collectSelectorPseudoStates(selectorText: string, states: Set<string>): void {
  let index = 0;
  while (index < selectorText.length) {
    const character = selectorText[index];
    if (character === "'" || character === '"') {
      index = skipQuotedSelectorText(selectorText, index, character);
      continue;
    }
    if (character === "[") {
      index = skipBalancedSelectorText(selectorText, index, "[", "]");
      continue;
    }
    if (character !== ":") {
      index += 1;
      continue;
    }

    if (selectorText[index + 1] === ":") {
      index += 2;
      while (isCssIdentifierCharacter(selectorText[index])) {
        index += 1;
      }
      continue;
    }

    index += 1;
    const pseudoStart = index;
    while (isCssIdentifierCharacter(selectorText[index])) {
      index += 1;
    }
    if (pseudoStart === index) {
      continue;
    }
    const pseudoName = selectorText.slice(pseudoStart, index).toLowerCase();
    if (selectorText[index] === "(") {
      const innerStart = index + 1;
      const innerEnd = skipBalancedSelectorText(selectorText, index, "(", ")");
      if (SELECTOR_PSEUDO_STATE_CONTAINERS.has(pseudoName)) {
        collectSelectorPseudoStates(selectorText.slice(innerStart, innerEnd - 1), states);
      } else if (!SELECTOR_PSEUDO_CLASS_IGNORED_FOR_STATE.has(pseudoName)) {
        states.add(pseudoName);
      }
      index = innerEnd;
      continue;
    }

    if (MODELED_SELECTOR_PSEUDO_STATES.has(pseudoName)) {
      states.add(pseudoName);
    }
  }
}

function skipQuotedSelectorText(text: string, startIndex: number, quote: string): number {
  let index = startIndex + 1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === quote) {
      return index + 1;
    }
    index += 1;
  }
  return text.length;
}

function skipBalancedSelectorText(
  text: string,
  startIndex: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let index = startIndex;
  while (index < text.length) {
    const character = text[index];
    if (character === "'" || character === '"') {
      index = skipQuotedSelectorText(text, index, character);
      continue;
    }
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return text.length;
}

function isCssIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_-]/.test(character);
}

type CandidateConditionCompatibility = {
  compatibility: "definite" | "conditional" | "unknown";
  detail: string;
};

function mapMatchCertainty(
  certainty: SelectorMatchCertainty,
): CascadeDeclarationCandidate["matchCertainty"] {
  if (certainty === "definite") {
    return "definite";
  }
  if (certainty === "possible") {
    return "possible";
  }
  return "unknown";
}

function mapRenderCertainty(
  certainty: RenderCertainty,
): CascadeDeclarationCandidate["matchCertainty"] {
  if (certainty === "definite") {
    return "definite";
  }
  if (certainty === "possible") {
    return "possible";
  }
  return "unknown";
}

function buildOutcomes(input: {
  candidates: CascadeDeclarationCandidate[];
  projectEvidence: ProjectEvidenceAssemblyResult;
  conditionSetsById: Map<string, CascadeConditionSet>;
  diagnostics: CascadeAnalysisDiagnostic[];
}): CascadeOutcome[] {
  const candidatesByElementProperty = new Map<string, CascadeDeclarationCandidate[]>();
  for (const candidate of input.candidates) {
    const key = elementPropertyKey(candidate);
    candidatesByElementProperty.set(key, [
      ...(candidatesByElementProperty.get(key) ?? []),
      candidate,
    ]);
  }

  const outcomes: CascadeOutcome[] = [];
  for (const candidates of candidatesByElementProperty.values()) {
    const sortedCandidates = candidates.sort(compareCandidates);
    const winner = sortedCandidates.at(-1);
    if (!winner) {
      continue;
    }
    const stylesheets = new Set(
      sortedCandidates
        .map((candidate) =>
          candidate.declarationId
            ? input.projectEvidence.indexes.cssDeclarationsById.get(candidate.declarationId)
                ?.stylesheetId
            : undefined,
        )
        .filter((stylesheetId): stylesheetId is string => Boolean(stylesheetId)),
    );
    const orderKnown = sortedCandidates.every((candidate) => candidate.cascadeKey.orderKnown);
    if (stylesheets.size > 1 && !orderKnown) {
      outcomes.push({
        id: cascadeOutcomeId(winner),
        elementId: winner.elementId,
        property: winner.property,
        losingCandidateIds: [],
        unresolvedCandidateIds: sortedCandidates.map((candidate) => candidate.id),
        certainty: "unknown",
        reason: "order-uncertain",
        comparisonTrace: [
          {
            reason: "order-uncertain",
            certainty: "unknown",
            detail:
              "Candidates come from multiple stylesheets and project source order is not normalized yet.",
          },
        ],
        traces: [],
      });
      continue;
    }
    const layerOrderKnown = sortedCandidates.every(
      (candidate) => candidate.cascadeKey.layer?.known ?? true,
    );
    if (!layerOrderKnown) {
      outcomes.push({
        id: cascadeOutcomeId(winner),
        elementId: winner.elementId,
        property: winner.property,
        losingCandidateIds: [],
        unresolvedCandidateIds: sortedCandidates.map((candidate) => candidate.id),
        certainty: "unknown",
        reason: "layer-order",
        comparisonTrace: [
          {
            reason: "layer-order",
            certainty: "unknown",
            detail: "One or more candidates use anonymous or unsupported cascade layer ordering.",
          },
        ],
        traces: [],
      });
      continue;
    }

    const conditionCompatibility = compareCandidateConditionSets(
      sortedCandidates,
      input.conditionSetsById,
    );
    if (conditionCompatibility.compatibility === "unknown") {
      input.diagnostics.push({
        id: cascadeDiagnosticId({
          code: "unknown-condition-compatibility",
          elementId: winner.elementId,
          index: input.diagnostics.length,
        }),
        code: "unknown-condition-compatibility",
        severity: "debug",
        confidence: "high",
        message: `Cascade candidates for "${winner.property}" have condition sets that cannot be reduced to one winner.`,
        elementId: winner.elementId,
        traces: [],
      });
      outcomes.push({
        id: cascadeOutcomeId(winner),
        elementId: winner.elementId,
        property: winner.property,
        losingCandidateIds: [],
        unresolvedCandidateIds: sortedCandidates.map((candidate) => candidate.id),
        certainty: "unknown",
        reason: "condition-uncertain",
        comparisonTrace: [
          {
            reason: "condition-uncertain",
            certainty: "unknown",
            detail: conditionCompatibility.detail,
          },
        ],
        traces: [],
      });
      continue;
    }

    const second = sortedCandidates.at(-2);
    const reason = second ? compareCandidatesReason(winner, second) : "source-order";
    const certainty =
      winner.matchCertainty === "definite" && conditionCompatibility.compatibility === "definite"
        ? "definite"
        : "possible";
    outcomes.push({
      id: cascadeOutcomeId(winner),
      elementId: winner.elementId,
      property: winner.property,
      winningCandidateId: winner.id,
      losingCandidateIds: sortedCandidates
        .filter((candidate) => candidate.id !== winner.id)
        .map((candidate) => candidate.id),
      unresolvedCandidateIds: [],
      certainty,
      reason,
      comparisonTrace: sortedCandidates
        .filter((candidate) => candidate.id !== winner.id)
        .map((candidate) => ({
          reason: compareCandidatesReason(winner, candidate),
          winningCandidateId: winner.id,
          losingCandidateId: candidate.id,
          certainty,
          detail:
            conditionCompatibility.compatibility === "conditional"
              ? "Cascade candidates compared within the same conditional context."
              : "Cascade candidates compared by importance, origin, layer, specificity, and known source order.",
        })),
      traces: [],
    });
  }

  return outcomes;
}

function compareCandidateConditionSets(
  candidates: CascadeDeclarationCandidate[],
  conditionSetsById: Map<string, CascadeConditionSet>,
): CandidateConditionCompatibility {
  const conditionSignatures = new Set(
    candidates.map((candidate) =>
      serializeConditionSet(
        candidate.conditionSetId ? conditionSetsById.get(candidate.conditionSetId) : undefined,
      ),
    ),
  );
  if (conditionSignatures.size > 1) {
    return {
      compatibility: "unknown",
      detail:
        "Candidates have different at-rule or render conditions, so different runtime contexts may produce different winners.",
    };
  }

  const conditionSet = candidates[0]?.conditionSetId
    ? conditionSetsById.get(candidates[0].conditionSetId)
    : undefined;
  if (!conditionSet || conditionSet.sources.length === 0) {
    return {
      compatibility: "definite",
      detail: "All candidates are unconditional.",
    };
  }

  return {
    compatibility: "conditional",
    detail: "All candidates share the same conditional context.",
  };
}

function serializeConditionSet(conditionSet: CascadeConditionSet | undefined): string {
  if (!conditionSet) {
    return "unconditional";
  }
  return JSON.stringify({
    atRuleContext: conditionSet.atRuleContext,
    renderConditionIds: conditionSet.renderConditionIds,
    classEmissionConditionIds: conditionSet.classEmissionConditionIds,
    pseudoStates: conditionSet.pseudoStates,
    runtimeContextIds: conditionSet.runtimeContextIds,
  });
}

function compareCandidates(
  left: CascadeDeclarationCandidate,
  right: CascadeDeclarationCandidate,
): number {
  return (
    Number(left.cascadeKey.important) - Number(right.cascadeKey.important) ||
    originPrecedenceRank(left) - originPrecedenceRank(right) ||
    compareLayerPrecedence(left, right) ||
    compareSpecificity(left.cascadeKey.specificity, right.cascadeKey.specificity) ||
    (left.cascadeKey.sourceOrder ?? 0) - (right.cascadeKey.sourceOrder ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

function compareCandidatesReason(
  winner: CascadeDeclarationCandidate,
  loser: CascadeDeclarationCandidate,
): CascadeComparisonReason {
  if (winner.cascadeKey.important !== loser.cascadeKey.important) {
    return "important";
  }
  if (originPrecedenceRank(winner) !== originPrecedenceRank(loser)) {
    return "higher-origin";
  }
  if (compareLayerPrecedence(winner, loser) !== 0) {
    return "layer-order";
  }
  if (compareSpecificity(winner.cascadeKey.specificity, loser.cascadeKey.specificity) !== 0) {
    return "specificity";
  }
  return "source-order";
}

function originPrecedenceRank(candidate: CascadeDeclarationCandidate): number {
  switch (candidate.cascadeKey.origin) {
    case "user-agent":
      return 0;
    case "user":
      return 1;
    case "author":
      return 2;
    case "inline":
      return 3;
    default:
      return -1;
  }
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function getDeclarationLayer(
  atRuleContext: ProjectEvidenceAssemblyResult["entities"]["cssDeclarations"][number]["atRuleContext"],
): CascadeDeclarationCandidate["cascadeKey"]["layer"] {
  const layerContext = findInnermostLayerContext(atRuleContext);
  if (!layerContext) {
    return {
      known: true,
      unlayered: true,
    };
  }
  return {
    ...(layerContext.layerName ? { name: layerContext.layerName } : {}),
    ...(layerContext.layerOrder !== undefined ? { order: layerContext.layerOrder } : {}),
    known: layerContext.layerOrderKnown === true && layerContext.layerOrder !== undefined,
    unlayered: false,
  };
}

function findInnermostLayerContext(
  atRuleContext: ProjectEvidenceAssemblyResult["entities"]["cssDeclarations"][number]["atRuleContext"],
) {
  for (let index = atRuleContext.length - 1; index >= 0; index -= 1) {
    if (atRuleContext[index].name === "layer") {
      return atRuleContext[index];
    }
  }
  return undefined;
}

function compareLayerPrecedence(
  left: CascadeDeclarationCandidate,
  right: CascadeDeclarationCandidate,
): number {
  return layerPrecedenceRank(left) - layerPrecedenceRank(right);
}

function layerPrecedenceRank(candidate: CascadeDeclarationCandidate): number {
  const layer = candidate.cascadeKey.layer;
  if (!layer || layer.unlayered) {
    return candidate.cascadeKey.important ? -1_000_000 : 1_000_000;
  }
  const layerOrder = layer.order ?? 0;
  return candidate.cascadeKey.important ? -layerOrder : layerOrder;
}

function buildRuntimeStylesheetOrder(input: CascadeAnalysisInput): Map<ProjectEvidenceId, number> {
  const stylesheetIdByPath = input.projectEvidence.indexes.stylesheetIdByPath;
  const stylesheetOrdersById = new Map<ProjectEvidenceId, number[]>();

  for (const chunk of input.runtimeCssLoading.chunks) {
    if (chunk.loading !== "initial") {
      continue;
    }
    const definiteStylesheetPaths = new Set(
      input.runtimeCssLoading.availability
        .filter(
          (availability) =>
            availability.chunkId === chunk.id && availability.availability === "definite",
        )
        .map((availability) => availability.stylesheetFilePath),
    );
    if (
      !chunk.stylesheetFilePaths.every((stylesheetPath) =>
        definiteStylesheetPaths.has(stylesheetPath),
      )
    ) {
      continue;
    }

    const orderedStylesheetPaths = collectRuntimeOrderedStylesheets({
      factGraph: input.factGraph,
      entrySourceFilePath: chunk.rootSourceFilePath,
      allowedSourceFilePaths: new Set(chunk.sourceFilePaths),
      allowedStylesheetFilePaths: new Set(chunk.stylesheetFilePaths),
    });
    for (const [index, stylesheetPath] of orderedStylesheetPaths.entries()) {
      const stylesheetId = stylesheetIdByPath.get(stylesheetPath);
      if (!stylesheetId) {
        continue;
      }
      const orders = stylesheetOrdersById.get(stylesheetId) ?? [];
      orders.push(index);
      stylesheetOrdersById.set(stylesheetId, orders);
    }
  }

  const stableOrder = new Map<ProjectEvidenceId, number>();
  for (const [stylesheetId, orders] of stylesheetOrdersById) {
    const uniqueOrders = [...new Set(orders)];
    if (uniqueOrders.length === 1) {
      stableOrder.set(stylesheetId, uniqueOrders[0]);
    }
  }
  return stableOrder;
}

function collectRuntimeOrderedStylesheets(input: {
  factGraph: FactGraphResult;
  entrySourceFilePath: string;
  allowedSourceFilePaths: Set<string>;
  allowedStylesheetFilePaths: Set<string>;
}): string[] {
  const importsBySourcePath = new Map<
    string,
    Array<{
      specifier: string;
      importKind: string;
      importLoading: string;
      resolvedFilePath?: string;
    }>
  >();
  for (const sourceFile of input.factGraph.frontends.source.files) {
    importsBySourcePath.set(
      sourceFile.filePath,
      sourceFile.moduleSyntax.imports.map((importRecord) => {
        const edge = input.factGraph.graph.edges.imports.find(
          (candidate) =>
            candidate.importerKind === "source" &&
            candidate.importerFilePath === sourceFile.filePath &&
            candidate.specifier === importRecord.specifier &&
            candidate.importKind === importRecord.importKind &&
            candidate.importLoading === importRecord.importLoading,
        );
        return {
          specifier: importRecord.specifier,
          importKind: importRecord.importKind,
          importLoading: importRecord.importLoading,
          resolvedFilePath: edge?.resolvedFilePath,
        };
      }),
    );
  }

  const stylesheetImportsByPath = new Map<string, string[]>();
  for (const edge of input.factGraph.snapshot.edges) {
    if (
      (edge.kind === "stylesheet-import" ||
        (edge.kind === "package-css-import" && edge.importerKind === "stylesheet")) &&
      edge.resolvedFilePath
    ) {
      const imports = stylesheetImportsByPath.get(edge.importerFilePath) ?? [];
      imports.push(edge.resolvedFilePath.replace(/\\/g, "/"));
      stylesheetImportsByPath.set(edge.importerFilePath.replace(/\\/g, "/"), imports);
    }
  }

  const orderedStylesheets: string[] = [];
  const visitedSourcePaths = new Set<string>();
  const visitedStylesheetPaths = new Set<string>();

  visitSource(input.entrySourceFilePath.replace(/\\/g, "/"));
  return orderedStylesheets;

  function visitSource(sourceFilePath: string): void {
    if (
      visitedSourcePaths.has(sourceFilePath) ||
      !input.allowedSourceFilePaths.has(sourceFilePath)
    ) {
      return;
    }
    visitedSourcePaths.add(sourceFilePath);

    for (const importRecord of importsBySourcePath.get(sourceFilePath) ?? []) {
      const resolvedFilePath = importRecord.resolvedFilePath?.replace(/\\/g, "/");
      if (!resolvedFilePath || importRecord.importLoading !== "static") {
        continue;
      }
      if (importRecord.importKind === "css") {
        visitStylesheet(resolvedFilePath);
      }
      if (importRecord.importKind === "source") {
        visitSource(resolvedFilePath);
      }
    }
  }

  function visitStylesheet(stylesheetPath: string): void {
    if (
      visitedStylesheetPaths.has(stylesheetPath) ||
      !input.allowedStylesheetFilePaths.has(stylesheetPath)
    ) {
      return;
    }
    visitedStylesheetPaths.add(stylesheetPath);

    for (const importedStylesheetPath of stylesheetImportsByPath.get(stylesheetPath) ?? []) {
      visitStylesheet(importedStylesheetPath);
    }
    orderedStylesheets.push(stylesheetPath);
  }
}
