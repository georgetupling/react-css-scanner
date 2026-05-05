import { TestProjectBuilder } from "../TestProjectBuilder.js";

export async function createManagerUiProject() {
  return new TestProjectBuilder()
    .withTemplate("empty")
    .withFile(
      "package.json",
      JSON.stringify(
        {
          name: "realistic-manager-ui",
          private: true,
          dependencies: {
            "@zesty-io/material": "^0.16.1",
            "@reduxjs/toolkit": "^1.6.0",
            classnames: "^2.3.1",
            react: "^18.0.0",
            "react-dom": "^18.0.0",
            "react-router": "^5.2.0",
            "react-router-dom": "^5.2.0",
          },
          devDependencies: {
            webpack: "^5.39.0",
            "webpack-cli": "^6.0.1",
            "css-loader": "^5.2.6",
            less: "^4.2.0",
            "less-loader": "^12.2.0",
            "mini-css-extract-plugin": "^2.0.0",
            typescript: "^5.9.0",
          },
          scripts: {
            build: "webpack --config src/shell/webpack.config.js",
            start: "webpack serve --config src/shell/webpack.config.js",
          },
        },
        null,
        2,
      ) + "\n",
    )
    .withFile(
      "src/index-content.html",
      [
        "<!doctype html>",
        '<html lang="en">',
        "  <head>",
        '    <meta charset="utf-8" />',
        "    <title>Manager UI</title>",
        "  </head>",
        "  <body>",
        '    <div id="manager-root"></div>',
        "    <%= htmlWebpackPlugin.tags.bodyTags %>",
        "  </body>",
        "</html>",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/index.tsx",
      [
        "import React from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "import '@zesty-io/material/dist/styles.css';",
        "import './styles/global.css';",
        "import { AppShell } from './components/AppShell';",
        "import { createManagerStore } from './store';",
        "import { routes } from './routes';",
        "import { createManagerTheme } from '../theme';",
        "",
        "const store = createManagerStore();",
        "const theme = createManagerTheme('dark');",
        "",
        "createRoot(document.getElementById('manager-root')).render(",
        '  <AppShell store={store} theme={theme} routes={routes} className="manager-root manager-root--ready" />',
        ");",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/bootstrap.ts",
      [
        "export function getRuntimeEnv() {",
        "  return { instanceZUID: '8-abc', userZUID: '5-user' };",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/routes.ts",
      [
        "import { BlocksApp } from '../apps/blocks';",
        "import { ContentApp } from '../apps/content';",
        "",
        "export const routes = [",
        "  { path: '/blocks', label: 'Blocks', component: BlocksApp },",
        "  { path: '/content', label: 'Content', component: ContentApp },",
        "];",
        "",
        "export async function loadAuditPanel() {",
        "  return import('../apps/audit/AuditPanel');",
        "}",
        "",
        "export async function loadPreviewPanel() {",
        "  return import('../apps/active-preview/Preview');",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/store.ts",
      [
        "import { getRuntimeEnv } from './bootstrap';",
        "",
        "export function createManagerStore() {",
        "  const env = getRuntimeEnv();",
        "  return { env, user: { name: 'Manager' } };",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/services/instance.ts",
      [
        "export function useGetContentModelsQuery() {",
        "  return {",
        "    isLoading: false,",
        "    data: [",
        "      { ZUID: '6-block-hero', type: 'block', label: 'Hero Block', updatedAt: '2026-01-01' },",
        "      { ZUID: '6-block-card', type: 'block', label: 'Card Block', updatedAt: '2026-01-02' },",
        "      { ZUID: '6-page-home', type: 'page', label: 'Home Page', updatedAt: '2026-01-03' },",
        "    ],",
        "  };",
        "}",
        "",
        "export function useGetContentItemsQuery() {",
        "  return { isLoading: false, data: [{ ZUID: '7-home', title: 'Home', status: 'published' }] };",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/hooks/useParams.ts",
      [
        "export function useParams() {",
        "  return { modelZUID: '6-block-hero', itemZUID: '7-home' };",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/hooks/useLocalStorageFlag.ts",
      [
        "export function useLocalStorageFlag(_key, initialValue) {",
        "  return [initialValue, () => undefined];",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/utils/classNames.ts",
      [
        "export function cx(...values) {",
        "  return values.filter(Boolean).join(' ');",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/utils/formatDate.ts",
      ["export function formatDate(value) {", "  return value.slice(0, 10);", "}", ""].join("\n"),
    )
    .withSourceFile(
      "src/shell/utils/formatName.ts",
      [
        "export function formatName(value) {",
        "  return value.trim().replace(/\\s+/g, ' ');",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/components/AppShell.tsx",
      [
        "import { AppSidebar } from './AppSidebar';",
        "import { ResizeableContainer } from './ResizeableContainer';",
        "import { ToolbarButton } from './ToolbarButton';",
        "import { cx } from '../utils/classNames';",
        "",
        "export function AppShell({ className, routes, store }) {",
        "  const activeRoute = routes[0];",
        "  const ActiveApp = activeRoute.component;",
        "  return (",
        "    <main className={cx('manager-shell', className)}>",
        '      <ResizeableContainer id="primary-nav">',
        "        <AppSidebar routes={routes} activePath={activeRoute.path} user={store.user} />",
        "      </ResizeableContainer>",
        '      <section className="manager-shell__workspace">',
        '        <header className="manager-toolbar">',
        '          <ToolbarButton icon="sync" label="Sync" className="manager-toolbar__button" />',
        "        </header>",
        "        <ActiveApp />",
        "      </section>",
        "    </main>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/components/AppSidebar.tsx",
      [
        "import { SearchBox } from './SearchBox';",
        "",
        "export function AppSidebar({ routes, activePath, user }) {",
        "  return (",
        '    <aside className="app-sidebar app-sidebar--dark">',
        '      <div className="app-sidebar__account">{user.name}</div>',
        '      <SearchBox value="" placeholder="Filter apps" className="app-sidebar__search" />',
        '      <nav className="app-sidebar__nav">',
        "        {routes.map((route) => (",
        "          <a",
        "            key={route.path}",
        "            href={route.path}",
        "            className={route.path === activePath ? 'app-sidebar__link app-sidebar__link--active' : 'app-sidebar__link'}",
        "          >",
        "            {route.label}",
        "          </a>",
        "        ))}",
        "      </nav>",
        "    </aside>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/components/ResizeableContainer.tsx",
      [
        "export function ResizeableContainer({ id, children }) {",
        '  return <div id={id} className="resizeable-container resizeable-container--locked">{children}</div>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/components/SearchBox.tsx",
      [
        "export function SearchBox({ value, placeholder, className }) {",
        '  return <input className={`search-box ${className || ""}`} value={value} placeholder={placeholder} readOnly />;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/components/ToolbarButton.tsx",
      [
        "export function ToolbarButton({ icon, label, className }) {",
        '  return <button className={`toolbar-button ${className || ""}`} data-icon={icon}>{label}</button>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/shell/components/EmptyState.tsx",
      [
        "export function EmptyState({ title, action }) {",
        '  return <div className="empty-state"><h2 className="empty-state__title">{title}</h2>{action}</div>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/blocks/index.tsx",
      [
        "import './styles/blocks.css';",
        "import { Sidebar } from './components/Sidebar';",
        "import { AllBlocks } from './views/AllBlocks';",
        "import { BlockModel } from './views/BlockModel';",
        "",
        "export function BlocksApp() {",
        "  return (",
        '    <section className="blocks-app blocks-app--mounted">',
        "      <Sidebar />",
        "      <AllBlocks />",
        "      <BlockModel />",
        "    </section>",
        "  );",
        "}",
        "",
        "export { BlockItem } from './views/BlockItem';",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/blocks/views/AllBlocks.tsx",
      [
        "import { useGetContentModelsQuery } from '../../../shell/services/instance';",
        "import { EmptyState } from '../../../shell/components/EmptyState';",
        "import { BlockCard } from '../components/BlockCard';",
        "import { OnboardingDialog } from '../components/OnboardingDialog';",
        "import { useLocalStorageFlag } from '../../../shell/hooks/useLocalStorageFlag';",
        "",
        "export function AllBlocks() {",
        "  const { data: models } = useGetContentModelsQuery();",
        "  const [showTour] = useLocalStorageFlag('manager:blocks:onboarding', true);",
        "  const blocks = models.filter((model) => model.type === 'block');",
        "  return (",
        '    <div className="all-blocks-view">',
        '      <header className="all-blocks-view__header">',
        '        <h1 className="all-blocks-view__title">All Blocks</h1>',
        "      </header>",
        '      {blocks.length === 0 ? <EmptyState title="No blocks" /> : null}',
        '      <div className="block-grid">',
        "        {blocks.map((model) => <BlockCard key={model.ZUID} model={model} />)}",
        "      </div>",
        "      {showTour ? <OnboardingDialog /> : null}",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/blocks/views/BlockModel.tsx",
      [
        "import { CreateVariantDialog } from '../components/CreateVariantDialog';",
        "import { useParams } from '../../../shell/hooks/useParams';",
        "",
        "export function BlockModel() {",
        "  const params = useParams();",
        "  return (",
        '    <article className="block-model-view block-model-view--selected">',
        '      <h2 className="block-model-view__title">Model {params.modelZUID}</h2>',
        "      <CreateVariantDialog open />",
        "    </article>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/blocks/views/BlockItem.tsx",
      [
        "import { useParams } from '../../../shell/hooks/useParams';",
        "",
        "export function BlockItem({ isCreate = false }) {",
        "  const params = useParams();",
        "  const itemClass = isCreate ? 'block-item-view block-item-view--create' : 'block-item-view';",
        "  return <section className={itemClass}>Editing {params.itemZUID}</section>;",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/blocks/components/Sidebar.tsx",
      [
        "import { SearchBox } from '../../../shell/components/SearchBox';",
        "",
        "export function Sidebar() {",
        "  return (",
        '    <aside className="blocks-sidebar">',
        '      <SearchBox value="" placeholder="Filter blocks" className="blocks-sidebar__search" />',
        '      <a className="blocks-sidebar__link blocks-sidebar__link--active" href="/blocks">All Blocks</a>',
        "    </aside>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/blocks/components/BlockCard.tsx",
      [
        "import { formatDate } from '../../../shell/utils/formatDate';",
        "import { formatName } from '../../../shell/utils/formatName';",
        "",
        "export function BlockCard({ model }) {",
        "  return (",
        '    <article className="block-card material-card">',
        '      <h3 className="block-card__title">{formatName(model.label)}</h3>',
        '      <p className="block-card__meta">{formatDate(model.updatedAt)}</p>',
        "    </article>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/blocks/components/CreateVariantDialog.tsx",
      [
        "export function CreateVariantDialog({ open }) {",
        '  return open ? <aside className="variant-dialog variant-dialog--open">Create variant</aside> : null;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/blocks/components/OnboardingDialog.tsx",
      [
        "export function OnboardingDialog() {",
        '  return <aside className="onboarding-dialog">Take the product tour</aside>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/content/index.tsx",
      [
        "import './styles/content.css';",
        "import { ContentNav } from './components/ContentNav';",
        "import { ContentList } from './views/ContentList';",
        "import { ContentItem } from './views/ContentItem';",
        "",
        "export function ContentApp() {",
        "  return (",
        '    <section className="content-app">',
        "      <ContentNav />",
        "      <ContentList />",
        "      <ContentItem />",
        "    </section>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/content/views/ContentList.tsx",
      [
        "import { useGetContentItemsQuery } from '../../../shell/services/instance';",
        "import { ContentRow } from '../components/ContentRow';",
        "",
        "export function ContentList() {",
        "  const { data } = useGetContentItemsQuery();",
        '  return <div className="content-list">{data.map((item) => <ContentRow key={item.ZUID} item={item} />)}</div>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/content/views/ContentItem.tsx",
      [
        "export function ContentItem() {",
        '  return <article className="content-item content-item--dirty"><h2 className="content-item__title">Content item</h2></article>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/content/components/ContentNav.tsx",
      [
        "export function ContentNav() {",
        '  return <nav className="content-nav"><a className="content-nav__link content-nav__link--active">Entries</a></nav>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/content/components/ContentRow.tsx",
      [
        "export function ContentRow({ item }) {",
        "  const statusClass = item.status === 'published' ? 'content-row content-row--published' : 'content-row';",
        '  return <article className={statusClass}><span className="content-row__title">{item.title}</span></article>;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/audit/index.ts",
      [
        "export { AuditPanel as default } from './AuditPanel';",
        "export { AuditRow } from './components/AuditRow';",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/audit/AuditPanel.tsx",
      [
        "import styles from './styles/AuditPanel.module.css';",
        "import { AuditRow } from './components/AuditRow';",
        "",
        "export function AuditPanel() {",
        "  return (",
        "    <section className={styles.panel}>",
        "      <h2 className={styles.title}>Recent activity</h2>",
        '      <AuditRow action="published" />',
        "    </section>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/audit/components/AuditRow.tsx",
      [
        "import styles from '../styles/AuditPanel.module.css';",
        "",
        "export function AuditRow({ action }) {",
        "  return <p className={styles.row}>Entry {action}</p>;",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/apps/active-preview/Preview.tsx",
      [
        "import styles from './Preview.less';",
        "",
        "export function Preview() {",
        "  const frameClass = `${styles.previewFrame} ${styles.previewFrameDevice}`;",
        "  return (",
        "    <section className={`${styles.previewShell} ${styles.previewShellEmpty}`}>",
        "      <header className={styles.previewShellToolbar}>Preview</header>",
        "      <article className={frameClass}>",
        "        <div className={styles.previewFrameChrome} />",
        '        <iframe className={styles.previewFrameContent} title="active preview" />',
        "      </article>",
        "    </section>",
        "  );",
        "}",
        "",
        "export default Preview;",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/theme/index.ts",
      ["export { createManagerTheme } from './createTheme';", ""].join("\n"),
    )
    .withSourceFile(
      "src/theme/createTheme.ts",
      [
        "export function createManagerTheme(mode) {",
        "  return { mode, palette: { primary: '#006cdb' } };",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/utility/request.ts",
      ["export function request(path) {", "  return Promise.resolve({ path });", "}", ""].join(
        "\n",
      ),
    )
    .withSourceFile(
      "src/utility/numberFormatter.ts",
      ["export function formatNumber(value) {", "  return String(value);", "}", ""].join("\n"),
    )
    .withFile(
      "src/shell/webpack.config.js",
      [
        "const path = require('path');",
        "",
        "module.exports = {",
        "  entry: { manager: path.resolve(__dirname, './index.tsx') },",
        "  module: {",
        "    rules: [",
        "      { test: /\\.css$/, use: ['style-loader', 'css-loader'] },",
        "      { test: /\\.less$/, use: ['style-loader', { loader: 'css-loader', options: { modules: true } }, 'less-loader'] },",
        "    ],",
        "  },",
        "};",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/shell/styles/global.css",
      [
        ".manager-root { min-height: 100vh; }",
        ".manager-root--ready { opacity: 1; }",
        ".manager-shell { display: flex; min-height: 100vh; }",
        ".manager-shell__workspace { flex: 1; }",
        ".manager-toolbar { display: flex; justify-content: flex-end; }",
        ".manager-toolbar__button { margin-left: auto; }",
        ".app-sidebar { width: 220px; }",
        ".app-sidebar--dark { background: #172033; color: white; }",
        ".app-sidebar__account { padding: 12px; }",
        ".app-sidebar__search { margin: 8px; }",
        ".app-sidebar__nav { display: grid; }",
        ".app-sidebar__link { color: inherit; }",
        ".app-sidebar__link--active { font-weight: 700; }",
        ".resizeable-container { min-width: 220px; }",
        ".resizeable-container--locked { resize: horizontal; }",
        ".search-box { border: 1px solid #d0d7de; }",
        ".toolbar-button { border: 0; }",
        ".empty-state { padding: 24px; }",
        ".empty-state__title { margin: 0; }",
        ".orphan-manager-utility { display: none; }",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/apps/blocks/styles/blocks.css",
      [
        ".blocks-app { display: grid; grid-template-columns: 220px 1fr 300px; }",
        ".blocks-app--mounted { min-height: 100%; }",
        ".blocks-sidebar { border-right: 1px solid #d8dee4; }",
        ".blocks-sidebar__search { width: calc(100% - 16px); }",
        ".blocks-sidebar__link { display: block; }",
        ".blocks-sidebar__link--active { background: #eef4ff; }",
        ".all-blocks-view { padding: 24px; }",
        ".all-blocks-view__header { display: flex; }",
        ".all-blocks-view__title { font-size: 20px; }",
        ".block-grid { display: flex; flex-wrap: wrap; gap: 16px; }",
        ".block-card { padding: 16px; }",
        ".block-card__title { margin: 0; }",
        ".block-card__meta { color: #57606a; }",
        ".block-model-view { padding: 24px; }",
        ".block-model-view--selected { outline: 1px solid #006cdb; }",
        ".block-model-view__title { font-size: 18px; }",
        ".block-item-view { padding: 24px; }",
        ".block-item-view--create { background: #f6f8fa; }",
        ".variant-dialog { position: fixed; }",
        ".variant-dialog--open { display: block; }",
        ".onboarding-dialog { position: fixed; }",
        ".stale-block-helper { color: tomato; }",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/apps/content/styles/content.css",
      [
        ".content-app { display: grid; grid-template-columns: 220px 1fr 360px; }",
        ".content-nav { border-right: 1px solid #d8dee4; }",
        ".content-nav__link { display: block; }",
        ".content-nav__link--active { font-weight: 700; }",
        ".content-list { padding: 16px; }",
        ".content-row { padding: 12px; }",
        ".content-row--published { border-left: 3px solid #2da44e; }",
        ".content-row__title { font-weight: 600; }",
        ".content-item { padding: 24px; }",
        ".content-item--dirty { background: #fff8c5; }",
        ".content-item__title { margin: 0; }",
        ".legacy-content-spacer { height: 1px; }",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/apps/active-preview/Preview.less",
      [
        '@import "../../shell/styles/legacy/tokens.less";',
        "",
        ".preview-shell {",
        "  border-left: 1px solid @manager-border;",
        "  color: @manager-text;",
        "}",
        "",
        ".preview-shell--empty {",
        "  background: @manager-surface;",
        "}",
        "",
        ".preview-shell__toolbar {",
        "  display: flex;",
        "  min-height: 48px;",
        "}",
        "",
        ".preview-frame {",
        "  border: 1px solid @manager-border;",
        "}",
        "",
        ".preview-frame--device {",
        "  border-radius: 12px;",
        "}",
        "",
        ".preview-frame__chrome {",
        "  height: 32px;",
        "}",
        "",
        ".preview-frame__content {",
        "  width: 100%;",
        "}",
        "",
        ".stale-preview-helper {",
        "  opacity: 0;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/shell/styles/legacy/tokens.less",
      [
        "@manager-border: #d8dee4;",
        "@manager-surface: #f6f8fa;",
        "@manager-text: #24292f;",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/apps/audit/styles/AuditPanel.module.css",
      [
        ".panel { padding: 16px; }",
        ".title { font-size: 16px; }",
        ".row { color: #57606a; }",
        ".unusedAuditToken { color: tomato; }",
        "",
      ].join("\n"),
    )
    .withNodeModuleFile(
      "@zesty-io/material/dist/styles.css",
      [
        ".material-card { border: 1px solid #d8dee4; }",
        ".material-elevation-1 { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }",
        "",
      ].join("\n"),
    )
    .build();
}
