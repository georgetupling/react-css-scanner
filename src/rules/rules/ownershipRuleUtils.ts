const BROAD_STYLESHEET_SEGMENTS = new Set([
  "common",
  "design-system",
  "designsystem",
  "global",
  "globals",
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

export function hasPrivateComponentOwnerEvidence(input: {
  ownerCandidates: Array<{
    kind: string;
    confidence: string;
    reasons: string[];
    id?: string;
  }>;
}): boolean {
  return input.ownerCandidates.some(
    (candidate) =>
      candidate.kind === "component" &&
      candidate.id &&
      candidate.confidence === "high" &&
      candidate.reasons.some((reason) => PRIVATE_OWNER_REASONS.has(reason)),
  );
}

export function findPrivateComponentOwnerCandidate<
  TCandidate extends {
    kind: string;
    confidence: string;
    reasons: string[];
    id?: string;
  },
>(candidates: TCandidate[]): TCandidate | undefined {
  return candidates.find(
    (candidate) =>
      candidate.kind === "component" &&
      candidate.id &&
      candidate.confidence === "high" &&
      candidate.reasons.some((reason) => PRIVATE_OWNER_REASONS.has(reason)),
  );
}

export function isIntentionallySharedStylesheetForConsumers(input: {
  stylesheetFilePath: string | undefined;
  consumerComponentNames: string[];
}): boolean {
  if (isIntentionallyBroadStylesheetPath(input.stylesheetFilePath)) {
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

function getBaseNameWithoutExtension(filePath: string): string {
  const normalized = filePath.split("\\").join("/");
  const fileName = normalized.split("/").at(-1) ?? normalized;
  return fileName.replace(/\.[^.]+$/, "");
}

function normalizeName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
