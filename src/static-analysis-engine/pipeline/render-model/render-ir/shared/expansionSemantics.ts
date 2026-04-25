export const COMPONENT_DEFINITION_NOT_FOUND_REASON = "component-definition-not-found";

export const EXPANSION_SCOPES = {
  sameFile: "same-file",
  crossFile: "cross-file",
} as const;

export const UNSUPPORTED_PARAMETER_BINDING_REASONS = {
  multipleParameters: "multiple-parameters",
  unsupportedDestructuredBinding: "unsupported-destructured-binding",
  unsupportedDestructuredPropertyName: "unsupported-destructured-property-name",
  destructuredDefaultValues: "destructured-default-values",
  unsupportedParameterPattern: "unsupported-parameter-pattern",
} as const;

export type UnsupportedParameterBindingReason =
  (typeof UNSUPPORTED_PARAMETER_BINDING_REASONS)[keyof typeof UNSUPPORTED_PARAMETER_BINDING_REASONS];

export type ExpansionScope = (typeof EXPANSION_SCOPES)[keyof typeof EXPANSION_SCOPES];

export type ComponentExpansionReason =
  | typeof COMPONENT_DEFINITION_NOT_FOUND_REASON
  | `${ExpansionScope}-component-expansion-cycle`
  | `${ExpansionScope}-component-expansion-budget-exceeded`
  | `${ExpansionScope}-component-expansion-unsupported-props`
  | `${ExpansionScope}-component-expansion-children-not-consumed`
  | `${ExpansionScope}-component-expansion-unsupported:${UnsupportedParameterBindingReason}`;

export type HelperExpansionReason =
  | `${ExpansionScope}-helper-expansion-cycle`
  | `${ExpansionScope}-helper-expansion-budget-exceeded`
  | `${ExpansionScope}-helper-expansion-unsupported-arguments`;

export function getExpansionScope(currentFilePath: string, targetFilePath: string): ExpansionScope {
  return currentFilePath === targetFilePath
    ? EXPANSION_SCOPES.sameFile
    : EXPANSION_SCOPES.crossFile;
}

export function buildComponentExpansionReason(
  scope: ExpansionScope,
  reason: "cycle" | "budgetExceeded" | "unsupportedProps" | "childrenNotConsumed",
): ComponentExpansionReason {
  switch (reason) {
    case "cycle":
      return `${scope}-component-expansion-cycle`;
    case "budgetExceeded":
      return `${scope}-component-expansion-budget-exceeded`;
    case "unsupportedProps":
      return `${scope}-component-expansion-unsupported-props`;
    case "childrenNotConsumed":
      return `${scope}-component-expansion-children-not-consumed`;
  }
}

export function buildHelperExpansionReason(
  scope: ExpansionScope,
  reason: "cycle" | "budgetExceeded" | "unsupportedArguments",
): HelperExpansionReason {
  switch (reason) {
    case "cycle":
      return `${scope}-helper-expansion-cycle`;
    case "budgetExceeded":
      return `${scope}-helper-expansion-budget-exceeded`;
    case "unsupportedArguments":
      return `${scope}-helper-expansion-unsupported-arguments`;
  }
}

export function buildUnsupportedParameterExpansionReason(
  scope: ExpansionScope,
  reason: UnsupportedParameterBindingReason,
): ComponentExpansionReason {
  return `${scope}-component-expansion-unsupported:${reason}`;
}
