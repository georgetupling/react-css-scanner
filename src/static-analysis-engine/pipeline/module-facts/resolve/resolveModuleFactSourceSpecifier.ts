import { resolveSourceSpecifier } from "./resolveSourceSpecifier.js";
import { resolveTypescriptModuleSpecifier } from "./typescriptResolution.js";
import type { ModuleFactsStore } from "../types.js";

export function resolveModuleFactSourceSpecifier(input: {
  moduleFacts: ModuleFactsStore;
  fromFilePath: string;
  specifier: string;
}): string | undefined {
  const cacheKey = `${input.fromFilePath}\0${input.specifier}\0source`;
  const cached = input.moduleFacts.caches.moduleSpecifiers.get(cacheKey);
  if (cached) {
    return cached.status === "resolved" ? cached.value : undefined;
  }

  const resolvedFilePath =
    resolveSourceSpecifier({
      fromFilePath: input.fromFilePath,
      specifier: input.specifier,
      knownFilePaths: input.moduleFacts.parsedSourceFilesByFilePath,
      includeTypeScriptExtensionAlternates: true,
      workspacePackageEntryPointsByPackageName:
        input.moduleFacts.workspacePackageEntryPointsByPackageName,
    }) ??
    (input.moduleFacts.typescriptResolution
      ? resolveTypescriptModuleSpecifier({
          typescriptResolution: input.moduleFacts.typescriptResolution,
          fromFilePath: input.fromFilePath,
          specifier: input.specifier,
        })
      : undefined);

  input.moduleFacts.caches.moduleSpecifiers.set(
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
