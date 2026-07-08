import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { runSyncAllFn } from "@/lib/sync.functions";

// Guarda global entre navegações para evitar disparar sync múltiplas vezes
// se o usuário pular entre dashboard/financial/costs rapidamente.
let inFlight: Promise<any> | null = null;
let lastFinishedAt = 0;
const MIN_INTERVAL_MS = 15_000; // 15s de debounce entre execuções

/**
 * Dispara runSyncAllFn em background sempre que uma página que consome
 * dados sincronizados é aberta. Ao concluir, invalida as queries para
 * que dashboards, financeiro e custos reflitam os dados mais recentes.
 */
export function useAutoSync(queryKeys: string[] = ["cost_entries", "provider_usage_syncs"]) {
  const qc = useQueryClient();
  const runAll = useServerFn(runSyncAllFn);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const now = Date.now();
    if (inFlight) return; // já rodando
    if (now - lastFinishedAt < MIN_INTERVAL_MS) return; // debounce

    inFlight = runAll()
      .then(() => {
        queryKeys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      })
      .catch(() => {
        // silencioso: erros específicos já aparecem na página de fornecedores
      })
      .finally(() => {
        lastFinishedAt = Date.now();
        inFlight = null;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
