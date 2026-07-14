import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_ROUTE_REDIRECTS,
  NAVIGATION_SECTIONS,
  getNavigationLabel,
  resolveLegacyRoute,
} from "../../src/lib/navigation.ts";

test("navigation exposes the four business-oriented sections", () => {
  assert.deepEqual(
    NAVIGATION_SECTIONS.map((section) => section.label),
    ["Visão", "Gestão de custos", "Estrutura financeira", "Administração"],
  );
});

test("navigation items use unique routes and human-readable labels", () => {
  const items = NAVIGATION_SECTIONS.flatMap((section) => section.items);
  const routes = items.map((item) => item.url);
  const labels = items.map((item) => item.title);

  assert.equal(new Set(routes).size, routes.length);
  assert.ok(labels.includes("Visão geral"));
  assert.ok(labels.includes("Lançamentos"));
  assert.ok(labels.includes("Consumo e planos"));
  assert.ok(labels.includes("Faturas"));
  assert.ok(labels.includes("Centros de custo"));
  assert.ok(labels.includes("Saúde dos dados"));
});

test("legacy dashboards resolve to the consolidated overview", () => {
  assert.equal(LEGACY_ROUTE_REDIRECTS["/"], "/overview");
  assert.equal(resolveLegacyRoute("/dashboard"), "/overview");
  assert.equal(resolveLegacyRoute("/financial"), "/overview");
  assert.equal(resolveLegacyRoute("/costs"), "/costs");
});

test("breadcrumb labels resolve exact and nested routes", () => {
  assert.equal(getNavigationLabel("/overview"), "Visão geral");
  assert.equal(getNavigationLabel("/providers/123"), "Fornecedores e integrações");
  assert.equal(getNavigationLabel("/unknown"), undefined);
});
