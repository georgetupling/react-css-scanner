# Bundler Smoke Fixtures

These fixtures are for optional build-backed smoke tests. They are not part of the normal
`npm test` path.

Install fixture dependencies before running the smoke lane:

```bash
npm --prefix test/fixtures/bundlers/vite-default install
npm --prefix test/fixtures/bundlers/vite-css-code-split-false install
npm test
```

The smoke tests run real bundler builds, inspect emitted manifests/assets, and compare that
runtime CSS behavior with `scan-react-css` findings.
