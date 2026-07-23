(() => {
  "use strict";

  const STORAGE_KEY = "value-scanner-guided-dcf-v1";
  const SNAPSHOT_KEY = "value-scanner-dcf-snapshots-v1";
  const TOTAL_QUESTIONS = 15;
  const RESULT_STEP = TOTAL_QUESTIONS;
  const WACC_API = "http://localhost:3001/api/wacc";
  const WACC_CHANGED_EVENT = "value-scanner:wacc-changed";
  const OFFLINE_WACC_STORAGE_KEY = "value-scanner:wacc-records:v1";

  const waccMethodLabels = Object.freeze({
    industry: "순수접근법",
    regression: "회귀분석법",
    direct: "펀더멘털 베타",
    levered: "유사기업 비교법",
    "pure-play": "순수접근법",
    pureplay: "순수접근법",
    capm: "펀더멘털 베타",
    manual: "직접 입력",
  });

  const groups = [
    { label: "기준정보", start: 0, end: 3 },
    { label: "영업예측", start: 3, end: 7 },
    { label: "재투자", start: 7, end: 11 },
    { label: "영구가치", start: 11, end: 14 },
    { label: "최종검토", start: 14, end: 15 },
  ];

  const reviewGroups = [
    { label: "기준정보", description: "평가 목적과 기준일, 적용 할인율이 서로 같은 시점을 기준으로 하는지 확인하세요." },
    { label: "영업예측", description: "예측기간과 매출·수익성 가정이 승인된 사업계획과 이어지는지 확인하세요." },
    { label: "재투자", description: "세금과 감가상각, CAPEX, 운전자본 가정이 현금흐름에서 일관되게 연결되는지 확인하세요." },
    { label: "영구가치", description: "영구성장 기준과 성장률이 WACC 및 장기 경제전망과 맞는지 마지막으로 확인하세요." },
  ];

  const resultPanels = ["요약", "현금흐름", "민감도", "체크"];

  const evidenceKeys = [
    "wacc",
    "revenue",
    "revenueGrowth",
    "ebitMargin",
    "taxRate",
    "depreciationRate",
    "capexRate",
    "nwcRate",
    "terminalGrowth",
  ];

  const today = () => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const createDefaultState = () => ({
    step: 0,
    purpose: "internal",
    valuationDate: today(),
    wacc: 10,
    waccMode: null,
    waccSnapshot: null,
    interestBearingDebt: "",
    cashAndCashEquivalents: "",
    forecastYears: 5,
    revenue: 1000,
    revenueGrowth: 5,
    ebitMargin: 10,
    taxRate: 25,
    depreciationRate: 5,
    capexRate: 5,
    nwcRate: 10,
    terminalBasis: "nominal-gdp",
    terminalGrowth: 2,
    evidence: {},
    lastVersion: null,
    reviewPage: 0,
    resultPage: 0,
  });

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const finiteNumber = (value) => {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const loadState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return createDefaultState();
      const merged = { ...createDefaultState(), ...saved };
      merged.evidence = saved.evidence && typeof saved.evidence === "object" ? saved.evidence : {};
      merged.step = Math.min(Math.max(Number(saved.step) || 0, 0), RESULT_STEP);
      merged.reviewPage = Math.min(
        Math.max(Math.trunc(Number(saved.reviewPage) || 0), 0),
        reviewGroups.length - 1,
      );
      merged.resultPage = Math.min(
        Math.max(Math.trunc(Number(saved.resultPage) || 0), 0),
        resultPanels.length - 1,
      );
      const requiresCapitalBridgeMigration =
        merged.step === RESULT_STEP &&
        (finiteNumber(saved.interestBearingDebt) === null ||
          finiteNumber(saved.cashAndCashEquivalents) === null);
      if (requiresCapitalBridgeMigration) {
        merged.step = TOTAL_QUESTIONS - 1;
        merged.reviewPage = reviewGroups.length - 1;
      }
      if (!Object.prototype.hasOwnProperty.call(saved, "waccMode")) {
        // Drafts created before the guided chooser existed used either a snapshot
        // or a manually entered number. Preserve those drafts without making a
        // brand-new analysis silently accept the default 10% value.
        merged.waccMode = saved.waccSnapshot ? "saved" : "manual";
      } else if (saved.waccMode !== "saved" && saved.waccMode !== "manual") {
        merged.waccMode = null;
      }
      if (requiresCapitalBridgeMigration) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }
      return merged;
    } catch {
      return createDefaultState();
    }
  };

  let state = loadState();
  let guidedRoot = null;
  let savedWaccRows = [];
  let waccLoadStatus = "idle";
  let waccLoadPromise = null;
  let waccReloadQueued = false;
  let waccResetBrowseQueued = false;
  let waccBrowseIndex = 0;
  let syncQueued = false;

  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The calculator remains usable when browser storage is unavailable.
    }
  };

  const formatNumber = (value, maximumFractionDigits = 0) =>
    new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(Number(value) || 0);

  const formatPercent = (value) => `${formatNumber(value, 2)}%`;

  const waccMethodLabel = (method) =>
    waccMethodLabels[String(method || "industry").toLowerCase()] || "기타 산정법";

  const formatSavedWaccDate = (value) => {
    if (!value) return "저장일 정보 없음";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "저장일 정보 없음";
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  };

  const purposeLabel = (purpose) =>
    ({
      internal: "내부 의사결정",
      ias36: "IAS 36 사용가치",
      ifrs13: "IFRS 13 공정가치",
    })[purpose] || "내부 의사결정";

  const terminalBasisLabel = (basis) =>
    ({
      "nominal-gdp": "명목 GDP 성장률",
      inflation: "장기 물가상승률",
      sustainable: "지속가능성장률",
      riskfree: "무위험이자율 참고",
      custom: "직접 입력",
    })[basis] || "직접 입력";

  const computeDcf = (overrides = {}) => {
    const waccPercent = finiteNumber(overrides.wacc ?? state.wacc);
    const terminalGrowthPercent = finiteNumber(
      overrides.terminalGrowth ?? state.terminalGrowth,
    );
    const years = finiteNumber(state.forecastYears);
    const baseRevenue = finiteNumber(state.revenue);
    const growthPercent = finiteNumber(state.revenueGrowth);
    const ebitMarginPercent = finiteNumber(state.ebitMargin);
    const taxPercent = finiteNumber(state.taxRate);
    const depreciationPercent = finiteNumber(state.depreciationRate);
    const capexPercent = finiteNumber(state.capexRate);
    const nwcPercent = finiteNumber(state.nwcRate);

    if (
      waccPercent === null ||
      terminalGrowthPercent === null ||
      years === null ||
      !Number.isInteger(years) ||
      years < 1 ||
      baseRevenue === null ||
      growthPercent === null ||
      ebitMarginPercent === null ||
      taxPercent === null ||
      depreciationPercent === null ||
      capexPercent === null ||
      nwcPercent === null
    ) {
      return null;
    }

    const wacc = waccPercent / 100;
    const terminalGrowth = terminalGrowthPercent / 100;
    if (
      wacc <= 0 ||
      wacc >= 1 ||
      terminalGrowth < 0 ||
      terminalGrowth > 0.2 ||
      wacc <= terminalGrowth
    )
      return null;

    let previousRevenue = baseRevenue;
    let previousNwc = baseRevenue * (nwcPercent / 100);
    const cashFlows = [];

    for (let year = 1; year <= years; year += 1) {
      const revenue = previousRevenue * (1 + growthPercent / 100);
      const ebit = revenue * (ebitMarginPercent / 100);
      const nopat = ebit * (1 - taxPercent / 100);
      const depreciation = revenue * (depreciationPercent / 100);
      const capex = revenue * (capexPercent / 100);
      const nwc = revenue * (nwcPercent / 100);
      const changeNwc = nwc - previousNwc;
      const fcff = nopat + depreciation - capex - changeNwc;
      const discountFactor = (1 + wacc) ** year;
      const presentValue = fcff / discountFactor;

      cashFlows.push({
        year,
        revenue,
        ebit,
        nopat,
        depreciation,
        capex,
        changeNwc,
        fcff,
        presentValue,
      });

      previousRevenue = revenue;
      previousNwc = nwc;
    }

    const forecastPresentValue = cashFlows.reduce(
      (sum, cashFlow) => sum + cashFlow.presentValue,
      0,
    );
    const lastFcff = cashFlows[cashFlows.length - 1]?.fcff || 0;
    const terminalFcff = lastFcff * (1 + terminalGrowth);
    const terminalValue = terminalFcff / (wacc - terminalGrowth);
    const terminalPresentValue = terminalValue / (1 + wacc) ** years;
    const enterpriseValue = forecastPresentValue + terminalPresentValue;
    const terminalShare = enterpriseValue
      ? (terminalPresentValue / enterpriseValue) * 100
      : 0;
    const interestBearingDebt = finiteNumber(
      overrides.interestBearingDebt ?? state.interestBearingDebt,
    );
    const cashAndCashEquivalents = finiteNumber(
      overrides.cashAndCashEquivalents ?? state.cashAndCashEquivalents,
    );
    const hasCapitalBridge =
      interestBearingDebt !== null &&
      interestBearingDebt >= 0 &&
      cashAndCashEquivalents !== null &&
      cashAndCashEquivalents >= 0;
    const debtValue = hasCapitalBridge ? interestBearingDebt : null;
    const netDebt = hasCapitalBridge
      ? interestBearingDebt - cashAndCashEquivalents
      : null;
    const equityValue = hasCapitalBridge ? enterpriseValue - netDebt : null;

    return {
      cashFlows,
      forecastPresentValue,
      terminalValue,
      terminalPresentValue,
      enterpriseValue,
      terminalShare,
      interestBearingDebt: debtValue,
      cashAndCashEquivalents: hasCapitalBridge ? cashAndCashEquivalents : null,
      debtValue,
      netDebt,
      equityValue,
      wacc: waccPercent,
      terminalGrowth: terminalGrowthPercent,
    };
  };

  const validateStep = (step) => {
    const result = { error: "", warning: "" };
    const number = (field) => finiteNumber(state[field]);

    switch (step) {
      case 0:
        if (!state.purpose) result.error = "평가 목적을 선택해 주세요.";
        break;
      case 1:
        if (!state.valuationDate) result.error = "평가 기준일을 입력해 주세요.";
        else if (state.valuationDate > today())
          result.warning = "평가 기준일이 오늘보다 미래입니다. 기준 자료의 시점을 다시 확인해 주세요.";
        break;
      case 2:
        if (state.waccMode !== "saved" && state.waccMode !== "manual")
          result.error = "저장된 WACC을 가져올지, 직접 입력할지 먼저 선택해 주세요.";
        else if (state.waccMode === "saved" && !state.waccSnapshot)
          result.error = "사용할 저장 WACC을 한 개 선택해 주세요.";
        else if (number("wacc") === null || number("wacc") <= 0 || number("wacc") >= 100)
          result.error = "WACC은 0%보다 크고 100%보다 작아야 합니다.";
        else if (number("wacc") < 3 || number("wacc") > 30)
          result.warning = "일반적인 범위를 크게 벗어났습니다. 산출 근거를 꼭 남겨 주세요.";
        break;
      case 3:
        if (
          number("forecastYears") === null ||
          !Number.isInteger(number("forecastYears")) ||
          number("forecastYears") < 1 ||
          number("forecastYears") > 20
        )
          result.error = "직접 예측기간은 1년에서 20년 사이의 정수로 입력해 주세요.";
        else if (number("forecastYears") > 10)
          result.warning = "10년을 초과한 상세 예측은 불확실성이 큽니다. 장기 예측의 근거를 확인해 주세요.";
        break;
      case 4:
        if (number("revenue") === null || number("revenue") <= 0)
          result.error = "기준연도 매출액은 0보다 커야 합니다.";
        break;
      case 5:
        if (number("revenueGrowth") === null || number("revenueGrowth") <= -100)
          result.error = "매출 성장률은 -100%보다 커야 합니다.";
        else if (number("revenueGrowth") > 30)
          result.warning = "높은 성장률입니다. 승인된 사업계획이나 수주잔고 등 근거를 확인해 주세요.";
        break;
      case 6:
        if (
          number("ebitMargin") === null ||
          number("ebitMargin") < -100 ||
          number("ebitMargin") > 100
        )
          result.error = "영업이익률은 -100%에서 100% 사이로 입력해 주세요.";
        else if (number("ebitMargin") < 0)
          result.warning = "적자 가정입니다. 흑자 전환 시점과 필요한 자금도 함께 검토해 주세요.";
        break;
      case 7:
        if (
          number("taxRate") === null ||
          number("taxRate") < 0 ||
          number("taxRate") > 100
        )
          result.error = "법인세율은 0%에서 100% 사이로 입력해 주세요.";
        break;
      case 8:
        if (
          number("depreciationRate") === null ||
          number("depreciationRate") < 0 ||
          number("depreciationRate") > 100
        )
          result.error = "감가상각비율은 0%에서 100% 사이로 입력해 주세요.";
        break;
      case 9:
        if (
          number("capexRate") === null ||
          number("capexRate") < 0 ||
          number("capexRate") > 200
        )
          result.error = "CAPEX 비율은 0%에서 200% 사이로 입력해 주세요.";
        else if (number("capexRate") < number("depreciationRate"))
          result.warning = "CAPEX가 감가상각비보다 낮습니다. 장기적으로 자산 유지가 가능한지 확인해 주세요.";
        break;
      case 10:
        if (
          number("nwcRate") === null ||
          number("nwcRate") < -200 ||
          number("nwcRate") > 200
        )
          result.error = "운전자본 비율은 -200%에서 200% 사이로 입력해 주세요.";
        break;
      case 12:
        if (!state.terminalBasis) result.error = "영구성장률의 기준을 선택해 주세요.";
        break;
      case 13:
        if (number("terminalGrowth") === null)
          result.error = "영구성장률을 입력해 주세요.";
        else if (number("terminalGrowth") < 0 || number("terminalGrowth") > 20)
          result.error = "영구성장률은 0%에서 20% 사이로 입력해 주세요.";
        else if (number("terminalGrowth") >= number("wacc"))
          result.error = "영구성장률은 WACC보다 낮아야 합니다.";
        else if (number("terminalGrowth") > 5)
          result.warning = "장기 성장률이 높은 편입니다. 명목 GDP 또는 물가 장기전망과 비교해 주세요.";
        break;
      case 14: {
        const debt = number("interestBearingDebt");
        const cash = number("cashAndCashEquivalents");
        if (debt === null || debt < 0)
          result.error = "이자부차입금 가치를 0억원 이상으로 입력해 주세요.";
        else if (cash === null || cash < 0)
          result.error = "가산할 현금성자산을 0억원 이상으로 입력해 주세요.";
        else {
          const bridge = computeDcf();
          if (bridge?.equityValue < 0)
            result.warning = "계산된 주주가치가 음수입니다. 부채·현금 금액과 기준일을 다시 확인해 주세요.";
          else if (cash > debt)
            result.warning = "순현금 상태입니다. 현금성자산이 주주가치에 가산됩니다.";
        }
        break;
      }
      default:
        break;
    }

    return result;
  };

  const allAssumptionsValid = () => {
    for (let step = 0; step < TOTAL_QUESTIONS; step += 1) {
      if (validateStep(step).error) return false;
    }
    return Boolean(computeDcf());
  };

  const readiness = () => {
    const completed = evidenceKeys.filter((key) => String(state.evidence[key] || "").trim()).length;
    return { completed, total: evidenceKeys.length, percent: Math.round((completed / evidenceKeys.length) * 100) };
  };

  const renderEvidence = (key, placeholder) => `
    <details class="guided-evidence">
      <summary>
        <span>근거 자료 남기기</span>
        <span class="guided-optional">선택</span>
      </summary>
      <label class="guided-evidence-label" for="evidence-${escapeHtml(key)}">
        문서명·기준기간·페이지·판단 메모
      </label>
      <textarea
        id="evidence-${escapeHtml(key)}"
        data-evidence="${escapeHtml(key)}"
        rows="3"
        placeholder="${escapeHtml(placeholder)}"
      >${escapeHtml(state.evidence[key] || "")}</textarea>
    </details>
  `;

  const renderValidation = (step) => {
    const { error, warning } = validateStep(step);
    if (error) return `<div class="guided-message error" role="alert">${escapeHtml(error)}</div>`;
    if (warning) return `<div class="guided-message warning">${escapeHtml(warning)}</div>`;
    return '<div class="guided-message" aria-live="polite"></div>';
  };

  const renderWhereToFind = (title, body) => `
    <details class="guided-help">
      <summary>잘 모르겠어요</summary>
      <div class="guided-help-body">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(body)}</p>
      </div>
    </details>
  `;

  const renderNumberQuestion = ({
    step,
    eyebrow,
    question,
    description,
    field,
    unit,
    min,
    max,
    inputStep = "0.1",
    helpTitle,
    helpBody,
    evidenceKey,
    evidencePlaceholder,
    readout = "",
    quickValues = [],
  }) => `
    <section class="guided-question-card" aria-labelledby="guided-question-title">
      <div class="guided-question-copy">
        <span class="guided-eyebrow">${escapeHtml(eyebrow)}</span>
        <h3 id="guided-question-title">${escapeHtml(question)}</h3>
        <p>${escapeHtml(description)}</p>
      </div>

      <div class="guided-primary-input">
        <div class="guided-input-wrap">
          <input
            id="guided-${escapeHtml(field)}"
            data-field="${escapeHtml(field)}"
            type="number"
            inputmode="decimal"
            value="${escapeHtml(state[field])}"
            min="${escapeHtml(min)}"
            max="${escapeHtml(max)}"
           step="${escapeHtml(inputStep)}"
            aria-labelledby="guided-question-title"
            aria-describedby="guided-validation"
          />
          <span>${escapeHtml(unit)}</span>
        </div>
        ${readout ? `<div class="guided-readout" data-readout="${escapeHtml(field)}">${escapeHtml(readout)}</div>` : ""}
      </div>

      ${
        quickValues.length
          ? `<div class="guided-quick-values" aria-label="빠른 선택">
              ${quickValues
                .map(
                  (value) => `
                    <button type="button" data-set-field="${escapeHtml(field)}" data-set-value="${escapeHtml(value)}">
                      ${escapeHtml(value)}${escapeHtml(unit)}
                    </button>`,
                )
                .join("")}
            </div>`
          : ""
      }

      <div id="guided-validation" data-validation>
        ${renderValidation(step)}
      </div>

      ${renderWhereToFind(helpTitle, helpBody)}
      ${evidenceKey ? renderEvidence(evidenceKey, evidencePlaceholder) : ""}
    </section>
  `;

  const renderPurposeStep = () => {
    const options = [
      {
        value: "internal",
        icon: "🧭",
        title: "내부 의사결정",
        description: "투자·경영 검토를 위한 일반적인 기업가치 분석",
      },
      {
        value: "ias36",
        icon: "📋",
        title: "IAS 36 사용가치",
        description: "손상검사 목적. 현금흐름과 할인율의 위험 일치가 중요",
      },
      {
        value: "ifrs13",
        icon: "⚖️",
        title: "IFRS 13 공정가치",
        description: "시장참여자 관점의 가정과 관측 가능한 자료를 우선",
      },
    ];

    return `
      <section class="guided-question-card" aria-labelledby="guided-question-title">
        <div class="guided-question-copy">
          <span class="guided-eyebrow">평가 기준</span>
          <h3 id="guided-question-title">이번 DCF는 어떤 목적으로 계산하나요?</h3>
          <p>목적에 따라 감사인이 확인하는 현금흐름과 할인율 기준이 달라집니다.</p>
        </div>
        <div class="guided-choice-grid purpose">
          ${options
            .map(
              (option) => `
                <button
                  type="button"
                  class="guided-choice ${state.purpose === option.value ? "selected" : ""}"
                  data-purpose="${escapeHtml(option.value)}"
                  aria-pressed="${state.purpose === option.value}"
                >
                  <span class="guided-choice-icon">${option.icon}</span>
                  <span class="guided-choice-copy">
                    <strong>${escapeHtml(option.title)}</strong>
                    <small>${escapeHtml(option.description)}</small>
                  </span>
                </button>
              `,
            )
            .join("")}
        </div>
        ${
          state.purpose === "ias36"
            ? `<div class="guided-message warning">현재 계산기는 세후 FCFF·WACC 방식입니다. IAS 36 보고 목적이라면 동일 현재가치를 만드는 세전 할인율과 위험 중복 여부를 별도로 검토하세요.</div>`
            : ""
        }
        <div data-validation>${renderValidation(0)}</div>
      </section>
    `;
  };

  const renderDateStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-question-title">
      <div class="guided-question-copy">
        <span class="guided-eyebrow">평가 기준일</span>
        <h3 id="guided-question-title">이번 평가의 기준일은 언제인가요?</h3>
        <p>재무자료, 시장 데이터, WACC를 모두 이 날짜 기준으로 맞춰 주세요.</p>
      </div>
      <div class="guided-primary-input date">
        <input
          id="guided-valuationDate"
          data-field="valuationDate"
          type="date"
          value="${escapeHtml(state.valuationDate)}"
          aria-labelledby="guided-question-title"
          aria-describedby="guided-validation"
        />
      </div>
      <div id="guided-validation" data-validation>${renderValidation(1)}</div>
      ${renderWhereToFind(
        "어떤 날짜를 쓰나요?",
        "결산 손상검사는 통상 결산일, 거래 목적 평가는 합의된 평가기준일을 사용합니다. 이후 발생한 사건은 별도로 구분해 기록하세요.",
      )}
    </section>
  `;

  const renderWaccModeChooser = () => `
    <div class="guided-choice-grid">
      <button type="button" class="guided-choice" data-wacc-mode="saved">
        <span class="guided-choice-icon">↙</span>
        <span class="guided-choice-copy">
          <strong>저장된 WACC 가져오기</strong>
          <small>WACC 계산하기에서 저장한 결과를 한 개씩 확인하고 선택합니다.</small>
        </span>
      </button>
      <button type="button" class="guided-choice" data-wacc-mode="manual">
        <span class="guided-choice-icon">✎</span>
        <span class="guided-choice-copy">
          <strong>직접 입력</strong>
          <small>외부에서 검토한 할인율과 산출 근거를 직접 입력합니다.</small>
        </span>
      </button>
    </div>
  `;

  const renderNoSavedWacc = () => `
    <div class="guided-saved-wacc">
      <div class="guided-message ${waccLoadStatus === "error" ? "warning" : ""}">
        <strong>${waccLoadStatus === "error" ? "저장 목록을 불러오지 못했어요." : "저장된 WACC이 아직 없어요."}</strong>
        <p>${
          waccLoadStatus === "error"
            ? "연결 상태를 확인한 뒤 다시 불러오거나, 다른 방법을 선택해 주세요."
            : "먼저 WACC을 계산해 저장하면 이곳에서 그대로 가져올 수 있어요."
        }</p>
      </div>
      <div class="guided-review-actions">
        <button type="button" class="primary" data-go-wacc>WACC 계산하러 가기</button>
        <button type="button" data-wacc-refresh>다시 불러오기</button>
        <button type="button" data-wacc-mode="manual">직접 입력 선택</button>
      </div>
    </div>
  `;

  const renderSavedWacc = () => {
    if (waccLoadStatus === "loading" && !savedWaccRows.length) {
      return '<div class="guided-message">저장된 WACC을 확인하고 있어요…</div>';
    }

    if (!savedWaccRows.length) return renderNoSavedWacc();

    if (state.waccSnapshot) {
      const selected = state.waccSnapshot;
      return `
        <div class="guided-saved-wacc">
          <span class="guided-field-label">DCF에 적용할 WACC</span>
          <div class="guided-wacc-option selected">
            <span>
              <strong>${escapeHtml(selected.name)}</strong>
              <small>${escapeHtml(waccMethodLabel(selected.method))} · ${escapeHtml(formatSavedWaccDate(selected.createdAt))}</small>
            </span>
            <b>${formatPercent(selected.wacc)}</b>
          </div>
          <div class="guided-message success">이 값을 DCF 할인율로 사용합니다.</div>
          <div class="guided-review-actions">
            <button type="button" data-wacc-change>다른 저장값 선택</button>
            <button type="button" data-wacc-refresh>목록 새로고침</button>
          </div>
        </div>
      `;
    }

    const safeIndex = Math.min(Math.max(waccBrowseIndex, 0), savedWaccRows.length - 1);
    const row = savedWaccRows[safeIndex];
    waccBrowseIndex = safeIndex;
    return `
      <div class="guided-saved-wacc">
        <div class="guided-progress-topline">
          <span class="guided-field-label">저장값 ${safeIndex + 1} / ${savedWaccRows.length}</span>
          <button type="button" data-wacc-refresh>목록 새로고침</button>
        </div>
        <div class="guided-wacc-option">
          <span>
            <strong>${escapeHtml(row.name)}</strong>
            <small>${escapeHtml(waccMethodLabel(row.method))} · ${escapeHtml(formatSavedWaccDate(row.createdAt))}</small>
          </span>
          <b>${formatPercent(row.wacc)}</b>
        </div>
        <div class="guided-review-actions">
          <button type="button" data-wacc-browse="previous" ${safeIndex === 0 ? "disabled" : ""}>← 이전 저장값</button>
          <button type="button" class="primary" data-wacc-id="${escapeHtml(row.id)}">이 WACC 사용하기</button>
          <button type="button" data-wacc-browse="next" ${safeIndex === savedWaccRows.length - 1 ? "disabled" : ""}>다음 저장값 →</button>
        </div>
        <button type="button" class="secondary" data-wacc-mode="manual">저장값 대신 직접 입력</button>
      </div>
    `;
  };

  const renderManualWacc = () => `
    <div class="guided-primary-input">
      <label class="guided-field-label" for="guided-wacc">검토한 WACC을 입력해 주세요</label>
      <div class="guided-input-wrap">
        <input
          id="guided-wacc"
          data-field="wacc"
          type="number"
          inputmode="decimal"
          value="${escapeHtml(state.wacc)}"
          min="0.1"
          max="99.9"
          step="0.1"
          aria-describedby="guided-validation"
        />
        <span>%</span>
      </div>
      <button type="button" class="secondary" data-wacc-mode="saved">저장된 WACC 가져오기로 변경</button>
    </div>
  `;

  const renderWaccStep = () => {
    const choosingMode = state.waccMode !== "saved" && state.waccMode !== "manual";
    const title = choosingMode
      ? "WACC을 어떻게 준비할까요?"
      : state.waccMode === "saved"
        ? "저장한 WACC 중 어떤 값을 사용할까요?"
        : "DCF에 사용할 WACC은 몇 %인가요?";
    const description = choosingMode
      ? "한 가지 방법을 먼저 선택하면 다음 화면에서 필요한 내용만 보여드릴게요."
      : state.waccMode === "saved"
        ? "한 번에 한 저장값씩 확인한 뒤 사용할 값을 확정해 주세요."
        : "검토가 끝난 할인율을 입력하고 산출 근거를 함께 남겨 주세요.";

    return `
      <section class="guided-question-card" aria-labelledby="guided-question-title">
        <div class="guided-question-copy">
          <span class="guided-eyebrow">할인율</span>
          <h3 id="guided-question-title">${title}</h3>
          <p>${description}</p>
        </div>
        ${
          choosingMode
            ? renderWaccModeChooser()
            : state.waccMode === "saved"
              ? renderSavedWacc()
              : renderManualWacc()
        }
        <div id="guided-validation" data-validation>${renderValidation(2)}</div>
        ${
          choosingMode
            ? ""
            : `
              <div class="guided-audit-tip">
                <span>감사 대응 팁</span>
                <p>베타·무위험수익률·시장위험프리미엄·목표 자본구조의 기준일과 출처를 함께 보관하세요.</p>
              </div>
              ${renderWhereToFind(
                "WACC은 어디서 가져오나요?",
                "왼쪽의 WACC 계산하기에서 목적에 맞는 방법으로 계산할 수 있습니다. 현금흐름에 반영한 위험을 할인율에 다시 더하지 마세요.",
              )}
              ${renderEvidence("wacc", "예: 2026.07.20 Bloomberg 5Y Weekly adjusted beta, 비교기업 6개 중위값")}
            `
        }
      </section>
    `;
  };

  const renderFcffReview = () => {
    const result = computeDcf();
    if (!result) {
      return `
        <section class="guided-question-card">
          <div class="guided-message error">입력값으로 현금흐름을 계산할 수 없습니다. 이전 가정을 다시 확인해 주세요.</div>
        </section>
      `;
    }

    return `
      <section class="guided-question-card wide" aria-labelledby="guided-question-title">
        <div class="guided-question-copy">
          <span class="guided-eyebrow">중간 검토</span>
          <h3 id="guided-question-title">예상 FCFF 흐름이 사업계획과 비슷한가요?</h3>
          <p>매출에서 현금흐름까지의 연결을 확인하세요. 이상하면 해당 가정으로 바로 돌아갈 수 있습니다.</p>
        </div>
        <div class="guided-review-actions">
          <button type="button" data-edit-step="4">매출 수정</button>
          <button type="button" data-edit-step="5">성장률 수정</button>
          <button type="button" data-edit-step="6">마진 수정</button>
          <button type="button" data-edit-step="9">CAPEX 수정</button>
          <button type="button" data-edit-step="10">NWC 수정</button>
        </div>
        <div class="guided-table-wrap">
          <table class="guided-fcff-table">
            <thead>
              <tr>
                <th>연도</th>
                <th>매출액</th>
                <th>EBIT</th>
                <th>NOPAT</th>
                <th>D&amp;A</th>
                <th>CAPEX</th>
                <th>ΔNWC</th>
                <th>FCFF</th>
              </tr>
            </thead>
            <tbody>
              ${result.cashFlows
                .map(
                  (cashFlow) => `
                    <tr>
                      <td>${cashFlow.year}년차</td>
                      <td>${formatNumber(cashFlow.revenue)}</td>
                      <td>${formatNumber(cashFlow.ebit)}</td>
                      <td>${formatNumber(cashFlow.nopat)}</td>
                      <td>${formatNumber(cashFlow.depreciation)}</td>
                      <td>${formatNumber(cashFlow.capex)}</td>
                      <td>${formatNumber(cashFlow.changeNwc)}</td>
                      <td class="highlight">${formatNumber(cashFlow.fcff)}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <div class="guided-message ${state.capexRate < state.depreciationRate ? "warning" : "success"}">
          ${
            state.capexRate < state.depreciationRate
              ? "CAPEX가 감가상각비보다 낮습니다. 장기간 유지 가능한 가정인지 확인해 주세요."
              : "FCFF 연결표가 완성됐습니다. 사업계획과 일치하면 다음으로 진행하세요."
          }
        </div>
      </section>
    `;
  };

  const renderTerminalBasisStep = () => {
    const options = [
      ["nominal-gdp", "명목 GDP", "명목 현금흐름과 비교하기 쉬운 장기 경제성장 기준"],
      ["inflation", "장기 물가", "실질 성장이 제한적인 안정 사업에 적합"],
      ["sustainable", "지속가능성장률", "ROE와 유보율 등 기업 펀더멘털 기준"],
      ["riskfree", "무위험이자율 참고", "통화와 만기가 일치하는 장기 금리 참고"],
      ["custom", "직접 입력", "산업 전망 등 별도 근거가 있는 경우"],
    ];

    return `
      <section class="guided-question-card" aria-labelledby="guided-question-title">
        <div class="guided-question-copy">
          <span class="guided-eyebrow">영구가치 기준</span>
          <h3 id="guided-question-title">예측기간 이후 성장률은 어떤 기준으로 정할까요?</h3>
          <p>자동 제안값이 아니라, 선택한 기준의 최신 전망치를 다음 단계에서 직접 확인합니다.</p>
        </div>
        <div class="guided-choice-grid terminal">
          ${options
            .map(
              ([value, title, description]) => `
                <button
                  type="button"
                  class="guided-choice ${state.terminalBasis === value ? "selected" : ""}"
                  data-terminal-basis="${escapeHtml(value)}"
                  aria-pressed="${state.terminalBasis === value}"
                >
                  <span class="guided-choice-copy">
                    <strong>${escapeHtml(title)}</strong>
                    <small>${escapeHtml(description)}</small>
                  </span>
                </button>
              `,
            )
            .join("")}
        </div>
        <div data-validation>${renderValidation(12)}</div>
      </section>
    `;
  };

  const assumptionGroups = () => [
    [
      ["평가 목적", purposeLabel(state.purpose), 0],
      ["평가 기준일", state.valuationDate, 1],
      [
        "WACC",
        `${formatPercent(state.wacc)}${state.waccSnapshot ? ` · ${waccMethodLabel(state.waccSnapshot.method)}` : " · 직접 입력"}`,
        2,
      ],
    ],
    [
      ["상세 예측기간", `${formatNumber(state.forecastYears)}년`, 3],
      ["기준연도 매출", `${formatNumber(state.revenue)}억원`, 4],
      ["연평균 매출 성장률", formatPercent(state.revenueGrowth), 5],
      ["EBIT Margin", formatPercent(state.ebitMargin), 6],
    ],
    [
      ["법인세율", formatPercent(state.taxRate), 7],
      ["D&A / 매출", formatPercent(state.depreciationRate), 8],
      ["CAPEX / 매출", formatPercent(state.capexRate), 9],
      ["NWC / 매출", formatPercent(state.nwcRate), 10],
    ],
    [
      ["영구성장 기준", terminalBasisLabel(state.terminalBasis), 12],
      ["영구성장률", formatPercent(state.terminalGrowth), 13],
    ],
  ];

  const renderFinalReview = () => {
    const auditReadiness = readiness();
    const valid = allAssumptionsValid();
    const page = Math.min(Math.max(state.reviewPage, 0), reviewGroups.length - 1);
    const group = reviewGroups[page];
    const rows = assumptionGroups()[page];
    const isLastPage = page === reviewGroups.length - 1;
    const bridgeValidation = validateStep(14);

    return `
      <section class="guided-question-card wide" aria-labelledby="guided-question-title">
        <div class="guided-question-copy">
          <span class="guided-eyebrow">최종 검토 · ${page + 1}/${reviewGroups.length}</span>
          <h3 id="guided-question-title">${escapeHtml(group.label)} 가정을 확인해 주세요</h3>
          <p>${escapeHtml(group.description)}</p>
        </div>
        <div class="guided-group-tabs" aria-label="최종 검토 묶음">
          ${reviewGroups
            .map(
              (item, index) => `
                <span class="${index === page ? "active" : ""} ${index < page ? "done" : ""}">
                  ${index < page ? "✓ " : ""}${escapeHtml(item.label)}
                </span>
              `,
            )
            .join("")}
        </div>
        <div class="guided-assumption-list">
          ${rows
            .map(
              ([label, value, step]) => `
                <div class="guided-assumption-row">
                  <span>${escapeHtml(label)}</span>
                  <strong>${escapeHtml(value)}</strong>
                  <button type="button" data-edit-step="${step}">수정</button>
                </div>
              `,
            )
            .join("")}
        </div>
        ${
          isLastPage
            ? `
              <section class="guided-capital-inputs" aria-labelledby="guided-capital-input-title">
                <div class="guided-capital-input-heading">
                  <div>
                    <span>가치 브리지</span>
                    <h4 id="guided-capital-input-title">영업가치를 주주가치로 연결해 주세요</h4>
                  </div>
                  <small>단위: 억원 · 기준일 ${escapeHtml(state.valuationDate)}</small>
                </div>
                <div class="guided-capital-input-grid">
                  <div>
                    <label class="guided-field-label" for="guided-interest-bearing-debt">이자부차입금 가치</label>
                    <div class="guided-input-wrap">
                      <input
                        id="guided-interest-bearing-debt"
                        data-field="interestBearingDebt"
                        type="number"
                        inputmode="decimal"
                        value="${escapeHtml(state.interestBearingDebt)}"
                        min="0"
                        step="0.1"
                        placeholder="예: 300"
                        aria-describedby="guided-capital-input-note"
                      />
                      <span>억원</span>
                    </div>
                  </div>
                  <div>
                    <label class="guided-field-label" for="guided-cash-equivalents">가산할 현금성자산</label>
                    <div class="guided-input-wrap">
                      <input
                        id="guided-cash-equivalents"
                        data-field="cashAndCashEquivalents"
                        type="number"
                        inputmode="decimal"
                        value="${escapeHtml(state.cashAndCashEquivalents)}"
                        min="0"
                        step="0.1"
                        placeholder="예: 100"
                        aria-describedby="guided-capital-input-note"
                      />
                      <span>억원</span>
                    </div>
                  </div>
                </div>
                <p id="guided-capital-input-note" class="guided-capital-input-note">
                  평가일 현재 시장·공정가치를 사용하고, 확인이 어려우면 장부금액을 근사치로 입력하세요. 현금성자산은 영업에 필요한 최소 현금을 제외한 가산 금액을 입력합니다.
                </p>
              </section>
              <div class="guided-readiness">
                <div>
                  <span>근거 메모</span>
                  <strong>${auditReadiness.completed}/${auditReadiness.total}</strong>
                </div>
                <div class="guided-readiness-track">
                  <span style="width:${auditReadiness.percent}%"></span>
                </div>
                <small>핵심 가정에 근거 메모를 남긴 수입니다. 감사 승인 여부를 의미하지 않습니다.</small>
              </div>
              <div data-validation>
                ${
                  valid && bridgeValidation.warning
                    ? `<div class="guided-message warning">${escapeHtml(bridgeValidation.warning)}</div>`
                    : valid
                      ? '<div class="guided-message success">네 묶음의 검토가 끝났습니다. 이제 계산할 수 있어요.</div>'
                      : bridgeValidation.error
                        ? `<div class="guided-message error">${escapeHtml(bridgeValidation.error)}</div>`
                        : '<div class="guided-message error">일부 가정이 유효하지 않습니다. 표시된 항목을 수정해 주세요.</div>'
                }
              </div>
            `
            : '<div class="guided-message">이 묶음을 확인했으면 다음 묶음으로 이동해 주세요.</div>'
        }
        <div class="guided-review-actions">
          <button type="button" data-review-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← 이전 묶음</button>
          ${
            isLastPage
              ? ""
              : `<button type="button" class="primary" data-review-page="${page + 1}">다음 묶음: ${escapeHtml(reviewGroups[page + 1].label)} →</button>`
          }
        </div>
      </section>
    `;
  };

  const renderSensitivity = (result) => {
    const waccOffsets = [-1, 0, 1];
    const growthOffsets = [-0.5, 0, 0.5];
    return `
      <div class="guided-sensitivity">
        <h4>민감도 분석 <small>(추정 주주가치, 억원)</small></h4>
        <div class="guided-table-wrap">
          <table>
            <thead>
              <tr>
                <th>WACC \ g</th>
                ${growthOffsets
                  .map((offset) => `<th>${formatPercent(result.terminalGrowth + offset)}</th>`)
                  .join("")}
              </tr>
            </thead>
            <tbody>
              ${waccOffsets
                .map(
                  (waccOffset) => `
                    <tr>
                      <th>${formatPercent(result.wacc + waccOffset)}</th>
                      ${growthOffsets
                        .map((growthOffset) => {
                          const scenario = computeDcf({
                            wacc: result.wacc + waccOffset,
                            terminalGrowth: result.terminalGrowth + growthOffset,
                          });
                          return `<td class="${waccOffset === 0 && growthOffset === 0 ? "base" : ""}">${
                            scenario ? formatNumber(scenario.equityValue) : "-"
                          }</td>`;
                        })
                        .join("")}
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  };

  const renderResultSummary = (result) => `
    <div class="guided-result-hero">
      <div class="guided-result-headline">
        <span class="guided-eyebrow">DCF 결과 · 버전 ${escapeHtml(state.lastVersion || 1)}</span>
        <h3 id="guided-result-title">추정 영업가치 (EV)</h3>
        <strong>${formatNumber(result.enterpriseValue)}<small>억원</small></strong>
        <p>FCFF를 WACC로 할인한 사업의 영업가치입니다.</p>
      </div>
      <div class="guided-result-meta">
        <div class="guided-result-badge">WACC ${formatPercent(result.wacc)}</div>
        <small>${escapeHtml(purposeLabel(state.purpose))} · 기준일 ${escapeHtml(state.valuationDate)}</small>
      </div>
    </div>
    <section class="guided-capital-split" aria-labelledby="guided-capital-split-title">
      <div class="guided-capital-split-header">
        <div>
          <span>최종 가치 구성</span>
          <h4 id="guided-capital-split-title">자본가치와 타인자본가치</h4>
        </div>
        <small>단위: 억원</small>
      </div>
      <div class="guided-capital-values">
        <article class="equity">
          <span>추정 주주가치 <small>Equity Value</small></span>
          <strong>${formatNumber(result.equityValue, 1)}</strong>
          <em>자본가치</em>
        </article>
        <article class="debt">
          <span>이자부차입금 <small>Debt Value</small></span>
          <strong>${formatNumber(result.debtValue, 1)}</strong>
          <em>타인자본가치</em>
        </article>
      </div>
      <div class="guided-capital-equation" aria-label="주주가치 계산식">
        <span>영업가치 <strong>${formatNumber(result.enterpriseValue, 1)}</strong></span>
        <b>+</b>
        <span>가산 현금 <strong>${formatNumber(result.cashAndCashEquivalents, 1)}</strong></span>
        <b>−</b>
        <span>이자부차입금 <strong>${formatNumber(result.debtValue, 1)}</strong></span>
        <b>=</b>
        <span class="total">주주가치 <strong>${formatNumber(result.equityValue, 1)}</strong></span>
      </div>
      <p class="guided-capital-note">입력한 부채가 장부금액이면 주주가치는 근사치입니다. 비영업자산·우선주·비지배지분 등은 별도 조정이 필요합니다.</p>
    </section>
    <div class="guided-result-grid">
      <article>
        <span>예측기간 현재가치</span>
        <strong>${formatNumber(result.forecastPresentValue)}</strong>
        <small>억원</small>
      </article>
      <article>
        <span>영구가치 현재가치</span>
        <strong>${formatNumber(result.terminalPresentValue)}</strong>
        <small>억원</small>
      </article>
      <article>
        <span>영구가치 비중</span>
        <strong>${formatNumber(result.terminalShare, 1)}%</strong>
        <small>${result.terminalShare > 75 ? "민감도 확인 필요" : "일반 검토 범위"}</small>
      </article>
    </div>
    ${
      result.terminalShare > 75
        ? '<div class="guided-message warning">기업가치의 75% 이상이 영구가치에서 나옵니다. 뒤의 민감도 패널에서 영향을 꼭 확인하세요.</div>'
        : '<div class="guided-message success">상세 예측기간과 영구가치의 연결이 계산됐습니다.</div>'
    }
  `;

  const renderResultCashFlows = (result) => `
    <div class="guided-question-copy">
      <span class="guided-eyebrow">결과 · 2/4</span>
      <h3 id="guided-result-title">연도별 현금흐름을 확인해 주세요</h3>
      <p>매출에서 만들어진 FCFF와 현재가치가 예상한 방향으로 움직이는지 확인하세요.</p>
    </div>
    <div class="guided-table-wrap result-table">
      <table class="guided-fcff-table">
        <thead>
          <tr>
            <th>연도</th>
            <th>매출액</th>
            <th>FCFF</th>
            <th>FCFF 현재가치</th>
          </tr>
        </thead>
        <tbody>
          ${result.cashFlows
            .map(
              (cashFlow) => `
                <tr>
                  <td>${cashFlow.year}년차</td>
                  <td>${formatNumber(cashFlow.revenue)}</td>
                  <td>${formatNumber(cashFlow.fcff)}</td>
                  <td class="highlight">${formatNumber(cashFlow.presentValue)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  const renderResultSensitivityPanel = (result) => `
    <div class="guided-question-copy">
      <span class="guided-eyebrow">결과 · 3/4</span>
      <h3 id="guided-result-title">할인율과 성장률 변화도 확인해 주세요</h3>
      <p>기준값 주변에서 기업가치가 얼마나 달라지는지 보고 특정 가정에 지나치게 의존하지 않는지 점검하세요.</p>
    </div>
    ${renderSensitivity(result)}
  `;

  const renderResultChecklist = (result) => {
    const auditReadiness = readiness();
    return `
      <div class="guided-question-copy">
        <span class="guided-eyebrow">결과 · 4/4</span>
        <h3 id="guided-result-title">마지막 검토 항목입니다</h3>
        <p>결과를 공유하기 전에 아래 네 가지를 문서와 다시 대조해 주세요.</p>
      </div>
      <div class="guided-assumption-list">
        <div class="guided-assumption-row"><span>기준일 일치</span><strong>${escapeHtml(state.valuationDate)}</strong></div>
        <div class="guided-assumption-row"><span>WACC 근거</span><strong>${escapeHtml(state.waccSnapshot?.name || "직접 입력값")}</strong></div>
        <div class="guided-assumption-row"><span>핵심 가정 근거 메모</span><strong>${auditReadiness.completed}/${auditReadiness.total}</strong></div>
        <div class="guided-assumption-row"><span>영구가치 비중</span><strong>${formatNumber(result.terminalShare, 1)}%</strong></div>
        <div class="guided-assumption-row"><span>추정 주주가치</span><strong>${formatNumber(result.equityValue, 1)}억원</strong></div>
        <div class="guided-assumption-row"><span>타인자본가치</span><strong>${formatNumber(result.debtValue, 1)}억원</strong></div>
      </div>
      <div class="guided-result-note">
        <strong>감사 검토용 체크</strong>
        <p>전기 예측 대비 실제 실적, 비교기업·WACC 기준일, 영구성장률 근거, 현금흐름과 할인율의 위험 중복을 별도 확인하세요.</p>
      </div>
    `;
  };

  const renderResult = () => {
    const result = computeDcf();
    if (!result) {
      return `
        <section class="guided-question-card">
          <div class="guided-message error">결과를 계산할 수 없습니다. WACC과 영구성장률을 다시 확인해 주세요.</div>
        </section>
      `;
    }

    const page = Math.min(Math.max(state.resultPage, 0), resultPanels.length - 1);
    const panels = [
      () => renderResultSummary(result),
      () => renderResultCashFlows(result),
      () => renderResultSensitivityPanel(result),
      () => renderResultChecklist(result),
    ];

    return `
      <section class="guided-result" aria-labelledby="guided-result-title">
        <div class="guided-group-tabs" aria-label="DCF 결과 확인 순서">
          ${resultPanels
            .map(
              (label, index) => `
                <span class="${index === page ? "active" : ""} ${index < page ? "done" : ""}">
                  ${index < page ? "✓ " : ""}${escapeHtml(label)}
                </span>
              `,
            )
            .join("")}
        </div>
        ${panels[page]()}
        <div class="guided-result-actions">
          <button type="button" class="secondary" data-result-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← 이전 패널</button>
          ${
            page < resultPanels.length - 1
              ? `<button type="button" class="primary" data-result-page="${page + 1}">다음: ${escapeHtml(resultPanels[page + 1])} →</button>`
              : `
                <button type="button" class="secondary" data-action="back-to-review">가정 다시 검토</button>
                <button type="button" class="primary" data-action="new-analysis">새 분석 시작</button>
              `
          }
        </div>
      </section>
    `;
  };

  const renderStepContent = () => {
    switch (state.step) {
      case 0:
        return renderPurposeStep();
      case 1:
        return renderDateStep();
      case 2:
        return renderWaccStep();
      case 3:
        return renderNumberQuestion({
          step: 3,
          eyebrow: "예측기간",
          question: "몇 년간 현금흐름을 직접 예측할까요?",
          description: "사업계획이 구체적으로 승인된 기간까지만 상세 예측하는 것이 좋습니다.",
          field: "forecastYears",
          unit: "년",
          min: 1,
          max: 20,
          inputStep: 1,
          quickValues: [5, 7, 10],
          helpTitle: "보통 몇 년을 쓰나요?",
          helpBody: "안정적인 사업은 5년이 흔합니다. 정상화나 대규모 투자기간이 더 길면 7~10년을 사용할 수 있지만 추가 근거가 필요합니다.",
        });
      case 4:
        return renderNumberQuestion({
          step: 4,
          eyebrow: "기준 매출",
          question: "기준연도 매출액은 얼마인가요?",
          description: "가장 최근 확정 결산 또는 평가기준일에 가까운 신뢰할 수 있는 실적을 입력하세요.",
          field: "revenue",
          unit: "억원",
          min: 0,
          max: 1e12,
          inputStep: 1,
          readout: `${formatNumber(state.revenue)}억원으로 입력됐어요`,
          helpTitle: "어디서 찾나요?",
          helpBody: "감사받은 손익계산서의 매출액을 우선 사용합니다. 최근 인수나 중단사업이 있으면 비교 가능한 기준으로 조정하고 근거를 남기세요.",
          evidenceKey: "revenue",
          evidencePlaceholder: "예: 2025년 감사보고서 연결 손익계산서 p.42, 매출 1,250억원",
        });
      case 5:
        return renderNumberQuestion({
          step: 5,
          eyebrow: "매출 성장",
          question: "앞으로 매출은 매년 얼마나 성장할까요?",
          description: "현재 버전은 연평균 성장률을 적용합니다. 승인된 사업계획의 연도별 성장과 크게 다르지 않은지 확인하세요.",
          field: "revenueGrowth",
          unit: "%",
          min: -99.9,
          max: 200,
          helpTitle: "무엇을 근거로 하나요?",
          helpBody: "수주잔고, 생산능력, 가격·물량 계획, 시장성장률과 과거 예측 정확도를 함께 봅니다. 단순히 과거 평균만 연장하지 마세요.",
          evidenceKey: "revenueGrowth",
          evidencePlaceholder: "예: 2026~2030 이사회 승인 사업계획, 주요 고객 수주잔고 및 시장성장률 교차검증",
        });
      case 6:
        return renderNumberQuestion({
          step: 6,
          eyebrow: "수익성",
          question: "매출 중 영업이익은 몇 % 정도 남을까요?",
          description: "일회성 손익을 제거한 정상 영업이익률(EBIT Margin)을 입력하세요.",
          field: "ebitMargin",
          unit: "%",
          min: -100,
          max: 100,
          helpTitle: "영업이익률은 어떻게 정하나요?",
          helpBody: "승인된 원가·판관비 계획을 기준으로 계산하고, 과거 실적·동종회사 마진과 비교해 정상화 가능성을 확인합니다.",
          evidenceKey: "ebitMargin",
          evidencePlaceholder: "예: 사업계획 원가율 72%, 판관비율 16%, EBIT Margin 12%",
        });
      case 7:
        return renderNumberQuestion({
          step: 7,
          eyebrow: "현금 법인세",
          question: "영업이익에 적용할 법인세율은 몇 %인가요?",
          description: "법정세율과 실제 현금세율은 다를 수 있습니다. 이월결손금의 사용기간도 고려하세요.",
          field: "taxRate",
          unit: "%",
          min: 0,
          max: 100,
          helpTitle: "어떤 세율을 쓰나요?",
          helpBody: "장기적으로 부담할 한계세율을 기본으로 하되, 이월결손금이나 세액공제 효과가 명확하면 기간별 현금세율을 별도 검토합니다.",
          evidenceKey: "taxRate",
          evidencePlaceholder: "예: 법정 한계세율 및 이월결손금 소진 예상연도 검토",
        });
      case 8:
        return renderNumberQuestion({
          step: 8,
          eyebrow: "비현금 비용",
          question: "감가상각비는 매출의 몇 %인가요?",
          description: "현금이 나가지 않는 비용이므로 NOPAT에 다시 더해집니다.",
          field: "depreciationRate",
          unit: "%",
          min: 0,
          max: 100,
          helpTitle: "어디서 찾나요?",
          helpBody: "현금흐름표의 감가상각·상각비와 유형·무형자산 투자계획을 참고해 매출 대비 정상 수준을 정합니다.",
          evidenceKey: "depreciationRate",
          evidencePlaceholder: "예: 최근 3개년 D&A/매출 4.6~5.2%, 계획기간 5.0% 적용",
        });
      case 9:
        return renderNumberQuestion({
          step: 9,
          eyebrow: "재투자",
          question: "설비투자(CAPEX)는 매출의 몇 %로 예상하나요?",
          description: "유형자산과 무형자산 취득 범위를 현금흐름 계획과 일치시키세요.",
          field: "capexRate",
          unit: "%",
          min: 0,
          max: 200,
          helpTitle: "CAPEX 범위는 어디까지인가요?",
          helpBody: "유지보수 투자와 성장 투자를 모두 포함하되, 리스·개발비 등 회계 처리와 현금흐름 분류를 일관되게 적용하세요.",
          evidenceKey: "capexRate",
          evidencePlaceholder: "예: 설비 투자계획 승인안, 유지보수 35억원 + 증설 20억원",
        });
      case 10:
        return renderNumberQuestion({
          step: 10,
          eyebrow: "운전자본",
          question: "매출 대비 영업운전자본은 몇 % 필요한가요?",
          description: "매출채권 + 재고 - 매입채무를 중심으로 보며 현금과 차입금은 제외합니다.",
          field: "nwcRate",
          unit: "%",
          min: -200,
          max: 200,
          helpTitle: "왜 증감액만 차감하나요?",
          helpBody: "매출 성장으로 추가로 묶이는 운전자본만 현금유출입니다. 고객 선결제가 큰 사업은 음수가 될 수도 있습니다.",
          evidenceKey: "nwcRate",
          evidencePlaceholder: "예: 최근 3개년 영업 NWC/매출 중위값 9.8%, 10% 적용",
        });
      case 11:
        return renderFcffReview();
      case 12:
        return renderTerminalBasisStep();
      case 13:
        return renderNumberQuestion({
          step: 13,
          eyebrow: terminalBasisLabel(state.terminalBasis),
          question: "장기적으로 매년 몇 % 성장한다고 볼까요?",
          description: "명목 현금흐름에는 명목 성장률을 사용하고, WACC보다 반드시 낮게 설정하세요.",
          field: "terminalGrowth",
          unit: "%",
          min: 0,
          max: 20,
          helpTitle: "어떤 값을 써야 하나요?",
          helpBody: "평가기준일 현재의 장기 명목 GDP·물가·산업전망을 확인하세요. 높은 영구성장률은 기업가치를 크게 올리므로 보수적으로 검토합니다.",
          evidenceKey: "terminalGrowth",
          evidencePlaceholder: `예: ${terminalBasisLabel(state.terminalBasis)} 장기전망 자료, 기준일 및 발행기관`,
        });
      case 14:
        return renderFinalReview();
      case RESULT_STEP:
        return renderResult();
      default:
        return "";
    }
  };

  const nextButtonLabel = () => {
    const labels = [
      "다음: 평가 기준일",
      "다음: WACC",
      "다음: 예측기간",
      "다음: 현재 매출",
      "다음: 매출 성장률",
      "다음: 영업이익률",
      "다음: 법인세율",
      "다음: 감가상각비",
      "다음: CAPEX",
      "다음: 운전자본",
      "다음: FCFF 검토",
      "다음: 영구성장 기준",
      "다음: 영구성장률",
      "다음: 최종 검토",
      "계산하고 버전 저장",
    ];
    return labels[state.step] || "다음";
  };

  const renderProgress = () => {
    const activeStep = Math.min(state.step, TOTAL_QUESTIONS - 1);
    const activeGroup = groups.findIndex(
      (group) => activeStep >= group.start && activeStep < group.end,
    );
    const progress = state.step === RESULT_STEP ? 100 : ((state.step + 1) / TOTAL_QUESTIONS) * 100;

    return `
      <header class="guided-progress-shell">
        <div class="guided-progress-topline">
          <div>
            <span class="guided-product-label">GUIDED DCF</span>
            <strong>${state.step === RESULT_STEP ? "분석 결과" : `${state.step + 1} / ${TOTAL_QUESTIONS}`}</strong>
          </div>
          <span class="guided-autosave">✓ 자동 저장됨</span>
        </div>
        <div class="guided-group-tabs" aria-label="DCF 진행 구간">
          ${groups
            .map(
              (group, index) => `
                <span class="${index === activeGroup ? "active" : ""} ${index < activeGroup ? "done" : ""}">
                  ${index < activeGroup ? "✓ " : ""}${escapeHtml(group.label)}
                </span>
              `,
            )
            .join("")}
        </div>
        <div class="guided-progress-track" aria-hidden="true">
          <span style="width:${progress}%"></span>
        </div>
      </header>
    `;
  };

  const renderNavigation = () => {
    if (state.step === RESULT_STEP) return "";
    const validation = validateStep(state.step);
    const finalBlocked = state.step === 14 && (
      state.reviewPage < reviewGroups.length - 1 || !allAssumptionsValid()
    );
    return `
      <footer class="guided-navigation">
        <button type="button" class="secondary" data-action="previous" ${state.step === 0 ? "disabled" : ""}>
          ← 이전
        </button>
        <span class="guided-navigation-hint">Enter 키로 다음</span>
        <button
          type="button"
          class="primary"
          data-action="next"
          ${validation.error || finalBlocked ? "disabled" : ""}
        >
          ${escapeHtml(nextButtonLabel())} →
        </button>
      </footer>
    `;
  };

  const render = () => {
    if (!guidedRoot?.isConnected) return;
    guidedRoot.innerHTML = `
      <div class="guided-dcf-inner">
        ${renderProgress()}
        ${renderStepContent()}
        ${renderNavigation()}
      </div>
    `;

    const contentArea = guidedRoot.closest(".content-area");
    if (contentArea) contentArea.scrollTop = 0;

    const primaryInput = guidedRoot.querySelector(
      ".guided-primary-input input, .guided-choice.selected",
    );
    const focusTarget =
      primaryInput || guidedRoot.querySelector("#guided-question-title, #guided-result-title");
    if (focusTarget) {
      if (focusTarget.matches("h1, h2, h3, h4, h5, h6")) {
        focusTarget.setAttribute("tabindex", "-1");
      }
      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        // Focus is an enhancement, not a requirement for calculation.
      }
    }
  };

  const updateValidation = () => {
    if (!guidedRoot?.isConnected) return;
    const validationHost = guidedRoot.querySelector("[data-validation]");
    if (validationHost) validationHost.innerHTML = renderValidation(state.step);
    const next = guidedRoot.querySelector('[data-action="next"]');
    if (next) {
      const invalid = Boolean(validateStep(state.step).error);
      next.disabled = invalid || (
        state.step === 14 && (
          state.reviewPage < reviewGroups.length - 1 || !allAssumptionsValid()
        )
      );
    }
    const revenueReadout = guidedRoot.querySelector('[data-readout="revenue"]');
    if (revenueReadout)
      revenueReadout.textContent = `${formatNumber(state.revenue)}억원으로 입력됐어요`;
  };

  const saveSnapshot = () => {
    const result = computeDcf();
    if (!result) return null;
    try {
      const snapshots = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
      const list = Array.isArray(snapshots) ? snapshots : [];
      const version = (Number(list[list.length - 1]?.version) || 0) + 1;
      list.push({
        version,
        savedAt: new Date().toISOString(),
        assumptions: { ...state, step: 14 },
        result: {
          enterpriseValue: result.enterpriseValue,
          equityValue: result.equityValue,
          debtValue: result.debtValue,
          netDebt: result.netDebt,
          cashAndCashEquivalents: result.cashAndCashEquivalents,
          forecastPresentValue: result.forecastPresentValue,
          terminalPresentValue: result.terminalPresentValue,
          terminalShare: result.terminalShare,
        },
      });
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list.slice(-20)));
      return version;
    } catch {
      return 1;
    }
  };

  const onClick = (event) => {
    const button = event.target.closest("button");
    if (!button || !guidedRoot?.contains(button)) return;

    if (button.dataset.purpose) {
      state.purpose = button.dataset.purpose;
      saveState();
      render();
      return;
    }

    if (button.dataset.terminalBasis) {
      state.terminalBasis = button.dataset.terminalBasis;
      saveState();
      render();
      return;
    }

    if (button.dataset.setField) {
      state[button.dataset.setField] = Number(button.dataset.setValue);
      saveState();
      render();
      return;
    }

    if (button.dataset.waccMode) {
      state.waccMode = button.dataset.waccMode === "saved" ? "saved" : "manual";
      state.waccSnapshot = null;
      state.evidence.wacc = "";
      if (state.waccMode === "saved") {
        waccBrowseIndex = 0;
        loadSavedWacc({ force: true, resetBrowse: true });
      }
      saveState();
      render();
      return;
    }

    if (button.dataset.waccBrowse) {
      const direction = button.dataset.waccBrowse === "next" ? 1 : -1;
      waccBrowseIndex = Math.min(
        Math.max(waccBrowseIndex + direction, 0),
        Math.max(savedWaccRows.length - 1, 0),
      );
      render();
      return;
    }

    if (button.hasAttribute("data-wacc-change")) {
      const currentIndex = savedWaccRows.findIndex(
        (row) => String(row.id) === String(state.waccSnapshot?.id),
      );
      waccBrowseIndex = currentIndex >= 0 ? currentIndex : 0;
      state.waccSnapshot = null;
      state.evidence.wacc = "";
      saveState();
      render();
      return;
    }

    if (button.hasAttribute("data-wacc-refresh")) {
      loadSavedWacc({ force: true });
      return;
    }

    if (button.hasAttribute("data-go-wacc")) {
      const target = Array.from(document.querySelectorAll(".sidebar-nav .nav-item"))
        .find((item) => item.textContent.includes("WACC"));
      target?.click();
      return;
    }

    if (button.dataset.waccId) {
      const selected = savedWaccRows.find((row) => String(row.id) === button.dataset.waccId);
      if (selected) {
        state.wacc = selected.wacc;
        state.waccMode = "saved";
        state.waccSnapshot = { ...selected };
        state.evidence.wacc = `${selected.name} · ${waccMethodLabel(selected.method)} · WACC ${formatPercent(selected.wacc)}`;
        saveState();
        render();
      }
      return;
    }

    if (button.dataset.reviewPage !== undefined) {
      state.reviewPage = Math.min(
        Math.max(Number(button.dataset.reviewPage) || 0, 0),
        reviewGroups.length - 1,
      );
      saveState();
      render();
      return;
    }

    if (button.dataset.resultPage !== undefined) {
      state.resultPage = Math.min(
        Math.max(Number(button.dataset.resultPage) || 0, 0),
        resultPanels.length - 1,
      );
      saveState();
      render();
      return;
    }

    if (button.dataset.editStep !== undefined) {
      state.step = Number(button.dataset.editStep);
      saveState();
      render();
      return;
    }

    switch (button.dataset.action) {
      case "previous":
        state.step = Math.max(0, state.step - 1);
        saveState();
        render();
        break;
      case "next": {
        if (validateStep(state.step).error) {
          updateValidation();
          break;
        }
        if (state.step === 14) {
          if (
            state.reviewPage < reviewGroups.length - 1 ||
            !allAssumptionsValid()
          ) {
            updateValidation();
            break;
          }
          state.lastVersion = saveSnapshot();
          state.resultPage = 0;
          state.step = RESULT_STEP;
        } else {
          if (state.step === 13) state.reviewPage = 0;
          state.step += 1;
        }
        saveState();
        render();
        break;
      }
      case "back-to-review":
        state.reviewPage = 0;
        state.step = 14;
        saveState();
        render();
        break;
      case "new-analysis":
        if (confirm("현재 결과는 버전으로 보관됩니다. 새 DCF 분석을 시작할까요?")) {
          state = createDefaultState();
          saveState();
          render();
        }
        break;
      default:
        break;
    }
  };

  const onInput = (event) => {
    const field = event.target.dataset.field;
    const evidenceKey = event.target.dataset.evidence;

    if (field) {
      state[field] = event.target.type === "date" ? event.target.value : event.target.value === "" ? "" : Number(event.target.value);
      if (field === "wacc") {
        state.waccMode = "manual";
        state.waccSnapshot = null;
      }
      saveState();
      updateValidation();
    }

    if (evidenceKey) {
      state.evidence[evidenceKey] = event.target.value;
      saveState();
    }
  };

  const onKeyDown = (event) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.target.matches("textarea, button") ||
      state.step === RESULT_STEP
    )
      return;
    const next = guidedRoot?.querySelector('[data-action="next"]');
    if (next && !next.disabled) {
      event.preventDefault();
      next.click();
    }
  };

  const mountGuidedDcf = (source) => {
    source.classList.add("guided-dcf-source");
    let host = source.previousElementSibling;
    if (!host?.classList.contains("guided-dcf")) {
      host = document.createElement("div");
      host.className = "guided-dcf";
      source.before(host);
      host.addEventListener("click", onClick);
      host.addEventListener("input", onInput);
      host.addEventListener("change", onInput);
      host.addEventListener("keydown", onKeyDown);
    }
    guidedRoot = host;
    render();
    loadSavedWacc({ force: true, resetBrowse: true });
  };

  const addBetaAuditGuidance = () => {
    const purePlay = document.querySelector(".pure-play-container");
    if (purePlay && !purePlay.querySelector(".audit-beta-guide")) {
      const guide = document.createElement("section");
      guide.className = "audit-beta-guide";
      guide.innerHTML = `
        <div class="audit-beta-guide-icon">✓</div>
        <div>
          <div class="audit-beta-guide-title">
            <strong>외부감사 대응 권장</strong>
            <span>Bottom-up Beta</span>
          </div>
          <p>동종 상장사 비교 → 회사별 무부채화 → 무부채 베타 중위값 → 목표 D/E로 재부채화</p>
          <small>기준서는 특정 베타 산식을 강제하지 않습니다. 비교기업 선정, 동일한 기준일·기간·빈도, 포함·제외 사유와 원본 데이터가 핵심입니다.</small>
        </div>
      `;
      purePlay.prepend(guide);
    }

    const regression = document.querySelector(".regression-beta-calculator");
    if (regression && !regression.querySelector(".audit-regression-guide")) {
      const guide = document.createElement("section");
      guide.className = "audit-regression-guide";
      guide.innerHTML = `
        <strong>감사 대응 시 보조 검증으로 사용하세요</strong>
        <p>단일 회사 회귀베타는 기간·거래량·사업구조 변화에 민감합니다. 비교기업 Bottom-up Beta와 2년/5년 기간 민감도를 함께 제시하면 설명력이 좋아집니다.</p>
      `;
      regression.prepend(guide);
    }
  };

  const normalizeWaccRow = (row) => ({
    id: row.id,
    name: row.name || "저장된 WACC",
    method: row.method || "industry",
    wacc: Number(row.wacc) || 0,
    costOfEquity: Number(row.cost_of_equity ?? row.costOfEquity) || 0,
    costOfDebt: Number(row.cost_of_debt ?? row.costOfDebt) || 0,
    taxRate: Number(row.tax_rate ?? row.taxRate) || 0,
    debtEquityRatio: Number(row.debt_equity_ratio ?? row.debtEquityRatio) || 0,
    leveredBeta: Number(row.levered_beta ?? row.leveredBeta) || 0,
    riskFreeRate: Number(row.risk_free_rate ?? row.riskFreeRate) || 0,
    marketRiskPremium: Number(row.market_risk_premium ?? row.marketRiskPremium) || 0,
    createdAt: row.created_at ?? row.createdAt ?? null,
  });

  async function loadSavedWacc({ force = false, resetBrowse = false } = {}) {
    if (waccLoadPromise) {
      if (force) waccReloadQueued = true;
      if (resetBrowse) waccResetBrowseQueued = true;
      return waccLoadPromise;
    }

    const previousCandidateId = resetBrowse ? null : savedWaccRows[waccBrowseIndex]?.id;
    if (resetBrowse) waccBrowseIndex = 0;
    waccLoadStatus = "loading";
    if (guidedRoot?.isConnected && state.step === 2) render();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const request = (async () => {
      try {
        const response = await fetch(WACC_API, { signal: controller.signal });
        const payload = await response.json();
        if (!payload?.success || !Array.isArray(payload.data)) {
          throw new Error("Invalid WACC list response");
        }

        const rows = payload.data
          .map(normalizeWaccRow)
          .filter((row) => row.id !== null && row.id !== undefined && row.wacc > 0 && row.wacc < 100);
        savedWaccRows = rows;
        waccLoadStatus = "loaded";

        const selectedIndex = rows.findIndex(
          (row) => String(row.id) === String(state.waccSnapshot?.id),
        );
        if (state.waccMode === "saved" && state.waccSnapshot) {
          if (selectedIndex >= 0) {
            const selected = rows[selectedIndex];
            state.wacc = selected.wacc;
            state.waccSnapshot = { ...selected };
            state.evidence.wacc = `${selected.name} · ${waccMethodLabel(selected.method)} · WACC ${formatPercent(selected.wacc)}`;
          } else {
            state.waccSnapshot = null;
            state.evidence.wacc = "";
          }
          saveState();
        }

        const candidateIndex = rows.findIndex(
          (row) => String(row.id) === String(previousCandidateId),
        );
        waccBrowseIndex = candidateIndex >= 0
          ? candidateIndex
          : selectedIndex >= 0
            ? selectedIndex
            : 0;
      } catch {
        waccLoadStatus = "error";
        // Manual WACC remains available when the optional local API is offline.
      } finally {
        clearTimeout(timeout);
        if (guidedRoot?.isConnected && state.step === 2) render();
      }
    })();

    waccLoadPromise = request;
    try {
      await request;
    } finally {
      waccLoadPromise = null;
      if (waccReloadQueued) {
        const shouldResetBrowse = waccResetBrowseQueued;
        waccReloadQueued = false;
        waccResetBrowseQueued = false;
        loadSavedWacc({ force: true, resetBrowse: shouldResetBrowse });
      }
    }
    return request;
  }

  const handleWaccRecordsChanged = (event) => {
    if (guidedRoot?.isConnected) {
      loadSavedWacc({
        force: true,
        resetBrowse: event?.detail?.method === "POST" || event?.type === "storage",
      });
    } else {
      waccLoadStatus = "idle";
    }
  };

  globalThis.addEventListener?.(WACC_CHANGED_EVENT, handleWaccRecordsChanged);
  globalThis.addEventListener?.("storage", (event) => {
    if (event.key === OFFLINE_WACC_STORAGE_KEY) handleWaccRecordsChanged(event);
  });

  const syncPage = () => {
    syncQueued = false;
    const source = document.querySelector(".dcf-analysis");
    const existingGuided = document.querySelector(".guided-dcf");

    if (source) {
      if (!existingGuided || !source.classList.contains("guided-dcf-source")) {
        mountGuidedDcf(source);
      } else {
        guidedRoot = existingGuided;
      }
    } else if (existingGuided) {
      existingGuided.remove();
      guidedRoot = null;
    }

    addBetaAuditGuidance();
  };

  const scheduleSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(syncPage);
  };

  globalThis.ValueScannerGuidedDcf = Object.freeze({
    calculate: (overrides = {}) => computeDcf(overrides),
    getAssumptions: () => JSON.parse(JSON.stringify(state)),
    validateStep: (step) => ({ ...validateStep(step) }),
    startNew: () => {
      state = createDefaultState();
      saveState();
      if (guidedRoot) render();
      return JSON.parse(JSON.stringify(state));
    },
  });

  syncPage();

  const appRoot = document.getElementById("root");
  if (appRoot) {
    new MutationObserver(scheduleSync).observe(appRoot, {
      childList: true,
      subtree: true,
    });
  }
})();
