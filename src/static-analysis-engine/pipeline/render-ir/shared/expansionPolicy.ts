export const MAX_LOCAL_COMPONENT_EXPANSION_DEPTH = 2;
export const MAX_LOCAL_HELPER_EXPANSION_DEPTH = 3;

export const LOCAL_COMPONENT_EXPANSION_REASONS = {
  definitionNotFound: "same-file-component-definition-not-found",
  cycle: "same-file-component-expansion-cycle",
  budgetExceeded: "same-file-component-expansion-budget-exceeded",
  unsupportedProps: "same-file-component-expansion-unsupported-props",
  childrenNotConsumed: "same-file-component-expansion-children-not-consumed",
} as const;

export const LOCAL_HELPER_EXPANSION_REASONS = {
  cycle: "same-file-helper-expansion-cycle",
  budgetExceeded: "same-file-helper-expansion-budget-exceeded",
  unsupportedArguments: "same-file-helper-expansion-unsupported-arguments",
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

export type SameFileComponentExpansionReason =
  | (typeof LOCAL_COMPONENT_EXPANSION_REASONS)[keyof typeof LOCAL_COMPONENT_EXPANSION_REASONS]
  | `same-file-component-expansion-unsupported:${UnsupportedParameterBindingReason}`;

export type SameFileHelperExpansionReason =
  (typeof LOCAL_HELPER_EXPANSION_REASONS)[keyof typeof LOCAL_HELPER_EXPANSION_REASONS];

export function buildUnsupportedParameterExpansionReason(
  reason: UnsupportedParameterBindingReason,
): SameFileComponentExpansionReason {
  return `same-file-component-expansion-unsupported:${reason}`;
}
