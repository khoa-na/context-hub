const PRESETS = {
  financial: {
    id: "financial",
    label: "Financial performance",
    focus: [
      "revenue and revenue growth",
      "gross margin, EBITDA, operating profit, and net profit",
      "cash flow, working capital, debt, and liquidity",
      "quarterly or period-over-period changes",
      "drivers, anomalies, risks, and management outlook",
    ],
    fields: [
      "period",
      "revenue",
      "gross_margin",
      "ebitda",
      "net_profit",
      "cash_flow",
      "working_capital",
      "growth_rates",
      "key_drivers",
      "risks",
      "outlook",
    ],
    keywords: [
      "financial",
      "finance",
      "revenue",
      "sales",
      "profit",
      "margin",
      "ebitda",
      "cash",
      "debt",
      "doanh thu",
      "loi nhuan",
      "bien loi nhuan",
      "tai chinh",
      "dong tien",
      "von luu dong",
    ],
  },
  operational: {
    id: "operational",
    label: "Operational performance",
    focus: [
      "customer, product, inventory, fulfillment, and service KPIs",
      "operational bottlenecks and improvement initiatives",
      "technology rollout, process changes, and execution risks",
      "changes across reporting periods",
    ],
    fields: [
      "period",
      "customer_kpis",
      "inventory_kpis",
      "service_kpis",
      "product_or_category_performance",
      "operational_incidents",
      "initiatives",
      "risks",
      "outlook",
    ],
    keywords: [
      "operation",
      "operational",
      "kpi",
      "inventory",
      "customer",
      "nps",
      "csat",
      "retention",
      "project",
      "van hanh",
      "khach hang",
      "hang ton kho",
      "du an",
      "ty le giu chan",
      "dich vu",
    ],
  },
  risk: {
    id: "risk",
    label: "Risk and controls",
    focus: [
      "risk factors, incidents, root causes, and impact",
      "mitigation actions, controls, and unresolved issues",
      "legal, market, operational, financial, and technology risks",
      "severity and trend across reporting periods",
    ],
    fields: [
      "period",
      "risk_factors",
      "incidents",
      "root_causes",
      "impact",
      "mitigations",
      "open_issues",
      "trend",
      "outlook",
    ],
    keywords: [
      "risk",
      "risks",
      "issue",
      "incident",
      "warning",
      "challenge",
      "mitigation",
      "root cause",
      "rui ro",
      "canh bao",
      "su co",
      "nguyen nhan",
      "khac phuc",
      "bat thuong",
    ],
  },
  generic: {
    id: "generic",
    label: "General report synthesis",
    focus: [
      "period covered by the report",
      "important metrics and facts relevant to the user request",
      "trends, anomalies, risks, decisions, and outlook",
      "differences between selected documents",
    ],
    fields: [
      "period",
      "key_metrics",
      "key_events",
      "trends",
      "risks",
      "drivers",
      "outlook",
      "missing_or_uncertain_data",
    ],
    keywords: [],
  },
};

function normalizeForScoring(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function scorePreset(question, preset) {
  const normalized = normalizeForScoring(question);
  return preset.keywords.reduce((score, keyword) => {
    const normalizedKeyword = normalizeForScoring(keyword);
    return normalized.includes(normalizedKeyword) ? score + normalizedKeyword.split(/\s+/).length : score;
  }, 0);
}

function selectFullDocumentSchemaPreset(question) {
  const candidates = [PRESETS.financial, PRESETS.operational, PRESETS.risk];
  let best = PRESETS.generic;
  let bestScore = 0;

  for (const preset of candidates) {
    const score = scorePreset(question, preset);
    if (score > bestScore) {
      best = preset;
      bestScore = score;
    }
  }

  return best;
}

function buildSchemaPresetInstruction(preset) {
  const selected = preset || PRESETS.generic;
  return [
    `Schema preset: ${selected.id} (${selected.label})`,
    `Focus: ${selected.focus.join("; ")}`,
    `Extract these fields when present: ${selected.fields.join(", ")}`,
    "Every extracted fact should carry a source label when available.",
    "Keep original units, currencies, percentages, and period labels.",
  ].join("\n");
}

module.exports = {
  FULL_DOCUMENT_SCHEMA_PRESETS: PRESETS,
  buildSchemaPresetInstruction,
  normalizeForScoring,
  selectFullDocumentSchemaPreset,
};
