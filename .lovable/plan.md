## LeFil Cost Center — MVP Plan

Plataforma web para monitorar custos das plataformas LeFil (Creator, Soma, LeKPIs, DeePersona) consumidos em APIs de IA e infraestrutura. Stack: Lovable + Lovable Cloud (Supabase) com RLS, Edge Functions e Auth.

### 1. Backend (Lovable Cloud / Supabase)

**Ativar Lovable Cloud** e configurar Auth (email/senha + Google).

**Tabelas (com RLS habilitada e GRANTs):**
- `platforms` — id, name, description, status, color, icon
- `providers` — id, name, category, website, status
- `clients` — id, name, company, cnpj, responsible, status
- `provider_connections` — id, provider_id, platform_id, name, status, last_sync_at, secret_ref
- `provider_usage_syncs` — id, provider_id, platform_id, client_id, period_start, period_end, usage_quantity, usage_unit, cost_usd, exchange_rate, cost_brl, raw_response (jsonb), created_at
- `cost_entries` — id, provider_id, platform_id, client_id, description, usage_quantity, usage_unit, cost_usd, exchange_rate, cost_brl, origin ('manual'|'api'|'import'), entry_date, created_at
- `sync_logs` — id, provider_id, started_at, finished_at, status, duration_ms, records_imported, error_message
- `system_settings` — key/value (cotação cache, configurações)
- `user_roles` + `app_role` enum (admin, viewer) + `has_role()` security definer

**RLS policies:** apenas usuários autenticados leem; mutações apenas para admin via `has_role()`.

**Seed inicial:** 4 plataformas (Creator, Soma, LeKPIs, DeePersona) e 7 fornecedores (Gemini, Firecrawl, Supabase, OpenAI, Claude, ElevenLabs, Outros).

### 2. Edge Functions

- `firecrawl-sync` — chama API Firecrawl, retorna créditos usados/restantes/totais, grava em `provider_usage_syncs` + `cost_entries`, registra em `sync_logs`.
- `gemini-billing-import` — esqueleto preparado para Google Cloud Billing (BigQuery export), mapeia projeto → plataforma.
- `currency-rate` — busca cotação USD→BRL (awesomeapi pública), faz cache em `system_settings`.
- `daily-cost-aggregation` — agregação diária (pode ser cron via pg_cron futuramente).

Secrets via Supabase Secrets (`FIRECRAWL_API_KEY`, `GOOGLE_CLOUD_*`). Solicitados conforme o usuário ativar cada integração.

### 3. Frontend (TanStack Start)

**Layout:** sidebar (shadcn sidebar) com tema claro/escuro, header com toggle de tema.

**Rotas (todas autenticadas exceto `/auth`):**
- `/` Dashboard — 6 cards (custo mês/hoje/30d, plataforma+cara, fornecedor+caro, cliente top), gráficos (recharts): custos por plataforma (donut), por fornecedor (bar), evolução diária (line), evolução mensal (bar), distribuição por cliente (donut); tabela últimos 20 lançamentos.
- `/platforms` — CRUD com cor + ícone (lucide).
- `/providers` — CRUD com categoria, website.
- `/clients` — CRUD simples.
- `/integrations` — lista de conexões; botão "Sincronizar agora" invoca edge function correspondente.
- `/costs` — tabela com filtros (data, plataforma, fornecedor, cliente, origem); editar/criar manualmente.
- `/syncs` — histórico de `sync_logs`; botão re-executar.
- `/settings` — cotação manual, preferências, usuários/roles.
- `/auth` — login/cadastro.

### 4. Design

Inspirado em Stripe / Vercel / Supabase Studio. Tema claro + escuro via tokens semânticos em `src/styles.css` (oklch). Paleta neutra com accent verde-azulado discreto (não roxo genérico). Tipografia: Geist (display) + Inter (body).

### 5. Escalabilidade

Schema preparado: `cost_entries` já tem `client_id` (nullable) para billing por cliente; `provider_connections` separado de `providers` para multi-conta; `system_settings` chave/valor para futuras flags; estrutura de roles pronta para expandir.

### Detalhes técnicos

- Auth: `_authenticated` layout managed; Google OAuth via `lovable.auth.signInWithOAuth`.
- Server functions (`createServerFn` + `requireSupabaseAuth`) para leituras agregadas do dashboard.
- Edge functions para integrações externas (mantêm secrets no servidor).
- Conversão USD→BRL sempre via `currency-rate` no momento da gravação.
- `recharts` para gráficos, `@tanstack/react-table` para tabelas, `date-fns` para datas (pt-BR).

### Fora do escopo agora (mas suportado pela arquitetura)
Billing/assinaturas/Stripe/Asaas/créditos/marketplace — schema permite evoluir sem refactor.

### Próximo passo
Ativar Lovable Cloud e iniciar implementação. Você precisará fornecer depois: `FIRECRAWL_API_KEY` quando quiser ativar a integração Firecrawl; credenciais Google Cloud Billing quando ativar Gemini.

Confirma que posso prosseguir? Algo a ajustar (escopo, cores/tipografia, idioma da UI — assumi PT-BR)?