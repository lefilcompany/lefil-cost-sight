# Integração Gemini + Google Cloud Billing — Plano de Execução

Esse escopo é grande demais para uma única entrega. Proponho quebrar em 5 fases entregáveis, cada uma testável isoladamente. Confirme a ordem e eu começo pela Fase 1.

## Estado atual

Já existe hoje no projeto:
- `provider_connections` com credencial no `vault` (criptografada) + RPC `get_connection_api_key_internal`
- `src/lib/gcp-auth.server.ts` (JWT RS256 → OAuth2 → BigQuery `jobs.query`)
- `src/lib/gemini-billing.server.ts` (query no billing export, upsert em `provider_usage_daily` e `cost_entries`)
- Sync manual + cron diário (`/api/public/cron/sync-billing`)
- Página `/providers` com dialog de conexão (campos GCP básicos)

O que **falta** e o que a spec pede é essencialmente uma reescrita/expansão. Vou preservar o que já funciona e adicionar por cima.

## Fase 1 — Fundação (schema + conexão robusta)

**Migration** (uma só):
- `google_billing_connections` (1:1 com `provider_connections`, todos os campos GCP da spec: `bigquery_dataset_id`, `standard_billing_table`, `detailed_billing_table`, `pricing_table`, `dataset_location`, `timezone`, `billing_mode`, `gemini_tier`, `manual_spend_cap`, etc.)
- `cloud_projects` (projetos GCP descobertos)
- `billing_cost_records` (custos oficiais com `external_row_hash` UNIQUE p/ dedupe)
- `gemini_usage_events` (metadados de `usageMetadata`)
- `pricing_skus`
- `cost_reconciliations`
- `integration_api_keys` (hash + prefix)
- `provider_service_mappings`
- `sync_jobs` (substitui/estende `provider_usage_syncs` atual)
- RLS por organização em todas + GRANT completo
- `encrypted_credentials` fica só no vault (não em coluna); frontend nunca lê

**UI** — reescrever dialog de conexão Gemini como wizard de 3 etapas:
1. Dados GCP (project_id, billing_account_id, bq_project, bq_dataset, tabelas, location, timezone, currency)
2. Upload `.json` da service account (validação client: JSON válido, `type=service_account`, campos obrigatórios, tamanho; envio via server fn; **nunca** volta ao frontend)
3. Checklist de permissões e APIs (informativo)

Após salvar: exibir apenas `client_email`, `project_id`, últimos 4 do `private_key_id`, data.

## Fase 2 — Validação real (teste em etapas)

Botão "Testar conexão" que executa 6 testes sequenciais e emite eventos via SSE ou polling:

1. **Credencial** — parse SA, sign JWT, trocar por access_token
2. **Projeto** — `GET cloudresourcemanager/v1/projects/{id}`
3. **Billing** — `GET cloudbilling/v1/projects/{id}/billingInfo` → verificar `billingEnabled` e comparar `billingAccountName` com o informado
4. **BigQuery** — `GET bigquery/v2/projects/{p}/datasets/{d}` + `.../tables/{t}` para cada tabela configurada; validar location
5. **Orçamentos** — `GET billingbudgets/v1/billingAccounts/{id}/budgets` (permissão = warning se 403)
6. **Dados** — query `SELECT MIN/MAX(usage_start_time), COUNT(DISTINCT project.id), COUNT(*)` com `LIMIT`

Cada teste grava resultado em `provider_connections.metadata.tests[]` com status (`connected|warning|error|not_configured`), mensagem segura (sem stack/token), timestamp.

UI: painel com linha por teste + status colorido; clicar abre detalhes filtrados.

Códigos de erro internos mapeados (todos os 20+ da spec §23) com título/explicação/orientação em pt-BR.

## Fase 3 — BigQuery Billing Export completo

- `GoogleBigQueryBillingService` em `src/lib/gcp-bq-billing.server.ts`:
  - Sanitização de identificadores (`^[a-zA-Z0-9_-]+$` para project/dataset/table)
  - Query parametrizada (datas via `queryParameters`, não interpolação)
  - Campos completos: usage_date, start/end, project id/name, service, sku, gross_cost, credit_amount, net_cost, currency, invoice_month, location, labels
  - Filtros opcionais: project, service, sku, currency, billing_account
- **Dedupe**: hash SHA-256 sobre `billing_account_id|project_id|service_id|sku_id|usage_start_time|usage_end_time|invoice_month|currency` → coluna UNIQUE `external_row_hash`
- Upsert com atualização se hash existe (Google pode ajustar valores)
- Reprocessamento automático dos últimos 7d em cada sync
- Botões: sync 7d / 30d / mês atual / backfill customizado
- Substitui a lógica atual de delete-and-insert em `gemini-billing.server.ts`
- Classificação Gemini via `provider_service_mappings` (não hardcoded); SKUs não classificados viram `unclassified` + alerta

## Fase 4 — Gemini usage + estimativas

- Endpoint público `POST /api/public/hooks/gemini-usage`:
  - Auth via `integration_api_keys` (header `X-Billing-OS-Key`) + HMAC opcional
  - Valida payload (zod), grava em `gemini_usage_events`, calcula `estimated_cost` a partir de `pricing_skus`
  - Se preço faltar: `pricing_status='pricing_missing'`, cost `NULL`, cria alerta
- UI `/settings/integrations/api-keys`: gerar chave (mostrar uma vez), listar (só prefix + last_used), revogar
- `GeminiCostEstimationService` server-side puro (tokens × unit_price)
- Sync de preços via Cloud Billing Catalog API (`services/*/skus`) → `pricing_skus`

## Fase 5 — Reconciliação + dashboard + automação

- Job diário `cost_reconciliations`: agrega estimado vs confirmado por (project, date, sku)
- Cron: custos 6h, projetos/preços 1x/dia, reconciliação 1x/dia (via `pg_cron`, configurável)
- Página `/providers/[id]` reescrita com abas: Visão geral / Permissões / Dados / Sincronizações / Credencial / Configurações avançadas / Plano manual
- Dashboard da conexão: custo confirmado, estimado, créditos, projeção, gráficos (custo diário, tokens/dia, por projeto, por SKU, in vs out, estimado vs confirmado)
- Badges `Estimado | Confirmado | Reconciliado | Divergente | Pendente`
- Audit log para operações sensíveis (upload credencial, teste, sync manual, revogação)

## Detalhes técnicos importantes

- **Criptografia**: mantenho o `vault` do Supabase (já em uso). A spec sugere `GOOGLE_CREDENTIAL_ENCRYPTION_KEY` próprio, mas o vault já entrega isso com KMS gerenciado — evita reinventar. Confirme se aceita ou se quer AES-GCM manual com secret adicional.
- **Edge Functions vs Server Fn**: a spec cita "Supabase Edge Functions"; o projeto é TanStack Start (Cloudflare Worker). Vou usar `createServerFn` + rotas `/api/public/*` para webhooks (equivalente funcional, é o padrão do stack). Não vou criar Supabase Edge Functions novas.
- **Roles**: já existe `has_role` + tabela `user_roles`. Vou adicionar checagem de role nas server fns sensíveis (só admin/owner cria/edita/desconecta).
- **Sem dados fictícios**: já foi removido em turn anterior; não vou reintroduzir banner de demo — só mostrar "sem dados, conecte" quando vazio.

## O que preciso confirmar antes de começar

1. **Ordem**: começo pela Fase 1 (schema + wizard de conexão) e entrego para você testar antes de avançar? Ou quer tudo de uma vez (~5–10x mais tokens, alto risco de erro)?
2. **Criptografia**: mantém o `vault` do Supabase (recomendo) ou implementa AES-GCM manual com `GOOGLE_CREDENTIAL_ENCRYPTION_KEY`?
3. **Roles**: seu modelo atual (`user_roles` global com `admin/editor/viewer`) atende, ou quer o modelo por organização (`org_role: Owner/Admin/Analyst/Finance/Viewer`) que a spec descreve? O segundo exige refatorar auth de várias telas.
4. **Escopo do Gemini usage endpoint**: você tem sistemas externos hoje que vão chamar esse endpoint, ou é preparação para o futuro? Se for futuro, posso deixar Fase 4 por último.

Responda essas 4 perguntas e eu executo a Fase 1 já na próxima mensagem.
