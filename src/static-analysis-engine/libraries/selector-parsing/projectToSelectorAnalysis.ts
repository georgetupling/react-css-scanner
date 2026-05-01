import type { AnalysisTrace } from "../../types/analysis.js";
import type {
  NormalizedSelector,
  SelectorConstraint,
} from "../../pipeline/selector-analysis/types.js";
import { projectSelectorBranchRequirement } from "../../pipeline/selector-reachability/selectorRequirements.js";
import type { ParsedSelectorBranch } from "./types.js";

const UNSUPPORTED_SELECTOR_REASON =
  "only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported";

export function projectToNormalizedSelector(
  parsedBranch: ParsedSelectorBranch,
  options: { includeTraces?: boolean } = {},
): NormalizedSelector {
  const requirement = projectSelectorBranchRequirement(parsedBranch, options);
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

export function projectToSelectorConstraint(
  normalizedSelector: NormalizedSelector,
  options: { includeTraces?: boolean } = {},
):
  | SelectorConstraint
  | {
      kind: "unsupported";
      reason: string;
      traces: AnalysisTrace[];
    } {
  const includeTraces = options.includeTraces ?? true;
  if (normalizedSelector.kind === "unsupported") {
    return normalizedSelector;
  }

  const { steps } = normalizedSelector;
  if (steps.length < 2) {
    return createUnsupportedConstraint({
      reason: UNSUPPORTED_SELECTOR_REASON,
      summary:
        "normalized selector did not contain enough steps to project into a supported selector constraint",
      metadata: {
        stepCount: steps.length,
      },
      includeTraces,
    });
  }

  const combinators = steps.slice(1).map((step) => step.combinatorFromPrevious);

  if (combinators.every((combinator) => combinator === "same-node")) {
    return {
      kind: "same-node-class-conjunction",
      classNames: steps.flatMap((step) => step.selector.requiredClasses),
    };
  }

  if (
    steps.length === 2 &&
    steps[1].combinatorFromPrevious === "descendant" &&
    steps[0].selector.requiredClasses.length === 1 &&
    steps[1].selector.requiredClasses.length === 1
  ) {
    return {
      kind: "ancestor-descendant",
      ancestorClassName: steps[0].selector.requiredClasses[0],
      subjectClassName: steps[1].selector.requiredClasses[0],
    };
  }

  if (
    steps.length === 2 &&
    steps[1].combinatorFromPrevious === "child" &&
    steps[0].selector.requiredClasses.length === 1 &&
    steps[1].selector.requiredClasses.length === 1
  ) {
    return {
      kind: "parent-child",
      parentClassName: steps[0].selector.requiredClasses[0],
      childClassName: steps[1].selector.requiredClasses[0],
    };
  }

  if (
    steps.length === 2 &&
    (steps[1].combinatorFromPrevious === "adjacent-sibling" ||
      steps[1].combinatorFromPrevious === "general-sibling") &&
    steps[0].selector.requiredClasses.length === 1 &&
    steps[1].selector.requiredClasses.length === 1
  ) {
    return {
      kind: "sibling",
      relation: steps[1].combinatorFromPrevious === "adjacent-sibling" ? "adjacent" : "general",
      leftClassName: steps[0].selector.requiredClasses[0],
      rightClassName: steps[1].selector.requiredClasses[0],
    };
  }

  return {
    kind: "unsupported",
    reason: UNSUPPORTED_SELECTOR_REASON,
    traces: includeTraces
      ? [
          createSelectorParsingTrace({
            traceId: "selector-parsing:constraint:unsupported-shape",
            summary:
              "normalized selector could not be projected into one of the currently supported selector constraint shapes",
            metadata: {
              stepCount: steps.length,
              combinators,
            },
          }),
        ]
      : [],
  };
}

export function buildSelectorParseNotes(normalizedSelector: NormalizedSelector): string[] {
  if (normalizedSelector.kind === "unsupported") {
    return [`unsupported selector shape: ${normalizedSelector.reason}`];
  }

  const { steps } = normalizedSelector;
  const combinators = steps.slice(1).map((step) => step.combinatorFromPrevious);

  if (combinators.every((combinator) => combinator === "same-node")) {
    return [
      "normalized selector into a same-node class conjunction",
      `required classes: ${steps.flatMap((step) => step.selector.requiredClasses).join(", ")}`,
    ];
  }

  if (
    steps.length === 2 &&
    steps[1].combinatorFromPrevious === "descendant" &&
    steps[0].selector.requiredClasses.length === 1 &&
    steps[1].selector.requiredClasses.length === 1
  ) {
    return [
      "normalized selector into a simple ancestor-descendant class relationship",
      `ancestor class: ${steps[0].selector.requiredClasses[0]}`,
      `subject class: ${steps[1].selector.requiredClasses[0]}`,
    ];
  }

  if (
    steps.length === 2 &&
    steps[1].combinatorFromPrevious === "child" &&
    steps[0].selector.requiredClasses.length === 1 &&
    steps[1].selector.requiredClasses.length === 1
  ) {
    return [
      "normalized selector into a simple parent-child class relationship",
      `parent class: ${steps[0].selector.requiredClasses[0]}`,
      `child class: ${steps[1].selector.requiredClasses[0]}`,
    ];
  }

  if (
    steps.length === 2 &&
    (steps[1].combinatorFromPrevious === "adjacent-sibling" ||
      steps[1].combinatorFromPrevious === "general-sibling") &&
    steps[0].selector.requiredClasses.length === 1 &&
    steps[1].selector.requiredClasses.length === 1
  ) {
    return [
      `normalized selector into a simple ${steps[1].combinatorFromPrevious === "adjacent-sibling" ? "adjacent" : "general"} sibling class relationship`,
      `left class: ${steps[0].selector.requiredClasses[0]}`,
      `right class: ${steps[1].selector.requiredClasses[0]}`,
    ];
  }

  return [`unsupported selector shape: ${UNSUPPORTED_SELECTOR_REASON}`];
}

function createUnsupportedConstraint(input: {
  reason: string;
  summary: string;
  metadata?: Record<string, unknown>;
  includeTraces: boolean;
}): Extract<
  ReturnType<typeof projectToSelectorConstraint>,
  {
    kind: "unsupported";
  }
> {
  return {
    kind: "unsupported",
    reason: input.reason,
    traces: input.includeTraces
      ? [
          createSelectorParsingTrace({
            traceId: "selector-parsing:constraint:unsupported",
            summary: input.summary,
            metadata: input.metadata,
          }),
        ]
      : [],
  };
}

function createSelectorParsingTrace(input: {
  traceId: string;
  summary: string;
  metadata?: Record<string, unknown>;
}): AnalysisTrace {
  return {
    traceId: input.traceId,
    category: "selector-parsing",
    summary: input.summary,
    children: [],
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
