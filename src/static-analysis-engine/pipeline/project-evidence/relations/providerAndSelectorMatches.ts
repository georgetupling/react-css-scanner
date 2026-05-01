import type {
  ClassReferenceAnalysis,
  ProjectEvidenceBuilderIndexes,
  ProviderBackedStylesheetRelation,
  ProjectEvidenceBuildInput,
  ProviderClassSatisfactionRelation,
  SelectorMatchRelation,
  SelectorQueryAnalysis,
} from "../analysisTypes.js";
import { collectReferenceClassNames, compareById, mergeTraces } from "../internal/shared.js";

export function buildProviderClassSatisfactions(input: {
  references: ClassReferenceAnalysis[];
  input: ProjectEvidenceBuildInput;
  includeTraces: boolean;
}): ProviderClassSatisfactionRelation[] {
  const relations: ProviderClassSatisfactionRelation[] = [];
  const activeProviders = collectActiveExternalCssProviders(input.input);

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

function collectActiveExternalCssProviders(input: ProjectEvidenceBuildInput): Array<{
  provider: string;
  match: string[];
  classPrefixes: string[];
  classNames: string[];
}> {
  const snapshot = input.factGraph?.snapshot;
  if (!snapshot) {
    return [];
  }

  const stylesheetLinks = snapshot.edges.filter((edge) => edge.kind === "html-stylesheet");
  return snapshot.externalCss.globalProviders
    .filter((provider) =>
      stylesheetLinks.some((link) =>
        provider.match.some(
          (pattern) =>
            globToRegExp(pattern).test(normalizeProjectPath(link.href)) ||
            (link.resolvedFilePath
              ? globToRegExp(pattern).test(normalizeProjectPath(link.resolvedFilePath))
              : false),
        ),
      ),
    )
    .map((provider) => ({
      provider: provider.provider,
      match: [...provider.match],
      classPrefixes: [...provider.classPrefixes],
      classNames: [...provider.classNames],
    }));
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

  const activeProviders = collectActiveExternalCssProviders(input.input);
  if (activeProviders.length === 0) {
    return [];
  }

  const relations: ProviderBackedStylesheetRelation[] = [];
  const stylesheetLinks = snapshot.edges.filter((edge) => edge.kind === "html-stylesheet");
  for (const link of stylesheetLinks) {
    if (!link.resolvedFilePath) {
      continue;
    }

    const stylesheetId = input.indexes.stylesheetIdByPath.get(
      normalizeProjectPath(link.resolvedFilePath),
    );
    if (!stylesheetId) {
      continue;
    }

    for (const provider of activeProviders) {
      const matchesProvider = provider.match.some(
        (pattern) =>
          globToRegExp(pattern).test(normalizeProjectPath(link.href)) ||
          globToRegExp(pattern).test(normalizeProjectPath(link.resolvedFilePath)),
      );
      if (!matchesProvider) {
        continue;
      }

      relations.push({
        id: `provider-backed-stylesheet:${stylesheetId}:${provider.provider}`,
        stylesheetId,
        provider: provider.provider,
        reasons: [`stylesheet matched active provider "${provider.provider}"`],
        traces: [],
      });
    }
  }

  return relations.sort(compareById);
}
