# Roadmap de Melhorias — Cost Center

Baseado nas anotações da reunião de 30/06/2026. Proponho entregar em **4 fases**, cada uma com valor de negócio isolado.

---

## Fase 1 — Plataformas (cadastro + resumo + pagamento)
Cobre itens 2, 4, 7 e parte do 10.

- **Padronização de nomenclatura**: renomear "Plataformas" mantendo o termo, mas revisar labels em todas as páginas (menu, breadcrumbs, títulos) para uso consistente ("Plataforma" no singular em detalhes, "Plataformas" nas listas). Ajustar rótulos residuais de "Provedor/Fornecedor" quando se referirem à plataforma.
- **Novos campos em `platforms`**:
  - `summary` (text) — resumo do funcionamento da plataforma.
  - `payment_method` (text) — ex.: "Cartão Corporativo".
  - `card_last4` (text) — últimos 4 dígitos do cartão.
  - `environment` (enum: `production` | `internal`) — separa produção de uso interno.
  - `owner_contact_id` (uuid, FK → clients) — responsável.
- **Página Plataformas**:
  - Filtros por ambiente (Produção/Interno), status e busca.
  - Card com resumo, forma de pagamento (•••• 1234), responsável e clientes vinculados.
  - Dialog de edição com os novos campos.
- **Validação de cadastro**: script/tela que lista plataformas usadas em `cost_entries` sem cadastro completo (resumo/pagamento/responsável ausentes) — banner "N plataformas incompletas".

## Fase 2 — Dashboard Financeiro
Cobre itens 1, 5, 6 e parte do 10.

- **Nova rota** `/dashboard/financeiro` (mantém dashboard atual como visão geral).
- **Blocos**:
  - KPIs: custo total, custo produção vs. interno, top 5 clientes, variação vs. mês anterior.
  - **Consumo por cliente** (tabela + gráfico de barras).
  - **Consumo por plataforma** com drill-down (produção/interno).
  - **Consumo detalhado** (tabela filtrável por período, cliente, plataforma, fornecedor).
  - **Uso interno** (visão isolada das plataformas `environment='internal'`).
- **Análises e insights** (item 5):
  - Bloco de "Comentários & Insights" — tabela `dashboard_notes` (título, corpo markdown, autor, `pinned`, `created_at`) editável por admins.
  - Insights automáticos: maior variação % do mês, cliente com maior crescimento, plataforma sem consumo há 30d.
- **Atualização em tempo real** (item 6): habilitar Realtime em `cost_entries` e `provider_usage_syncs`; o dashboard reage a inserts sem reload.

## Fase 3 — Contatos + Filtros globais
Cobre itens 3 e 7.

- **Painel do Contato** (`/contatos/:id`): página por cliente/contato mostrando plataformas que ele responde, custos vinculados, últimas sincronizações, histórico de consumo.
- **Lista de contatos** exibindo **apenas contatos em uso** (com pelo menos 1 vínculo em `platforms.owner_contact_id` ou em `cost_entries`). Toggle "Mostrar inativos".
- **Filtros consistentes**: componente unificado de filtro (período, cliente, plataforma, fornecedor, ambiente) reaproveitado em Custos, Sincronizações e Financeiro, com estado na URL (search params).

## Fase 4 — Alertas + Pré-definidos
Cobre itens 8, 9 e resto do 10.

- **Templates pré-definidos** (item 8): tabela `platform_presets` com configurações-modelo (categoria, fornecedor padrão, alertas padrão). Botão "Criar a partir de preset" no cadastro.
- **Sistema de alertas** (item 9):
  - Tabela `cost_alerts`: `scope` (global/cliente/plataforma), `metric` (mensal/diário), `threshold_brl`, `comparison` (`>`, `> variação %`), `channel` (in-app, email).
  - Tabela `alert_events` registrando disparos.
  - Job diário (server function agendável via `/api/public/cron/*`) que avalia regras e insere eventos.
  - Bell no header com contador + página `/alertas` listando eventos, com ack/resolve.
  - Alertas padrão automáticos: consumo > 20% acima da média dos últimos 3 meses; plataforma sem sincronização há 7 dias.

---

## Detalhes técnicos

- **Stack**: TanStack Start + Lovable Cloud (Supabase). Novas tabelas seguem padrão de RLS com `has_role` e GRANTs para `authenticated`/`service_role`.
- **Realtime**: `ALTER PUBLICATION supabase_realtime ADD TABLE public.cost_entries, public.provider_usage_syncs;` + subscription no dashboard.
- **Migrations por fase**, cada uma isolada. Sem breaking changes em tabelas existentes — apenas colunas nullable adicionadas.
- **Insights e alertas** em `createServerFn` (não Edge Functions). Cron via `src/routes/api/public/cron/evaluate-alerts.ts` protegido por `CRON_SECRET`.
- **Filtros na URL** via `validateSearch` + zod (padrão já usado em `/providers` e `/costs`).

---

## Sugestão de ordem de execução

1. **Fase 1** (base de dados + UX de plataformas) — desbloqueia todas as outras.
2. **Fase 2** (dashboard financeiro + realtime) — maior valor visível.
3. **Fase 3** (contatos + filtros).
4. **Fase 4** (presets + alertas).

**Quer que eu comece pela Fase 1?** Se preferir outra ordem, ou quiser recortar/adicionar algo em alguma fase, é só dizer.
