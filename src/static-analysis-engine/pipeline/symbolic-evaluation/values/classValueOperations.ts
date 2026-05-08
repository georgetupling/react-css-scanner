import type { SourceAnchor } from "../../../types/core.js";
import type { AbstractClassSet, AbstractValue } from "./types.js";

export function toAbstractClassSet(
  value: AbstractValue,
  sourceAnchor: SourceAnchor,
): AbstractClassSet {
  if (value.kind === "string-exact") {
    return {
      definite: tokenizeClassNames(value.value),
      possible: [],
      mutuallyExclusiveGroups: [],
      unknownDynamic: false,
      derivedFrom: [
        {
          sourceAnchor,
          description: "derived from exact string className expression",
        },
      ],
    };
  }

  if (value.kind === "string-set") {
    const allTokens = value.values.flatMap((entry) => tokenizeClassNames(entry));
    const tokenCounts = new Map<string, number>();
    for (const token of allTokens) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }

    const definite: string[] = [];
    const possible: string[] = [];
    for (const [token, count] of tokenCounts.entries()) {
      if (count === value.values.length) {
        definite.push(token);
      } else {
        possible.push(token);
      }
    }

    return {
      definite: definite.sort((left, right) => left.localeCompare(right)),
      possible: possible.sort((left, right) => left.localeCompare(right)),
      mutuallyExclusiveGroups: value.mutuallyExclusiveGroups ?? [],
      unknownDynamic: false,
      derivedFrom: [
        {
          sourceAnchor,
          description: "derived from bounded string-set className expression",
        },
      ],
    };
  }

  if (value.kind === "class-set") {
    return {
      definite: [...value.definite].sort((left, right) => left.localeCompare(right)),
      possible: [...value.possible].sort((left, right) => left.localeCompare(right)),
      mutuallyExclusiveGroups: value.mutuallyExclusiveGroups ?? [],
      unknownDynamic: value.unknownDynamic,
      derivedFrom: [
        {
          sourceAnchor,
          description: value.reason
            ? `derived from bounded class-set expression: ${value.reason}`
            : "derived from bounded class-set expression",
        },
      ],
    };
  }

  return {
    definite: [],
    possible: [],
    mutuallyExclusiveGroups: [],
    unknownDynamic: true,
    derivedFrom: [
      {
        sourceAnchor,
        description: `className expression degraded to unknown: ${value.reason}`,
      },
    ],
  };
}

export function mergeClassNameValues(values: AbstractValue[], reason: string): AbstractValue {
  return mergeClassSets(values, reason);
}

export function tokenizeClassNames(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function combineStrings(left: string[], right: string[]): string[] {
  return left.flatMap((leftValue) => right.map((rightValue) => `${leftValue}${rightValue}`));
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function mergeClassSets(values: AbstractValue[], reason: string): AbstractValue {
  const definite = new Set<string>();
  const possible = new Set<string>();
  let unknownDynamic = false;

  for (const value of values) {
    const classSet = toClassSet(value);
    for (const className of classSet.definite) {
      definite.add(className);
    }
    for (const className of classSet.possible) {
      possible.add(className);
    }
    unknownDynamic ||= classSet.unknownDynamic;
  }

  for (const className of definite) {
    possible.delete(className);
  }

  return {
    kind: "class-set",
    definite: [...definite].sort((left, right) => left.localeCompare(right)),
    possible: [...possible].sort((left, right) => left.localeCompare(right)),
    mutuallyExclusiveGroups: values.flatMap((value) =>
      value.kind === "string-set" || value.kind === "class-set"
        ? (value.mutuallyExclusiveGroups ?? [])
        : [],
    ),
    unknownDynamic,
    reason,
  };
}

export function toClassSet(value: AbstractValue): {
  definite: string[];
  possible: string[];
  mutuallyExclusiveGroups: string[][];
  unknownDynamic: boolean;
} {
  if (value.kind === "string-exact") {
    return {
      definite: tokenizeClassNames(value.value),
      possible: [],
      mutuallyExclusiveGroups: [],
      unknownDynamic: false,
    };
  }

  if (value.kind === "string-set") {
    const allTokens = value.values.flatMap((entry) => tokenizeClassNames(entry));
    const tokenCounts = new Map<string, number>();
    for (const token of allTokens) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }

    const definite: string[] = [];
    const possible: string[] = [];
    for (const [token, count] of tokenCounts.entries()) {
      if (count === value.values.length) {
        definite.push(token);
      } else {
        possible.push(token);
      }
    }

    return {
      definite,
      possible,
      mutuallyExclusiveGroups: value.mutuallyExclusiveGroups ?? [],
      unknownDynamic: false,
    };
  }

  if (value.kind === "class-set") {
    return {
      definite: value.definite,
      possible: value.possible,
      mutuallyExclusiveGroups: value.mutuallyExclusiveGroups ?? [],
      unknownDynamic: value.unknownDynamic,
    };
  }

  return {
    definite: [],
    possible: [],
    mutuallyExclusiveGroups: [],
    unknownDynamic: true,
  };
}

export function getStringCandidates(value: AbstractValue): string[] | undefined {
  if (value.kind === "string-exact") {
    return [value.value];
  }

  if (value.kind === "string-set") {
    return value.values;
  }

  return undefined;
}

export function collectStringCandidates(...values: AbstractValue[]): string[] | undefined {
  const candidates = new Set<string>();

  for (const value of values) {
    const valueCandidates = getStringCandidates(value);
    if (!valueCandidates) {
      return undefined;
    }

    for (const candidate of valueCandidates) {
      candidates.add(candidate);
    }
  }

  return [...candidates].sort((left, right) => left.localeCompare(right));
}

export function toStringValue(candidates: string[]): AbstractValue {
  const uniqueCandidates = uniqueSorted(candidates);
  if (uniqueCandidates.length === 1) {
    return {
      kind: "string-exact",
      value: uniqueCandidates[0],
    };
  }

  return {
    kind: "string-set",
    values: uniqueCandidates,
  };
}
