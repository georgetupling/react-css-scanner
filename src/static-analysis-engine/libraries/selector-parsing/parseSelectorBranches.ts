import { parseSelectorBranch } from "./parseSelectorBranch.js";
import { splitTopLevelSelectorList } from "./splitTopLevelSelectorList.js";
import type { ParsedSelectorBranch } from "./types.js";

export function parseSelectorBranches(selectorText: string): ParsedSelectorBranch[] {
  const branches = splitTopLevelSelectorList(selectorText);
  const parsedBranches: ParsedSelectorBranch[] = [];

  for (const branch of branches) {
    const parsedBranch = parseSelectorBranch(branch);
    if (parsedBranch) {
      parsedBranches.push(parsedBranch);
    }
  }

  return parsedBranches;
}
