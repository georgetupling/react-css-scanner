import ts from "typescript";

import { collectComponentLikeDefinitions } from "../../../../../libraries/react-components/index.js";
import type { SameFileComponentDefinition } from "../shared/types.js";
import type { FiniteTypeInterpreterCache } from "../shared/finiteTypeInterpreter.js";
import { summarizeParameterBinding } from "../summarization/summarizeParameterBinding.js";
import { summarizeComponentBody } from "../summarization/summarizeComponentBody.js";

export function collectSameFileComponents(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  finiteTypeInterpreterCache?: FiniteTypeInterpreterCache;
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
      componentName: definition.componentName,
      exported: definition.exported,
      filePath: input.filePath,
      parsedSourceFile: input.parsedSourceFile,
      sourceAnchor: definition.sourceAnchor,
      rootExpression: bodySummary.rootExpression,
      localExpressionBindings: bodySummary.localExpressionBindings,
      localStringSetBindings: bodySummary.localStringSetBindings,
      localHelperDefinitions: bodySummary.localHelperDefinitions,
      parameterBinding,
    });
  }

  return components;
}
export type { SameFileComponentDefinition, LocalHelperDefinition } from "../shared/types.js";
