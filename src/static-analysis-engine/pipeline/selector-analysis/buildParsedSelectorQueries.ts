import type { ExtractedSelectorQuery, ParsedSelectorQuery } from "./types.js";
import type { AnalysisTrace } from "../../types/analysis.js";
import type {
  SelectorBranchRequirement,
  SelectorReachabilityResult,
} from "../selector-reachability/index.js";
import { selectorBranchSourceKey } from "../selector-reachability/index.js";
import {
  buildSelectorParseNotes,
  parseSelectorBranches,
  projectToNormalizedSelector,
  projectToSelectorConstraint,
} from "../../libraries/selector-parsing/index.js";

const UNSUPPORTED_SELECTOR_REASON =
  "only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported";

export function buildParsedSelectorQueries(
  selectorQueries: ExtractedSelectorQuery[],
  options: { includeTraces?: boolean; selectorReachability?: SelectorReachabilityResult } = {},
): ParsedSelectorQuery[] {
  const includeTraces = options.includeTraces ?? true;
  return selectorQueries.map((selectorQuery) => {
    const normalizedSelectorText = selectorQuery.selectorText.trim().replace(/\s+/g, " ");
    const stageRequirement = getSelectorReachabilityRequirement({
      selectorQuery,
      normalizedSelectorText,
      selectorReachability: options.selectorReachability,
    });
    if (stageRequirement) {
      const normalizedSelector = normalizedSelectorFromRequirement(stageRequirement);
      const constraint = selectorConstraintFromRequirement(stageRequirement, includeTraces);
      const parseTraces = includeTraces
        ? collectSelectorParseTraces(normalizedSelector, constraint)
        : [];

      return {
        selectorText: selectorQuery.selectorText,
        source: selectorQuery.source,
        normalizedSelectorText,
        normalizedSelector,
        parseNotes: stageRequirement.parseNotes,
        parseTraces,
        constraint,
      };
    }

    const parsedBranches = parseSelectorBranches(normalizedSelectorText);
    const normalizedSelector =
      parsedBranches.length === 1
        ? projectToNormalizedSelector(parsedBranches[0], { includeTraces })
        : {
            kind: "unsupported" as const,
            reason: UNSUPPORTED_SELECTOR_REASON,
            traces: includeTraces
              ? [
                  {
                    traceId: "selector-parsing:normalized-selector:multiple-branches",
                    category: "selector-parsing" as const,
                    summary:
                      "could not normalize selector because comma-separated or multi-branch selectors are not yet supported for bounded selector analysis",
                    children: [],
                    metadata: {
                      branchCount: parsedBranches.length,
                    },
                  },
                ]
              : [],
          };
    const constraint = projectToSelectorConstraint(normalizedSelector, { includeTraces });
    const parseTraces = includeTraces
      ? collectSelectorParseTraces(normalizedSelector, constraint)
      : [];

    return {
      selectorText: selectorQuery.selectorText,
      source: selectorQuery.source,
      normalizedSelectorText,
      normalizedSelector,
      parseNotes: buildSelectorParseNotes(normalizedSelector),
      parseTraces,
      constraint,
    };
  });
}

function getSelectorReachabilityRequirement(input: {
  selectorQuery: ExtractedSelectorQuery;
  normalizedSelectorText: string;
  selectorReachability?: SelectorReachabilityResult;
}): SelectorBranchRequirement | undefined {
  if (!input.selectorReachability || input.selectorQuery.source.kind !== "css-source") {
    return undefined;
  }

  return input.selectorReachability.indexes.branchReachabilityBySourceKey.get(
    selectorBranchSourceKey({
      ruleKey: input.selectorQuery.source.ruleKey,
      branchIndex: input.selectorQuery.source.branchIndex,
      selectorText: input.normalizedSelectorText,
      location: input.selectorQuery.source.selectorAnchor,
    }),
  )?.requirement;
}

function normalizedSelectorFromRequirement(
  requirement: SelectorBranchRequirement,
): ParsedSelectorQuery["normalizedSelector"] {
  if (requirement.kind === "unsupported") {
    return {
      kind: "unsupported",
      reason: requirement.reason,
      traces: requirement.traces,
    };
  }

  return {
    kind: "selector-chain",
    steps: requirement.normalizedSteps.map((step) => ({
      combinatorFromPrevious: step.combinatorFromPrevious,
      selector: {
        kind: "class-only",
        requiredClasses: step.requiredClasses,
      },
    })),
  };
}

function selectorConstraintFromRequirement(
  requirement: SelectorBranchRequirement,
  includeTraces: boolean,
): ParsedSelectorQuery["constraint"] {
  if (requirement.kind === "unsupported") {
    return {
      kind: "unsupported",
      reason: requirement.reason,
      traces: includeTraces ? requirement.traces : [],
    };
  }

  if (requirement.kind === "same-node-class-conjunction") {
    return {
      kind: "same-node-class-conjunction",
      classNames: requirement.classNames,
    };
  }

  if (requirement.kind === "ancestor-descendant") {
    return {
      kind: "ancestor-descendant",
      ancestorClassName: requirement.ancestorClassName,
      subjectClassName: requirement.subjectClassName,
    };
  }

  if (requirement.kind === "parent-child") {
    return {
      kind: "parent-child",
      parentClassName: requirement.parentClassName,
      childClassName: requirement.childClassName,
    };
  }

  return {
    kind: "sibling",
    relation: requirement.relation,
    leftClassName: requirement.leftClassName,
    rightClassName: requirement.rightClassName,
  };
}

function collectSelectorParseTraces(
  normalizedSelector: ParsedSelectorQuery["normalizedSelector"],
  constraint: ParsedSelectorQuery["constraint"],
): AnalysisTrace[] {
  const tracesByKey = new Map<string, AnalysisTrace>();

  if (normalizedSelector.kind === "unsupported") {
    for (const trace of normalizedSelector.traces) {
      tracesByKey.set(serializeTrace(trace), trace);
    }
  }

  if ("kind" in constraint && constraint.kind === "unsupported") {
    for (const trace of constraint.traces) {
      tracesByKey.set(serializeTrace(trace), trace);
    }
  }

  return [...tracesByKey.values()];
}

function serializeTrace(trace: AnalysisTrace): string {
  return JSON.stringify({
    traceId: trace.traceId,
    category: trace.category,
    summary: trace.summary,
    metadata: trace.metadata ?? null,
    anchor: trace.anchor ?? null,
  });
}
