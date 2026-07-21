(() => {
  const API_ORIGIN = "http://localhost:3001";
  const WACC_PATH = "/api/wacc";
  const STORAGE_KEY = "value-scanner:wacc-records:v1";
  const nativeFetch = window.fetch.bind(window);

  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

  const readRecords = () => {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const writeRecords = (records) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      // Private browsing can disable storage. The API still returns a safe result.
    }
  };

  const toStoredRecord = (value) => {
    const now = new Date().toISOString();
    return {
      id: globalThis.crypto?.randomUUID?.() || `local-${Date.now()}`,
      name: value.name || "저장한 WACC",
      method: value.method || "industry",
      wacc: Number(value.wacc) || 0,
      cost_of_equity: Number(value.costOfEquity) || 0,
      cost_of_debt: Number(value.costOfDebt) || 0,
      tax_rate: Number(value.taxRate) || 0,
      debt_equity_ratio: Number(value.debtEquityRatio) || 0,
      levered_beta: Number(value.leveredBeta) || 0,
      risk_free_rate: Number(value.riskFreeRate) || 0,
      market_risk_premium: Number(value.marketRiskPremium) || 0,
      stock_code: value.stockCode || null,
      stock_name: value.stockName || null,
      r_squared: value.rSquared == null ? null : Number(value.rSquared),
      created_at: now,
      updated_at: now,
      storage: "local",
    };
  };

  const offlineWaccResponse = (url, options) => {
    const method = String(options?.method || "GET").toUpperCase();
    const path = new URL(url).pathname;

    if (method === "GET" && path === WACC_PATH) {
      return jsonResponse({ success: true, data: readRecords() });
    }

    if (method === "POST" && path === WACC_PATH) {
      try {
        const record = toStoredRecord(JSON.parse(options?.body || "{}"));
        const records = [record, ...readRecords()];
        writeRecords(records);
        return jsonResponse({ success: true, data: record });
      } catch {
        return jsonResponse({ success: false, error: "저장할 WACC 데이터를 확인해 주세요." });
      }
    }

    if (method === "DELETE" && path.startsWith(`${WACC_PATH}/`)) {
      const id = decodeURIComponent(path.slice(WACC_PATH.length + 1));
      writeRecords(readRecords().filter((record) => String(record.id) !== id));
      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: false, error: "지원하지 않는 오프라인 요청입니다." });
  };

  window.fetch = async (input, options) => {
    const url = typeof input === "string" ? input : input?.url;
    const isWaccApi = typeof url === "string"
      && url.startsWith(`${API_ORIGIN}${WACC_PATH}`);

    if (!isWaccApi) {
      return nativeFetch(input, options);
    }

    try {
      const response = await nativeFetch(input, options);
      if (response.ok) return response;
    } catch {
      // The downloaded static app has no API server, so local storage is the fallback.
    }

    return offlineWaccResponse(url, options);
  };
})();
