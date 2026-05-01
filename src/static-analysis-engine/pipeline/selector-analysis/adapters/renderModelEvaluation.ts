import type { RenderedElement } from "../../render-structure/types.js";
import type { SelectorAnalysisTarget, SelectorRenderModelIndex } from "../types.js";
import type { PresenceEvaluation } from "../selectorEvaluationUtils.js";

export type StructuralEvaluation = "match" | "possible-match" | "unsupported" | "no-match";

export function getScopedElements(
  target: SelectorAnalysisTarget,
  renderModelIndex: SelectorRenderModelIndex,
): RenderedElement[] {
  return target.elementIds
    .map((elementId) => renderModelIndex.renderModel.indexes.elementById.get(elementId))
    .filter((element): element is RenderedElement => Boolean(element));
}

export function evaluateElementClassRequirement(input: {
  renderModelIndex: SelectorRenderModelIndex;
  elementId: string;
  classNames: string[];
}): StructuralEvaluation {
  const emissionSiteIds =
    input.renderModelIndex.renderModel.indexes.emissionSiteIdsByElementId.get(input.elementId) ??
    [];
  if (emissionSiteIds.length === 0) {
    return "no-match";
  }

  const element = input.renderModelIndex.renderModel.indexes.elementById.get(input.elementId);
  let sawPossible = false;
  let sawUnsupported = false;

  for (const siteId of emissionSiteIds) {
    const site = input.renderModelIndex.renderModel.indexes.emissionSiteById.get(siteId);
    if (!site) {
      continue;
    }

    if (
      site.emissionVariants.some(
        (variant) =>
          includesAll(variant.tokens, input.classNames) &&
          variant.completeness === "complete" &&
          !variant.unknownDynamic,
      )
    ) {
      if (element && isDefiniteElementEmission(input.renderModelIndex, element, siteId)) {
        return "match";
      }
      sawPossible = true;
      continue;
    }

    if (site.emissionVariants.some((variant) => includesAll(variant.tokens, input.classNames))) {
      sawPossible = true;
      continue;
    }

    const allPresent = input.classNames.every((className) =>
      site.tokens.some(
        (token) => token.token === className && token.tokenKind !== "css-module-export",
      ),
    );
    if (allPresent && requiredClassesCanCoexist(site.tokens, input.classNames)) {
      sawPossible = true;
      continue;
    }

    if (site.confidence === "low" || site.unsupported.length > 0) {
      sawUnsupported = true;
    }
  }

  if (sawPossible) {
    return "possible-match";
  }
  if (sawUnsupported) {
    return "unsupported";
  }
  return "no-match";
}

export function evaluateElementPresence(
  renderModelIndex: SelectorRenderModelIndex,
  elementId: string,
  className: string,
): PresenceEvaluation {
  const emissionSiteIds =
    renderModelIndex.renderModel.indexes.emissionSiteIdsByElementId.get(elementId) ?? [];
  if (emissionSiteIds.length === 0) {
    return "no-match";
  }

  const element = renderModelIndex.renderModel.indexes.elementById.get(elementId);
  let sawPossible = false;
  let sawUnsupported = false;

  for (const siteId of emissionSiteIds) {
    const site = renderModelIndex.renderModel.indexes.emissionSiteById.get(siteId);
    if (!site) {
      continue;
    }

    if (
      site.emissionVariants.some(
        (variant) =>
          variant.tokens.includes(className) &&
          variant.completeness === "complete" &&
          !variant.unknownDynamic,
      )
    ) {
      if (element && isDefiniteElementEmission(renderModelIndex, element, siteId)) {
        return "definite";
      }
      sawPossible = true;
      continue;
    }

    if (site.emissionVariants.some((variant) => variant.tokens.includes(className))) {
      sawPossible = true;
      continue;
    }

    if (
      site.tokens.some(
        (token) => token.token === className && token.tokenKind !== "css-module-export",
      )
    ) {
      sawPossible = true;
      continue;
    }

    if (site.unsupported.length > 0 || site.confidence === "low") {
      sawUnsupported = true;
    }
  }

  if (sawPossible) {
    return "possible";
  }
  if (sawUnsupported) {
    return "unsupported";
  }
  return "no-match";
}

export function mergeStructuralEvaluations(
  evaluations: StructuralEvaluation[],
): StructuralEvaluation {
  if (evaluations.includes("match")) {
    return "match";
  }
  if (evaluations.includes("possible-match")) {
    return "possible-match";
  }
  if (evaluations.includes("unsupported")) {
    return "unsupported";
  }
  return "no-match";
}

function isDefiniteElementEmission(
  renderModelIndex: SelectorRenderModelIndex,
  element: RenderedElement,
  emissionSiteId: string,
): boolean {
  if (element.certainty !== "definite" || element.placementConditionIds.length > 0) {
    return false;
  }

  const site = renderModelIndex.renderModel.indexes.emissionSiteById.get(emissionSiteId);
  if (!site || site.placementConditionIds.length > 0) {
    return false;
  }

  const renderPath = renderModelIndex.renderModel.indexes.renderPathById.get(element.renderPathId);
  return !renderPath || renderPath.certainty === "definite";
}

function includesAll(tokens: string[], requiredClassNames: string[]): boolean {
  return requiredClassNames.every((className) => tokens.includes(className));
}

function requiredClassesCanCoexist(
  tokens: Array<{ token: string; exclusiveGroupId?: string }>,
  requiredClassNames: string[],
): boolean {
  const required = new Set(requiredClassNames);
  const requiredTokensByGroup = new Map<string, Set<string>>();
  for (const token of tokens) {
    if (!token.exclusiveGroupId || !required.has(token.token)) {
      continue;
    }

    const groupTokens = requiredTokensByGroup.get(token.exclusiveGroupId) ?? new Set<string>();
    groupTokens.add(token.token);
    requiredTokensByGroup.set(token.exclusiveGroupId, groupTokens);
  }

  return [...requiredTokensByGroup.values()].every((groupTokens) => groupTokens.size <= 1);
}
