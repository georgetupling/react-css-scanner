# Rules Design

## Purpose

This document describes the current rule catalog for `react-css-scanner` and keeps a few near-term future candidates visible without treating them as implemented behavior.

## Rule design principles

- Rules must have stable IDs.
- Rules may belong to a rule family for readability.
- Severity and confidence are separate concerns.
- A high-severity rule may still produce a low-confidence finding.
- The scanner should prefer a smaller, coherent rule set over a large but fuzzy one.

## Severity scale

Suggested default severity meanings:

- `error`: should typically fail CI by default
- `warning`: important, but not necessarily build-breaking by default
- `info`: advisory or optimization-oriented

## Legacy baseline

The product preserves the intent of the earlier Loremaster-style audit while using a more explicit rule model and reachability-aware analysis.

## Rule families

- `definition-and-usage-integrity`
- `ownership-and-organization`
- `dynamic-analysis`
- `css-modules`
- `external-css`
- `optimization-and-migration`

## Implemented rules

### Tier 1

- `missing-css-class` - `error`
- `unreachable-css` - `error`
- `unused-css-class` - `warning`
- `component-style-cross-component` - `warning`
- `global-css-not-global` - `info`
- `utility-class-replacement` - `info`
- `dynamic-class-reference` - `warning`
- `missing-css-module-class` - `error`

### Tier 2

- `page-style-used-by-single-component` - `info`
- `dynamic-missing-css-class` - `warning`
- `unused-css-module-class` - `warning`
- `missing-external-css-class` - `error`
- `duplicate-css-class-definition` - `warning`
- `component-css-should-be-global` - `info`

## Rule notes

### Definition and usage integrity

These rules answer whether a class is defined, used, and reachable where it is referenced.

- `missing-css-class`: a class referenced by React code has no matching reachable definition in project CSS or imported external CSS
- `unused-css-class`: a class is defined in CSS but has no convincing usage
- `unreachable-css`: a referenced class exists, but not in CSS that is reachable for the module using it

### Ownership and organization

These rules look at whether CSS appears to live in the right scope.

- `component-style-cross-component`: component-local CSS is used outside its intended boundary
- `page-style-used-by-single-component`: page-level CSS effectively serves one component and may belong closer to that component
- `global-css-not-global`: configured global CSS is only used in a narrow scope
- `component-css-should-be-global`: supposedly local CSS appears broadly shared enough to be global

### Dynamic analysis

These rules capture uncertainty explicitly instead of falling back to a vague manual-review bucket.

- `dynamic-class-reference`: class usage is dynamic and cannot be fully proven statically
- `dynamic-missing-css-class`: a likely dynamic class usage cannot be matched to a known definition

### CSS Modules

- `missing-css-module-class`: a referenced CSS Module property does not correspond to a class in the imported module file
- `unused-css-module-class`: a class defined in a CSS Module file appears unused by the importing module or modules

### External CSS

- `missing-external-css-class`: a class appears intended to come from imported external CSS, but cannot be found in the imported external stylesheets

### Optimization and migration

- `utility-class-replacement`: a custom class may be replaceable with configured utility CSS already available in the project
- `duplicate-css-class-definition`: the same class name is defined in multiple places in a way that is likely confusing or redundant

## Known future candidates

These are not currently implemented:

- `component-css-file-convention`
- `dynamic-css-module-reference`
- `unused-external-css-import`
- `repeated-style-pattern`
