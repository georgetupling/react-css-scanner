import type { EmissionSite, RenderedElement } from "../render-structure/index.js";
import type { SelectorMatchCertainty } from "./types.js";
import { createScopeClassKey } from "./renderMatchIndexes.js";
import type { SelectorRenderMatchIndexes } from "./renderMatchIndexes.js";

export type ElementRequirementMatch = {
  certainty: SelectorMatchCertainty;
  supportingEmissionSiteIds: string[];
  matchedClassNames: string[];
};

export function matchElementClassRequirement(input: {
  indexes: SelectorRenderMatchIndexes;
  elementId: string;
  classNames: string[];
  cssModuleStylesheetNodeId?: string;
}): ElementRequirementMatch {
  const emissionSiteIds = input.indexes.emissionSiteIdsByElementId.get(input.elementId) ?? [];
  const element = input.indexes.elementsById.get(input.elementId);
  if (!element || emissionSiteIds.length === 0) {
    return noMatch(input.classNames);
  }

  let sawPossible = false;
  let sawUnsupported = false;
  const supportingEmissionSiteIds: string[] = [];
  const isSingleClass = input.classNames.length === 1;
  const requiredClass = isSingleClass ? input.classNames[0] : undefined;

  for (const siteId of emissionSiteIds) {
    const site = input.indexes.emissionSitesById.get(siteId);
    if (!site) {
      continue;
    }

    if (input.cssModuleStylesheetNodeId) {
      const cssModuleMatch = matchCssModuleElementClassRequirement({
        indexes: input.indexes,
        element,
        site,
        classNames: input.classNames,
        cssModuleStylesheetNodeId: input.cssModuleStylesheetNodeId,
      });
      if (cssModuleMatch.certainty === "definite") {
        return {
          certainty: "definite",
          supportingEmissionSiteIds: uniqueSorted([...supportingEmissionSiteIds, siteId]),
          matchedClassNames: uniqueSorted(input.classNames),
        };
      }
      if (cssModuleMatch.certainty === "possible") {
        sawPossible = true;
        supportingEmissionSiteIds.push(siteId);
        continue;
      }
      if (cssModuleMatch.certainty === "unknown-context") {
        sawUnsupported = true;
      }
      continue;
    }

    const completeVariant = site.emissionVariants.find(
      (variant) =>
        includesAll(variant.tokens, input.classNames, requiredClass) &&
        hasGlobalTokensForClasses(site.tokens, input.classNames) &&
        variant.completeness === "complete" &&
        !variant.unknownDynamic,
    );
    if (completeVariant) {
      supportingEmissionSiteIds.push(siteId);
      if (isDefiniteElementEmission(input.indexes, element, site, input.classNames)) {
        return {
          certainty: "definite",
          supportingEmissionSiteIds: uniqueSorted(supportingEmissionSiteIds),
          matchedClassNames: uniqueSorted(input.classNames),
        };
      }
      sawPossible = true;
      continue;
    }

    if (
      site.emissionVariants.some(
        (variant) =>
          includesAll(variant.tokens, input.classNames, requiredClass) &&
          hasGlobalTokensForClasses(site.tokens, input.classNames),
      )
    ) {
      sawPossible = true;
      supportingEmissionSiteIds.push(siteId);
      continue;
    }

    const allPresent = input.classNames.every((className) =>
      site.tokens.some(
        (token) => token.token === className && token.tokenKind !== "css-module-export",
      ),
    );
    if (allPresent && requiredClassesCanCoexist(site.tokens, input.classNames)) {
      sawPossible = true;
      supportingEmissionSiteIds.push(siteId);
      continue;
    }

    if (site.confidence === "low" || site.unsupported.length > 0) {
      sawUnsupported = true;
    }
  }

  if (sawPossible) {
    return {
      certainty: "possible",
      supportingEmissionSiteIds: uniqueSorted(supportingEmissionSiteIds),
      matchedClassNames: uniqueSorted(input.classNames),
    };
  }

  if (sawUnsupported) {
    return {
      certainty: "unknown-context",
      supportingEmissionSiteIds: uniqueSorted(supportingEmissionSiteIds),
      matchedClassNames: [],
    };
  }

  if (input.indexes.unknownClassElementIds.includes(input.elementId)) {
    return {
      certainty: "unknown-context",
      supportingEmissionSiteIds: uniqueSorted(supportingEmissionSiteIds),
      matchedClassNames: [],
    };
  }

  return noMatch(input.classNames);
}

function matchCssModuleElementClassRequirement(input: {
  indexes: SelectorRenderMatchIndexes;
  element: RenderedElement;
  site: EmissionSite;
  classNames: string[];
  cssModuleStylesheetNodeId: string;
}): ElementRequirementMatch {
  const matchedContributions = input.site.cssModuleContributions.filter(
    (contribution) => contribution.stylesheetNodeId === input.cssModuleStylesheetNodeId,
  );
  const indexedClassNames =
    input.indexes.cssModuleClassNamesByEmissionSiteAndScope.get(
      createScopeClassKey(input.site.id, input.cssModuleStylesheetNodeId),
    ) ?? [];
  if (matchedContributions.length === 0 && indexedClassNames.length === 0) {
    return noMatch(input.classNames);
  }

  const tokensByContributionId = new Map(
    input.site.tokens
      .filter((token) => token.tokenKind === "css-module-export" && token.contributionId)
      .map((token) => [token.contributionId as string, token]),
  );
  const matchedClassNames = new Set(
    indexedClassNames.filter((className) => input.classNames.includes(className)),
  );
  let sawPossible = false;

  for (const contribution of matchedContributions) {
    const token = tokensByContributionId.get(contribution.id);
    const localClassNames =
      input.indexes.cssModuleLocalClassNamesByScopeAndExportName.get(
        createScopeClassKey(input.cssModuleStylesheetNodeId, contribution.exportName),
      ) ?? [];

    for (const className of localClassNames) {
      if (!input.classNames.includes(className)) {
        continue;
      }
      matchedClassNames.add(className);
      if (!token || token.presence !== "always") {
        sawPossible = true;
      }
    }
  }

  if (!input.classNames.every((className) => matchedClassNames.has(className))) {
    if (input.site.confidence === "low" || input.site.unsupported.length > 0) {
      return {
        certainty: "unknown-context",
        supportingEmissionSiteIds: [],
        matchedClassNames: [],
      };
    }
    return noMatch(input.classNames);
  }

  if (sawPossible) {
    return {
      certainty: "possible",
      supportingEmissionSiteIds: [input.site.id],
      matchedClassNames: uniqueSorted(input.classNames),
    };
  }

  if (isDefiniteCssModuleElementEmission(input.indexes, input.element, input.site)) {
    return {
      certainty: "definite",
      supportingEmissionSiteIds: [input.site.id],
      matchedClassNames: uniqueSorted(input.classNames),
    };
  }

  return {
    certainty: "possible",
    supportingEmissionSiteIds: [input.site.id],
    matchedClassNames: uniqueSorted(input.classNames),
  };
}

function isDefiniteCssModuleElementEmission(
  indexes: SelectorRenderMatchIndexes,
  element: RenderedElement,
  emissionSite: EmissionSite,
): boolean {
  if (element.certainty !== "definite" || element.placementConditionIds.length > 0) {
    return false;
  }

  if (emissionSite.placementConditionIds.length > 0) {
    return false;
  }

  const renderPath = indexes.renderModel.indexes.renderPathById.get(element.renderPathId);
  return !renderPath || renderPath.certainty === "definite";
}

function hasGlobalTokensForClasses(
  tokens: Array<{ token: string; tokenKind: string }>,
  requiredClassNames: string[],
): boolean {
  return requiredClassNames.every((className) =>
    tokens.some((token) => token.token === className && token.tokenKind !== "css-module-export"),
  );
}

function isDefiniteElementEmission(
  indexes: SelectorRenderMatchIndexes,
  element: RenderedElement,
  emissionSite: EmissionSite,
  classNames: string[],
): boolean {
  if (element.certainty !== "definite" || element.placementConditionIds.length > 0) {
    return false;
  }

  if (emissionSite.placementConditionIds.length > 0) {
    return false;
  }

  if (
    !classNames.every((className) =>
      emissionSite.tokens.some(
        (token) =>
          token.token === className &&
          token.tokenKind !== "css-module-export" &&
          token.presence === "always",
      ),
    )
  ) {
    return false;
  }

  const renderPath = indexes.renderModel.indexes.renderPathById.get(element.renderPathId);
  return !renderPath || renderPath.certainty === "definite";
}

function noMatch(classNames: string[]): ElementRequirementMatch {
  return {
    certainty: "impossible",
    supportingEmissionSiteIds: [],
    matchedClassNames: classNames.length === 0 ? [] : [],
  };
}

function includesAll(
  tokens: string[],
  requiredClassNames: string[],
  requiredClass?: string,
): boolean {
  if (requiredClass !== undefined) {
    return tokens.includes(requiredClass);
  }
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
