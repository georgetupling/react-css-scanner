import type { AnalysisTrace, CssModuleImportAnalysis } from "../../static-analysis-engine/index.js";
import type { RuleContext, RuleDefinition, UnresolvedFinding } from "../types.js";

export const cssModuleImportNotUsedRule: RuleDefinition = {
  id: "css-module-import-not-used",
  run(context) {
    return runCssModuleImportNotUsedRule(context);
  },
};

function runCssModuleImportNotUsedRule(context: RuleContext): UnresolvedFinding[] {
  const usedImportIds = collectUsedCssModuleImportIds(context);

  return context.analysisEvidence.projectEvidence.entities.cssModuleImports
    .filter((importRecord) => !usedImportIds.has(importRecord.id))
    .map((importRecord) => buildCssModuleImportNotUsedFinding({ context, importRecord }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function collectUsedCssModuleImportIds(context: RuleContext): Set<string> {
  const usedImportIds = new Set<string>();
  const entities = context.analysisEvidence.projectEvidence.entities;

  for (const reference of entities.cssModuleMemberReferences) {
    usedImportIds.add(reference.importId);
  }
  for (const alias of entities.cssModuleAliases) {
    usedImportIds.add(alias.importId);
  }
  for (const binding of entities.cssModuleDestructuredBindings) {
    usedImportIds.add(binding.importId);
  }
  for (const diagnostic of entities.cssModuleReferenceDiagnostics) {
    usedImportIds.add(diagnostic.importId);
  }
  for (const match of context.analysisEvidence.projectEvidence.relations.cssModuleMemberMatches) {
    usedImportIds.add(match.importId);
  }

  return usedImportIds;
}

function buildCssModuleImportNotUsedFinding(input: {
  context: RuleContext;
  importRecord: CssModuleImportAnalysis;
}): UnresolvedFinding {
  return {
    id: `css-module-import-not-used:${input.importRecord.id}`,
    ruleId: "css-module-import-not-used",
    confidence: "high",
    message: `CSS Module import "${input.importRecord.localName}" is never used.`,
    subject: {
      kind: "css-module-import",
      id: input.importRecord.id,
    },
    location: undefined,
    evidence: [
      {
        kind: "source-file",
        id: input.importRecord.sourceFileId,
      },
      {
        kind: "stylesheet",
        id: input.importRecord.stylesheetId,
      },
    ],
    traces:
      input.context.includeTraces === false
        ? []
        : buildCssModuleImportNotUsedTraces(input.importRecord),
    data: {
      localName: input.importRecord.localName,
      specifier: input.importRecord.specifier,
      importKind: input.importRecord.importKind,
      sourceFilePath: input.importRecord.sourceFilePath,
      stylesheetFilePath: input.importRecord.stylesheetFilePath,
      stylesheetId: input.importRecord.stylesheetId,
    },
  };
}

function buildCssModuleImportNotUsedTraces(importRecord: CssModuleImportAnalysis): AnalysisTrace[] {
  return [
    {
      traceId: `rule-evaluation:css-module-import-not-used:${importRecord.id}`,
      category: "rule-evaluation",
      summary: `CSS Module import "${importRecord.localName}" had no member, alias, destructuring, diagnostic, or match evidence`,
      anchor: {
        filePath: importRecord.sourceFilePath,
        startLine: 1,
        startColumn: 1,
      },
      children: [],
      metadata: {
        ruleId: "css-module-import-not-used",
        importId: importRecord.id,
        localName: importRecord.localName,
        stylesheetId: importRecord.stylesheetId,
      },
    },
  ];
}
