import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [sidebarSource, stylesSource, scrollbarsSource, rootSource] = await Promise.all([
  readFile(new URL("../../src/components/app-sidebar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../../src/scrollbars.css", import.meta.url), "utf8"),
  readFile(new URL("../../src/routes/__root.tsx", import.meta.url), "utf8"),
]);

test("sidebar uses the product color tokens for active navigation", () => {
  assert.match(sidebarSource, /data-\[active=true\]:bg-sidebar-primary/);
  assert.match(sidebarSource, /data-\[active=true\]:text-sidebar-primary-foreground/);
  assert.match(sidebarSource, /var\(--color-lime\)/);
});

test("sidebar scroll area replaces native arrows with a themed scrollbar", () => {
  assert.match(sidebarSource, /sidebar-scrollarea/);
  assert.match(stylesSource, /\.sidebar-scrollarea::?-webkit-scrollbar-button/);
  assert.match(stylesSource, /display:\s*none/);
  assert.match(stylesSource, /scrollbar-color:\s*var\(--sidebar-scroll-thumb\)/);
});

test("global scrollbar theme covers the document and nested overflow containers", () => {
  assert.match(rootSource, /scrollbars\.css\?url/);
  assert.match(rootSource, /href:\s*scrollbarsCss/);
  assert.match(scrollbarsSource, /:where\(html, body, \*\)/);
  assert.match(scrollbarsSource, /scrollbar-width:\s*thin/);
  assert.match(scrollbarsSource, /--app-scrollbar-thumb:\s*var\(--sidebar-scroll-thumb\)/);
  assert.match(scrollbarsSource, /::-webkit-scrollbar-button/);
  assert.match(scrollbarsSource, /-webkit-appearance:\s*none/);
  assert.match(scrollbarsSource, /display:\s*none/);
});

test("sidebar keeps an accessible navigation landmark", () => {
  assert.match(sidebarSource, /aria-label="Navegação principal"/);
});
