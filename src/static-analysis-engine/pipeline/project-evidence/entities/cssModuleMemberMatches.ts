import type {
  CssModuleLocalsConvention,
  CssModuleMemberMatchRelation,
  CssModuleMemberReferenceAnalysis,
  ProjectEvidenceBuilderIndexes,
} from "../analysisTypes.js";
import { compareById, mergeTraces, uniqueSorted } from "../internal/shared.js";

export function buildCssModuleMemberMatches(input: {
  references: CssModuleMemberReferenceAnalysis[];
  indexes: ProjectEvidenceBuilderIndexes;
  localsConvention?: CssModuleLocalsConvention;
  includeTraces: boolean;
}): CssModuleMemberMatchRelation[] {
  const matches: CssModuleMemberMatchRelation[] = [];

  for (const reference of input.references) {
    const definitionIds = input.indexes.definitionsByStylesheetId.get(reference.stylesheetId) ?? [];
    const definitionId = definitionIds.find((candidateId) => {
      const definition = input.indexes.classDefinitionsById.get(candidateId);
      return (
        definition &&
        getCssModuleExportNames(definition.className, input.localsConvention).includes(
          reference.memberName,
        )
      );
    });

    if (definitionId) {
      const definition = input.indexes.classDefinitionsById.get(definitionId);
      const originalClassName = definition?.className ?? reference.memberName;
      matches.push({
        id: `css-module-member-match:${reference.id}:${definitionId}`,
        referenceId: reference.id,
        importId: reference.importId,
        stylesheetId: reference.stylesheetId,
        definitionId,
        className: originalClassName,
        exportName: reference.memberName,
        status: "matched",
        reasons: [
          `CSS Module member "${reference.memberName}" matched exported class "${originalClassName}"`,
        ],
        traces: input.includeTraces ? mergeTraces(reference.traces) : [],
      });
      continue;
    }

    matches.push({
      id: `css-module-member-match:${reference.id}:missing`,
      referenceId: reference.id,
      importId: reference.importId,
      stylesheetId: reference.stylesheetId,
      className: reference.memberName,
      exportName: reference.memberName,
      status: "missing",
      reasons: [`CSS Module member "${reference.memberName}" has no exported class`],
      traces: input.includeTraces ? mergeTraces(reference.traces) : [],
    });
  }

  return matches.sort(compareById);
}

export function getCssModuleExportNames(
  className: string,
  localsConvention: CssModuleLocalsConvention | undefined,
): string[] {
  const resolvedLocalsConvention = localsConvention ?? "camelCase";
  const exportNames =
    resolvedLocalsConvention === "asIs"
      ? [className]
      : resolvedLocalsConvention === "camelCaseOnly"
        ? [toCamelCaseClassName(className)]
        : [className, toCamelCaseClassName(className)];

  return uniqueSorted(exportNames);
}

export function toCamelCaseClassName(className: string): string {
  return className.replace(/[-_]+([a-zA-Z0-9])/g, (_match, character: string) =>
    character.toUpperCase(),
  );
}
