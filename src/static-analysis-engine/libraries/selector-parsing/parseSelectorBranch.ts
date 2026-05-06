import { parseSimpleSelectorSequence } from "./parseSimpleSelectorSequence.js";
import type { ParsedSelectorBranch, ParsedSelectorStep, SelectorStepCombinator } from "./types.js";

export function parseSelectorBranch(branch: string): ParsedSelectorBranch | undefined {
  const normalizedBranch = branch.trim();
  if (!normalizedBranch) {
    return undefined;
  }

  const steps = parseSelectorSteps(normalizedBranch);
  if (steps.length === 0) {
    return undefined;
  }

  const subjectStepIndex = steps.length - 1;
  const subjectStep = steps[subjectStepIndex];
  const subjectClassNames = subjectStep.selector.requiredClasses;
  if (subjectClassNames.length === 0) {
    return undefined;
  }

  const contextClassNames = unique(
    steps
      .slice(0, -1)
      .flatMap((step) => [...step.selector.requiredClasses, ...step.selector.hasDescendantClasses])
      .concat(subjectStep.selector.hasDescendantClasses),
  );
  const negativeClassNames = unique(subjectStep.selector.negativeClasses);
  const hasDescendantClassNames = unique(subjectStep.selector.hasDescendantClasses);
  const hasUnknownSemantics = steps.some((step) => step.selector.hasUnknownSemantics);
  const hasCombinators = steps.length > 1;
  const hasSubjectModifiers =
    subjectStep.selector.hasSubjectModifiers || subjectStep.selector.hasTypeOrIdConstraint;

  let matchKind: ParsedSelectorBranch["matchKind"];
  if (hasUnknownSemantics || subjectStep.selector.hasTypeOrIdConstraint) {
    matchKind = "complex";
  } else if (hasCombinators) {
    matchKind = "contextual";
  } else if (subjectClassNames.length > 1) {
    matchKind = "compound";
  } else {
    matchKind = "standalone";
  }

  return {
    raw: normalizedBranch,
    steps,
    subjectStepIndex,
    subjectClassNames,
    requiredClassNames: subjectClassNames,
    contextClassNames,
    negativeClassNames,
    hasDescendantClassNames,
    hasCombinators,
    hasSubjectModifiers,
    hasUnknownSemantics,
    matchKind,
  };
}

function parseSelectorSteps(branch: string): ParsedSelectorStep[] {
  const steps: ParsedSelectorStep[] = [];
  let index = 0;
  let combinatorFromPrevious: SelectorStepCombinator = null;

  while (index < branch.length) {
    index = skipWhitespace(branch, index);
    if (index >= branch.length) {
      break;
    }

    const token = readTopLevelToken(branch, index);
    if (!token.value.trim()) {
      break;
    }

    steps.push({
      combinatorFromPrevious,
      selector: parseSimpleSelectorSequence(token.value.trim()),
    });

    index = token.nextIndex;
    const whitespaceResult = skipWhitespaceWithSignal(branch, index);
    index = whitespaceResult.nextIndex;
    if (index >= branch.length) {
      break;
    }

    const explicitCombinator = readExplicitCombinator(branch[index]);
    if (explicitCombinator) {
      combinatorFromPrevious = explicitCombinator;
      index += 1;
      index = skipWhitespace(branch, index);
      continue;
    }

    combinatorFromPrevious = whitespaceResult.sawWhitespace ? "descendant" : null;
  }

  return steps;
}

function readTopLevelToken(
  branch: string,
  startIndex: number,
): {
  value: string;
  nextIndex: number;
} {
  let index = startIndex;
  let bracketDepth = 0;
  let parenDepth = 0;
  let stringQuote: string | undefined;
  let escaped = false;

  while (index < branch.length) {
    const character = branch[index];

    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      index += 1;
      continue;
    }

    if (stringQuote) {
      if (character === stringQuote) {
        stringQuote = undefined;
      }
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      stringQuote = character;
      index += 1;
      continue;
    }

    if (character === "[") {
      bracketDepth += 1;
      index += 1;
      continue;
    }

    if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      index += 1;
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      index += 1;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      index += 1;
      continue;
    }

    if (bracketDepth === 0 && parenDepth === 0) {
      if (character === ">" || character === "+" || character === "~" || /\s/.test(character)) {
        break;
      }
    }

    index += 1;
  }

  return {
    value: branch.slice(startIndex, index),
    nextIndex: index,
  };
}

function skipWhitespace(value: string, startIndex: number): number {
  return skipWhitespaceWithSignal(value, startIndex).nextIndex;
}

function skipWhitespaceWithSignal(
  value: string,
  startIndex: number,
): { nextIndex: number; sawWhitespace: boolean } {
  let index = startIndex;
  let sawWhitespace = false;

  while (index < value.length && /\s/.test(value[index] ?? "")) {
    sawWhitespace = true;
    index += 1;
  }

  return { nextIndex: index, sawWhitespace };
}

function readExplicitCombinator(character: string | undefined): SelectorStepCombinator {
  if (character === ">") {
    return "child";
  }

  if (character === "+") {
    return "adjacent-sibling";
  }

  if (character === "~") {
    return "general-sibling";
  }

  return null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
