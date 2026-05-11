import type { CssStyleRuleFact } from "../../types/css.js";
import { extractCssTreeStyleRules, extractCssTreeStylesheetFacts } from "./cssTreeParser.js";

export function extractCssStyleRules(input: {
  cssText: string;
  filePath?: string;
}): CssStyleRuleFact[] {
  return extractCssTreeStyleRules(input);
}

export function extractCssStylesheetFacts(input: {
  cssText: string;
  filePath?: string;
}): ReturnType<typeof extractCssTreeStylesheetFacts> {
  return extractCssTreeStylesheetFacts(input);
}
