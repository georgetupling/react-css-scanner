import type { NormalizedSelector, SelectorConstraint } from "../selector-analysis/types.js";
import type { ParsedSelectorBranch } from "./types.js";

const UNSUPPORTED_SELECTOR_REASON =
  "only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported";

export function projectToNormalizedSelector(
  parsedBranch: ParsedSelectorBranch,
): NormalizedSelector {
  if (
    parsedBranch.hasUnknownSemantics ||
    parsedBranch.hasSubjectModifiers ||
    parsedBranch.negativeClassNames.length > 0
  ) {
    return {
      kind: "unsupported",
      reason: UNSUPPORTED_SELECTOR_REASON,
    };
  }

  if (parsedBranch.steps.length === 1) {
    const requiredClasses = parsedBranch.steps[0].selector.requiredClasses;
    if (requiredClasses.length < 2) {
      return {
        kind: "unsupported",
        reason: UNSUPPORTED_SELECTOR_REASON,
      };
    }

    return {
      kind: "selector-chain",
      steps: [
        {
          combinatorFromPrevious: null,
          selector: {
            kind: "class-only",
            requiredClasses: [requiredClasses[0]],
          },
        },
        ...requiredClasses.slice(1).map((className) => ({
          combinatorFromPrevious: "same-node" as const,
          selector: {
            kind: "class-only" as const,
            requiredClasses: [className],
          },
        })),
      ],
    };
  }

  if (parsedBranch.steps.length !== 2) {
    return {
      kind: "unsupported",
      reason: UNSUPPORTED_SELECTOR_REASON,
    };
  }

  const [leftStep, rightStep] = parsedBranch.steps;
  if (
    leftStep.selector.requiredClasses.length !== 1 ||
    rightStep.selector.requiredClasses.length !== 1
  ) {
    return {
      kind: "unsupported",
      reason: UNSUPPORTED_SELECTOR_REASON,
    };
  }

  if (
    rightStep.combinatorFromPrevious !== "descendant" &&
    rightStep.combinatorFromPrevious !== "child" &&
    rightStep.combinatorFromPrevious !== "adjacent-sibling" &&
    rightStep.combinatorFromPrevious !== "general-sibling"
  ) {
    return {
      kind: "unsupported",
      reason: UNSUPPORTED_SELECTOR_REASON,
    };
  }

  return {
    kind: "selector-chain",
    steps: [
      {
        combinatorFromPrevious: null,
        selector: {
          kind: "class-only",
          requiredClasses: [leftStep.selector.requiredClasses[0]],
        },
      },
      {
        combinatorFromPrevious: rightStep.combinatorFromPrevious,
        selector: {
          kind: "class-only",
          requiredClasses: [rightStep.selector.requiredClasses[0]],
        },
      },
    ],
  };
}

export function projectToSelectorConstraint(normalizedSelector: NormalizedSelector):
  | SelectorConstraint
  | {
      kind: "unsupported";
      reason: string;
    } {
  if (normalizedSelector.kind === "unsupported") {
    return normalizedSelector;
  }

  const { steps } = normalizedSelector;
  if (steps.length < 2) {
    return {
      kind: "unsupported",
      reason: UNSUPPORTED_SELECTOR_REASON,
    };
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
