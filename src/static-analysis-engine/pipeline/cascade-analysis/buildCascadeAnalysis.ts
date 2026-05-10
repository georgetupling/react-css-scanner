import type { FactGraphResult } from "../fact-graph/index.js";
import type {
  ProjectEvidenceAssemblyResult,
  ProjectEvidenceId,
  SelectorBranchAnalysis,
} from "../project-evidence/index.js";
import type { RuntimeCssLoadingResult } from "../runtime-css-loading/index.js";
import type {
  SelectorBranchMatch,
  SelectorMatchCertainty,
  SelectorReachabilityResult,
} from "../selector-reachability/index.js";
import { buildCascadeAnalysisIndexes } from "./indexes.js";
import {
  cascadeConditionSetId,
  cascadeDeclarationCandidateId,
  cascadeDiagnosticId,
  cascadeOutcomeId,
  elementPropertyKey,
} from "./ids.js";
import { getCssPropertyEffects } from "./propertyEffects.js";
import { calculateSelectorSpecificity, compareSpecificity } from "./specificity.js";
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

      const propertyEffects = getCssPropertyEffects(declaration.property, declaration.value);
      for (const propertyEffect of propertyEffects) {
        if (!propertyEffect.supported) {
          diagnostics.push(
            createDiagnostic({
              code: "unsupported-property-semantics",
              message:
                propertyEffect.reason ??
                `Property semantics are not fully modeled for "${declaration.property}".`,
              declarationId: declaration.id,
              selectorBranchId,
              location: declaration.location,
              traces: [],
            }),
          );
        }
      }

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

  const outcomes = buildOutcomes({
    candidates: candidates.sort(compareById),
    projectEvidence: input.projectEvidence,
    conditionSetsById,
    diagnostics,
  });
  const sortedDiagnostics = diagnostics.sort(compareById);
  const sortedConditionSets = [...conditionSetsById.values()].sort(compareById);
  const sortedDeclarations = declarations.sort((left, right) =>
    left.declarationId.localeCompare(right.declarationId),
  );
  const sortedCandidates = candidates.sort(compareById);
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

function createConditionSet(input: {
  declaration: ProjectEvidenceAssemblyResult["entities"]["cssDeclarations"][number];
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
  const sources = [
    ...(atRuleContext.length > 0 ? (["at-rule"] as const) : []),
    ...(renderConditionIds.length > 0 ? (["render-condition"] as const) : []),
  ];
  const compatibility: CascadeConditionSet["compatibility"] =
    atRuleContext.length > 0 || renderConditionIds.length > 0 ? "conditional" : "definite";
  const conditionSet: Omit<CascadeConditionSet, "id"> = {
    sources,
    atRuleContext,
    renderConditionIds,
    classEmissionConditionIds: [],
    pseudoStates: [],
    runtimeContextIds: [],
    compatibility,
    reasons: [
      ...(atRuleContext.length > 0
        ? ["at-rule conditions are modeled as conditional runtime contexts"]
        : []),
      ...(renderConditionIds.length > 0
        ? ["render placement conditions may affect applicability"]
        : []),
    ],
    traces: input.includeTraces ? input.match.traces : [],
  };
  return {
    id: cascadeConditionSetId(conditionSet),
    ...conditionSet,
  };
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
        .map(
          (candidate) =>
            input.projectEvidence.indexes.cssDeclarationsById.get(candidate.declarationId)
              ?.stylesheetId,
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
              ? "Author declarations compared within the same conditional context."
              : "Author declarations compared by importance, specificity, and known source order.",
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
  if (compareLayerPrecedence(winner, loser) !== 0) {
    return "layer-order";
  }
  if (compareSpecificity(winner.cascadeKey.specificity, loser.cascadeKey.specificity) !== 0) {
    return "specificity";
  }
  return "source-order";
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
