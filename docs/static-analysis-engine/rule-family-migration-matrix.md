# Static Analysis Engine Rule-Family Migration Matrix

## Purpose

This document is the parity-first migration matrix for moving the shipped rule
catalog from the current scanner implementation onto the `static-analysis-engine`.

It is the companion to:

- `replacement-readiness-plan.md`
- `current-to-target-map.md`
- `docs/design/rules.md`

Its job is to answer:

- which shipped rules already have meaningful new-engine coverage
- which rules still need migration design
- which rules are likely to need compatibility adapters before full
  new-engine-native replacement
- what validation each rule family needs before cutover

## Scope

This matrix covers the current shipped rule families and rule IDs described in
`docs/design/rules.md`.

It does **not** cover:

- experimental-only new-engine rule IDs that are not part of the shipped
  product contract
- future rule-family redesign work
- speculative new rule ideas

## Decision Baseline

This matrix follows the project decision:

- parity-first with the current shipped rules and families
- redesign later, as separate work

That means the first question for each rule is:

- how do we replace the current shipped behavior?

not:

- how should the rule ideally be redesigned in a future product revision?

## Status Vocabulary

The statuses in this document mean:

- `experimental coverage exists`: the new engine already has a meaningful rule-
  level or comparison-level slice touching this area, but not yet parity
- `migration path visible`: the rule does not yet exist on the new engine, but
  the target owner and likely migration path are clear
- `needs migration design`: the target owner is broadly visible, but parity
  details or product semantics still need a written plan
- `likely compatibility adapter first`: a full new-engine-native rewrite may be
  unnecessary for first replacement; an adapter or staged coexistence path is
  probably the practical first move
- `blocked by capability gap`: replacement is not yet credible without more
  engine capability work

## Family Summary

| Family | Shipped rules | Current new-engine position | Close-out direction |
| --- | --- | --- | --- |
| `definition-and-usage-integrity` | `missing-css-class`, `css-class-missing-in-some-contexts`, `unreachable-css`, `unused-css-class` | Engine capability is highly relevant, but parity rules are not migrated yet | High-priority parity migration family |
| `ownership-and-organization` | `component-style-cross-component`, `page-style-used-by-single-component`, `global-css-not-global`, `component-css-should-be-global` | No meaningful new-engine rule slice yet | Probably adapter-first, then selective native migration |
| `dynamic-analysis` | `dynamic-class-reference`, `dynamic-missing-css-class` | Engine has bounded value-flow support, but no shipped-rule migration yet | Needs migration design after parity contract is written |
| `css-modules` | `missing-css-module-class`, `unused-css-module-class` | No meaningful new-engine rule slice yet, and no first-class CSS-Module semantic layer is published yet | Likely compatibility adapter first, unless a native CSS-Module layer is added before cutover |
| `external-css` | `missing-external-css-class` | First native rule slice now exists on top of imported external CSS, fetch-remote project-wide stylesheets, active declared providers, and native reachability | Native rule path plus explicit first-release runtime adapter for fetch/fallback behavior |
| `optimization-and-migration` | `utility-class-replacement`, `duplicate-css-class-definition`, `empty-css-rule`, `redundant-css-declaration-block`, `unused-compound-selector-branch` | Strongest current new-engine family; several rules already exist experimentally | Best first family for parity-first migration |

## Rule Matrix

| Family | Rule ID | Current production owner | Target new-engine owner | Current status | Notes |
| --- | --- | --- | --- | --- | --- |
| `definition-and-usage-integrity` | `missing-css-class` | old rule engine on `ProjectModel` | `rule-execution` on top of `css-analysis`, `reachability`, `selector-analysis`, and class/value evidence | `migration path visible` | Current feature comparison already shows this rule as a baseline reference point; parity semantics need to be written carefully because the new engine reasons about rendered structure and contextual reachability differently |
| `definition-and-usage-integrity` | `css-class-missing-in-some-contexts` | old rule engine on `ProjectModel` | `rule-execution` on top of `reachability` and selector/context evidence | `migration path visible` | This rule is conceptually close to new-engine `possible` reasoning, but the exact mapping from engine outcomes to shipped finding semantics still needs a written contract |
| `definition-and-usage-integrity` | `unreachable-css` | old rule engine on `ProjectModel` | `rule-execution` on top of `reachability` and CSS-definition evidence | `migration path visible` | Likely one of the best fits for new-engine-native replacement once parity semantics are written |
| `definition-and-usage-integrity` | `unused-css-class` | old rule engine on `ProjectModel` | `rule-execution` on top of `css-analysis`, selector evidence, and bounded usage/reachability evidence | `needs migration design` | New-engine structural reasoning should improve this rule, but the product contract around plain class evidence versus contextual selector evidence must stay aligned with current shipped behavior |
| `ownership-and-organization` | `component-style-cross-component` | old rule engine on `ProjectModel` ownership model | `rule-execution` on top of ownership data plus new-engine reachability/render evidence | `likely compatibility adapter first` | The engine can strengthen evidence, but parity-first replacement does not require immediate redesign of ownership semantics |
| `ownership-and-organization` | `page-style-used-by-single-component` | old rule engine on `ProjectModel` ownership model | `rule-execution` on top of ownership data plus usage/reachability evidence | `likely compatibility adapter first` | Probably practical to preserve current ownership logic first, then decide later how much new-engine evidence should reshape the rule |
| `ownership-and-organization` | `global-css-not-global` | old rule engine on `ProjectModel` ownership model | `rule-execution` on top of ownership data plus usage/reachability evidence | `likely compatibility adapter first` | Parity-first replacement should avoid changing the ownership contract at the same time as engine cutover |
| `ownership-and-organization` | `component-css-should-be-global` | old rule engine on `ProjectModel` ownership model | `rule-execution` on top of ownership data plus usage/reachability evidence | `likely compatibility adapter first` | This rule already depends on thresholded product policy, so adapter-first is likely the safest initial replacement shape |
| `dynamic-analysis` | `dynamic-class-reference` | old rule engine on `ProjectModel` plus class-expression uncertainty | `rule-execution` on top of `abstract-values`, render/value uncertainty, and explicit unknown outcomes | `needs migration design` | The new engine has stronger bounded reasoning, so the parity question is product-facing: when should uncertainty still become a shipped dynamic finding? |
| `dynamic-analysis` | `dynamic-missing-css-class` | old rule engine on `ProjectModel` plus dynamic matching heuristics | `rule-execution` on top of `abstract-values`, CSS-definition evidence, and bounded unknown/possible outcomes | `needs migration design` | This likely needs explicit policy mapping so the new engine does not silently over-report or under-report dynamic missing cases |
| `css-modules` | `missing-css-module-class` | old CSS Modules rule engine path | likely `rule-execution` with dedicated CSS Module analysis inputs, or compatibility adapter | `likely compatibility adapter first` | The current new engine does not yet expose a first-class CSS-Module semantic layer comparable to the shipped implementation's import/property model |
| `css-modules` | `unused-css-module-class` | old CSS Modules rule engine path | likely `rule-execution` with dedicated CSS Module usage inputs, or compatibility adapter | `likely compatibility adapter first` | Same parity-first logic as above; do not block engine cutover on full CSS Modules redesign if an explicit adapter keeps the product contract stable, unless a native CSS-Module layer is added first |
| `external-css` | `missing-external-css-class` | old external CSS rule engine path | `rule-execution` on top of `external-css`, `reachability`, and bounded class/value evidence, with runtime fetch/fallback behavior adapter-backed in the first release | `experimental coverage exists` | The current new engine can now classify external CSS imports in the module graph, propagate directly imported and fetch-remote project-wide external CSS through native reachability, publish active declared providers through `externalCssSummary`, emit a first native `missing-external-css-class` rule slice, and compare that slice against the current scanner; the remaining first-release adapter boundary is runtime-specific fetch/fallback behavior rather than rule semantics |
| `optimization-and-migration` | `utility-class-replacement` | old optimization rule engine path | `rule-execution` on top of CSS-definition analysis and configured utility catalogs | `needs migration design` | The new engine can likely support this later, but it is not currently part of the experimental rule slice and may not need to be first-wave |
| `optimization-and-migration` | `duplicate-css-class-definition` | old optimization rule engine path | `rule-execution` on top of `css-analysis` | `experimental coverage exists` | Already implemented experimentally in the new engine and covered by comparison tests |
| `optimization-and-migration` | `empty-css-rule` | old optimization rule engine path | `rule-execution` on top of `css-analysis` | `experimental coverage exists` | Already implemented experimentally in the new engine and covered by comparison tests |
| `optimization-and-migration` | `redundant-css-declaration-block` | old optimization rule engine path | `rule-execution` on top of `css-analysis` | `experimental coverage exists` | Already implemented experimentally in the new engine and covered by comparison tests |
| `optimization-and-migration` | `unused-compound-selector-branch` | old optimization rule engine path | `rule-execution` on top of `selector-analysis` and CSS-derived selector evidence | `experimental coverage exists` | Already implemented experimentally in the new engine and compared directly against the current scanner |

## Experimental-To-Shipped Mapping Notes

The current experimental new-engine rule IDs are **not** the shipped contract.

They currently serve two roles:

- proof that the engine can support rule execution
- comparison scaffolding for parity planning

Important examples:

- `duplicate-css-class-definition`, `empty-css-rule`,
  `redundant-css-declaration-block`, and `unused-compound-selector-branch`
  already overlap directly with shipped rules
- `selector-never-satisfied`, `selector-possibly-satisfied`,
  `selector-analysis-unsupported`, and
  `contextual-selector-branch-never-satisfied` are useful migration signals, but
  they are not shipped rule IDs today

Those selector-derived experimental rules should be treated as:

- evidence and scaffolding for migrating shipped
  `definition-and-usage-integrity` behavior
- not as automatic additions to the shipped product contract

## Family-Level Validation Expectations

### `definition-and-usage-integrity`

Needed before cutover:

- wrapper and ancestor-route scenarios
- partial-context reachability scenarios
- direct match, possible match, unknown barrier, and unavailable stylesheet cases
- comparison review against current scanner findings, including intentional
  divergences

### `ownership-and-organization`

Needed before cutover:

- parity checks against existing ownership heuristics
- explicit decision on whether first replacement uses adapter-first semantics or
  immediate new-engine-native evidence

### `dynamic-analysis`

Needed before cutover:

- exact versus unresolved class-value scenarios
- imported helper and imported constant scenarios
- explicit mapping of bounded unknown outcomes into shipped dynamic findings

### `css-modules`

Needed before cutover:

- explicit decision on adapter-first versus native migration
- either a first-class CSS-Module semantic layer or a deliberate compatibility
  boundary
- stable parity checks for import resolution and unused-definition behavior

### `external-css`

Needed before cutover:

- keep the native rule path for `missing-external-css-class`
- keep runtime-specific fetch-remote retrieval, failure fallback, and
  operational-warning shaping adapter-backed in the first replacement release
- parity checks for directly imported, declared-global/provider, and fetch-
  remote behavior
- explicit coverage for unavailable or fallback external stylesheet paths where
  the product contract still expects a deliberate finding or warning shape

### `optimization-and-migration`

Needed before cutover:

- direct parity and comparison review for the experimentally migrated rules
- separate migration decision for `utility-class-replacement`

## Recommended Migration Order

The best parity-first order looks like this:

1. `optimization-and-migration`
2. `definition-and-usage-integrity`
3. `dynamic-analysis`
4. `ownership-and-organization`
5. `css-modules`
6. `external-css`

Why this order:

- the optimization family already has the strongest new-engine-native rule slice
- definition/usage integrity is where the engine’s structural advantages matter
  most
- dynamic-analysis is closely related to bounded value reasoning and should be
  planned after the main definition/usage contract
- ownership, CSS Modules, and external CSS are more likely to need adapter-
  first cutover decisions

## Concrete Next Steps

The next steps that follow directly from this matrix are:

1. use `replacement-acceptance-criteria-checklist.md` and
   `cutover-and-old-engine-retirement-checklist.md` to turn first-wave family
   decisions into explicit ship/no-ship gates
2. write the parity contract for the
   `definition-and-usage-integrity` family, especially:
   - how `possible` and `unknown` engine outcomes map to shipped findings
   - how contextual selector evidence should and should not satisfy plain class
     checks
3. decide explicitly which families are adapter-first for initial replacement:
   - likely `ownership-and-organization`
   - likely `css-modules`
   - `external-css` now has a visible native path, but the first-release
     adapter decision still needs to be written down
4. add targeted per-family cutover checklists where the global checklists are
   still too broad, starting with `optimization-and-migration`
5. extend replacement validation so comparison is organized around these family
   decisions rather than only around isolated exploratory scenarios

## Open Questions

These are not blocking ambiguities for this matrix, but they do require later
 decisions:

- whether `utility-class-replacement` belongs in the first parity wave or a
  later optimization follow-on
- whether ownership-family rules should remain adapter-backed for the entire
  first cutover
- whether CSS Modules should stay on compatibility adapters through the first
  replacement release instead of waiting for a native CSS-Module semantic layer

## Summary

This matrix makes the current state explicit:

- the new engine is strongest today in the
  `optimization-and-migration` family
- the most important parity-first migration family is
  `definition-and-usage-integrity`
- ownership and CSS Modules are still the strongest compatibility-first
  candidates, while external CSS now has a meaningful native path that still
  needs explicit cutover validation

That gives the project a concrete path to replacement without mixing it with a
future rule/family redesign effort.
