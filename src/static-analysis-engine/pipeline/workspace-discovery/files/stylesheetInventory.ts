import type { ProjectStylesheetFile } from "../types.js";
import { isCssModulePath } from "../../../libraries/stylesheets/cssModulePaths.js";

export function mergeStylesheets(stylesheets: ProjectStylesheetFile[]): ProjectStylesheetFile[] {
  const stylesheetsByPath = new Map<string, ProjectStylesheetFile>();
  for (const stylesheet of stylesheets) {
    stylesheetsByPath.set(stylesheet.filePath, stylesheet);
  }

  return [...stylesheetsByPath.values()].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  );
}

export function toCssSources(stylesheets: ProjectStylesheetFile[]): Array<{
  filePath: string;
  cssText: string;
}> {
  return stylesheets.map((stylesheet) => ({
    filePath: stylesheet.filePath,
    cssText: stylesheet.cssText,
  }));
}

export function toStylesheetFiles(
  cssSources: Array<{ filePath: string; cssText: string }>,
  origin: ProjectStylesheetFile["origin"],
): ProjectStylesheetFile[] {
  return cssSources.map((cssSource) => ({
    kind: "stylesheet",
    filePath: cssSource.filePath,
    cssText: cssSource.cssText,
    cssKind: getCssKind(cssSource.filePath),
    origin,
  }));
}

function getCssKind(filePath: string): ProjectStylesheetFile["cssKind"] {
  return isCssModulePath(filePath) ? "css-module" : "global-css";
}
