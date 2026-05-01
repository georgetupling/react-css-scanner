import ts from "typescript";

import { collectComponentLikeDefinitions } from "../../../../libraries/react-components/index.js";
import { createComponentKey } from "./componentIdentity.js";
import type { ReactComponentDeclarationFact } from "./types.js";

export function collectReactComponents(input: { filePath: string; sourceFile: ts.SourceFile }): {
  components: ReactComponentDeclarationFact[];
  componentKeyByFunction: Map<ts.Node, string>;
} {
  const definitions = collectComponentLikeDefinitions({
    filePath: input.filePath,
    parsedSourceFile: input.sourceFile,
  });
  const componentKeyByFunction = new Map<ts.Node, string>();
  const components = definitions.map((definition): ReactComponentDeclarationFact => {
    const componentKey = createComponentKey({
      filePath: input.filePath,
      sourceAnchor: definition.sourceAnchor,
      componentName: definition.componentName,
    });

    if (definition.functionLikeNode) {
      componentKeyByFunction.set(definition.functionLikeNode, componentKey);
    }

    return {
      componentKey,
      componentName: definition.componentName,
      filePath: input.filePath,
      exported: definition.exported,
      declarationKind: definition.declarationKind,
      evidence: definition.evidence,
      location: definition.sourceAnchor,
    };
  });

  return { components, componentKeyByFunction };
}
