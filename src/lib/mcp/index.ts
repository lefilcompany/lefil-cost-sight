import { auth, defineMcp } from "@lovable.dev/mcp-js";

import listProvidersTool from "./tools/list-providers";
import costsSummaryTool from "./tools/costs-summary";
import listAlertsTool from "./tools/list-alerts";

// The OAuth issuer MUST be the direct Supabase host (RFC 8414 issuer match).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "quiwi-cost-center-mcp",
  title: "Quiwi Cost Center",
  version: "0.1.0",
  instructions:
    "Ferramentas do Quiwi Cost Center para consultar fornecedores conectados, resumos de custos por período e alertas configurados. Todas as chamadas respeitam as permissões do usuário autenticado.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProvidersTool, costsSummaryTool, listAlertsTool],
});
