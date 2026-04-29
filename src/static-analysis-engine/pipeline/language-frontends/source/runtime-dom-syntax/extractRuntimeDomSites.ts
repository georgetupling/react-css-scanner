import ts from "typescript";

import type { SourceModuleSyntaxFacts } from "../moduleSyntax.js";
import type { RuntimeDomClassSite } from "../../types.js";
import { collectProseMirrorEditorViewRuntimeDomSites } from "./prosemirrorEditorView.js";
import type { RuntimeDomFrontendAdapterContext } from "./shared.js";

const RUNTIME_DOM_FRONTEND_ADAPTERS = [collectProseMirrorEditorViewRuntimeDomSites];

export function extractRuntimeDomClassSites(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
  moduleSyntax: SourceModuleSyntaxFacts;
}): RuntimeDomClassSite[] {
  const context: RuntimeDomFrontendAdapterContext = {
    filePath: input.filePath,
    parsedSourceFile: input.sourceFile,
  };
  const sites: RuntimeDomClassSite[] = [];

  function visit(node: ts.Node): void {
    for (const adapter of RUNTIME_DOM_FRONTEND_ADAPTERS) {
      sites.push(
        ...adapter({
          node,
          context,
          imports: input.moduleSyntax.imports,
        }),
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(input.sourceFile);
  return sites.sort(compareRuntimeDomClassSites);
}

function compareRuntimeDomClassSites(
  left: RuntimeDomClassSite,
  right: RuntimeDomClassSite,
): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.location.startLine - right.location.startLine ||
    left.location.startColumn - right.location.startColumn ||
    left.kind.localeCompare(right.kind) ||
    left.rawExpressionText.localeCompare(right.rawExpressionText)
  );
}
