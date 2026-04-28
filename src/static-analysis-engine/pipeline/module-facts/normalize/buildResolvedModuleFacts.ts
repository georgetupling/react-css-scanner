import type { ModuleFactsStore, ResolvedModuleFacts } from "../types.js";
import { normalizeFilePath } from "../shared/pathUtils.js";
import { createModuleFactsModuleId } from "./moduleIds.js";
import { normalizeExportFacts } from "./normalizeExportFacts.js";
import { normalizeImportFacts } from "./normalizeImportFacts.js";
import { normalizeTopLevelBindings } from "./normalizeTopLevelBindings.js";

export function buildResolvedModuleFacts(input: {
  moduleFacts: ModuleFactsStore;
}): Map<string, ResolvedModuleFacts> {
  const factsByFilePath = new Map<string, ResolvedModuleFacts>();
  const filePaths = [...input.moduleFacts.parsedSourceFilesByFilePath.keys()].sort((left, right) =>
    left.localeCompare(right),
  );

  for (const filePath of filePaths) {
    const normalizedFilePath = normalizeFilePath(filePath);
    const moduleId = createModuleFactsModuleId(normalizedFilePath);
    const imports = input.moduleFacts.importsByFilePath.get(normalizedFilePath) ?? [];
    const declarations = input.moduleFacts.declarationsByFilePath.get(normalizedFilePath);
    const exports = input.moduleFacts.exportsByFilePath.get(normalizedFilePath) ?? [];
    const topLevelBindings = normalizeTopLevelBindings({
      moduleId,
      imports,
      declarations,
    });
    const localBindingIdsByName = new Map(
      topLevelBindings.map((binding) => [binding.localName, binding.bindingId]),
    );

    factsByFilePath.set(normalizedFilePath, {
      filePath: normalizedFilePath,
      moduleId,
      moduleKind: "source",
      imports: normalizeImportFacts({
        moduleFacts: input.moduleFacts,
        filePath: normalizedFilePath,
        moduleId,
        imports,
      }),
      exports: normalizeExportFacts({
        moduleFacts: input.moduleFacts,
        moduleId,
        localBindingIdsByName,
        exports,
      }),
      topLevelBindings,
    });
  }

  return factsByFilePath;
}
