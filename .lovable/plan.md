## Objetivo
Remover o card "Monitor News (MCP)" da página **Configurações** e integrá-lo na página **Plataformas**, onde ele conceitualmente pertence (Monitor News já existe como plataforma).

## Mudanças

### 1. `src/routes/_authenticated/platforms.tsx`
- Adicionar um card/seção dedicado ao **Monitor News (MCP)** no topo da lista de plataformas (ou vinculado ao card existente da plataforma Monitor News).
- Reutilizar o componente `MonitorNewsCard` da tela de Configurações, adaptando-o ao layout de Plataformas: estado da conexão, botões **Conectar / Sincronizar agora / Desconectar**, indicador da última sincronização e link para "Importar workspaces" (fluxo já existente em Clientes).
- Manter permissão de admin (somente admin vê os controles de conexão/sync/desconectar); usuários não-admin veem apenas o status.

### 2. `src/routes/_authenticated/settings.tsx`
- Remover o `<MonitorNewsCard />` e o bloco de função `MonitorNewsCard()` inteiro.
- Remover imports de `startMonitorNewsOauth`, `getMonitorNewsStatus`, `syncMonitorNewsFn`, `disconnectMonitorNewsFn` e ícones usados apenas por ele.

### 3. Sem mudanças de backend
- Server functions em `src/lib/monitor-news.functions.ts` permanecem iguais.
- Callback OAuth (`/api/public/hooks/monitor-news-oauth`) e cron permanecem iguais.

## Detalhes técnicos
- O card na aba Plataformas fica visualmente vinculado à plataforma "Monitor News" (mesmo ícone/cor), destacando que é uma integração especial via MCP.
- O texto do status ("Conectado desde…", "Última sync…") e o fluxo de duas etapas para desconectar são preservados.
