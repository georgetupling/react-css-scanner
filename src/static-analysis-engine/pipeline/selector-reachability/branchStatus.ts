import type { AnalysisConfidence } from "../../types/analysis.js";
import type {
  SelectorBranchMatch,
  SelectorReachabilityDiagnostic,
  SelectorReachabilityStatus,
} from "./types.js";

export function getBranchStatus(
  diagnostics: SelectorReachabilityDiagnostic[],
  matches: SelectorBranchMatch[],
): SelectorReachabilityStatus {
  if (diagnostics.length > 0) {
    return "unsupported";
  }

  if (matches.some((match) => match.certainty === "definite")) {
    return "definitely-matchable";
  }

  if (matches.some((match) => match.certainty === "possible")) {
    return "possibly-matchable";
  }

  if (matches.some((match) => match.certainty === "unknown-context")) {
    return "only-matches-in-unknown-context";
  }

  return "not-matchable";
}

export function getBranchConfidence(
  diagnostics: SelectorReachabilityDiagnostic[],
  matches: SelectorBranchMatch[],
): AnalysisConfidence {
  if (diagnostics.length > 0) {
    return "low";
  }

  if (matches.some((match) => match.certainty === "definite")) {
    return "high";
  }

  if (matches.length > 0) {
    return "medium";
  }

  return "high";
}
