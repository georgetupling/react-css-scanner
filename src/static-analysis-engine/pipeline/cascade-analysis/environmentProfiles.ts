import {
  getContainerQueryConstraints,
  getMediaQueryListEnvironmentConstraints,
  getSupportsConditionConstraints,
  type ContainerQueryConstraints,
  type MediaEnvironmentConstraints,
  type MediaWidthRange,
  type SupportsConditionConstraints,
} from "./atRuleConditions.js";
import type { CascadeConditionSet } from "./types.js";

export type BrowserEnvironmentProfile = {
  id: string;
  name: string;
  viewportWidthPx?: number;
  orientation?: "landscape" | "portrait";
  colorScheme?: "dark" | "light";
  supportedDeclarations?: "modern-css";
  containerQueries?: Array<{
    containerName?: string;
    widthPx?: number;
  }>;
};

export type EnvironmentConditionProfileResult = {
  satisfiable: boolean;
  profileIds: string[];
};

const DEFAULT_BROWSER_ENVIRONMENT_PROFILES: BrowserEnvironmentProfile[] = [
  {
    id: "browser:modern",
    name: "Modern browser",
    supportedDeclarations: "modern-css",
  },
  {
    id: "mobile-light",
    name: "Mobile light",
    viewportWidthPx: 390,
    orientation: "portrait",
    colorScheme: "light",
    supportedDeclarations: "modern-css",
  },
  {
    id: "mobile-dark",
    name: "Mobile dark",
    viewportWidthPx: 390,
    orientation: "portrait",
    colorScheme: "dark",
    supportedDeclarations: "modern-css",
  },
  {
    id: "desktop-light",
    name: "Desktop light",
    viewportWidthPx: 1280,
    orientation: "landscape",
    colorScheme: "light",
    supportedDeclarations: "modern-css",
  },
  {
    id: "desktop-dark",
    name: "Desktop dark",
    viewportWidthPx: 1280,
    orientation: "landscape",
    colorScheme: "dark",
    supportedDeclarations: "modern-css",
  },
  {
    id: "container-card-mobile",
    name: "Card container mobile",
    supportedDeclarations: "modern-css",
    containerQueries: [{ containerName: "card", widthPx: 360 }],
  },
  {
    id: "container-card-desktop",
    name: "Card container desktop",
    supportedDeclarations: "modern-css",
    containerQueries: [{ containerName: "card", widthPx: 960 }],
  },
];

export function getDefaultBrowserEnvironmentProfiles(): BrowserEnvironmentProfile[] {
  return DEFAULT_BROWSER_ENVIRONMENT_PROFILES;
}

export function evaluateEnvironmentProfilesForAtRuleContext(
  atRuleContext: CascadeConditionSet["atRuleContext"],
  profiles: BrowserEnvironmentProfile[] = DEFAULT_BROWSER_ENVIRONMENT_PROFILES,
): EnvironmentConditionProfileResult {
  const constraints = collectEnvironmentConstraints(atRuleContext);
  if (!constraints.satisfiable) {
    return {
      satisfiable: false,
      profileIds: [],
    };
  }

  const matchingProfileIds = profiles
    .filter((profile) => profileCanSatisfyConstraints(profile, constraints))
    .map((profile) => profile.id)
    .sort((left, right) => left.localeCompare(right));

  return {
    satisfiable: true,
    profileIds: matchingProfileIds,
  };
}

export function areAtRuleEnvironmentConditionsSatisfiable(
  atRuleContext: CascadeConditionSet["atRuleContext"],
): boolean {
  return evaluateEnvironmentProfilesForAtRuleContext(atRuleContext).satisfiable;
}

function collectEnvironmentConstraints(atRuleContext: CascadeConditionSet["atRuleContext"]): {
  satisfiable: boolean;
  media: MediaEnvironmentConstraints;
  supports: SupportsConditionConstraints;
  containersByKey: Map<string, ContainerQueryConstraints>;
} {
  let media: MediaEnvironmentConstraints = {};
  const supports: SupportsConditionConstraints = { required: [], rejected: [] };
  const containersByKey = new Map<string, ContainerQueryConstraints>();

  for (const entry of atRuleContext) {
    if (entry.name === "media") {
      const nextMedia = getMediaQueryListEnvironmentConstraints(entry.params);
      if (!nextMedia) {
        continue;
      }
      const mergedMedia = mergeMediaEnvironmentConstraints(media, nextMedia);
      if (!mergedMedia) {
        return { satisfiable: false, media: {}, supports, containersByKey };
      }
      media = mergedMedia;
      continue;
    }

    if (entry.name === "supports") {
      const nextSupports = getSupportsConditionConstraints(entry.params);
      if (!nextSupports) {
        continue;
      }
      supports.required.push(...nextSupports.required);
      supports.rejected.push(...nextSupports.rejected);
      continue;
    }

    if (entry.name === "container") {
      const nextContainer = getContainerQueryConstraints(entry.params);
      if (!nextContainer) {
        continue;
      }
      const containerKey = nextContainer.containerName ?? "__nearest-query-container__";
      const existingContainer = containersByKey.get(containerKey) ?? {};
      const mergedContainer = mergeContainerQueryConstraints(existingContainer, nextContainer);
      if (!mergedContainer) {
        return { satisfiable: false, media: {}, supports, containersByKey };
      }
      containersByKey.set(containerKey, mergedContainer);
    }
  }

  const rejectedSupports = new Set(supports.rejected);
  const supportsSatisfiable = supports.required.every(
    (required) => !rejectedSupports.has(required),
  );
  return {
    satisfiable: supportsSatisfiable,
    media,
    supports: {
      required: uniqueSorted(supports.required),
      rejected: uniqueSorted(supports.rejected),
    },
    containersByKey,
  };
}

function profileCanSatisfyConstraints(
  profile: BrowserEnvironmentProfile,
  constraints: ReturnType<typeof collectEnvironmentConstraints>,
): boolean {
  return (
    profileCanSatisfyMedia(profile, constraints.media) &&
    profileCanSatisfySupports(profile, constraints.supports) &&
    profileCanSatisfyContainers(profile, constraints.containersByKey)
  );
}

function profileCanSatisfyMedia(
  profile: BrowserEnvironmentProfile,
  constraints: MediaEnvironmentConstraints,
): boolean {
  if (
    constraints.width &&
    (profile.viewportWidthPx === undefined ||
      !widthRangeContainsValue(constraints.width, profile.viewportWidthPx))
  ) {
    return false;
  }
  if (
    constraints.prefersColorScheme &&
    (!profile.colorScheme || constraints.prefersColorScheme !== profile.colorScheme)
  ) {
    return false;
  }
  if (
    constraints.orientation &&
    (!profile.orientation || constraints.orientation !== profile.orientation)
  ) {
    return false;
  }
  return true;
}

function profileCanSatisfySupports(
  profile: BrowserEnvironmentProfile,
  constraints: SupportsConditionConstraints,
): boolean {
  if (constraints.required.length === 0 && constraints.rejected.length === 0) {
    return true;
  }
  if (profile.supportedDeclarations !== "modern-css") {
    return false;
  }
  return constraints.rejected.length === 0;
}

function profileCanSatisfyContainers(
  profile: BrowserEnvironmentProfile,
  constraintsByKey: Map<string, ContainerQueryConstraints>,
): boolean {
  for (const [containerKey, constraints] of constraintsByKey) {
    const profileContainer = profile.containerQueries?.find(
      (container) => (container.containerName ?? "__nearest-query-container__") === containerKey,
    );
    if (
      constraints.width &&
      profileContainer?.widthPx !== undefined &&
      !widthRangeContainsValue(constraints.width, profileContainer.widthPx)
    ) {
      return false;
    }
  }
  return true;
}

function mergeMediaEnvironmentConstraints(
  left: MediaEnvironmentConstraints,
  right: MediaEnvironmentConstraints,
): MediaEnvironmentConstraints | undefined {
  const width = mergeWidthRanges(left.width, right.width);
  if (width === false) {
    return undefined;
  }
  const prefersColorScheme = mergeExclusiveValue(left.prefersColorScheme, right.prefersColorScheme);
  if (prefersColorScheme === false) {
    return undefined;
  }
  const orientation = mergeExclusiveValue(left.orientation, right.orientation);
  if (orientation === false) {
    return undefined;
  }
  return {
    ...(width ? { width } : {}),
    ...(prefersColorScheme ? { prefersColorScheme } : {}),
    ...(orientation ? { orientation } : {}),
  };
}

function mergeContainerQueryConstraints(
  left: ContainerQueryConstraints,
  right: ContainerQueryConstraints,
): ContainerQueryConstraints | undefined {
  const width = mergeWidthRanges(left.width, right.width);
  if (width === false) {
    return undefined;
  }
  return {
    ...(left.containerName || right.containerName
      ? { containerName: left.containerName ?? right.containerName }
      : {}),
    ...(width ? { width } : {}),
  };
}

function mergeWidthRanges(
  left: MediaWidthRange | undefined,
  right: MediaWidthRange | undefined,
): MediaWidthRange | false | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  const merged: MediaWidthRange = {};
  applyMinWidth(merged, left.minWidthPx, left.minWidthInclusive);
  applyMinWidth(merged, right.minWidthPx, right.minWidthInclusive);
  applyMaxWidth(merged, left.maxWidthPx, left.maxWidthInclusive);
  applyMaxWidth(merged, right.maxWidthPx, right.maxWidthInclusive);
  return isWidthRangeSatisfiable(merged) ? merged : false;
}

function applyMinWidth(
  range: MediaWidthRange,
  valuePx: number | undefined,
  inclusive: boolean | undefined,
): void {
  if (valuePx === undefined) {
    return;
  }
  const isInclusive = inclusive ?? true;
  if (
    range.minWidthPx === undefined ||
    valuePx > range.minWidthPx ||
    (valuePx === range.minWidthPx && range.minWidthInclusive === true && !isInclusive)
  ) {
    range.minWidthPx = valuePx;
    range.minWidthInclusive = isInclusive;
  }
}

function applyMaxWidth(
  range: MediaWidthRange,
  valuePx: number | undefined,
  inclusive: boolean | undefined,
): void {
  if (valuePx === undefined) {
    return;
  }
  const isInclusive = inclusive ?? true;
  if (
    range.maxWidthPx === undefined ||
    valuePx < range.maxWidthPx ||
    (valuePx === range.maxWidthPx && range.maxWidthInclusive === true && !isInclusive)
  ) {
    range.maxWidthPx = valuePx;
    range.maxWidthInclusive = isInclusive;
  }
}

function mergeExclusiveValue<T extends string>(
  left: T | undefined,
  right: T | undefined,
): T | false | undefined {
  if (!left) {
    return right;
  }
  if (!right || left === right) {
    return left;
  }
  return false;
}

function isWidthRangeSatisfiable(range: MediaWidthRange): boolean {
  if (range.minWidthPx === undefined || range.maxWidthPx === undefined) {
    return true;
  }
  if (range.minWidthPx < range.maxWidthPx) {
    return true;
  }
  if (range.minWidthPx > range.maxWidthPx) {
    return false;
  }
  return range.minWidthInclusive === true && range.maxWidthInclusive === true;
}

function widthRangeContainsValue(range: MediaWidthRange, valuePx: number): boolean {
  if (range.minWidthPx !== undefined) {
    if (valuePx < range.minWidthPx) {
      return false;
    }
    if (valuePx === range.minWidthPx && range.minWidthInclusive === false) {
      return false;
    }
  }
  if (range.maxWidthPx !== undefined) {
    if (valuePx > range.maxWidthPx) {
      return false;
    }
    if (valuePx === range.maxWidthPx && range.maxWidthInclusive === false) {
      return false;
    }
  }
  return true;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
