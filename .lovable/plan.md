## Objetivo

Integrar o MCP externo `https://dvuaudcncwzferlagmck.supabase.co/functions/v1/mcp` (protegido por OAuth do Supabase deles) ao Quiwi. Um único admin autoriza uma vez em Configurações; um sync diário lista os workspaces do Monitor News, cria/atualiza um cliente Quiwi para cada workspace e importa créditos/custos por workspace, atrelados a uma nova plataforma "Monitor News".

## 1. Autenticação (OAuth 2.1 + PKCE + DCR)

O endpoint responde `WWW-Authenticate` apontando para `https://dvuaudcncwzferlagmck.supabase.co/auth/v1` como authorization server. Já existem tabelas prontas (`monitor_news_oauth_clients`, `monitor_news_oauth_states`, `monitor_news_connections`) — vamos usá-las como estão.

Fluxo:
- Página **Configurações → Monitor News**: botão "Conectar como admin".
- Server fn `startMonitorNewsOAuth` (admin-only):
  1. Faz Dynamic Client Registration em `.../auth/v1/oauth/register` se não houver linha em `monitor_news_oauth_clients` para nosso `redirect_uri` (`https://<origem>/api/public/hooks/monitor-news-oauth`), salvando `client_id` (+ secret cifrado com `MONITOR_NEWS_ENC_KEY` já existente).
  2. Gera `state` + `code_verifier` PKCE, grava em `monitor_news_oauth_states`.
  3. Retorna URL `.../auth/v1/authorize?...` para o navegador redirecionar.
- Server route pública `GET /api/public/hooks/monitor-news-oauth` (callback):
  1. Valida `state`, troca `code` por tokens em `.../auth/v1/token`.
  2. Cifra `access_token`/`refresh_token` e grava em `monitor_news_connections` (uma linha global; sobrescreve).
  3. Redireciona para `/settings?monitor_news=ok`.
- Helper `getMonitorNewsToken()`: lê a linha, decripta, renova via refresh se `expires_at < now+60s`.

Não usamos "OAuth por usuário Quiwi" — só um registro global (o único aprovado pelo admin).

## 2. Cliente MCP mínimo

Criar `src/lib/monitor-news-mcp.server.ts` com um cliente JSON-RPC/Streamable HTTP:
- `POST /functions/v1/mcp` com `Authorization: Bearer <token>`, `Content-Type: application/json`, `Accept: application/json, text/event-stream`.
- Métodos: `initialize`, `tools/list`, `tools/call`.
- Suporte a resposta `text/event-stream` (lê o primeiro evento `message`) e a `application/json`.
- Cache do `Mcp-Session-Id` retornado.

## 3. Descoberta e sync

Server fn `syncMonitorNews()` (admin-only):
1. Chama `tools/list` e loga os nomes descobertos no `sync_logs` (para você inspecionar o que o servidor de fato oferece).
2. Escolhe tools por convenção (regex flexível — cobre variações de nome):
   - Lista de workspaces: primeira tool cujo nome bata `/workspace|team|tenant/i` e sem parâmetros obrigatórios.
   - Créditos/uso por workspace: tool cujo nome bata `/credit|usage|billing|cost/i` e aceite `workspace_id` (ou similar).
   Se nenhuma bater, grava erro amigável em `sync_logs` — sem quebrar.
3. Para cada workspace retornado:
   - **Upsert em `clients`** com `external_source='monitor_news'`, `external_id=<workspace_id>`, `name`/`company` do workspace, `metadata` com plano/limites.
   - **Upsert em `platforms`** o registro fixo "Monitor News" (uma vez).
   - Chama a tool de créditos/custos, grava:
     - `cost_entries` (uma entrada do dia, `provider`=Monitor News, `client_id`=cliente recém-criado, `cost_usd`/`cost_brl` convertido pela cotação atual).
     - `provider_usage_daily` com `credits_used`, `credits_included`, `credits_remaining` no `metadata`.

Sem migrações novas de schema: reutiliza `platforms`, `clients` (já tem `external_source`/`external_id`/`metadata`), `cost_entries` e `provider_usage_daily`.

## 4. Automação diária + botão manual

- `pg_cron` "sync-monitor-news-daily" às 04:10 UTC → `POST /api/public/hooks/cron/sync-monitor-news` com `apikey` anon.
- Server route pública faz sanity check e chama `syncMonitorNews()`.
- Botão "Sincronizar agora" na página Monitor News (Configurações e no card da plataforma) chama a server fn diretamente.

## 5. UI

- **Configurações → aba Monitor News**: status da conexão (`Conectado como <email>`, expira em X), botão Conectar/Reconectar/Desconectar, botão Sincronizar agora, últimos 5 registros de `sync_logs` do job.
- **Plataformas**: novo card fixo "Monitor News" abrindo `/platforms/monitor-news` com KPIs globais (créditos totais/consumidos, custo do mês) e tabela "Workspaces → Cliente Quiwi (link) · créditos · custo mês".
- **Clientes**: cada workspace importado aparece na lista com badge "Monitor News"; a rota `/clients/:id` já existe e mostra os custos automaticamente por vir de `cost_entries`.

## Detalhes técnicos

Novos arquivos:
- `src/lib/monitor-news-oauth.server.ts` — DCR, PKCE, exchange, refresh, cripto AES-GCM com `MONITOR_NEWS_ENC_KEY`.
- `src/lib/monitor-news-mcp.server.ts` — cliente MCP (initialize/list/call, parser SSE).
- `src/lib/monitor-news.functions.ts` — `startOAuth`, `getStatus`, `disconnect`, `syncNow` (todas `requireSupabaseAuth` + `has_role admin`).
- `src/routes/api/public/hooks/monitor-news-oauth.ts` — callback OAuth.
- `src/routes/api/public/hooks/cron/sync-monitor-news.ts` — endpoint chamado pelo cron.
- `src/routes/_authenticated/platforms.monitor-news.tsx` — página de detalhe da plataforma.
- Trecho na `src/routes/_authenticated/settings.tsx` — bloco Monitor News.

Ajustes:
- `src/lib/sync.server.ts`: nada a mudar — Monitor News é sincronizado por handler próprio; os dados caem em `cost_entries`/`provider_usage_daily` e já entram automaticamente em Dashboard/Financeiro.
- Realtime: `cost_entries`, `clients`, `sync_logs` e `provider_usage_daily` já estão no publicaton realtime, então os cards atualizam sozinhos.

Suposição a validar após o primeiro `tools/list`: nomes exatos das tools do Monitor News. O sync grava a lista descoberta em `sync_logs.metadata` no primeiro run — se a heurística de nome não casar, ajustamos a regex/mapeamento numa iteração curta em vez de adivinhar agora.

## Fora do escopo desta iteração

- Multi-tenant OAuth (cada usuário Quiwi com sua própria conta Monitor News).
- Import histórico anterior à data da conexão (só faremos daí em diante; podemos adicionar backfill depois se as tools suportarem intervalo).
