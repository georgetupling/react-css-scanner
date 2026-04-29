import path from "node:path";

import type { ProjectBoundary, ProjectSourceFile } from "../types.js";

export function collectWorkspacePackageBoundaries(
  sourceFiles: ProjectSourceFile[],
): ProjectBoundary[] {
  const boundariesByKey = new Map<string, ProjectBoundary>();

  for (const sourceFile of sourceFiles) {
    const packageName = inferWorkspacePackageName(sourceFile.filePath);
    if (!packageName) {
      continue;
    }

    const boundary: ProjectBoundary = {
      kind: "workspace-package",
      packageName,
      entryFilePath: sourceFile.filePath,
      confidence: "heuristic",
      reason: "discovered-workspace-entrypoint",
    };
    boundariesByKey.set(`${boundary.packageName}\0${boundary.entryFilePath}`, boundary);
  }

  return [...boundariesByKey.values()];
}

function inferWorkspacePackageName(filePath: string): string | undefined {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const parsedPath = path.posix.parse(normalizedFilePath);
  if (!/^index\.[cm]?[jt]sx?$/.test(parsedPath.base)) {
    return undefined;
  }

  const segments = normalizedFilePath.split("/");
  const fileName = segments.at(-1);
  if (!fileName || !/^index\.[cm]?[jt]sx?$/.test(fileName)) {
    return undefined;
  }

  const parentName = segments.at(-2);
  if (!parentName) {
    return undefined;
  }

  if (parentName === "src") {
    const packageName = segments.at(-3);
    const scopeName = segments.at(-4);
    if (packageName?.startsWith("@")) {
      return undefined;
    }
    if (scopeName?.startsWith("@") && packageName) {
      return `${scopeName}/${packageName}`;
    }
    return packageName;
  }

  const scopeName = segments.at(-3);
  if (scopeName?.startsWith("@")) {
    return `${scopeName}/${parentName}`;
  }

  return parentName;
}
