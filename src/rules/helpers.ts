import type { RuleConfigObject } from "../config/types.js";
import { matchesAnyGlob } from "../files/pathUtils.js";
import type { CssFileNode, ProjectModel } from "../model/types.js";

export const DYNAMIC_REFERENCE_KINDS = new Set([
  "template-literal",
  "conditional",
  "helper-call",
  "css-module-dynamic-property",
]);

export function getProjectClassDefinitions(model: ProjectModel, className: string) {
  return (model.indexes.classDefinitionsByName.get(className) ?? []).filter(
    (definition) => !isCssModuleFile(model, definition.cssFile),
  );
}

export function isDefinitionReachable(
  model: ProjectModel,
  sourceFilePath: string,
  cssFilePath: string,
  externalSpecifier?: string,
): boolean {
  const reachability = model.reachability.get(sourceFilePath);
  const cssFile = model.indexes.cssFileByPath.get(cssFilePath);
  if (!reachability) {
    return false;
  }

  if (externalSpecifier) {
    return reachability.externalCss.has(externalSpecifier);
  }

  if (!cssFile) {
    return false;
  }

  if (cssFile.category === "global") {
    return reachability.globalCss.has(cssFilePath);
  }

  return reachability.localCss.has(cssFilePath);
}

export function isCssModuleReference(kind: string): boolean {
  return kind === "css-module-property" || kind === "css-module-dynamic-property";
}

export function isCssModuleFile(model: ProjectModel, cssFilePath: string): boolean {
  if (matchesAnyGlob(cssFilePath, model.config.css.modules.patterns)) {
    return true;
  }

  for (const sourceFile of model.graph.sourceFiles) {
    if (sourceFile.cssModuleImports.some((entry) => entry.resolvedPath === cssFilePath)) {
      return true;
    }
  }

  return false;
}

export function getOwningSourceFiles(model: ProjectModel, cssFilePath: string): Set<string> {
  const owners = new Set<string>();
  const siblingOwners = getSiblingOwnerSources(model, cssFilePath);
  if (siblingOwners.size > 0) {
    return siblingOwners;
  }

  for (const sourceFile of model.graph.sourceFiles) {
    if (
      sourceFile.cssImports.some((entry) => entry.resolvedPath === cssFilePath) ||
      sourceFile.cssModuleImports.some((entry) => entry.resolvedPath === cssFilePath)
    ) {
      owners.add(sourceFile.path);
    }
  }

  return owners;
}

export function getUsingSourceFiles(model: ProjectModel, cssFile: CssFileNode): Set<string> {
  const usingSources = new Set<string>();

  for (const definition of cssFile.classDefinitions) {
    const references = model.indexes.classReferencesByName.get(definition.className) ?? [];
    for (const entry of references) {
      if (isCssModuleReference(entry.reference.kind) && !isCssModuleFile(model, cssFile.path)) {
        continue;
      }

      if (isDefinitionReachable(model, entry.sourceFile, cssFile.path)) {
        usingSources.add(entry.sourceFile);
      }
    }
  }

  return usingSources;
}

export function getRuleNumberConfig(
  model: ProjectModel,
  ruleId: string,
  field: "threshold" | "minDeclarationOverlap" | "minOccurrences" | "minDeclarations",
  fallback: number,
): number {
  const configuredValue = model.config.rules[ruleId];
  if (configuredValue && typeof configuredValue === "object") {
    const typedValue = configuredValue as RuleConfigObject;
    const numericValue = typedValue[field];
    if (typeof numericValue === "number") {
      return numericValue;
    }
  }

  return fallback;
}

export function getDeclarationOverlap(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return left.filter((declaration) => rightSet.has(declaration)).length;
}

export function getBaseName(filePath: string): string {
  const fileName = filePath.split("/").at(-1) ?? filePath;
  return fileName.replace(/\.[^.]+$/, "");
}

export function getDirectoryName(filePath: string): string {
  const segments = filePath.split("/");
  segments.pop();
  return segments.join("/");
}

function getSiblingOwnerSources(model: ProjectModel, cssFilePath: string): Set<string> {
  const owners = new Set<string>();
  if (model.config.ownership.namingConvention !== "sibling") {
    return owners;
  }

  const cssBaseName = getBaseName(cssFilePath);

  for (const sourceFile of model.graph.sourceFiles) {
    if (
      getDirectoryName(sourceFile.path) === getDirectoryName(cssFilePath) &&
      getBaseName(sourceFile.path) === cssBaseName
    ) {
      owners.add(sourceFile.path);
    }
  }

  return owners;
}
