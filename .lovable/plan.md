# Fase 5 — Billing, planos e uso detalhado

## O que cada API realmente entrega

| Dado | OpenAI | Firecrawl | Gemini (GCP) |
|---|---|---|---|
| Plano atual + limites | ⚠️ parcial (não há endpoint público de plano; dá pra inferir de créditos/limits) | ✅ `plan_credits`, `remaining_credits` | ✅ SKU/tier via BigQuery |
| Uso detalhado (dia/modelo) | ✅ `/v1/organization/usage/*` (completions, embeddings, images, audio…) | ✅ `/v2/team/credit-usage-historical` | ✅ BigQuery billing export |
| Custo diário | ✅ `/v1/organization/costs` (já temos) | ⚠️ só créditos (não USD direto) | ✅ BigQuery |
| Faturas/invoices | ❌ sem API pública | ❌ sem API pública | ⚠️ via Cloud Billing API (limitado) |
| Próxima cobrança estimada | 🧮 calculada (custo do ciclo + projeção linear) | 🧮 calculada | 🧮 calculada |

Faturas oficiais de OpenAI e Firecrawl **não existem via API** — vamos permitir upload manual de PDFs/valores nesse caso.

## Schema (uma migration)

**`provider_billing_snapshots`** — snapshot do estado de plano/quota por conexão
- `id`, `connection_id`, `provider_id`, `platform_id`
- `plan_name` text, `plan_tier` text, `billing_cycle` text (monthly/annual)
- `cycle_start` date, `cycle_end` date
- `included_quantity` numeric, `included_unit` text (tokens/credits/usd)
- `used_quantity` numeric, `remaining_quantity` numeric
- `hard_limit_usd` numeric, `soft_limit_usd` numeric
- `cost_period_usd` numeric, `projected_cost_usd` numeric
- `currency` text default 'USD', `raw` jsonb, `captured_at` timestamptz
- RLS: admin/editor write, viewer read; GRANT completo

**`provider_usage_daily`** — uso agregado por dia/modelo
- `id`, `provider_id`, `platform_id`, `connection_id`
- `usage_date` date, `model` text nullable, `endpoint` text nullable
- `input_tokens` bigint, `output_tokens` bigint, `requests` bigint
- `quantity` numeric, `unit` text (tokens/credits/requests)
- `cost_usd` numeric, `exchange_rate` numeric, `cost_brl` numeric
- `raw` jsonb, `synced_at` timestamptz
- Unique: `(connection_id, usage_date, model, endpoint)` para upsert
- RLS idêntico + GRANT

**`provider_invoices`** — faturas (mix de API + upload manual)
- `id`, `provider_id`, `platform_id`, `connection_id`
- `invoice_number` text, `issued_at` date, `period_start` date, `period_end` date
- `amount_usd` numeric, `exchange_rate` numeric, `amount_brl` numeric
- `status` text (paid/open/void), `pdf_url` text nullable
- `source` text ('api'|'manual'), `raw` jsonb, `created_at`
- RLS + GRANT

## Backend — `src/lib/billing.server.ts`

Handlers novos, isolados dos syncs de custo existentes:

- **`syncFirecrawlBilling(conn, rate)`**
  - `GET /v2/team/credit-usage` → snapshot (plan_credits, remaining, used)
  - `GET /v2/team/credit-usage-historical?byApiKey=false` → linhas em `provider_usage_daily`
  - Projeção: `(used/dias_decorridos) * dias_no_ciclo`

- **`syncOpenAIBilling(conn, rate)`**
  - `/v1/organization/usage/completions?bucket_width=1d` (+ embeddings, images, audio_speeches, audio_transcriptions, moderations) → `provider_usage_daily` com model breakdown
  - `/v1/organization/costs` já existente → totais para snapshot
  - Snapshot: cycle = mês corrente, `cost_period_usd` = soma do ciclo, `projected_cost_usd` = linear
  - Plano/limites: não há endpoint — deixa `plan_name = 'pay-as-you-go'` até o usuário informar

- **`syncGCPBilling(conn, rate)`** (Gemini)
  - Requer credenciais adicionais na `provider_connections.config`: `service_account_json`, `billing_export_dataset`, `billing_account_id`
  - JWT RS256 assinado no servidor → OAuth token → BigQuery `jobs.query`
  - Query padrão em `<dataset>.gcp_billing_export_v1_*` filtrando `service.description LIKE '%Gemini%'`
  - Se `service_account_json` faltar: retorna `skipped` com instruções

Server functions em `src/lib/billing.functions.ts`:
- `runBillingSync({ connection_id })` — dispara para uma conexão
- `runBillingSyncAll()` — todas
- `saveManualInvoice({ ... })` — insere em `provider_invoices` com `source='manual'`

## UI — nova rota `/billing`

Layout `crud-page` com abas:

1. **Planos & limites** — cards por conexão mostrando plan_name, uso vs incluído (progress bar), gasto no ciclo, projeção, hard limit. Botão "Sincronizar agora".
2. **Uso por dia/modelo** — tabela/chart filtrando por provedor + range de data. Colunas: data, modelo, requests, tokens in/out, custo USD/BRL.
3. **Faturas** — lista de `provider_invoices`. Botão "Adicionar fatura manual" abre dialog (número, período, valor, PDF URL). Faturas com `source='api'` vêm read-only.

Sidebar: novo item "Billing" (ícone Receipt) entre "Custos" e "Sincronizações".

## Cron

Estender o cron `sync-all` diário para também chamar `runBillingSyncAll()` (ou criar `/api/public/cron/sync-billing` separado e adicionar ao `pg_cron` diariamente às 03:00).

## Ordem de entrega

1. Migration (3 tabelas + RLS + GRANT + índices únicos)
2. Types.ts atualizado
3. `billing.server.ts` + `billing.functions.ts` (Firecrawl + OpenAI; Gemini como skipped-com-instruções)
4. Rota `/billing` com as 3 abas + dialog manual
5. Sidebar + registro no routeTree
6. Cron diário
7. Depois, quando você tiver o service account do GCP pronto, implemento a parte real do Gemini/BigQuery

Confirma que posso seguir assim? Se preferir começar sem Gemini para acelerar, corto o item 7 e o skip handler já cobre.
