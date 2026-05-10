import type { CssStyleRuleFact } from "../../types/css.js";
import { extractCssTreeStyleRules } from "./cssTreeParser.js";

export function extractCssStyleRules(input: {
  cssText: string;
  filePath?: string;
}): CssStyleRuleFact[] {
  return extractCssTreeStyleRules(input);
}
