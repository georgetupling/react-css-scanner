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
