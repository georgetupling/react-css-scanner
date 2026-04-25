# CSS Modules Contract

## Purpose

This document defines the supported CSS Modules surface for the reboot analysis track.

CSS Module syntax and binding discovery belongs in `cssModuleAnalysisStage` and
`pipeline/css-modules`. `ProjectAnalysis` assigns stable ids, connects records to source files and
stylesheet entities, builds member-to-definition match relations, and exposes deterministic indexes
for rules.

Rules should consume CSS Module entities, relations, diagnostics, and indexes directly. They should
not walk parsed source text or rebuild import/member maps.

## Supported Stylesheets

A stylesheet is treated as a CSS Module when its normalized project path ends with:

- `.module.css`

Only project CSS sources that are present in the scan inputs can become CSS Module stylesheets. A
relative import that resolves to a missing or non-module stylesheet is not represented as a CSS
Module import in the current contract.

## Supported Import Forms

The analysis records relative CSS imports that resolve to known `.module.css` stylesheets.

Supported and represented:

```ts
import styles from "./Button.module.css";
import * as styles from "./Button.module.css";
```

These produce `CssModuleImportAnalysis` records with:

- `importKind: "default"` for default imports
- `importKind: "namespace"` for namespace imports
- `localName` set to the local object name used in the source file

Named imports are recorded when the module graph exposes them:

```ts
import { root } from "./Button.module.css";
```

Current behavior is intentionally bounded:

- a named import can appear as a `CssModuleImportAnalysis` record with `importKind: "named"`
- direct use of the imported binding, such as `root`, is not yet represented as a member reference
- named import semantics are not yet used by `missing-css-module-class` or `unused-css-module-class`

Unsupported for now:

- non-relative CSS Module imports
- re-exported CSS Module objects
- imported module objects passed across files
- dynamic import of CSS Modules
- unresolved CSS Module import targets as durable diagnostics

## Supported Member Reference Forms

The analysis supports direct static member reads from a known imported module object:

```ts
styles.root;
styles["root"];
const { root, button: buttonClass } = styles;
```

These produce `CssModuleMemberReferenceAnalysis` records with:

- `accessKind: "property"` for `styles.root`
- `accessKind: "string-literal-element"` for `styles["root"]`
- `accessKind: "destructured-binding"` for supported object binding elements
- `memberName` set to the requested export/member name
- source location, raw expression text, and traces

Supported destructuring is intentionally local and declaration-based:

```ts
const { root } = styles;
const { button: buttonClass } = styles;
```

These also produce `CssModuleDestructuredBindingAnalysis` records that preserve:

- the imported module object name
- the exported member name
- the local binding name
- the source location, raw binding text, and traces

Computed element access is unsupported but diagnosed:

```ts
styles[name];
styles[prefix + "Root"];
const { [name]: root } = styles;
const { ...rest } = styles;
```

These produce `CssModuleReferenceDiagnosticAnalysis` records with:

- `reason: "computed-css-module-member"`
- `reason: "computed-css-module-destructuring"` for computed destructured member names
- `reason: "rest-css-module-destructuring"` for rest bindings
- `reason: "nested-css-module-destructuring"` for nested binding patterns
- source location, raw expression text, and traces

Unsupported for now:

- alias reads, such as `const s = styles; s.root`
- optional chaining, such as `styles?.root`
- passing module objects into helpers and reading members elsewhere

## Export Name Semantics

CSS Module export names are controlled by `cssModules.localsConvention`.

Supported values:

- `asIs`: only the original CSS class name is exported
- `camelCase`: the original CSS class name and a camel-cased variant are exported
- `camelCaseOnly`: only the camel-cased variant is exported

The default is `camelCase`.

Examples:

- with `asIs`, `.foo-bar` is matched by `styles["foo-bar"]`
- with `camelCase`, `.foo-bar` is matched by `styles["foo-bar"]` and `styles.fooBar`
- with `camelCaseOnly`, `.foo-bar` is matched by `styles.fooBar`
- underscore separators use the same transform, so `.foo_bar` can export `fooBar`

For matched relations, `className` preserves the original CSS class name and `exportName` preserves
the requested module member name. This lets rules report the authored selector and the runtime export
name without losing either side of the match.

The transform is intentionally small and bundler-neutral. It does not yet model every
bundler-specific option, generated type file, or escaped CSS identifier behavior.

## Match Relations

`ProjectAnalysis` builds `CssModuleMemberMatchRelation` records for each supported member reference.

Matched references include:

- `referenceId`
- `importId`
- `stylesheetId`
- `definitionId`
- `className`
- `exportName`
- `status: "matched"`
- reasons and traces

Missing references include:

- `referenceId`
- `importId`
- `stylesheetId`
- `className`
- `exportName`
- `status: "missing"`
- reasons and traces

These relations are the source of truth for CSS Module rules:

- `missing-css-module-class` reports missing member relations
- `unused-css-module-class` reports CSS Module class definitions without a matching member relation

## Generic Class Reference Evidence

CSS Module member reads are not currently projected into generic `ClassReferenceAnalysis` records.

That means:

- generic `missing-css-class`, `css-class-unreachable`, and `unused-css-class` do not reason about
  CSS Module member reads through `relations.referenceMatches`
- CSS Module rules use `entities.cssModuleMemberReferences` and
  `relations.cssModuleMemberMatches`
- this avoids double-reporting while the CSS Module-specific rules remain the canonical behavior

Future work may add generic class references with `origin: "css-module-member"` and a CSS
Module-specific reference match kind. That should include an explicit de-duplication policy so users
do not receive both generic and CSS Module-specific findings for the same evidence.

## Diagnostics Behavior

Unsupported CSS Module syntax should be surfaced as debug-level analysis detail when the analyzer can
identify a concrete unsupported pattern.

Currently diagnosed:

- computed member access from a known imported module object
- computed destructured member names from a known imported module object
- rest destructuring from a known imported module object
- nested destructuring from a known imported module object

Not yet diagnosed consistently:

- unsupported named import semantics
- alias reassignment
- unresolved CSS Module import targets
- re-exports
- unsupported `composes` targets

Normal user-facing CSS Module findings should stay focused on supported static evidence. Unsupported
patterns should not create normal findings by default unless the uncertainty itself becomes the
subject of a dedicated diagnostic rule.

## Deliberate Non-Goals For The Current Contract

- no `composes` analysis yet
- no cross-file value-flow tracking for module objects
- no direct named import usage semantics yet
- no projection of CSS Module member reads into generic class references yet
- no bundler-specific CSS Module type inference yet
