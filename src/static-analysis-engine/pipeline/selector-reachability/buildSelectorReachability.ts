import { parseSelectorBranch } from "../../libraries/selector-parsing/parseSelectorBranch.js";
import type { SelectorBranchNode } from "../fact-graph/index.js";
import type { RenderModel } from "../render-structure/index.js";
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
  buildStructuralRelationIndexes,
  buildStructuralMatches,
  createStructuralMatchContext,
  projectStructuralConstraintFromRequirement,
} from "./structuralMatches.js";
import type {
  SelectorBranchMatch,
  SelectorBranchReachability,
  SelectorElementMatch,
  SelectorReachabilityDiagnostic,
  SelectorReachabilityStatus,
  SelectorReachabilityResult,
} from "./types.js";
import { uniqueSorted } from "./utils.js";

export type SelectorReachabilityInput = {
  renderModel: RenderModel;
  selectorBranches: SelectorBranchNode[];
};

type SelectorReachabilityProfiler = {
  enabled: boolean;
  totals: Map<string, number>;
  counts: Map<string, number>;
  time<T>(label: string, run: () => T): T;
  logSummary(): void;
};

export function buildSelectorReachability(
  input: SelectorReachabilityInput,
  options: { includeTraces?: boolean } = {},
): SelectorReachabilityResult {
  const includeTraces = options.includeTraces ?? true;
  const profiler = createSelectorReachabilityProfiler(
    process.env.SCAN_REACT_CSS_PROFILE_SELECTOR_REACHABILITY === "1",
  );
  const renderIndexes = profiler.time("selectorReachability.buildRenderMatchIndexes", () =>
    buildSelectorRenderMatchIndexes(input.renderModel),
  );
  const selectorBranches: SelectorBranchReachability[] = [];
  const elementMatches: SelectorElementMatch[] = [];
  const branchMatches: SelectorBranchMatch[] = [];
  const diagnostics: SelectorReachabilityDiagnostic[] = [];
  const structuralRelationIndexes = profiler.time(
    "selectorReachability.buildStructuralRelationIndexes",
    () => buildStructuralRelationIndexes(input.renderModel),
  );
  const structuralMatchContext = createStructuralMatchContext();

  const sortedBranches = profiler.time("selectorReachability.sortSelectorBranches", () =>
    [...input.selectorBranches].sort(compareSelectorBranches),
  );
  for (const branch of sortedBranches) {
    const parsedBranch = profiler.time("selectorReachability.parseSelectorBranch", () =>
      parseSelectorBranch(branch.selectorText),
    );
    const requirement = profiler.time("selectorReachability.projectRequirement", () =>
      projectSelectorBranchRequirement(parsedBranch, { includeTraces }),
    );
    const structuralConstraint = profiler.time(
      "selectorReachability.projectStructuralConstraint",
      () => projectStructuralConstraintFromRequirement(requirement),
    );
    const branchDiagnostics = profiler.time("selectorReachability.buildDiagnostics", () =>
      buildDiagnostics({
        branch,
        parsedBranch,
        requirement,
      }),
    );
    diagnostics.push(...branchDiagnostics);

    const branchElementMatches: SelectorElementMatch[] = [];
    if (branch.subjectClassNames.length > 0 && branchDiagnostics.length === 0) {
      const subjectElementMatches = profiler.time(
        "selectorReachability.buildElementMatchesForClassNames",
        () => {
          const matches = buildElementMatchesForClassNames({
            branch,
            classNames: branch.subjectClassNames,
            elementIds: getCandidateElementIds({
              classNames: branch.subjectClassNames,
              elementIdsByClassName: renderIndexes.elementIdsByClassName,
              renderIndexes,
            }),
            renderIndexes,
          });
          return filterNegatedSubjectMatches({
            matches,
            requirement,
            elementIdsByClassName: renderIndexes.elementIdsByClassName,
          });
        },
      );
      branchElementMatches.push(...subjectElementMatches);
    }

    const structuralMatches = structuralConstraint
      ? profiler.time("selectorReachability.buildStructuralMatches", () =>
          buildStructuralMatches({
            branch,
            constraint: structuralConstraint,
            renderModel: input.renderModel,
            renderIndexes,
            structuralRelationIndexes,
            context: structuralMatchContext,
          }),
        )
      : undefined;
    if (structuralMatches) {
      branchElementMatches.push(...structuralMatches.elementMatches);
    }

    const candidateBranchMatches =
      structuralMatches?.branchMatches ??
      profiler.time("selectorReachability.buildSubjectBranchMatches", () =>
        buildSubjectBranchMatches({
          branch,
          renderModel: input.renderModel,
          elementMatches: branchElementMatches,
        }),
      );

    elementMatches.push(...branchElementMatches);
    branchMatches.push(...candidateBranchMatches);
    const status = getBranchStatus(branchDiagnostics, candidateBranchMatches);
    const confidence = getBranchConfidence(branchDiagnostics, candidateBranchMatches);

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
      status,
      confidence,
      reasons: buildBranchReasons({ status }),
      matchIds: candidateBranchMatches
        .map((match) => match.id)
        .sort((left, right) => left.localeCompare(right)),
      diagnosticIds: branchDiagnostics.map((diagnostic) => diagnostic.id),
      ...(branch.location ? { location: branch.location } : {}),
      traces: [],
    });
  }

  const indexes = profiler.time("selectorReachability.buildIndexes", () =>
    buildIndexes({
      renderModel: input.renderModel,
      selectorBranches,
      elementMatches,
      branchMatches,
      diagnostics,
    }),
  );

  const selectorQueries = profiler.time("selectorReachability.buildSelectorQueries", () =>
    buildSelectorQueries(selectorBranches),
  );
  profiler.logSummary();

  return {
    meta: {
      generatedAtStage: "selector-reachability",
      selectorBranchCount: selectorBranches.length,
      selectorQueryCount: selectorQueries.length,
      elementMatchCount: elementMatches.length,
      branchMatchCount: branchMatches.length,
      diagnosticCount: diagnostics.length,
    },
    selectorBranches,
    selectorQueries,
    elementMatches,
    branchMatches,
    diagnostics,
    indexes,
  };
}

function filterNegatedSubjectMatches(input: {
  matches: SelectorElementMatch[];
  requirement: ReturnType<typeof projectSelectorBranchRequirement>;
  elementIdsByClassName: Map<string, string[]>;
}): SelectorElementMatch[] {
  if (
    input.requirement.kind !== "same-node-class-conjunction" ||
    !input.requirement.forbiddenClassNames ||
    input.requirement.forbiddenClassNames.length === 0
  ) {
    return input.matches;
  }

  const forbiddenElementIds = new Set(
    input.requirement.forbiddenClassNames.flatMap(
      (className) => input.elementIdsByClassName.get(className) ?? [],
    ),
  );

  return input.matches.filter((match) => !forbiddenElementIds.has(match.elementId));
}

function createSelectorReachabilityProfiler(enabled: boolean): SelectorReachabilityProfiler {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  return {
    enabled,
    totals,
    counts,
    time<T>(label: string, run: () => T): T {
      if (!enabled) {
        return run();
      }
      const start = performance.now();
      const result = run();
      const elapsed = performance.now() - start;
      totals.set(label, (totals.get(label) ?? 0) + elapsed);
      counts.set(label, (counts.get(label) ?? 0) + 1);
      return result;
    },
    logSummary(): void {
      if (!enabled) {
        return;
      }
      const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
      for (const [label, totalMs] of rows) {
        const count = counts.get(label) ?? 0;
        const avgMs = count > 0 ? totalMs / count : 0;
        console.error(
          `[profile:selector-reachability] ${label}: total=${totalMs.toFixed(1)}ms count=${count} avg=${avgMs.toFixed(3)}ms`,
        );
      }
    },
  };
}

function buildSelectorQueries(selectorBranches: SelectorBranchReachability[]) {
  const queryBySelectorNodeId = new Map<string, (typeof selectorBranches)[number]>();
  const queries = new Map<
    string,
    {
      selectorNodeId: string;
      stylesheetNodeId?: string;
      ruleDefinitionNodeId?: string;
      selectorText: string;
      location?: SelectorBranchReachability["location"];
      branchIds: string[];
      selectorReachabilityStatuses: SelectorReachabilityStatus[];
      confidence: SelectorBranchReachability["confidence"];
      reasons: string[];
      traces: SelectorBranchReachability["traces"];
    }
  >();

  for (const branch of selectorBranches) {
    queryBySelectorNodeId.set(branch.selectorNodeId, branch);
    const existing = queries.get(branch.selectorNodeId);
    if (!existing) {
      queries.set(branch.selectorNodeId, {
        selectorNodeId: branch.selectorNodeId,
        ...(branch.stylesheetNodeId ? { stylesheetNodeId: branch.stylesheetNodeId } : {}),
        ...(branch.ruleDefinitionNodeId
          ? { ruleDefinitionNodeId: branch.ruleDefinitionNodeId }
          : {}),
        selectorText: branch.branchText,
        ...(branch.location ? { location: branch.location } : {}),
        branchIds: [branch.selectorBranchNodeId],
        selectorReachabilityStatuses: [branch.status],
        confidence: branch.confidence,
        reasons: [...branch.reasons],
        traces: [...branch.traces],
      });
      continue;
    }

    existing.branchIds.push(branch.selectorBranchNodeId);
    existing.selectorReachabilityStatuses.push(branch.status);
    for (const reason of branch.reasons) {
      if (!existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }
    }
    if (confidenceRank(branch.confidence) < confidenceRank(existing.confidence)) {
      existing.confidence = branch.confidence;
    }
    if (branch.stylesheetNodeId && !existing.stylesheetNodeId) {
      existing.stylesheetNodeId = branch.stylesheetNodeId;
    }
    if (branch.ruleDefinitionNodeId && !existing.ruleDefinitionNodeId) {
      existing.ruleDefinitionNodeId = branch.ruleDefinitionNodeId;
    }
    if (branch.location && !existing.location) {
      existing.location = branch.location;
    }
    existing.traces.push(...branch.traces);
  }

  return [...queries.values()]
    .map((query) => ({
      ...query,
      branchIds: [...new Set(query.branchIds)].sort((left, right) => left.localeCompare(right)),
      selectorReachabilityStatuses: [...query.selectorReachabilityStatuses].sort((left, right) =>
        left.localeCompare(right),
      ),
    }))
    .sort((left, right) => {
      return (
        (left.location?.filePath ?? "").localeCompare(right.location?.filePath ?? "") ||
        (left.location?.startLine ?? 0) - (right.location?.startLine ?? 0) ||
        (left.location?.startColumn ?? 0) - (right.location?.startColumn ?? 0) ||
        left.selectorText.localeCompare(right.selectorText) ||
        left.selectorNodeId.localeCompare(right.selectorNodeId)
      );
    });
}

function buildBranchReasons(input: { status: SelectorReachabilityStatus }): string[] {
  if (input.status === "unsupported") {
    return ["selector branch contains unsupported selector semantics"];
  }
  if (input.status === "not-matchable") {
    return ["no bounded selector match was found"];
  }
  if (input.status === "only-matches-in-unknown-context") {
    return ["selector can only match through unknown render or class context"];
  }
  if (input.status === "possibly-matchable") {
    return ["a bounded selector match is possible"];
  }
  return ["a bounded selector match was found"];
}

function confidenceRank(confidence: "low" | "medium" | "high"): number {
  if (confidence === "high") {
    return 2;
  }
  if (confidence === "medium") {
    return 1;
  }
  return 0;
}
