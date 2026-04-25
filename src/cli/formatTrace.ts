import type { AnalysisTrace } from "../static-analysis-engine/index.js";

export function formatTrace(trace: AnalysisTrace, indent = "  "): string[] {
  return [
    `${indent}- ${trace.summary}`,
    ...trace.children.flatMap((child) => formatTrace(child, `${indent}  `)),
  ];
}
