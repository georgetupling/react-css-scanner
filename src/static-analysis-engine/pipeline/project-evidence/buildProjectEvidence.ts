import { buildIndexes } from "./indexes.js";
import type {
  ProjectEvidenceAssemblyResult,
  ProjectEvidenceDiagnostic,
  ProjectEvidenceEntities,
  ProjectEvidenceRelations,
} from "./types.js";

export type ProjectEvidenceAssemblyInput = {
  entities?: Partial<ProjectEvidenceEntities>;
  relations?: Partial<ProjectEvidenceRelations>;
  diagnostics?: ProjectEvidenceDiagnostic[];
};

export function buildProjectEvidence(
  input: ProjectEvidenceAssemblyInput = {},
): ProjectEvidenceAssemblyResult {
  const entities = normalizeEntities(input.entities);
  const relations = normalizeRelations(input.relations);
  const diagnostics = [...(input.diagnostics ?? [])].sort(compareById);

  return {
    meta: {
      generatedAtStage: "project-evidence-assembly",
      sourceFileCount: entities.sourceFiles.length,
      componentCount: entities.components.length,
      stylesheetCount: entities.stylesheets.length,
      classDefinitionCount: entities.classDefinitions.length,
      classReferenceCount: entities.classReferences.length,
      relationCount: Object.values(relations).reduce(
        (count, relationSet) => count + relationSet.length,
        0,
      ),
      diagnosticCount: diagnostics.length,
    },
    entities,
    relations,
    diagnostics,
    indexes: buildIndexes({ entities, relations, diagnostics }),
  };
}

function normalizeEntities(input: Partial<ProjectEvidenceEntities> = {}): ProjectEvidenceEntities {
  return {
    sourceFiles: [...(input.sourceFiles ?? [])].sort(compareById),
    stylesheets: [...(input.stylesheets ?? [])].sort(compareById),
    components: [...(input.components ?? [])].sort(compareById),
    renderSubtrees: [...(input.renderSubtrees ?? [])].sort(compareById),
    classDefinitions: [...(input.classDefinitions ?? [])].sort(compareById),
    classContexts: [...(input.classContexts ?? [])].sort(compareById),
    classReferences: [...(input.classReferences ?? [])].sort(compareById),
    staticallySkippedClassReferences: [...(input.staticallySkippedClassReferences ?? [])].sort(
      compareById,
    ),
    selectorQueries: [...(input.selectorQueries ?? [])].sort(compareById),
    selectorBranches: [...(input.selectorBranches ?? [])].sort(compareById),
    unsupportedClassReferences: [...(input.unsupportedClassReferences ?? [])].sort(compareById),
    cssModuleImports: [...(input.cssModuleImports ?? [])].sort(compareById),
    cssModuleAliases: [...(input.cssModuleAliases ?? [])].sort(compareById),
    cssModuleDestructuredBindings: [...(input.cssModuleDestructuredBindings ?? [])].sort(
      compareById,
    ),
    cssModuleMemberReferences: [...(input.cssModuleMemberReferences ?? [])].sort(compareById),
    cssModuleReferenceDiagnostics: [...(input.cssModuleReferenceDiagnostics ?? [])].sort(
      compareById,
    ),
  };
}

function normalizeRelations(
  input: Partial<ProjectEvidenceRelations> = {},
): ProjectEvidenceRelations {
  return {
    moduleImports: [...(input.moduleImports ?? [])].sort(
      (left, right) =>
        [
          left.fromSourceFileId.localeCompare(right.fromSourceFileId),
          left.specifier.localeCompare(right.specifier),
          left.importKind.localeCompare(right.importKind),
          (left.toModuleId ?? "").localeCompare(right.toModuleId ?? ""),
          (left.resolvedFilePath ?? "").localeCompare(right.resolvedFilePath ?? ""),
        ].find((comparison) => comparison !== 0) ?? 0,
    ),
    componentRenders: [...(input.componentRenders ?? [])].sort(
      (left, right) =>
        left.fromComponentId.localeCompare(right.fromComponentId) ||
        (left.toComponentId ?? "").localeCompare(right.toComponentId ?? "") ||
        (left.location.filePath ?? "").localeCompare(right.location.filePath ?? "") ||
        left.location.startLine - right.location.startLine ||
        left.location.startColumn - right.location.startColumn,
    ),
    stylesheetReachability: [...(input.stylesheetReachability ?? [])].sort(
      (left, right) =>
        left.stylesheetId.localeCompare(right.stylesheetId) ||
        (left.sourceFileId ?? "").localeCompare(right.sourceFileId ?? "") ||
        (left.componentId ?? "").localeCompare(right.componentId ?? "") ||
        left.availability.localeCompare(right.availability),
    ),
    referenceMatches: [...(input.referenceMatches ?? [])].sort(compareById),
    selectorMatches: [...(input.selectorMatches ?? [])].sort(compareById),
    providerClassSatisfactions: [...(input.providerClassSatisfactions ?? [])].sort(compareById),
    providerBackedStylesheets: [...(input.providerBackedStylesheets ?? [])].sort(compareById),
    cssModuleMemberMatches: [...(input.cssModuleMemberMatches ?? [])].sort(compareById),
  };
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
