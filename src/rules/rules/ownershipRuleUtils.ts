import { getClassOwnershipEvidence as queryClassOwnershipEvidence } from "../analysisQueries.js";
import type { RuleContext } from "../types.js";

const BROAD_STYLESHEET_SEGMENTS = new Set([
  "common",
  "design-system",
  "designsystem",
  "global",
  "globals",
  "layout",
  "layouts",
  "shared",
  "theme",
  "themes",
  "tokens",
  "utilities",
  "utility",
]);

const PRIVATE_OWNER_REASONS = new Set([
  "sibling-basename-convention",
  "component-folder-convention",
]);

export type RuleClassOwnershipEvidence = ReturnType<typeof queryClassOwnershipEvidence>[number];

type OwnerCandidateLike = {
  kind?: string;
  ownerKind?: string;
  confidence: string;
  reasons: string[];
  id?: string;
  ownerId?: string;
};

export function getClassOwnershipEvidence(context: RuleContext): RuleClassOwnershipEvidence[] {
  return queryClassOwnershipEvidence(context.analysisEvidence);
}

export function isIntentionallyBroadStylesheetPath(filePath: string | undefined): boolean {
  if (!filePath) {
    return false;
  }

  const normalized = filePath.split("\\").join("/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const baseName = segments.at(-1)?.replace(/\.[^.]+$/, "");

  return (
    segments.some((segment) => BROAD_STYLESHEET_SEGMENTS.has(segment)) ||
    Boolean(baseName && BROAD_STYLESHEET_SEGMENTS.has(baseName))
  );
}

export function isConfiguredSharedStylesheetPath(input: {
  filePath: string | undefined;
  sharedCssPatterns: string[];
}): boolean {
  if (!input.filePath || input.sharedCssPatterns.length === 0) {
    return false;
  }

  const normalizedFilePath = normalizeProjectPath(input.filePath);
  return input.sharedCssPatterns.some((pattern) =>
    globToRegExp(normalizeProjectPath(pattern)).test(normalizedFilePath),
  );
}

export function isIntentionallySharedStylesheetPath(input: {
  filePath: string | undefined;
  sharedCssPatterns: string[];
}): boolean {
  return (
    isConfiguredSharedStylesheetPath(input) || isIntentionallyBroadStylesheetPath(input.filePath)
  );
}

export function hasPrivateComponentOwnerEvidence(input: {
  ownerCandidates: OwnerCandidateLike[];
}): boolean {
  return input.ownerCandidates.some(
    (candidate) =>
      getOwnerCandidateKind(candidate) === "component" &&
      getOwnerCandidateId(candidate) &&
      candidate.confidence === "high" &&
      candidate.reasons.some((reason) => PRIVATE_OWNER_REASONS.has(reason)),
  );
}

export function findPrivateComponentOwnerCandidate<TCandidate extends OwnerCandidateLike>(
  candidates: TCandidate[],
): TCandidate | undefined {
  return candidates.find(
    (candidate) =>
      getOwnerCandidateKind(candidate) === "component" &&
      getOwnerCandidateId(candidate) &&
      candidate.confidence === "high" &&
      candidate.reasons.some((reason) => PRIVATE_OWNER_REASONS.has(reason)),
  );
}

export function getOwnerCandidateId(candidate: OwnerCandidateLike): string | undefined {
  return candidate.ownerId ?? candidate.id;
}

export function getOwnerCandidateKind(candidate: OwnerCandidateLike): string | undefined {
  return candidate.ownerKind ?? candidate.kind;
}

export function isOwnerFamilyConsumer(input: {
  ownerComponentFilePath: string | undefined;
  consumerComponentFilePath: string | undefined;
  stylesheetFilePath: string | undefined;
}): boolean {
  if (
    !input.ownerComponentFilePath ||
    !input.consumerComponentFilePath ||
    !input.stylesheetFilePath
  ) {
    return false;
  }

  const ownerDirectory = getDirectoryPath(normalizeProjectPath(input.ownerComponentFilePath));
  const consumerDirectory = getDirectoryPath(normalizeProjectPath(input.consumerComponentFilePath));
  const stylesheetDirectory = getDirectoryPath(normalizeProjectPath(input.stylesheetFilePath));

  return (
    ownerDirectory.length > 0 &&
    ownerDirectory === consumerDirectory &&
    ownerDirectory === stylesheetDirectory
  );
}

export function isGenericStateClassToken(className: string): boolean {
  return /^is-[a-z0-9-]+$/.test(className) || /^has-[a-z0-9-]+$/.test(className);
}

export function isContextualPrimitiveOverrideClass(input: {
  className: string;
  selectorKind: string;
  contextClassNames: string[];
  ownerComponentName: string | undefined;
  stylesheetFilePath: string | undefined;
}): boolean {
  if (input.selectorKind !== "contextual" || input.contextClassNames.length === 0) {
    return false;
  }

  const ownerBlocks = getOwnerBlockNames({
    ownerComponentName: input.ownerComponentName,
    stylesheetFilePath: input.stylesheetFilePath,
  });
  if (ownerBlocks.length === 0) {
    return false;
  }

  return (
    input.contextClassNames.some((className) => belongsToAnyOwnerBlock(className, ownerBlocks)) &&
    !belongsToAnyOwnerBlock(input.className, ownerBlocks)
  );
}

export function isIntentionallySharedStylesheetForConsumers(input: {
  stylesheetFilePath: string | undefined;
  consumerComponentNames: string[];
  sharedCssPatterns: string[];
}): boolean {
  if (
    isIntentionallySharedStylesheetPath({
      filePath: input.stylesheetFilePath,
      sharedCssPatterns: input.sharedCssPatterns,
    })
  ) {
    return true;
  }

  if (!input.stylesheetFilePath || input.consumerComponentNames.length < 2) {
    return false;
  }

  const stylesheetBaseName = normalizeName(getBaseNameWithoutExtension(input.stylesheetFilePath));
  if (!stylesheetBaseName) {
    return false;
  }

  const consumerNames = input.consumerComponentNames.map(normalizeName).filter(Boolean);
  if (consumerNames.length < 2) {
    return false;
  }

  return (
    consumerNames.every((consumerName) => consumerName.endsWith(stylesheetBaseName)) &&
    consumerNames.some((consumerName) => consumerName !== stylesheetBaseName)
  );
}

function normalizeProjectPath(filePath: string): string {
  return filePath
    .split("\\")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const nextChar = glob[index + 1];

    if (char === "*" && nextChar === "*") {
      const afterGlobstar = glob[index + 2];
      if (afterGlobstar === "/") {
        source += "(?:.*/)?";
        index += 2;
        continue;
      }

      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getBaseNameWithoutExtension(filePath: string): string {
  const normalized = filePath.split("\\").join("/");
  const fileName = normalized.split("/").at(-1) ?? normalized;
  return fileName.replace(/\.[^.]+$/, "");
}

function getDirectoryPath(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function getOwnerBlockNames(input: {
  ownerComponentName: string | undefined;
  stylesheetFilePath: string | undefined;
}): string[] {
  const blocks = new Set<string>();
  if (input.ownerComponentName) {
    const normalizedComponentName = normalizeName(input.ownerComponentName);
    if (normalizedComponentName) {
      blocks.add(normalizedComponentName);
    }
  }

  if (input.stylesheetFilePath) {
    const normalizedStylesheetName = normalizeName(
      getBaseNameWithoutExtension(input.stylesheetFilePath),
    );
    if (normalizedStylesheetName) {
      blocks.add(normalizedStylesheetName);
    }
  }

  return [...blocks].sort((left, right) => left.localeCompare(right));
}

function belongsToAnyOwnerBlock(className: string, ownerBlocks: string[]): boolean {
  const normalizedClassName = normalizeName(className);
  return ownerBlocks.some(
    (block) =>
      normalizedClassName === block ||
      normalizedClassName.startsWith(`${block}-`) ||
      normalizedClassName.startsWith(`${block}__`) ||
      normalizedClassName.startsWith(`${block}--`),
  );
}

function normalizeName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
