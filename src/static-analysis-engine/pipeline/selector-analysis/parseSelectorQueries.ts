import type {
  ExtractedSelectorQuery,
  NormalizedSelector,
  ParsedSelectorQuery,
  SelectorConstraint,
} from "./types.js";

const UNSUPPORTED_SELECTOR_REASON =
  "only simple .a .b, .a > .b, .a + .b, .a ~ .b, and .a.b selector queries are currently supported";

export function parseSelectorQueries(
  selectorQueries: ExtractedSelectorQuery[],
): ParsedSelectorQuery[] {
  return selectorQueries.map((selectorQuery) => {
    const normalizedSelectorText = selectorQuery.selectorText.trim().replace(/\s+/g, " ");
    const normalizedSelector = parseNormalizedSelector(normalizedSelectorText);
    const constraint = mapNormalizedSelectorToConstraint(normalizedSelector);

    return {
      selectorText: selectorQuery.selectorText,
      source: selectorQuery.source,
      normalizedSelectorText,
      normalizedSelector,
      parseNotes: buildParseNotes(normalizedSelector),
      constraint,
    };
  });
}

function parseNormalizedSelector(selectorText: string): NormalizedSelector {
  const normalized = selectorText.trim();
  if (normalized.length === 0) {
    return {
      kind: "unsupported",
      reason: "empty-selector",
    };
  }

  const ancestorDescendantMatch = normalized.match(/^\.([A-Za-z0-9_-]+)\s+\.([A-Za-z0-9_-]+)$/);
  if (ancestorDescendantMatch) {
    return {
      kind: "selector-chain",
      steps: [
        {
          combinatorFromPrevious: null,
          selector: {
            kind: "class-only",
            requiredClasses: [ancestorDescendantMatch[1]],
          },
        },
        {
          combinatorFromPrevious: "descendant",
          selector: {
            kind: "class-only",
            requiredClasses: [ancestorDescendantMatch[2]],
          },
        },
      ],
    };
  }

  const parentChildMatch = normalized.match(/^\.([A-Za-z0-9_-]+)\s*>\s*\.([A-Za-z0-9_-]+)$/);
  if (parentChildMatch) {
    return {
      kind: "selector-chain",
      steps: [
        {
          combinatorFromPrevious: null,
          selector: {
            kind: "class-only",
            requiredClasses: [parentChildMatch[1]],
          },
        },
        {
          combinatorFromPrevious: "child",
          selector: {
            kind: "class-only",
            requiredClasses: [parentChildMatch[2]],
          },
        },
      ],
    };
  }

  const adjacentSiblingMatch = normalized.match(/^\.([A-Za-z0-9_-]+)\s*\+\s*\.([A-Za-z0-9_-]+)$/);
  if (adjacentSiblingMatch) {
    return {
      kind: "selector-chain",
      steps: [
        {
          combinatorFromPrevious: null,
          selector: {
            kind: "class-only",
            requiredClasses: [adjacentSiblingMatch[1]],
          },
        },
        {
          combinatorFromPrevious: "adjacent-sibling",
          selector: {
            kind: "class-only",
            requiredClasses: [adjacentSiblingMatch[2]],
          },
        },
      ],
    };
  }

  const generalSiblingMatch = normalized.match(/^\.([A-Za-z0-9_-]+)\s*~\s*\.([A-Za-z0-9_-]+)$/);
  if (generalSiblingMatch) {
    return {
      kind: "selector-chain",
      steps: [
        {
          combinatorFromPrevious: null,
          selector: {
            kind: "class-only",
            requiredClasses: [generalSiblingMatch[1]],
          },
        },
        {
          combinatorFromPrevious: "general-sibling",
          selector: {
            kind: "class-only",
            requiredClasses: [generalSiblingMatch[2]],
          },
        },
      ],
    };
  }

  const sameNodeClasses = normalized.match(/\.([A-Za-z0-9_-]+)/g);
  if (sameNodeClasses && sameNodeClasses.join("") === normalized && sameNodeClasses.length >= 2) {
    return {
      kind: "selector-chain",
      steps: [
        {
          combinatorFromPrevious: null,
          selector: {
            kind: "class-only",
            requiredClasses: [sameNodeClasses[0].slice(1)],
          },
        },
        ...sameNodeClasses.slice(1).map((entry) => ({
          combinatorFromPrevious: "same-node" as const,
          selector: {
            kind: "class-only" as const,
            requiredClasses: [entry.slice(1)],
          },
        })),
      ],
    };
  }

  return {
    kind: "unsupported",
    reason: UNSUPPORTED_SELECTOR_REASON,
  };
}

function mapNormalizedSelectorToConstraint(normalizedSelector: NormalizedSelector):
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

function buildParseNotes(normalizedSelector: NormalizedSelector): string[] {
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
