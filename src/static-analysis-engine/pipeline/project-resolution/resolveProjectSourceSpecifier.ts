import { resolveSourceSpecifier } from "./resolveSourceSpecifier.js";
import { resolveTypescriptModuleSpecifier } from "./typescriptResolution.js";
import type { ProjectResolution } from "./types.js";

export function resolveProjectSourceSpecifier(input: {
  projectResolution: ProjectResolution;
  fromFilePath: string;
  specifier: string;
}): string | undefined {
  const cacheKey = `${input.fromFilePath}\0${input.specifier}\0source`;
  const cached = input.projectResolution.caches.moduleSpecifiers.get(cacheKey);
  if (cached) {
    return cached.status === "resolved" ? cached.value : undefined;
  }

  const resolvedFilePath =
    resolveSourceSpecifier({
      fromFilePath: input.fromFilePath,
      specifier: input.specifier,
      knownFilePaths: input.projectResolution.parsedSourceFilesByFilePath,
      includeTypeScriptExtensionAlternates: true,
      workspacePackageEntryPointsByPackageName:
        input.projectResolution.workspacePackageEntryPointsByPackageName,
    }) ??
    (input.projectResolution.typescriptResolution
      ? resolveTypescriptModuleSpecifier({
          typescriptResolution: input.projectResolution.typescriptResolution,
          fromFilePath: input.fromFilePath,
          specifier: input.specifier,
        })
      : undefined);

  input.projectResolution.caches.moduleSpecifiers.set(
    cacheKey,
    resolvedFilePath
      ? {
          status: "resolved",
          confidence: input.specifier.startsWith(".") ? "exact" : "heuristic",
          value: resolvedFilePath,
        }
      : { status: "not-found", reason: "source-specifier-not-found" },
  );

  return resolvedFilePath;
}
