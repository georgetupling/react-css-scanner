import type { ProjectEvidenceAssemblyResult } from "../project-evidence/index.js";
import type { RenderCertainty, RenderedElement } from "../render-structure/index.js";
import type {
  SelectorBranchMatch,
  SelectorMatchCertainty,
} from "../selector-reachability/index.js";
import { cascadeConditionSetId } from "./ids.js";
import type { CascadeConditionSet, CascadeDeclarationCandidate } from "./types.js";

export function createConditionSetFromRenderedElement(input: {
  renderedElement: RenderedElement;
  runtimeContextIds?: string[];
  includeTraces: boolean;
}): CascadeConditionSet {
  return createConditionSetFromParts({
    atRuleContext: [],
    renderConditionIds: input.renderedElement.placementConditionIds,
    runtimeContextIds: input.runtimeContextIds,
    traces: input.includeTraces ? input.renderedElement.traces : [],
  });
}

export function createConditionSet(input: {
  declaration: ProjectEvidenceAssemblyResult["entities"]["cssDeclarations"][number];
  selectorText: string;
  match: SelectorBranchMatch;
  runtimeContextIds?: string[];
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
    runtimeContextIds: input.runtimeContextIds,
    traces: input.includeTraces ? input.match.traces : [],
  });
}

export function mapMatchCertainty(
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

export function mapRenderCertainty(
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

function createConditionSetFromParts(input: {
  atRuleContext: Array<{ name: string; params: string }>;
  renderConditionIds: string[];
  pseudoStates?: string[];
  runtimeContextIds?: string[];
  traces: CascadeConditionSet["traces"];
}): CascadeConditionSet {
  const atRuleContext = [...input.atRuleContext];
  const renderConditionIds = [...input.renderConditionIds].sort((left, right) =>
    left.localeCompare(right),
  );
  const pseudoStates = [...(input.pseudoStates ?? [])].sort((left, right) =>
    left.localeCompare(right),
  );
  const runtimeContextIds = [...(input.runtimeContextIds ?? [])].sort((left, right) =>
    left.localeCompare(right),
  );
  const sources = [
    ...(atRuleContext.length > 0 ? (["at-rule"] as const) : []),
    ...(pseudoStates.length > 0 ? (["selector-state"] as const) : []),
    ...(renderConditionIds.length > 0 ? (["render-condition"] as const) : []),
    ...(runtimeContextIds.length > 0 ? (["runtime-css-loading"] as const) : []),
  ];
  const compatibility: CascadeConditionSet["compatibility"] =
    atRuleContext.length > 0 ||
    pseudoStates.length > 0 ||
    renderConditionIds.length > 0 ||
    runtimeContextIds.length > 0
      ? "conditional"
      : "definite";
  const conditionSet: Omit<CascadeConditionSet, "id"> = {
    sources,
    atRuleContext,
    renderConditionIds,
    classEmissionConditionIds: [],
    pseudoStates,
    runtimeContextIds,
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
      ...(runtimeContextIds.length > 0
        ? ["runtime CSS loading context may affect stylesheet applicability and order"]
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
