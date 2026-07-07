
# Billing OS — Plano de Execução

O que você descreveu é essencialmente um novo produto sobre a base atual. Não dá para entregar tudo em uma única passada sem perder qualidade e sem estourar contexto/custos. Proponho executar exatamente na ordem que você definiu (Fases 1 a 6), entregando cada fase funcional e revisável antes de avançar.

## Estado atual x destino

O projeto hoje já tem:
- Auth Supabase + `user_roles` (admin/viewer) single-tenant
- Tabelas: `providers`, `provider_connections`, `cost_entries`, `provider_usage_daily`, `cost_alerts`, `alert_events`, `platforms`, `clients`, `sync_logs`, `system_settings`
- Integração Gemini via BigQuery Billing Export funcional (`gcp-auth.server.ts`, `gemini-billing.server.ts`)
- Cron routes: `sync-billing`, `sync-all`, `evaluate-alerts`
- Rotas autenticadas: dashboard, costs, providers, platforms, clients, alerts, syncs, billing, financial, settings

O destino (Billing OS) exige:
- Multi-organização com papéis Owner/Admin/Finance/Analyst/Viewer
- Modelo de dados novo (organizations, cloud_projects, usage_events, billing_cost_records, pricing_skus, budgets, reconciliations, audit_logs, saved_filters)
- Onboarding em etapas, teste de conexão detalhado, campos manuais Gemini
- Reconciliação estimado x confirmado, projeções, orçamentos internos + GCP, alertas ricos
- Endpoint público assinado para ingestão de `usage_events`
- Relatórios exportáveis, insights determinísticos

## Fase 1 — Fundação (o que farei agora)

Escopo desta primeira entrega, alinhado ao seu item 36 "Fase 1":

1. **Modelo multi-tenant no banco** (migration):
   - `organizations`, `organization_members` (com enum `org_role`: owner/administrator/finance/analyst/viewer)
   - `audit_logs`, `saved_filters`
   - Função `has_org_role(_org uuid, _user uuid, _roles org_role[])` SECURITY DEFINER
   - Função `is_org_member(_org uuid, _user uuid)` SECURITY DEFINER
   - Adicionar `organization_id` nas tabelas existentes (`provider_connections`, `cost_entries`, `provider_usage_daily`, `cost_alerts`, `alert_events`, `platforms`, `clients`, `sync_logs`, `provider_billing_snapshots`, `provider_invoices`, `provider_usage_syncs`, `dashboard_notes`)
   - Backfill: criar 1 organização "Default" e vincular todos os registros existentes + membros existentes como `owner`
   - Reescrever policies RLS de todas as tabelas para escopo por organização + papel
   - GRANTs corretos para authenticated/service_role

2. **Contexto de organização no frontend**:
   - Hook `useActiveOrganization()` + seletor no header/sidebar
   - Middleware server-side `requireOrgMember(orgId, roles?)` reutilizável
   - Persistência da org ativa em `localStorage` + validação server-side em toda query

3. **Shell visual atualizado**:
   - Sidebar com os 14 itens do item 5 (Visão geral, Custos, Consumo, Provedores, Projetos, Modelos e SKUs, Orçamentos, Alertas, Projeções, Relatórios, Sincronizações, Equipe, Configurações)
   - Rotas placeholder (estado vazio útil) para as que ainda não existem: `consumption`, `projects`, `skus`, `budgets`, `forecasts`, `reports`, `team`
   - Rodapé do menu: org ativa, perfil, tema, sair
   - Manter tema claro/escuro atual

4. **Tela de Equipe** (mínima para validar RLS):
   - Listar membros da org ativa, convidar por email, alterar papel, remover
   - Bloqueios: só Owner remove org / remove outro Owner; Admin gerencia membros exceto Owner

5. **Auditoria mínima**:
   - Log automático em: criação/edição de conexão, alteração de papel, convite, remoção de membro

Não incluído nesta fase (vem nas seguintes, na ordem do seu item 36):
- Fase 2: onboarding em etapas + `google_billing_connections` + teste de conexão granular + campos manuais Gemini
- Fase 3: `cloud_projects` + `billing_cost_records` (substituindo `cost_entries` gradualmente) + dashboard e filtros novos
- Fase 4: `usage_events` + endpoint público assinado + `CostEstimationService` + `ReconciliationService`
- Fase 5: `budgets` + `budget_thresholds` + alertas expandidos + `ForecastService` + relatórios/exportação
- Fase 6: auditoria completa, performance, mais provedores

## Perguntas antes de começar a Fase 1

1. **Migração dos dados atuais**: OK criar uma organização "Default" e migrar TODAS as conexões/custos/usuários existentes para dentro dela? (é o único caminho não-destrutivo)
2. **Papel inicial dos usuários existentes**: hoje há admin/viewer no `user_roles`. Mapear admin → `owner` e viewer → `viewer` na nova `organization_members`?
3. **Convites de novos membros**: por enquanto apenas registrar o convite em tabela (usuário precisa se cadastrar depois), ou já disparar email via Supabase Auth `inviteUserByEmail`?
4. **Nome / marca visual**: renomeio o app para "Billing OS" agora (título, logo, sidebar) ou mantenho a marca atual e só reorganizo a navegação?

Depois que você responder essas 4 perguntas eu executo a Fase 1 inteira em uma passada (migration + código + telas). Nas fases seguintes eu volto a alinhar antes de cada uma.
