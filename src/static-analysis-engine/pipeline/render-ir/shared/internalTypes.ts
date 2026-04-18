import ts from "typescript";

import type { LocalHelperDefinition, SameFileComponentDefinition } from "../collection/types.js";
import type { RenderNode } from "../types.js";

export type BuildContext = {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  componentsByName: Map<string, SameFileComponentDefinition>;
  currentDepth: number;
  expansionStack: string[];
  expressionBindings: Map<string, ts.Expression>;
  helperDefinitions: Map<string, LocalHelperDefinition>;
  helperExpansionStack: string[];
  propsObjectBindingName?: string;
  propsObjectProperties: Map<string, ts.Expression>;
  propsObjectSubtreeProperties: Map<string, RenderNode[]>;
  subtreeBindings: Map<string, RenderNode[]>;
};
