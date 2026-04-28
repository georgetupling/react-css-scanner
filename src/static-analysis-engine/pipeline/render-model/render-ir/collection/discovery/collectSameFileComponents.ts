import ts from "typescript";

import { collectComponentLikeDefinitions } from "../../../../../libraries/react-components/index.js";
import { createComponentKey } from "../../../componentIdentity.js";
import {
  indexExpressionBindingsBySymbolId,
  normalizeHelperDefinitionSymbolBindings,
} from "../shared/indexExpressionBindingsBySymbolId.js";
import type { SameFileComponentDefinition } from "../shared/types.js";
import type { FiniteTypeInterpreterCache } from "../shared/finiteTypeInterpreter.js";
import { summarizeParameterBinding } from "../summarization/summarizeParameterBinding.js";
import { summarizeComponentBody } from "../summarization/summarizeComponentBody.js";

export function collectSameFileComponents(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  finiteTypeInterpreterCache?: FiniteTypeInterpreterCache;
  symbolResolution: import("../../../../symbol-resolution/index.js").ProjectBindingResolution;
}): SameFileComponentDefinition[] {
  const components: SameFileComponentDefinition[] = [];

  for (const definition of collectComponentLikeDefinitions({
    filePath: input.filePath,
    parsedSourceFile: input.parsedSourceFile,
  })) {
    if (!definition.functionLikeNode) {
      continue;
    }

    const parameterBinding = summarizeParameterBinding(
      definition.functionLikeNode.parameters,
      input.finiteTypeInterpreterCache,
    );
    const bodySummary = summarizeComponentBody(definition.functionLikeNode.body, parameterBinding);
    if (!bodySummary) {
      continue;
    }

    components.push({
      componentKey: createComponentKey({
        filePath: input.filePath,
        sourceAnchor: definition.sourceAnchor,
        componentName: definition.componentName,
      }),
      componentName: definition.componentName,
      exported: definition.exported,
      filePath: input.filePath,
      parsedSourceFile: input.parsedSourceFile,
      sourceAnchor: definition.sourceAnchor,
      rootExpression: bodySummary.rootExpression,
      localExpressionBindingEntries: bodySummary.localExpressionBindingEntries,
      localExpressionBindings: bodySummary.localExpressionBindings,
      localExpressionBindingsBySymbolId: indexExpressionBindingsBySymbolId({
        bindingEntries: bodySummary.localExpressionBindingEntries,
        filePath: input.filePath,
        parsedSourceFile: input.parsedSourceFile,
        symbolResolution: input.symbolResolution,
      }),
      localStringSetBindings: bodySummary.localStringSetBindings,
      localHelperDefinitions: new Map(
        [...bodySummary.localHelperDefinitions.entries()].map(([helperName, helperDefinition]) => [
          helperName,
          normalizeHelperDefinitionSymbolBindings({
            helperDefinition,
            symbolResolution: input.symbolResolution,
          }),
        ]),
      ),
      parameterBinding,
    });
  }

  return components;
}
export type { SameFileComponentDefinition, LocalHelperDefinition } from "../shared/types.js";
