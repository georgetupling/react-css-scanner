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
import { root, button as buttonClass } from "./Button.module.css";
```

These produce `CssModuleImportAnalysis` records with:

- `importKind: "default"` for default imports
- `importKind: "namespace"` for namespace imports
- `importKind: "named"` for named imports
- `importedName` set to `default`, `*`, or the requested named export
- `localName` set to the local object name used in the source file

Default and namespace imports are object imports. They support member reads, destructuring, and
simple aliases:

```ts
import styles from "./Button.module.css";
styles.root;

import * as moduleStyles from "./Button.module.css";
moduleStyles.root;
```

Named imports are direct member bindings:

```ts
import { root, button as buttonClass } from "./Button.module.css";
```

These produce `CssModuleNamedImportBindingAnalysis` records and `CssModuleMemberReferenceAnalysis`
records with `accessKind: "named-import"`. The exported member name is matched against CSS class
definitions using the configured `localsConvention`; the local binding name is preserved for traces.

Named import support is a static source contract. It means the analyzer understands the syntax when
it appears in source; it does not imply every bundler supports named CSS Module imports at runtime.

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
const s = styles;
s.root;
const { root, button: buttonClass } = styles;
import { root } from "./Button.module.css";
```

These produce `CssModuleMemberReferenceAnalysis` records with:

- `accessKind: "property"` for `styles.root`
- `accessKind: "string-literal-element"` for `styles["root"]`
- `accessKind: "destructured-binding"` for supported object binding elements
- `accessKind: "named-import"` for supported named import bindings
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

Supported aliases are intentionally local and declaration-based:

```ts
const s = styles;
s.root;
```

These produce `CssModuleAliasAnalysis` records that preserve:

- the imported module object name
- the local alias name
- the source location, raw declaration text, and traces

Member references through a simple alias still point back to the original CSS Module import, so rules
do not need to distinguish `styles.root` from `s.root`.

Computed element access is unsupported but diagnosed:

```ts
styles[name];
styles[prefix + "Root"];
const { [name]: root } = styles;
const { ...rest } = styles;
let s = styles;
```

These produce `CssModuleReferenceDiagnosticAnalysis` records with:

- `reason: "computed-css-module-member"`
- `reason: "computed-css-module-destructuring"` for computed destructured member names
- `reason: "rest-css-module-destructuring"` for rest bindings
- `reason: "nested-css-module-destructuring"` for nested binding patterns
- `reason: "reassignable-css-module-alias"` for aliases declared with reassignable bindings
- `reason: "self-referential-css-module-alias"` for self-referential alias declarations
- source location, raw expression text, and traces

Unsupported for now:

- optional chaining, such as `styles?.root`
- passing module objects into helpers and reading members elsewhere
- chained aliases, such as `const s = styles; const t = s`
- alias reassignment after declaration

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

CSS Module member reads are projected into generic `ClassReferenceAnalysis` records with
`origin: "css-module-member"`.

Projected references include:

- `sourceCssModuleMemberReferenceId` pointing back to the CSS Module member reference
- `definiteClassNames` containing the matched authored class name when the member resolves
- `definiteClassNames` containing the requested member name when the member is missing
- `rawExpressionText`, location, and traces from the CSS Module evidence

`ProjectAnalysis` also emits generic `referenceMatches` with `matchKind: "css-module"` for resolved
CSS Module member references. These matches point at the CSS Module class definition and use
`reachability: "definite"` because module export matching, not stylesheet reachability, establishes
the relation.

The CSS Module-specific entities and relations remain the canonical user-facing evidence for CSS
Module rules:

- CSS Module rules use `entities.cssModuleMemberReferences` and
  `relations.cssModuleMemberMatches`
- generic rules may consume projected class references for shared summaries or broad analysis
- final finding output suppresses generic `missing-css-class` findings when a
  `missing-css-module-class` finding covers the same CSS Module member reference

## Diagnostics Behavior

Unsupported CSS Module syntax should be surfaced as debug-level analysis detail when the analyzer can
identify a concrete unsupported pattern.

Currently diagnosed:

- computed member access from a known imported module object
- computed destructured member names from a known imported module object
- rest destructuring from a known imported module object
- nested destructuring from a known imported module object
- reassignable aliases from a known imported module object
- self-referential aliases from a known imported module object

Not yet diagnosed consistently:

- unresolved CSS Module import targets
- re-exports
- unsupported `composes` targets

Normal user-facing CSS Module findings should stay focused on supported static evidence. Unsupported
patterns should not create normal findings by default unless the uncertainty itself becomes the
subject of a dedicated diagnostic rule.

## Deliberate Non-Goals For The Current Contract

- no `composes` analysis yet
- no cross-file value-flow tracking for module objects
- no projection of CSS Module member reads into generic class references yet
- no bundler-specific CSS Module type inference yet
