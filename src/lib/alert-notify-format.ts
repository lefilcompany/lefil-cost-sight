// Formatação pura das notificações de alerta (usada no servidor e na prévia da UI).

export type AlertNotificationContent = {
  ruleId: string;
  ruleName: string;
  severity: string;
  title: string;
  message: string;
  metricValue: number;
  threshold: number;
  scopeLabel: string;
  periodLabel: string;
  /** Resumo CSV dos cost_entries do período afetado (link assinado). */
  reportUrl?: string | null;
  reportRows?: number | null;
  reportTotalBrl?: number | null;
};

export const fmtBRLNotify = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(n) ? n : 0);

/** Rótulo legível do período afetado por métrica. */
export function periodLabelFor(
  metric: string,
  range: { start?: string; end?: string; days?: number },
): string {
  const br = (d?: string) => (d ? d.split("-").reverse().join("/") : "—");
  switch (metric) {
    case "monthly_cost":
      return `Mês corrente (${br(range.start)} a ${br(range.end)})`;
    case "daily_cost":
      return `Dia ${br(range.start)}`;
    case "variance_pct":
      return `Mês corrente vs. mês anterior (${br(range.start)} a ${br(range.end)})`;
    case "no_sync_days":
      return `Últimos ${Math.floor(range.days ?? 0)} dias sem sincronização`;
    default:
      return `${br(range.start)} a ${br(range.end)}`;
  }
}

export function severityEmoji(severity: string): string {
  return severity === "critical" ? "🚨" : severity === "info" ? "ℹ️" : "⚠️";
}

export function slackEmojiCode(severity: string): string {
  return severity === "critical"
    ? ":rotating_light:"
    : severity === "info"
      ? ":information_source:"
      : ":warning:";
}

export function buildSlackPayload(n: AlertNotificationContent, ruleUrl: string) {
  return {
    text: `${slackEmojiCode(n.severity)} ${n.title}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${severityEmoji(n.severity)} ${n.title}`.slice(0, 150) },
      },
      { type: "section", text: { type: "mrkdwn", text: n.message } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Regra:*\n${n.ruleName}` },
          { type: "mrkdwn", text: `*Escopo:*\n${n.scopeLabel}` },
          { type: "mrkdwn", text: `*Período afetado:*\n${n.periodLabel}` },
          { type: "mrkdwn", text: `*Limite:*\n${fmtBRLNotify(n.threshold)}` },
        ],
      },
      ...(n.reportUrl
        ? [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `📎 *Resumo em CSV:* <${n.reportUrl}|baixar ${n.reportRows ?? 0} lançamento(s)> — total ${fmtBRLNotify(n.reportTotalBrl ?? 0)} (link válido por 30 dias)`,
              },
            },
          ]
        : []),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Ver regra no Quiwi" },
            url: ruleUrl,
            style: n.severity === "critical" ? "danger" : "primary",
          },
          ...(n.reportUrl
            ? [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Baixar CSV do período" },
                  url: n.reportUrl,
                },
              ]
            : []),
        ],
      },
    ],
  };
}

export function buildEmailContent(n: AlertNotificationContent, ruleUrl: string) {
  const subject = `[Quiwi] ${n.severity === "critical" ? "Crítico" : "Atenção"}: ${n.title}`;
  const body = [
    n.message,
    "",
    `Regra: ${n.ruleName}`,
    `Escopo: ${n.scopeLabel}`,
    `Período afetado: ${n.periodLabel}`,
    `Limite configurado: ${fmtBRLNotify(n.threshold)}`,
    "",
    ...(n.reportUrl
      ? [
          `Resumo em CSV do período (${n.reportRows ?? 0} lançamentos, total ${fmtBRLNotify(n.reportTotalBrl ?? 0)}):`,
          n.reportUrl,
          "O link de download é válido por 30 dias.",
          "",
        ]
      : []),
    `Ver regra: ${ruleUrl}`,
  ].join("\n");
  return { subject, body };
}

/** Conteúdo de exemplo para a prévia, por métrica. */
export function sampleNotification(metric: string, severity = "warning"): AlertNotificationContent {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const range =
    metric === "daily_cost"
      ? { start: today, end: today }
      : metric === "no_sync_days"
        ? { days: 3 }
        : { start: monthStart, end: today };

  const base = {
    ruleId: "exemplo",
    ruleName: "Exemplo de regra",
    severity,
    scopeLabel: "Global",
    periodLabel: periodLabelFor(metric, range),
    reportUrl: metric === "no_sync_days" ? null : "https://exemplo.quiwi.app/relatorios/custos.csv",
    reportRows: metric === "no_sync_days" ? null : 128,
    reportTotalBrl: metric === "no_sync_days" ? null : 4820,
  };

  switch (metric) {
    case "daily_cost":
      return {
        ...base,
        title: "Custo diário acima do limite",
        message: "O custo do dia atingiu R$ 320,00, acima do limite de R$ 250,00.",
        metricValue: 320,
        threshold: 250,
      };
    case "variance_pct":
      return {
        ...base,
        title: "Variação de custo acima do esperado",
        message: "O custo do mês corrente está 42% acima do mês anterior (limite: 25%).",
        metricValue: 42,
        threshold: 25,
      };
    case "no_sync_days":
      return {
        ...base,
        title: "Fornecedor sem sincronização",
        message: "Nenhuma sincronização registrada nos últimos 3 dias (limite: 2 dias).",
        metricValue: 3,
        threshold: 2,
      };
    default:
      return {
        ...base,
        title: "Custo mensal acima do limite",
        message: "O custo acumulado do mês atingiu R$ 4.820,00, acima do limite de R$ 4.000,00.",
        metricValue: 4820,
        threshold: 4000,
      };
  }
}
