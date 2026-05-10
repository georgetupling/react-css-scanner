import { getCssDeclarationPropertyEffects } from "../../libraries/css-parsing/declarationPropertyEffects.js";
import type { CssDeclarationPropertyEffect } from "../../types/css.js";
import type { CssDeclarationAnalysis } from "../project-evidence/index.js";

export type CssPropertyEffect = CssDeclarationPropertyEffect;

export function getCssPropertyEffects(property: string, value: string): CssPropertyEffect[] {
  return getCssDeclarationPropertyEffects({ property, value });
}

export function getCssPropertyEffectsForDeclaration(
  declaration: CssDeclarationAnalysis,
): CssPropertyEffect[] {
  return (
    declaration.propertyEffects ?? getCssPropertyEffects(declaration.property, declaration.value)
  );
}
