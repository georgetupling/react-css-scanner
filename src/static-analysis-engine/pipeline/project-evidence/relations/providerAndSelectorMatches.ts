import type {
  ClassReferenceAnalysis,
  ProjectEvidenceBuilderIndexes,
  ProviderBackedStylesheetRelation,
  ProjectEvidenceBuildInput,
  ProviderClassSatisfactionRelation,
  SelectorMatchRelation,
  SelectorQueryAnalysis,
} from "../analysisTypes.js";
import type { ExternalCssGlobalProviderConfig } from "../../../../config/index.js";
import { collectReferenceClassNames, compareById, mergeTraces } from "../internal/shared.js";

type ActiveExternalCssProvider = ExternalCssGlobalProviderConfig;

export function buildProviderClassSatisfactions(input: {
  references: ClassReferenceAnalysis[];
  input: ProjectEvidenceBuildInput;
  includeTraces: boolean;
}): ProviderClassSatisfactionRelation[] {
  const relations: ProviderClassSatisfactionRelation[] = [];
  const activeProviders = collectHtmlActivatedExternalCssProviders(input.input);

  for (const reference of input.references) {
    for (const className of collectReferenceClassNames(reference)) {
      for (const provider of activeProviders) {
        const satisfied =
          provider.classNames.includes(className) ||
          provider.classPrefixes.some((classPrefix) => className.startsWith(classPrefix));
        if (!satisfied) {
          continue;
        }

        relations.push({
          id: `provider-class:${reference.id}:${provider.provider}:${className}`,
          referenceId: reference.id,
          className,
          referenceClassKind: reference.definiteClassNames.includes(className)
            ? "definite"
            : "possible",
          provider: provider.provider,
          reasons: [`class "${className}" is declared by active external CSS provider`],
          traces: input.includeTraces ? [...reference.traces] : [],
        });
      }
    }
  }

  return relations.sort(compareById);
}

function collectHtmlActivatedExternalCssProviders(
  input: ProjectEvidenceBuildInput,
): ActiveExternalCssProvider[] {
  const snapshot = input.factGraph?.snapshot;
  if (!snapshot) {
    return [];
  }

  const stylesheetLinks = snapshot.edges.filter((edge) => edge.kind === "html-stylesheet");
  return snapshot.externalCss.globalProviders
    .filter((provider) =>
      stylesheetLinks.some((link) =>
        [link.href, link.resolvedFilePath]
          .filter((value): value is string => Boolean(value))
          .some((filePath) => providerMatchesPath(provider, filePath)),
      ),
    )
    .map((provider) => ({
      provider: provider.provider,
      match: [...provider.match],
      classPrefixes: [...provider.classPrefixes],
      classNames: [...provider.classNames],
      stylesheetRole: provider.stylesheetRole,
    }));
}

function providerMatchesPath(
  provider: Pick<ExternalCssGlobalProviderConfig, "match">,
  filePath: string,
): boolean {
  return provider.match.some((pattern) =>
    globToRegExp(pattern).test(normalizeProjectPath(filePath)),
  );
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeProjectPath(pattern);
  let source = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const nextCharacter = normalized[index + 1];
    const nextNextCharacter = normalized[index + 2];

    if (character === "*") {
      if (nextCharacter === "*") {
        if (nextNextCharacter === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (character === "?") {
      source += ".";
      continue;
    }

    source += /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
  }

  source += "$";
  return new RegExp(source);
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function buildSelectorMatches(
  selectorQueries: SelectorQueryAnalysis[],
  includeTraces: boolean,
): SelectorMatchRelation[] {
  return selectorQueries
    .filter((selectorQuery) => selectorQuery.scopedReachability !== undefined)
    .map((selectorQuery) => {
      const reachability = selectorQuery.scopedReachability;

      return {
        id: `selector-match:${selectorQuery.id}`,
        selectorQueryId: selectorQuery.id,
        stylesheetId: selectorQuery.stylesheetId,
        availability: reachability?.availability,
        selectorReachabilityStatus: selectorQuery.selectorReachabilityStatus,
        contextCount: reachability?.contextCount ?? 0,
        matchedContextCount: reachability?.matchedContextCount ?? 0,
        reasons: reachability?.reasons ?? selectorQuery.reasons,
        traces: includeTraces ? mergeTraces([...selectorQuery.traces]) : [],
      };
    })
    .sort(compareById);
}

export function buildProviderBackedStylesheets(input: {
  input: ProjectEvidenceBuildInput;
  indexes: ProjectEvidenceBuilderIndexes;
  includeTraces: boolean;
}): ProviderBackedStylesheetRelation[] {
  const snapshot = input.input.factGraph?.snapshot;
  if (!snapshot) {
    return [];
  }

  const providers = snapshot.externalCss.globalProviders;

  const relations: ProviderBackedStylesheetRelation[] = [];
  for (const stylesheet of snapshot.files.stylesheets) {
    const stylesheetId = input.indexes.stylesheetIdByPath.get(
      normalizeProjectPath(stylesheet.filePath),
    );
    if (!stylesheetId) {
      continue;
    }

    for (const provider of providers) {
      if (!providerMatchesPath(provider, stylesheet.filePath)) {
        continue;
      }

      relations.push({
        id: `provider-backed-stylesheet:${stylesheetId}:${provider.provider}`,
        stylesheetId,
        provider: provider.provider,
        ...providerRuntimePolicy(provider),
        reasons: [`stylesheet matched active provider "${provider.provider}"`],
        traces: [],
      });
    }
  }

  return relations.sort(compareById);
}

function providerRuntimePolicy(
  provider: Pick<ExternalCssGlobalProviderConfig, "stylesheetRole">,
): Pick<
  ProviderBackedStylesheetRelation,
  "runtimeDom" | "suppressUnused" | "suppressUnknownContextSelectors"
> {
  if (provider.stylesheetRole === "third-party-runtime") {
    return {
      runtimeDom: true,
      suppressUnused: true,
      suppressUnknownContextSelectors: true,
    };
  }

  return {
    runtimeDom: false,
    suppressUnused: true,
    suppressUnknownContextSelectors: false,
  };
}
