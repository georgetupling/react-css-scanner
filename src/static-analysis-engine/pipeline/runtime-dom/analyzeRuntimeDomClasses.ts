import ts from "typescript";

import { prosemirrorEditorViewAdapter } from "./adapters/index.js";
import type {
  RuntimeDomAdapter,
  RuntimeDomAdapterContext,
  RuntimeDomClassReference,
} from "./types.js";

const RUNTIME_DOM_ADAPTERS: RuntimeDomAdapter[] = [prosemirrorEditorViewAdapter];

export function analyzeRuntimeDomClasses(input: {
  parsedFiles: Array<{
    filePath: string;
    parsedSourceFile: ts.SourceFile;
  }>;
  includeTraces?: boolean;
}): RuntimeDomClassReference[] {
  return input.parsedFiles.flatMap((parsedFile) =>
    collectRuntimeDomClassReferences({
      ...parsedFile,
      includeTraces: input.includeTraces ?? true,
    }),
  );
}

function collectRuntimeDomClassReferences(
  context: RuntimeDomAdapterContext,
): RuntimeDomClassReference[] {
  const references: RuntimeDomClassReference[] = [];

  function visit(node: ts.Node): void {
    for (const adapter of RUNTIME_DOM_ADAPTERS) {
      references.push(...adapter.collectReferences(node, context));
    }

    ts.forEachChild(node, visit);
  }

  visit(context.parsedSourceFile);
  return references;
}
