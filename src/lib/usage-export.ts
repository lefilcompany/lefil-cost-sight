export type UsageExportRow = {
  usage_date: string;
  provider: string;
  model: string;
  endpoint: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  quantity: number;
  unit: string | null;
  cost_usd: number;
  cost_brl: number;
};

const HEADERS = [
  "Data",
  "Fornecedor",
  "Modelo",
  "Endpoint",
  "Requests",
  "Tokens entrada",
  "Tokens saída",
  "Quantidade",
  "Unidade",
  "Custo USD",
  "Custo BRL",
];

function csvCell(value: string | number | null | undefined) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildUsageCsv(rows: UsageExportRow[]) {
  const lines = [HEADERS.join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.usage_date,
        r.provider,
        r.model,
        r.endpoint,
        r.requests,
        r.input_tokens,
        r.output_tokens,
        r.quantity,
        r.unit ?? "",
        r.cost_usd.toFixed(6).replace(".", ","),
        r.cost_brl.toFixed(6).replace(".", ","),
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

export function usageTotals(rows: UsageExportRow[]) {
  return rows.reduce(
    (acc, r) => {
      acc.requests += r.requests || 0;
      acc.input_tokens += r.input_tokens || 0;
      acc.output_tokens += r.output_tokens || 0;
      acc.cost_usd += r.cost_usd || 0;
      acc.cost_brl += r.cost_brl || 0;
      return acc;
    },
    { requests: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, cost_brl: 0 },
  );
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportUsagePdf(rows: UsageExportRow[], opts: { filename: string; subtitle: string }) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const t = usageTotals(rows);
  const nf = new Intl.NumberFormat("pt-BR");

  doc.setFontSize(14);
  doc.text("Uso por dia/modelo", 40, 40);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(opts.subtitle, 40, 56);
  doc.text(
    `Registros: ${nf.format(rows.length)}  •  Requests: ${nf.format(t.requests)}  •  Total: US$ ${t.cost_usd.toFixed(2)} / R$ ${t.cost_brl.toFixed(2)}`,
    40,
    70,
  );

  autoTable(doc, {
    startY: 86,
    head: [HEADERS],
    body: rows.map((r) => [
      r.usage_date,
      r.provider,
      r.model,
      r.endpoint,
      nf.format(r.requests || 0),
      nf.format(r.input_tokens || 0),
      nf.format(r.output_tokens || 0),
      nf.format(r.quantity || 0),
      r.unit ?? "",
      `US$ ${(r.cost_usd || 0).toFixed(4)}`,
      `R$ ${(r.cost_brl || 0).toFixed(4)}`,
    ]),
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [30, 41, 59], fontSize: 7 },
    columnStyles: {
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
    },
    margin: { left: 40, right: 40 },
  });

  doc.save(opts.filename);
}
