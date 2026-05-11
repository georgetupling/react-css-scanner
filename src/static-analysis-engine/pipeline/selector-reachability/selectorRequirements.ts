import type { AnalysisTrace } from "../../types/analysis.js";
import type {
  ParsedHasClassRelation,
  ParsedSelectorBranch,
} from "../../libraries/selector-parsing/types.js";
import type { SelectorBranchRequirement, SelectorRequirementStep } from "./types.js";

const UNSUPPORTED_SELECTOR_REASON =
  "only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported";

const SUPPORTED_SUBJECT_PSEUDO_MODIFIERS = new Set([
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
      !hasOnlySupportedSubjectPseudoModifiers(parsedBranch) &&
      !parsedBranch.steps.some((step) => step.selector.hasClassRelations.length > 0) &&
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
    const hasClassRelations = parsedBranch.steps[0].selector.hasClassRelations;
    if (requiredClasses.length === 1 && hasClassRelations.length === 1) {
      return projectHasClassRelationRequirement({
        subjectClassName: requiredClasses[0],
        relation: hasClassRelations[0],
      });
    }

    if (requiredClasses.length === 0) {
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
      ...(parsedBranch.negativeClassNames.length > 0
        ? { forbiddenClassNames: [...parsedBranch.negativeClassNames] }
        : {}),
      normalizedSteps,
      parseNotes: [
        parsedBranch.negativeClassNames.length > 0
          ? "normalized selector into a same-node class conjunction with negated class guards"
          : "normalized selector into a same-node class conjunction",
        requiredClasses.length === 1
          ? `required class: ${requiredClasses[0]}`
          : `required classes: ${requiredClasses.join(", ")}`,
        ...(parsedBranch.negativeClassNames.length > 0
          ? [`forbidden classes: ${parsedBranch.negativeClassNames.join(", ")}`]
          : []),
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

function hasOnlySupportedSubjectPseudoModifiers(parsedBranch: ParsedSelectorBranch): boolean {
  const subjectStep = parsedBranch.steps[parsedBranch.subjectStepIndex];
  if (!subjectStep) {
    return false;
  }
  const selector = subjectStep.selector;
  return (
    selector.pseudoClasses.length > 0 &&
    selector.pseudoClasses.every((pseudoClass) =>
      SUPPORTED_SUBJECT_PSEUDO_MODIFIERS.has(pseudoClass),
    ) &&
    !selector.hasTypeOrIdConstraint &&
    selector.classAttributePredicates.length === 0
  );
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

function projectHasClassRelationRequirement(input: {
  subjectClassName: string;
  relation: ParsedHasClassRelation;
}): SelectorBranchRequirement {
  const normalizedSteps: SelectorRequirementStep[] = [
    {
      combinatorFromPrevious: null,
      requiredClasses: [input.subjectClassName],
    },
    {
      combinatorFromPrevious: input.relation.relation,
      requiredClasses: [input.relation.className],
    },
  ];

  if (input.relation.relation === "descendant") {
    return {
      kind: "has-descendant",
      subjectClassName: input.subjectClassName,
      descendantClassName: input.relation.className,
      normalizedSteps,
      parseNotes: [
        "normalized selector into a simple :has() descendant class relationship",
        `subject class: ${input.subjectClassName}`,
        `descendant class: ${input.relation.className}`,
      ],
      traces: [],
    };
  }

  if (input.relation.relation === "child") {
    return {
      kind: "parent-child",
      parentClassName: input.subjectClassName,
      childClassName: input.relation.className,
      normalizedSteps,
      parseNotes: [
        "normalized selector into a simple :has() child class relationship",
        `subject class: ${input.subjectClassName}`,
        `child class: ${input.relation.className}`,
      ],
      traces: [],
    };
  }

  return {
    kind: "sibling",
    relation: input.relation.relation === "adjacent-sibling" ? "adjacent" : "general",
    leftClassName: input.subjectClassName,
    rightClassName: input.relation.className,
    normalizedSteps,
    parseNotes: [
      `normalized selector into a simple :has() ${
        input.relation.relation === "adjacent-sibling" ? "adjacent" : "general"
      } sibling class relationship`,
      `subject class: ${input.subjectClassName}`,
      `sibling class: ${input.relation.className}`,
    ],
    traces: [],
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
