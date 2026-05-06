import type { AnalysisTrace } from "../../types/analysis.js";
import type { ParsedSelectorBranch } from "../../libraries/selector-parsing/types.js";
import type { SelectorBranchRequirement, SelectorRequirementStep } from "./types.js";

const UNSUPPORTED_SELECTOR_REASON =
  "only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported";

export function projectSelectorBranchRequirement(
  parsedBranch: ParsedSelectorBranch | undefined,
  options: { includeTraces?: boolean } = {},
): SelectorBranchRequirement {
  const includeTraces = options.includeTraces ?? true;
  if (!parsedBranch) {
    return createUnsupportedRequirement({
      reason: "selector branch could not be parsed for bounded selector reachability",
      summary: "could not parse selector branch into the supported bounded selector shape subset",
      includeTraces,
    });
  }

  if (
    parsedBranch.hasUnknownSemantics ||
    (parsedBranch.hasSubjectModifiers &&
      parsedBranch.hasDescendantClassNames.length === 0 &&
      parsedBranch.negativeClassNames.length === 0)
  ) {
    return createUnsupportedRequirement({
      reason: UNSUPPORTED_SELECTOR_REASON,
      summary:
        "could not normalize selector branch into the supported bounded selector shape subset",
      metadata: {
        hasUnknownSemantics: parsedBranch.hasUnknownSemantics,
        hasSubjectModifiers: parsedBranch.hasSubjectModifiers,
        negativeClassNames: [...parsedBranch.negativeClassNames],
        hasDescendantClassNames: [...parsedBranch.hasDescendantClassNames],
      },
      includeTraces,
    });
  }

  if (parsedBranch.steps.length === 1) {
    const requiredClasses = parsedBranch.steps[0].selector.requiredClasses;
    const hasDescendantClasses = parsedBranch.steps[0].selector.hasDescendantClasses;
    if (requiredClasses.length === 1 && hasDescendantClasses.length === 1) {
      return {
        kind: "has-descendant",
        subjectClassName: requiredClasses[0],
        descendantClassName: hasDescendantClasses[0],
        normalizedSteps: [
          {
            combinatorFromPrevious: null,
            requiredClasses: [requiredClasses[0]],
          },
          {
            combinatorFromPrevious: "descendant",
            requiredClasses: [hasDescendantClasses[0]],
          },
        ],
        parseNotes: [
          "normalized selector into a simple :has() descendant class relationship",
          `subject class: ${requiredClasses[0]}`,
          `descendant class: ${hasDescendantClasses[0]}`,
        ],
        traces: [],
      };
    }

    if (requiredClasses.length < 2) {
      if (requiredClasses.length === 1 && parsedBranch.negativeClassNames.length > 0) {
        return {
          kind: "same-node-class-conjunction",
          classNames: [...requiredClasses],
          forbiddenClassNames: [...parsedBranch.negativeClassNames],
          normalizedSteps: [
            {
              combinatorFromPrevious: null,
              requiredClasses: [requiredClasses[0]],
            },
          ],
          parseNotes: [
            "normalized selector into a same-node class conjunction with negated class guards",
            `required class: ${requiredClasses[0]}`,
            `forbidden classes: ${parsedBranch.negativeClassNames.join(", ")}`,
          ],
          traces: [],
        };
      }

      return createUnsupportedRequirement({
        reason: UNSUPPORTED_SELECTOR_REASON,
        summary:
          "single-step selector branch did not contain enough required classes for supported same-node projection",
        metadata: {
          requiredClassCount: requiredClasses.length,
        },
        includeTraces,
      });
    }

    const normalizedSteps: SelectorRequirementStep[] = [
      {
        combinatorFromPrevious: null,
        requiredClasses: [requiredClasses[0]],
      },
      ...requiredClasses.slice(1).map((className) => ({
        combinatorFromPrevious: "same-node" as const,
        requiredClasses: [className],
      })),
    ];
    return {
      kind: "same-node-class-conjunction",
      classNames: [...requiredClasses],
      normalizedSteps,
      parseNotes: [
        "normalized selector into a same-node class conjunction",
        `required classes: ${requiredClasses.join(", ")}`,
      ],
      traces: [],
    };
  }

  if (parsedBranch.steps.length !== 2) {
    return createUnsupportedRequirement({
      reason: UNSUPPORTED_SELECTOR_REASON,
      summary:
        "selector branch had an unsupported number of structural steps for bounded selector analysis",
      metadata: {
        stepCount: parsedBranch.steps.length,
      },
      includeTraces,
    });
  }

  const [leftStep, rightStep] = parsedBranch.steps;
  if (
    leftStep.selector.requiredClasses.length !== 1 ||
    rightStep.selector.requiredClasses.length !== 1
  ) {
    return createUnsupportedRequirement({
      reason: UNSUPPORTED_SELECTOR_REASON,
      summary: "selector branch could not be normalized because one side required multiple classes",
      metadata: {
        leftRequiredClasses: [...leftStep.selector.requiredClasses],
        rightRequiredClasses: [...rightStep.selector.requiredClasses],
      },
      includeTraces,
    });
  }

  const combinator = rightStep.combinatorFromPrevious;
  if (
    combinator !== "descendant" &&
    combinator !== "child" &&
    combinator !== "adjacent-sibling" &&
    combinator !== "general-sibling"
  ) {
    return createUnsupportedRequirement({
      reason: UNSUPPORTED_SELECTOR_REASON,
      summary: "selector branch used an unsupported combinator for bounded selector analysis",
      metadata: {
        combinator,
      },
      includeTraces,
    });
  }

  const leftClassName = leftStep.selector.requiredClasses[0];
  const rightClassName = rightStep.selector.requiredClasses[0];
  const normalizedSteps: SelectorRequirementStep[] = [
    {
      combinatorFromPrevious: null,
      requiredClasses: [leftClassName],
    },
    {
      combinatorFromPrevious: combinator,
      requiredClasses: [rightClassName],
    },
  ];

  if (combinator === "descendant") {
    return {
      kind: "ancestor-descendant",
      ancestorClassName: leftClassName,
      subjectClassName: rightClassName,
      normalizedSteps,
      parseNotes: [
        "normalized selector into a simple ancestor-descendant class relationship",
        `ancestor class: ${leftClassName}`,
        `subject class: ${rightClassName}`,
      ],
      traces: [],
    };
  }

  if (combinator === "child") {
    return {
      kind: "parent-child",
      parentClassName: leftClassName,
      childClassName: rightClassName,
      normalizedSteps,
      parseNotes: [
        "normalized selector into a simple parent-child class relationship",
        `parent class: ${leftClassName}`,
        `child class: ${rightClassName}`,
      ],
      traces: [],
    };
  }

  return {
    kind: "sibling",
    relation: combinator === "adjacent-sibling" ? "adjacent" : "general",
    leftClassName,
    rightClassName,
    normalizedSteps,
    parseNotes: [
      `normalized selector into a simple ${combinator === "adjacent-sibling" ? "adjacent" : "general"} sibling class relationship`,
      `left class: ${leftClassName}`,
      `right class: ${rightClassName}`,
    ],
    traces: [],
  };
}

function createUnsupportedRequirement(input: {
  reason: string;
  summary: string;
  metadata?: Record<string, unknown>;
  includeTraces: boolean;
}): Extract<SelectorBranchRequirement, { kind: "unsupported" }> {
  return {
    kind: "unsupported",
    reason: input.reason,
    parseNotes: [`unsupported selector shape: ${input.reason}`],
    traces: input.includeTraces
      ? [
          createSelectorRequirementTrace({
            traceId: "selector-reachability:requirement:unsupported",
            summary: input.summary,
            metadata: input.metadata,
          }),
        ]
      : [],
  };
}

function createSelectorRequirementTrace(input: {
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
