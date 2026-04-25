import type { CssSelectorBranchFact } from "../../types/css.js";
import { parseSelectorBranches } from "./parseSelectorBranches.js";
import { projectToCssSelectorBranchFact } from "./projectToCssSelectorBranchFact.js";

export function extractSelectorBranchFacts(selectorText: string): CssSelectorBranchFact[] {
  return parseSelectorBranches(selectorText).map(projectToCssSelectorBranchFact);
}
