import type { CssSelectorBranchFact } from "../../types/css.js";
import type { ParsedSelectorBranch } from "./types.js";

export function projectToCssSelectorBranchFact(
  parsedBranch: ParsedSelectorBranch,
): CssSelectorBranchFact {
  return {
    raw: parsedBranch.raw,
    matchKind: parsedBranch.matchKind,
    subjectClassNames: [...parsedBranch.subjectClassNames],
    requiredClassNames: [...parsedBranch.requiredClassNames],
    contextClassNames: [...parsedBranch.contextClassNames],
    negativeClassNames: [...parsedBranch.negativeClassNames],
    hasCombinators: parsedBranch.hasCombinators,
    hasSubjectModifiers: parsedBranch.hasSubjectModifiers,
    hasUnknownSemantics: parsedBranch.hasUnknownSemantics,
  };
}
