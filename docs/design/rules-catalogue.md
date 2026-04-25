# Rules Catalogue

## Purpose

This document defines the target reboot rule catalogue.

The catalogue should stay centered on what this project can uniquely analyze:

- whether CSS references are valid
- whether CSS can actually reach the render context that uses it
- whether styles appear to live in the right project location
- whether selectors are satisfiable against known React render structure
- where static analysis became uncertain

This is not intended to become a generic Stylelint replacement.

## Severity Levels

Rules use the following severities:

- `debug`: diagnostic detail for analysis authors or deep troubleshooting
- `info`: useful context that does not usually require immediate action
- `warn`: likely issue or maintainability problem
- `error`: likely correctness issue

Severity and confidence are separate. A rule can be high severity but low confidence if analysis was bounded or uncertain.

## Initial Rule Set

The initial catalogue should be small enough to implement coherently and large enough to define the product.

### Definition And Usage Integrity

#### `missing-css-class`

Default severity: `error`

Triggers when a statically known class reference has no matching reachable project CSS definition, CSS Module export, or declared external provider match.

Meaning:

- the component references a class that the scanner cannot find in any stylesheet that can apply to that usage site
- this usually means a typo, deleted class, missing import, or missing stylesheet

Config:

- may support ignore patterns for generated class names
- may support configured global providers
- should respect CSS Module and external CSS configuration when those systems exist

#### `conditionally-missing-css-class`

Default severity: `warn`

Triggers when a class reference is only missing in some statically known conditional branches.

Meaning:

- at least one possible class value has a reachable definition
- at least one other possible class value does not
- this often points to an incomplete variant or conditional state

Config:

- may support ignore patterns for variant prefixes
- should share dynamic-analysis budget settings with class expression analysis

#### `unused-css-class`

Default severity: `warn`

Triggers when a project CSS class definition has no known reference from a reachable source or selector context.

Meaning:

- the class is defined but appears unused by the analyzed React project
- it may be dead CSS, or it may be referenced dynamically beyond current analysis

Config:

- should support ignore patterns for public/global classes
- should support configured global stylesheets
- should support an option to exclude external CSS from unused checks

#### `css-class-unreachable`

Default severity: `error`

Triggers when a matching class definition exists, but no stylesheet containing that definition is reachable from the usage context.

Meaning:

- the class exists somewhere in the project
- the relevant component or render path does not import or inherit the stylesheet that defines it
- this usually means a missing import or incorrect stylesheet placement

Config:

- should use configured project-wide/global stylesheets
- should not rely on render-tree ancestry heuristics unless explicitly enabled

#### `missing-css-module-class`

Default severity: `error`

Triggers when a CSS Module member reference, such as `styles.root`, has no matching exported class in the imported CSS Module.

Meaning:

- the module file was imported
- the referenced key does not exist in that module
- this usually means a typo or deleted module class

Config:

- may need CSS Module filename patterns
- uses configured `cssModules.localsConvention` when class export names are transformed

#### `unused-css-module-class`

Default severity: `warn`

Triggers when a CSS Module class is exported by a module file but is never consumed by known imports.

Meaning:

- the class exists in a local module stylesheet
- no analyzed source uses that exported member

Config:

- may need CSS Module filename patterns
- uses configured `cssModules.localsConvention`
- may support ignore patterns for classes consumed by tests, stories, or generated code

#### `missing-external-css-class`

Default severity: `error`

Triggers when a class appears intended to come from external CSS, but no imported external stylesheet or declared provider can satisfy it.

Meaning:

- the source file has external CSS in scope
- a referenced class is not defined by imported external CSS and does not match any declared provider

Config:

- requires external CSS modeling to be enabled
- should support declared providers with class names and class prefixes
- may later support fetched remote stylesheet contents

### Ownership And Architecture

Ownership rules should be convention-aware and conservative by default.

The reboot should prefer relational ownership over the old fixed bucket model. Instead of first asking whether a stylesheet is `component`, `page`, or `global`, these rules should ask:

- where is this class defined?
- where is it used?
- what owner would a maintainer expect from those paths and names?
- is the style too local, too shared, or crossing a boundary?

#### `single-component-style-not-colocated`

Default severity: `info`

Triggers when a class is only used by one component, but its definition is not colocated with that component according to configured or inferred conventions.

Meaning:

- the style behaves like component-local CSS
- the file location suggests it lives elsewhere
- this is a maintainability signal rather than a correctness failure

Config:

- requires or benefits from component-to-stylesheet naming conventions
- may support path conventions such as `Button.tsx` and `Button.css`
- may support component directory conventions such as `Button/index.tsx` and `Button/styles.css`

#### `style-used-outside-owner`

Default severity: `warn`

Triggers when a stylesheet class has a high-confidence single importing component owner, but is
used by another component.

Meaning:

- a local style is leaking across an ownership boundary
- this may make refactors risky because the defining owner does not match the consumers

Config:

- currently requires high-confidence import-based component ownership
- may later support feature root patterns
- may later support allowed cross-owner dependency lists

#### `style-shared-without-shared-owner`

Default severity: `info`

Triggers when a class is used by multiple components, has no high-confidence single importing
component owner, and is not defined in a path that looks intentionally broad.

Meaning:

- the style has become shared in practice
- its file location still suggests a narrower owner

Config:

- currently uses built-in broad path signals such as `shared`, `global`, `common`, `utilities`,
  `design-system`, `theme`, and `tokens`
- may later support configured broad path conventions
- may later support feature-boundary grouping

#### `global-style-only-used-locally`

Default severity: `info`

Triggers when a global stylesheet class is only used by one component or one narrow owner.

Meaning:

- the class may not need to be global
- it may be a candidate for localization into the consuming component or feature

Config:

- requires global stylesheet conventions or explicit global CSS configuration
- may support a minimum age or stability threshold later

### Selector Semantics

#### `unsatisfiable-selector`

Default severity: `warn`

Triggers when a selector cannot match any known renderable structure under bounded analysis.

Meaning:

- the CSS selector exists
- the analyzer cannot find a render path that satisfies its class and relationship requirements
- the selector may be dead or written against a DOM shape that no longer exists

Config:

- should respect render and selector analysis budgets
- may support ignore patterns for selectors intended for external/runtime DOM

#### `compound-selector-never-matched`

Default severity: `warn`

Triggers when a compound selector such as `.button.primary` requires classes that are never observed on the same render node.

Meaning:

- each class may exist independently
- the required combination is never produced by known JSX/class expression paths

Config:

- should use dynamic class confidence
- may support treating possible dynamic combinations as suppressing or lowering confidence

#### `unused-compound-selector-branch`

Default severity: `warn`

Triggers when one branch of a selector list or compound selector appears unused even though other branches may be useful.

Meaning:

- part of a CSS rule may be dead
- the whole declaration block is not necessarily unused

Config:

- may support ignoring broad reset or library selectors

#### `selector-only-matches-in-unknown-contexts`

Default severity: `info`

Triggers when a selector could only match through unresolved render paths, unknown dynamic class values, or unsupported syntax.

Meaning:

- the selector might be valid
- current static analysis cannot prove a concrete known match
- this is mainly an uncertainty signal

Config:

- should use render and dynamic-analysis budget settings
- may be hidden unless verbose diagnostics are enabled

### Dynamic And Diagnostic

#### `dynamic-class-usage`

Default severity: `info`

Triggers when a class expression cannot be reduced to a finite exact or possible set of class names.

Meaning:

- the scanner found class usage that affects CSS analysis
- static analysis cannot fully resolve the expression

Config:

- should support ignore patterns for known helper calls or generated class names
- may support configured class helper libraries such as `clsx` and `classnames`

#### `unsupported-syntax-affecting-analysis`

Default severity: `debug`

Triggers when unsupported syntax affects class extraction, selector analysis, module resolution, render modeling, or reachability.

Meaning:

- the scanner skipped or degraded analysis for a known reason
- downstream findings may have lower confidence

Config:

- should usually be controlled by diagnostic verbosity
- may be emitted as a scan diagnostic rather than a user-facing rule finding

## Future Rule Backlog

These rules are plausible, but should not drive the first implementation wave.

### Definition And Usage

- `unused-external-css-import`: external CSS import has no observed satisfying references
- `unused-external-css-provider`: configured provider is never used
- `orphan-css-file`: stylesheet has no meaningful path to renderable usage
- `dead-css-subtree`: a whole stylesheet region is unreachable or unused
- `css-class-defined-only-in-unreachable-context`: class exists only where it cannot apply

### Ownership And Architecture

- `feature-boundary-style-leak`: CSS from one feature affects another feature
- `page-style-crosses-page-boundary`: page-scoped CSS affects another route/page
- `global-dependency-without-declaration`: component depends on global CSS not declared as global
- `css-ownership-ambiguity`: class has multiple plausible owners
- `deep-ownership-distance`: class is used far from where it is defined

### Selector And Render Semantics

- `selector-fragile-to-render-shape`: selector depends on conditional or unstable wrapper structure
- `contextual-selector-without-context`: required ancestor/context never appears
- `selector-redundant-ancestor`: ancestor portion adds no observed filtering
- `partially-unsatisfiable-selector`: some selector branches can match while others cannot
- `style-for-nonexistent-slot`: selector targets child/slot structure the component never renders

### CSS Modules

- `css-module-import-not-used`: module import exists but none of its members are consumed
- `dynamic-css-module-reference`: module member access cannot be resolved statically
- `css-module-composition-missing-target`: `composes` references a missing class
- `css-module-owner-mismatch`: CSS Module is mostly consumed outside its expected owner

### External CSS

- `external-css-provider-not-declared`: project relies on a provider that is not configured
- `external-class-name-collision`: multiple active external providers define the same class
- `external-css-shadowed-by-local-definition`: local class collides with external class in active scope
- `remote-stylesheet-fetch-failed`: remote CSS could not be fetched
- `remote-stylesheet-version-drift`: fetched stylesheet no longer matches configured provider assumptions

### Cleanup And Abstraction

- `duplicate-class-definition`: same class is defined multiple times in comparable scopes
- `empty-css-rule`: CSS rule has no declarations
- `redundant-css-declaration-block`: two definitions repeat the same declaration block
- `repeated-style-pattern`: repeated declaration pattern suggests extraction
- `utility-class-replacement`: local class can be replaced by configured utility classes
- `semantic-style-duplication`: similar owners and declarations suggest duplicated intent

### Cascade, Layers, And Design Systems

These are likely future rule-pack material because they require stronger cascade, specificity, import-order, layer, or design-token modeling.

- `implicit-cascade-dependency`
- `order-sensitive-style-conflict`
- `component-style-overridden-by-global`
- `selector-specificity-too-high`
- `selector-specificity-conflict`
- `layer-boundary-violation`
- `design-token-bypass`
- `deprecated-style-pattern`

## Implementation Notes

Initial rule implementation should consume `ProjectAnalysis` rather than intermediate engine stages.

Rules should prefer these inputs:

- `entities.classReferences`
- `entities.classDefinitions`
- `entities.stylesheets`
- `relations.referenceMatches`
- `relations.selectorMatches`
- `relations.stylesheetReachability`
- `indexes.definitionsByClassName`
- `indexes.referencesByClassName`
- `indexes.matchesByReferenceId`

If a rule needs to rebuild a project-wide map from raw stage data, that is a signal that `ProjectAnalysis` is missing a relation or index.
