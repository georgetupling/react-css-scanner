import type { CssSelectorBranchFact } from "../facts/types.js";
import {
  parseSelectorBranches,
  projectToCssSelectorBranchFact,
} from "../libraries/selector-parsing/index.js";

export function extractSelectorBranchFacts(selectorText: string): CssSelectorBranchFact[] {
  return parseSelectorBranches(selectorText).map(projectToCssSelectorBranchFact);
}
