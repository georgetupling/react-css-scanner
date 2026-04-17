# Testing Plan

## Purpose

This document proposes a testing strategy for `react-css-scanner`.

The goal is to balance:

- fast feedback from unit tests
- realistic confidence from integration tests
- deterministic project fixtures
- performance monitoring

## Testing philosophy

The scanner is only as trustworthy as its behavior on realistic project structures.

Unit tests are necessary for correctness of small pieces, but the real value comes from integration tests that exercise:

- file discovery
- config loading
- source parsing
- CSS parsing
- graph construction
- reachability analysis
- rule execution
- reporting

So the test strategy should be intentionally integration-heavy.

## Test layers

The project should have four main test layers:

1. unit tests
2. model/pipeline tests
3. integration tests with generated fake projects
4. performance tests

## 1. Unit tests

Unit tests should cover small deterministic pieces with minimal filesystem setup.

### Good unit-test targets

- config parsing and normalization
- config precedence resolution
- path and glob normalization
- import parsing helpers
- CSS selector/class extraction
- class-composition parsing
- `classnames` and `clsx` helper handling
- CSS Module reference extraction
- rule-specific predicate logic
- finding formatting and policy-threshold logic

### Unit-test goals

- very fast
- easy to debug
- narrow failure surface

These should not try to prove the whole scanner works end to end.

## 2. Model / pipeline tests

These sit between unit and integration tests.

They should construct small synthetic file trees and assert on intermediate outputs such as:

- extracted file facts
- project graph
- reachability model
- derived indexes

### Why this layer matters

When an integration test fails, it is much easier to debug if there are also tests for:

- "did we parse the imports correctly?"
- "did we build the graph correctly?"
- "did we compute reachability correctly?"

Without this layer, failures become too opaque.

## 3. Integration tests

This is the highest-value layer.

Integration tests should run the scanner against generated fake React projects with realistic layouts and assert on:

- findings
- confidence levels
- rule IDs
- severity
- JSON output
- exit codes

## Recommendation: generated fixture projects

Your instinct is good: use a project builder/generator rather than manually maintaining dozens of brittle fixture folders.

The best approach is:

- keep a small number of hand-written baseline templates
- generate scenario-specific projects from those templates inside tests
- run the scanner against the generated project directory

This gives you:

- realism
- deterministic inputs
- low maintenance
- composable scenarios

## Proposed test project builder

The builder should create temporary React-like projects in a temp directory.

Conceptually:

```ts
const project = await createTestProject()
  .withTemplate("basic-react-app")
  .withGlobalCssFromFile("minimal-global.css")
  .withSourceFileFromFile("src/components/Button.tsx", "Button.tsx")
  .withCssFileFromFile("src/components/Button.css", "Button.css")
  .build();
```

The exact API can differ, but the important properties are:

- deterministic
- composable
- readable in tests
- capable of expressing realistic layouts

## Recommended builder pattern

Use one consistent builder pattern:

- start from a small baseline template
- compose scenarios by adding files or importing them from test resources
- allow direct file overrides when a test needs something custom

This is usually more maintainable than trying to encode every scenario as a named preset method.

### Recommended style

```ts
const project = await createTestProject()
  .withTemplate("basic-react-app")
  .withGlobalCssFromFile("minimal-global.css")
  .withSourceFileFromFile("src/pages/HomePage.tsx", "HomePage.tsx")
  .withCssFileFromFile("src/pages/HomePage.css", "HomePage.css")
  .build();
```

## Recommended builder capabilities

The builder should support:

- choosing a baseline template
- adding source files
- adding CSS files
- adding source files from resource files
- adding CSS files from resource files
- adding external CSS imports
- adding config files
- toggling CSS Modules
- toggling `classnames` / `clsx` usage
- overriding individual files directly

### Resource-file support

The builder should support loading test content from a resources directory.

Example style:

- `.withGlobalCssFromFile("minimal-global.css")`
- `.withSourceFileFromFile("src/pages/HomePage.tsx", "HomePage.tsx")`
- `.withCssFileFromFile("src/pages/HomePage.css", "HomePage.css")`

This keeps test code concise while allowing the fixture content to look like realistic project files.

## Baseline templates

Start with a small number of realistic templates:

- `basic-react-app`
- `react-app-with-global-css`
- `react-app-with-css-modules`
- `react-app-with-external-css`

These do not need to be full runnable apps.

They only need realistic file layout and import patterns for the scanner.

## Suggested test scenarios

Integration coverage should include:

- direct local CSS import works
- missing class is reported
- unused class is reported
- unreachable CSS usage is reported
- configured global CSS is reachable everywhere
- external imported CSS is parsed and contributes definitions
- unimported dependency CSS is ignored
- CSS Modules avoid false positives
- dynamic array composition yields expected confidence
- template-literal composition yields expected confidence
- `classnames` usage is understood
- `clsx` usage is understood
- config from project root is loaded
- global config is used only when local config is absent
- `--config` overrides discovery
- policy exit code fails on configured severity

## Integration execution model

For the main integration suite:

- generate project files into temp directories
- run the scanner directly against those directories
- assert on structured output

This should be the default path because it is fast, deterministic, and close to how the scanner actually works.

## Golden-output tests

For some integration scenarios, it may be useful to snapshot:

- JSON findings
- summary output

Use this selectively.

Golden tests are valuable for:

- stable reporting output
- regression detection on scanner behavior

But they should not become the only assertion style, because giant snapshots become noisy and hard to review.

## Builder scope

The builder should stay file-oriented.

It should not primarily model tests in terms of abstract helpers such as:

- `withRuleViolation("...")`

That approach becomes too magical and hides the scenario structure.

Better:

- represent scenarios through files, imports, CSS, and config
- add a few high-value convenience helpers like `withGlobalCssFromFile(...)`

## Determinism requirements

Generated test projects must be deterministic.

That means:

- no network access
- no dependency installation required for most tests
- fixed filenames and stable content
- stable ordering in output where possible

This is especially important for CI reliability.

## Suggested integration test structure

Example structure:

```text
test/
  unit/
  model/
  integration/
    fixtures/
      templates/
    builders/
      TestProjectBuilder.ts
    scenarios/
      missing-css-class.test.ts
      unreachable-css.test.ts
      css-modules.test.ts
      external-css.test.ts
      config-resolution.test.ts
  performance/
```

## Performance testing

Performance should be measured, not guessed.

The scanner probably will not be outrageously CPU-intensive, but it will still benefit from monitoring as features expand.

### Performance goals

- catch obvious regressions
- monitor scan time growth
- monitor memory growth
- identify unexpectedly expensive parsing or graph steps

### Recommended performance tests

Start with lightweight benchmarks against synthetic projects of increasing size:

- small project
- medium project
- large project

Each benchmark should record:

- total scan duration
- time by major pipeline stage if available
- number of files scanned
- number of class references
- number of class definitions

### Practical approach

Do not make performance tests hard fail on tiny fluctuations.

Instead:

- run benchmark-style tests in a separate suite
- store historical results in CI artifacts if useful
- add alert thresholds only for meaningful regressions

## Suggested first implementation order for testing

1. unit tests for config and parsing helpers
2. model tests for graph and reachability outputs
3. integration tests using generated temp projects
4. a few smoke tests for CLI output and exit codes
5. performance benchmarks

## Design summary

The recommended testing strategy is:

- unit tests for small pure logic
- pipeline/model tests for intermediate representations
- integration-heavy testing using generated fake React projects
- performance monitoring through benchmarks and stage timing

The test project builder idea is strong, but it should generate deterministic file trees rather than depend on heavyweight full app bootstrapping for every test.
