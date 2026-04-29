import {
  buildClassExpressionTraces,
  toAbstractClassSet,
} from "../render-model/abstract-values/classExpressions.js";
import type { AbstractValue } from "../render-model/abstract-values/types.js";
import type { RuntimeDomClassSite, SourceFrontendFacts } from "../language-frontends/types.js";
import type { RuntimeDomClassReference, RuntimeDomReferenceTrace } from "./types.js";

export function analyzeRuntimeDomClasses(input: {
  source: SourceFrontendFacts;
  includeTraces?: boolean;
}): RuntimeDomClassReference[] {
  const includeTraces = input.includeTraces ?? true;

  return input.source.files.flatMap((file) =>
    file.runtimeDomClassSites.map((site) =>
      runtimeDomClassSiteToReference({
        site,
        includeTraces,
      }),
    ),
  );
}

function runtimeDomClassSiteToReference(input: {
  site: RuntimeDomClassSite;
  includeTraces: boolean;
}): RuntimeDomClassReference {
  const value: AbstractValue = {
    kind: "string-exact",
    value: input.site.classText,
  };

  return {
    kind: input.site.kind,
    filePath: input.site.filePath,
    location: input.site.location,
    rawExpressionText: input.site.rawExpressionText,
    runtimeLibraryHint: input.site.runtimeLibraryHint,
    classExpression: {
      sourceAnchor: input.site.location,
      sourceText: input.site.rawExpressionText,
      value,
      classes: toAbstractClassSet(value, input.site.location),
      traces: [
        ...buildRuntimeDomClassSiteTraces({
          site: input.site,
          includeTraces: input.includeTraces,
        }),
        ...buildClassExpressionTraces({
          sourceAnchor: input.site.location,
          sourceText: input.site.rawExpressionText,
          value,
          includeTraces: input.includeTraces,
        }),
      ],
    },
  };
}

function buildRuntimeDomClassSiteTraces(input: {
  site: RuntimeDomClassSite;
  includeTraces: boolean;
}): RuntimeDomReferenceTrace[] {
  if (!input.includeTraces) {
    return [];
  }

  return [
    {
      traceId: `runtime-dom:class-reference:${input.site.location.filePath}:${input.site.location.startLine}:${input.site.location.startColumn}`,
      category: "value-evaluation",
      summary: input.site.trace.summary,
      anchor: input.site.location,
      children: [],
      metadata: {
        adapter: input.site.trace.adapterName,
      },
    },
  ];
}
