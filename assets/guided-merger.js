(() => {
  "use strict";

  const STORAGE_KEY = "value-scanner-guided-merger-v1";
  const SNAPSHOT_KEY = "value-scanner-merger-snapshots-v1";
  const TOTAL_QUESTIONS = 8;
  const REVIEW_STEP = TOTAL_QUESTIONS - 1;
  const RESULT_STEP = TOTAL_QUESTIONS;
  const resultPanels = ["거래조건", "가치배분", "EPS", "체크·범위"];
  const groups = [
    { label: "분석기준", start: 0, end: 3 },
    { label: "거래조건", start: 3, end: 5 },
    { label: "손익효과", start: 5, end: 7 },
    { label: "검토", start: 7, end: 8 },
  ];
  const evidenceKeys = [
    "acquirer", "target", "consideration", "synergyPV", "annualSynergy", "funding",
  ];

  const today = () => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const createDefaultState = () => ({
    step: 0,
    valuationDate: today(),
    currency: "KRW",
    unit: "million",
    acquirerPrice: 50,
    acquirerShares: 200,
    acquirerNetIncome: 600,
    targetPrice: 40,
    targetShares: 50,
    targetNetIncome: 120,
    targetNetDebt: 300,
    considerationMode: "offer-mix",
    offerPrice: 48,
    cashMixPercent: 50,
    cashPerTargetShare: 24,
    exchangeRatio: 0.48,
    synergyPV: 600,
    costPV: 100,
    annualSynergy: 60,
    annualOtherAdjustment: -10,
    internalCashPercent: 40,
    cashYield: 2,
    debtRate: 5,
    taxRate: 25,
    evidence: {},
    lastVersion: null,
    resultPage: 0,
  });

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const finiteNumber = (value) => {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const formatNumber = (value, maximumFractionDigits = 2) =>
    new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(Number(value) || 0);

  const formatSigned = (value, maximumFractionDigits = 2) => {
    const number = Number(value) || 0;
    const formatted = formatNumber(Math.abs(number), maximumFractionDigits);
    if (number > 0) return `+${formatted}`;
    if (number < 0) return `−${formatted}`;
    return formatted;
  };

  const currencyLabel = () => state.currency === "USD" ? "USD" : state.currency === "EUR" ? "EUR" : "원";
  const amountUnitLabel = () => `${currencyLabel()} · 백만 단위`;

  const loadState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return createDefaultState();
      const merged = { ...createDefaultState(), ...saved };
      merged.currency = ["KRW", "USD", "EUR"].includes(saved.currency) ? saved.currency : "KRW";
      merged.unit = "million";
      merged.considerationMode = saved.considerationMode === "direct" ? "direct" : "offer-mix";
      merged.step = Math.min(Math.max(Math.trunc(Number(saved.step) || 0), 0), RESULT_STEP);
      merged.resultPage = Math.min(Math.max(Math.trunc(Number(saved.resultPage) || 0), 0), resultPanels.length - 1);
      merged.evidence = saved.evidence && typeof saved.evidence === "object" ? saved.evidence : {};
      return merged;
    } catch {
      return createDefaultState();
    }
  };

  let state = loadState();
  let mountedHost = null;
  let exitCallback = null;
  let cachedResult = null;

  const saveState = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* optional */ }
  };

  const normalizeInput = (overrides = {}) => {
    const input = (field) => Object.prototype.hasOwnProperty.call(overrides, field)
      ? overrides[field]
      : state[field];
    const values = {
      valuationDate: String(input("valuationDate") || ""),
      currency: ["KRW", "USD", "EUR"].includes(input("currency")) ? input("currency") : "KRW",
      acquirerPrice: finiteNumber(input("acquirerPrice")),
      acquirerShares: finiteNumber(input("acquirerShares")),
      acquirerNetIncome: finiteNumber(input("acquirerNetIncome")),
      targetPrice: finiteNumber(input("targetPrice")),
      targetShares: finiteNumber(input("targetShares")),
      targetNetIncome: finiteNumber(input("targetNetIncome")),
      targetNetDebt: finiteNumber(input("targetNetDebt")),
      considerationMode: input("considerationMode") === "direct" ? "direct" : "offer-mix",
      offerPrice: finiteNumber(input("offerPrice")),
      cashMixPercent: finiteNumber(input("cashMixPercent")),
      cashPerTargetShare: finiteNumber(input("cashPerTargetShare")),
      exchangeRatio: finiteNumber(input("exchangeRatio")),
      synergyPV: finiteNumber(input("synergyPV")),
      costPV: finiteNumber(input("costPV")),
      annualSynergy: finiteNumber(input("annualSynergy")),
      annualOtherAdjustment: finiteNumber(input("annualOtherAdjustment")),
      internalCashPercent: finiteNumber(input("internalCashPercent")),
      cashYield: finiteNumber(input("cashYield")),
      debtRate: finiteNumber(input("debtRate")),
      taxRate: finiteNumber(input("taxRate")),
    };
    const scaleLimit = 1e15;
    if (
      !values.valuationDate ||
      values.acquirerPrice === null || values.acquirerPrice <= 0 || values.acquirerPrice > scaleLimit ||
      values.acquirerShares === null || values.acquirerShares <= 0 || values.acquirerShares > scaleLimit ||
      values.acquirerNetIncome === null || Math.abs(values.acquirerNetIncome) > scaleLimit ||
      values.targetPrice === null || values.targetPrice <= 0 || values.targetPrice > scaleLimit ||
      values.targetShares === null || values.targetShares <= 0 || values.targetShares > scaleLimit ||
      values.targetNetIncome === null || Math.abs(values.targetNetIncome) > scaleLimit ||
      (values.targetNetDebt !== null && Math.abs(values.targetNetDebt) > scaleLimit) ||
      values.synergyPV === null || Math.abs(values.synergyPV) > scaleLimit ||
      values.costPV === null || values.costPV < 0 || values.costPV > scaleLimit ||
      values.annualSynergy === null || Math.abs(values.annualSynergy) > scaleLimit ||
      values.annualOtherAdjustment === null || Math.abs(values.annualOtherAdjustment) > scaleLimit ||
      values.internalCashPercent === null || values.internalCashPercent < 0 || values.internalCashPercent > 100 ||
      values.cashYield === null || values.cashYield < 0 || values.cashYield > 100 ||
      values.debtRate === null || values.debtRate < 0 || values.debtRate > 100 ||
      values.taxRate === null || values.taxRate < 0 || values.taxRate > 100
    ) return null;

    if (values.considerationMode === "offer-mix") {
      if (values.offerPrice === null || values.offerPrice <= 0 || values.offerPrice > scaleLimit ||
        values.cashMixPercent === null || values.cashMixPercent < 0 || values.cashMixPercent > 100) return null;
      values.cashPerTargetShare = values.offerPrice * values.cashMixPercent / 100;
      values.exchangeRatio = (values.offerPrice - values.cashPerTargetShare) / values.acquirerPrice;
    } else {
      if (values.cashPerTargetShare === null || values.cashPerTargetShare < 0 || values.cashPerTargetShare > scaleLimit ||
        values.exchangeRatio === null || values.exchangeRatio < 0 || values.exchangeRatio > scaleLimit ||
        values.cashPerTargetShare + values.exchangeRatio * values.acquirerPrice <= 0) return null;
      values.offerPrice = values.cashPerTargetShare + values.exchangeRatio * values.acquirerPrice;
      values.cashMixPercent = values.offerPrice === 0 ? 0 : values.cashPerTargetShare / values.offerPrice * 100;
    }
    return values;
  };

  const calculateMerger = (overrides = {}, { includeScenarios = true } = {}) => {
    const input = normalizeInput(overrides);
    if (!input) return null;
    const acquirerEquityValue = input.acquirerPrice * input.acquirerShares;
    const targetEquityValue = input.targetPrice * input.targetShares;
    const headlineEquityPurchasePrice = input.offerPrice * input.targetShares;
    const cashConsideration = input.cashPerTargetShare * input.targetShares;
    const stockConsiderationAtReference = input.exchangeRatio * input.acquirerPrice * input.targetShares;
    const newShares = input.exchangeRatio * input.targetShares;
    const combinedShares = input.acquirerShares + newShares;
    const premium = headlineEquityPurchasePrice - targetEquityValue;
    const premiumPercent = input.offerPrice / input.targetPrice - 1;
    const transactionEnterpriseValue = input.targetNetDebt === null
      ? null
      : headlineEquityPurchasePrice + input.targetNetDebt;
    const equityBeforeCash = acquirerEquityValue + targetEquityValue + input.synergyPV - input.costPV;
    const postDealEquityValue = equityBeforeCash - cashConsideration;
    const postDealPrice = postDealEquityValue / combinedShares;
    const acquirerOwnership = input.acquirerShares / combinedShares;
    const targetOwnership = newShares / combinedShares;
    const acquirerShareholderValue = input.acquirerShares * postDealPrice;
    const targetShareholderValue = cashConsideration + newShares * postDealPrice;
    const targetValuePerShare = input.cashPerTargetShare + input.exchangeRatio * postDealPrice;
    const acquirerValueGain = acquirerShareholderValue - acquirerEquityValue;
    const targetValueGain = targetShareholderValue - targetEquityValue;
    const acquirerValueGainPercent = acquirerValueGain / acquirerEquityValue;
    const targetValueGainPercent = targetValueGain / targetEquityValue;
    const netSynergy = input.synergyPV - input.costPV;
    const breakevenSynergy = premium + input.costPV;
    const synergyCoverage = Math.abs(breakevenSynergy) < 1e-12 ? null : input.synergyPV / breakevenSynergy;

    const internalCash = cashConsideration * input.internalCashPercent / 100;
    const newDebt = cashConsideration - internalCash;
    const afterTaxCashOpportunityCost = internalCash * input.cashYield / 100 * (1 - input.taxRate / 100);
    const afterTaxInterest = newDebt * input.debtRate / 100 * (1 - input.taxRate / 100);
    const proFormaNetIncome = input.acquirerNetIncome + input.targetNetIncome + input.annualSynergy
      - afterTaxCashOpportunityCost - afterTaxInterest + input.annualOtherAdjustment;
    const acquirerEps = input.acquirerNetIncome / input.acquirerShares;
    const proFormaEps = proFormaNetIncome / combinedShares;
    const epsChange = proFormaEps - acquirerEps;
    const epsChangePercent = acquirerEps > 1e-12 ? proFormaEps / acquirerEps - 1 : null;

    const scale = Math.max(
      1,
      Math.abs(acquirerEquityValue),
      Math.abs(targetEquityValue),
      Math.abs(equityBeforeCash),
    );
    const tolerance = scale * 1e-8;
    const checks = {
      consideration: Math.abs(cashConsideration + stockConsiderationAtReference - headlineEquityPurchasePrice),
      shares: Math.abs(newShares - input.exchangeRatio * input.targetShares),
      ownership: Math.abs(acquirerOwnership + targetOwnership - 1),
      bridge: Math.abs(postDealEquityValue + cashConsideration - equityBeforeCash),
      allocation: Math.abs(acquirerValueGain + targetValueGain - netSynergy),
      tolerance,
    };

    const result = {
      ...input,
      acquirerEquityValue,
      targetEquityValue,
      headlineEquityPurchasePrice,
      cashConsideration,
      stockConsiderationAtReference,
      newShares,
      combinedShares,
      premium,
      premiumPercent,
      transactionEnterpriseValue,
      equityBeforeCash,
      postDealEquityValue,
      postDealPrice,
      acquirerOwnership,
      targetOwnership,
      acquirerShareholderValue,
      targetShareholderValue,
      targetValuePerShare,
      acquirerValueGain,
      targetValueGain,
      acquirerValueGainPercent,
      targetValueGainPercent,
      netSynergy,
      breakevenSynergy,
      synergyCoverage,
      internalCash,
      newDebt,
      afterTaxCashOpportunityCost,
      afterTaxInterest,
      proFormaNetIncome,
      acquirerEps,
      proFormaEps,
      epsChange,
      epsChangePercent,
      checks,
    };

    if (includeScenarios) {
      result.allCash = calculateMerger({
        ...input,
        considerationMode: "direct",
        cashPerTargetShare: input.offerPrice,
        exchangeRatio: 0,
      }, { includeScenarios: false });
      result.allStock = calculateMerger({
        ...input,
        considerationMode: "direct",
        cashPerTargetShare: 0,
        exchangeRatio: input.offerPrice / input.acquirerPrice,
      }, { includeScenarios: false });
      result.breakeven = calculateMerger({
        ...input,
        synergyPV: breakevenSynergy,
      }, { includeScenarios: false });
    }
    return result;
  };

  const validateStep = (step) => {
    const result = { error: "", warning: "" };
    const number = (field) => finiteNumber(state[field]);
    const positive = (field) => number(field) !== null && number(field) > 0 && number(field) <= 1e15;
    switch (step) {
      case 0:
        if (!state.valuationDate) result.error = "거래 분석 기준일을 입력해 주세요.";
        else if (!["KRW", "USD", "EUR"].includes(state.currency)) result.error = "표시 통화를 선택해 주세요.";
        break;
      case 1:
        if (!positive("acquirerPrice") || !positive("acquirerShares") || number("acquirerNetIncome") === null)
          result.error = "인수기업의 기준주가·희석주식수·순이익을 확인해 주세요.";
        else if (number("acquirerNetIncome") <= 0)
          result.warning = "인수기업 EPS가 0 이하이면 EPS 증감률은 N/M으로 표시됩니다.";
        break;
      case 2:
        if (!positive("targetPrice") || !positive("targetShares") || number("targetNetIncome") === null)
          result.error = "피인수기업의 기준주가·완전희석주식수·순이익을 확인해 주세요.";
        else if (state.targetNetDebt !== "" && number("targetNetDebt") === null)
          result.error = "순차입금은 숫자로 입력하거나 비워 주세요.";
        break;
      case 3:
        if (state.considerationMode === "offer-mix") {
          if (!positive("offerPrice") || number("cashMixPercent") === null || number("cashMixPercent") < 0 || number("cashMixPercent") > 100)
            result.error = "제안가와 0~100%의 현금비중을 확인해 주세요.";
        } else if (number("cashPerTargetShare") === null || number("cashPerTargetShare") < 0 ||
          number("exchangeRatio") === null || number("exchangeRatio") < 0 ||
          number("cashPerTargetShare") + number("exchangeRatio") * (number("acquirerPrice") || 0) <= 0) {
          result.error = "주당 현금대가와 교환비율 중 하나 이상을 0보다 크게 입력해 주세요.";
        }
        if (!result.error && positive("targetPrice")) {
          const currentOffer = state.considerationMode === "direct"
            ? number("cashPerTargetShare") + number("exchangeRatio") * (number("acquirerPrice") || 0)
            : number("offerPrice");
          if (currentOffer !== null && currentOffer < number("targetPrice"))
            result.warning = "피인수기업 기준주가보다 낮은 할인 거래입니다. 입력 기준일을 다시 확인해 주세요.";
        }
        break;
      case 4:
        if (number("synergyPV") === null || number("costPV") === null || number("costPV") < 0)
          result.error = "세후 시너지 현재가치와 거래·통합비용 현재가치를 확인해 주세요.";
        break;
      case 5:
        if (number("annualSynergy") === null || number("annualOtherAdjustment") === null)
          result.error = "연간 세후 시너지와 기타 세후 조정을 확인해 주세요.";
        break;
      case 6:
        if (number("internalCashPercent") === null || number("internalCashPercent") < 0 || number("internalCashPercent") > 100 ||
          number("cashYield") === null || number("cashYield") < 0 || number("cashYield") > 100 ||
          number("debtRate") === null || number("debtRate") < 0 || number("debtRate") > 100 ||
          number("taxRate") === null || number("taxRate") < 0 || number("taxRate") > 100)
          result.error = "현금 조달비중·수익률·차입금리·세율을 0~100% 범위로 입력해 주세요.";
        break;
      case REVIEW_STEP: {
        const calculated = calculateMerger({}, { includeScenarios: false });
        if (!calculated) result.error = "현재 입력으로 거래 분석을 계산할 수 없습니다.";
        else if (calculated.postDealEquityValue <= 0)
          result.warning = "거래 후 잔존 지분가치가 0 이하입니다. 모형상 비경제적인 입력입니다.";
        break;
      }
      default:
        break;
    }
    return result;
  };

  const allAssumptionsValid = () => {
    for (let step = 0; step <= REVIEW_STEP; step += 1) if (validateStep(step).error) return false;
    return true;
  };

  const readiness = () => {
    const completed = evidenceKeys.filter((key) => String(state.evidence[key] || "").trim()).length;
    return { completed, total: evidenceKeys.length, percent: Math.round(completed / evidenceKeys.length * 100) };
  };

  const renderValidation = (step) => {
    const { error, warning } = validateStep(step);
    if (error) return `<div class="guided-message error" role="alert">${escapeHtml(error)}</div>`;
    if (warning) return `<div class="guided-message warning">${escapeHtml(warning)}</div>`;
    return '<div class="guided-message" aria-live="polite"></div>';
  };

  const renderQuestionHeader = ({ eyebrow, question, description }) => `<div class="guided-question-copy"><span class="guided-eyebrow">${escapeHtml(eyebrow)}</span><h3 id="guided-ma-question-title">${escapeHtml(question)}</h3><p>${escapeHtml(description)}</p></div>`;
  const renderEvidence = (key, placeholder) => `<details class="guided-evidence"><summary><span>근거 자료 남기기</span><span class="guided-optional">선택</span></summary><label class="guided-evidence-label" for="ma-evidence-${escapeHtml(key)}">자료명 · 기준일 · 산정 메모</label><textarea id="ma-evidence-${escapeHtml(key)}" data-ma-evidence="${escapeHtml(key)}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(state.evidence[key] || "")}</textarea></details>`;
  const renderHelp = (title, body) => `<details class="guided-help"><summary>${escapeHtml(title)}</summary><div class="guided-help-body"><p>${escapeHtml(body)}</p></div></details>`;

  const renderScopeStep = () => `
    <section class="guided-question-card wide" aria-labelledby="guided-ma-question-title">
      ${renderQuestionHeader({ eyebrow: "분석 범위", question: "거래경제성과 주주가치 변화를 분석할까요?", description: "헤드라인 제안가, 시너지 배분과 EPS 효과를 보며 취득회계의 이전대가·영업권과는 분리합니다." })}
      <div class="guided-ma-scope-note"><strong>이번 분석에 포함</strong><span>현금·주식 혼합대가 · 교환비율 · 시너지 · 주주군별 가치 · EPS</span></div>
      <div class="guided-ma-basis-grid"><label><span>분석 기준일</span><input data-ma-field="valuationDate" type="date" value="${escapeHtml(state.valuationDate)}" /></label><label><span>표시 통화</span><select data-ma-field="currency"><option value="KRW" ${state.currency === "KRW" ? "selected" : ""}>KRW · 원</option><option value="USD" ${state.currency === "USD" ? "selected" : ""}>USD</option><option value="EUR" ${state.currency === "EUR" ? "selected" : ""}>EUR</option></select></label></div>
      <div data-ma-validation>${renderValidation(0)}</div>
      <div class="guided-message warning">금액과 주식수는 모두 백만 단위입니다. PPA·영업권·조건부대가·실제 취득일 가중평균주식수는 지원하지 않습니다.</div>
    </section>`;

  const renderCompanyStep = ({ target = false }) => {
    const prefix = target ? "target" : "acquirer";
    const title = target ? "피인수기업" : "인수기업";
    const price = finiteNumber(state[`${prefix}Price`]);
    const shares = finiteNumber(state[`${prefix}Shares`]);
    const equity = price !== null && shares !== null ? price * shares : null;
    return `<section class="guided-question-card wide" aria-labelledby="guided-ma-question-title">
      ${renderQuestionHeader({ eyebrow: target ? "독립가치 · 피인수기업" : "독립가치 · 인수기업", question: `${title}의 기준가치를 입력해 주세요`, description: "같은 기준일의 주가와 완전희석 주식수, 같은 전망기간의 순이익을 사용합니다." })}
      <div class="guided-ma-input-grid"><label><span>기준주가</span><div class="guided-input-wrap"><input data-ma-field="${prefix}Price" type="number" value="${escapeHtml(state[`${prefix}Price`])}" min="0.000001" step="0.01" /><span>${escapeHtml(currencyLabel())}</span></div></label><label><span>${target ? "완전희석" : "희석"} 주식수</span><div class="guided-input-wrap"><input data-ma-field="${prefix}Shares" type="number" value="${escapeHtml(state[`${prefix}Shares`])}" min="0.000001" step="0.01" /><span>백만주</span></div></label><label><span>전망기간 순이익</span><div class="guided-input-wrap"><input data-ma-field="${prefix}NetIncome" type="number" value="${escapeHtml(state[`${prefix}NetIncome`])}" step="0.01" /><span>${escapeHtml(amountUnitLabel())}</span></div></label>${target ? `<label><span>순차입금 · 선택</span><div class="guided-input-wrap"><input data-ma-field="targetNetDebt" type="number" value="${escapeHtml(state.targetNetDebt)}" step="0.01" /><span>${escapeHtml(amountUnitLabel())}</span></div></label>` : ""}</div>
      <div class="guided-ma-preview"><span>독립 지분가치</span><strong>${equity === null ? "—" : formatNumber(equity, 2)}</strong><small>${escapeHtml(amountUnitLabel())}</small></div>
      <div data-ma-validation>${renderValidation(target ? 2 : 1)}</div>
      ${renderEvidence(target ? "target" : "acquirer", `예: ${title} 기준주가·완전희석주식수·전망 순이익 출처`)}
    </section>`;
  };

  const renderConsiderationStep = () => {
    const preview = calculateMerger({}, { includeScenarios: false });
    return `<section class="guided-question-card wide" aria-labelledby="guided-ma-question-title">
      ${renderQuestionHeader({ eyebrow: "거래대가", question: "피인수기업 주주에게 무엇을 지급하나요?", description: "제안가와 현금비중 또는 계약서의 주당 현금·교환비율 중 한 방식만 사용합니다." })}
      <div class="guided-choice-grid guided-ma-mode-grid" role="group" aria-label="거래대가 입력 방식"><button type="button" class="guided-choice ${state.considerationMode === "offer-mix" ? "selected" : ""}" data-ma-mode="offer-mix" aria-pressed="${state.considerationMode === "offer-mix"}"><span class="guided-choice-icon">%</span><span class="guided-choice-copy"><strong>제안가 + 현금비중</strong><small>제안가를 현금과 주식으로 자동 분해</small></span></button><button type="button" class="guided-choice ${state.considerationMode === "direct" ? "selected" : ""}" data-ma-mode="direct" aria-pressed="${state.considerationMode === "direct"}"><span class="guided-choice-icon">x</span><span class="guided-choice-copy"><strong>계약조건 직접 입력</strong><small>주당 현금대가와 고정 교환비율</small></span></button></div>
      <div class="guided-ma-input-grid">${state.considerationMode === "offer-mix" ? `<label><span>피인수 1주당 제안가</span><div class="guided-input-wrap"><input data-ma-field="offerPrice" type="number" value="${escapeHtml(state.offerPrice)}" min="0.000001" step="0.01" /><span>${escapeHtml(currencyLabel())}</span></div></label><label><span>현금대가 비중</span><div class="guided-input-wrap"><input data-ma-field="cashMixPercent" type="number" value="${escapeHtml(state.cashMixPercent)}" min="0" max="100" step="0.1" /><span>%</span></div></label>` : `<label><span>피인수 1주당 현금</span><div class="guided-input-wrap"><input data-ma-field="cashPerTargetShare" type="number" value="${escapeHtml(state.cashPerTargetShare)}" min="0" step="0.01" /><span>${escapeHtml(currencyLabel())}</span></div></label><label><span>고정 교환비율</span><div class="guided-input-wrap"><input data-ma-field="exchangeRatio" type="number" value="${escapeHtml(state.exchangeRatio)}" min="0" step="0.001" /><span>신주/1주</span></div></label>`}</div>
      ${preview ? `<div class="guided-ma-deal-preview"><article><span>헤드라인 지분매입가</span><strong>${formatNumber(preview.headlineEquityPurchasePrice, 2)}</strong></article><article><span>현금 / 기준주가상 주식대가</span><strong>${formatNumber(preview.cashConsideration, 2)} / ${formatNumber(preview.stockConsiderationAtReference, 2)}</strong></article><article><span>교환비율 / 발행신주</span><strong>${formatNumber(preview.exchangeRatio, 6)} / ${formatNumber(preview.newShares, 3)}</strong></article></div>` : ""}
      <div data-ma-validation>${renderValidation(3)}</div>
      ${renderEvidence("consideration", "예: 계약서상 제안가 48, 현금 50% 또는 주당 현금 24·교환비율 0.48")}
    </section>`;
  };

  const renderSynergyStep = () => {
    const preview = calculateMerger({}, { includeScenarios: false });
    return `<section class="guided-question-card wide" aria-labelledby="guided-ma-question-title">
      ${renderQuestionHeader({ eyebrow: "거래경제성", question: "시너지와 거래·통합비용의 현재가치는 얼마인가요?", description: "두 값 모두 세후 현재가치로 맞추고, 비용 차감 후 시너지를 입력했다면 비용은 0으로 둡니다." })}
      <div class="guided-ma-input-grid"><label><span>세후 시너지 현재가치</span><div class="guided-input-wrap"><input data-ma-field="synergyPV" type="number" value="${escapeHtml(state.synergyPV)}" step="1" /><span>${escapeHtml(amountUnitLabel())}</span></div></label><label><span>거래·통합비용 현재가치</span><div class="guided-input-wrap"><input data-ma-field="costPV" type="number" value="${escapeHtml(state.costPV)}" min="0" step="1" /><span>${escapeHtml(amountUnitLabel())}</span></div></label></div>
      ${preview ? `<div class="guided-ma-preview"><span>인수기업 주주 손익분기 시너지</span><strong>${formatNumber(preview.breakevenSynergy, 2)}</strong><small>프리미엄 + 거래·통합비용</small></div>` : ""}
      <div data-ma-validation>${renderValidation(4)}</div>
      ${renderEvidence("synergyPV", "예: 매출·비용 시너지의 세후 현금흐름 PV 600, 거래·통합비용 PV 100")}
      ${renderHelp("왜 연간 시너지와 따로 입력하나요?", "가치분석의 시너지 PV와 EPS 분석의 특정 전망기간 순이익 효과는 단위와 기간이 다릅니다. 자동 변환하지 않아 이중계상을 막습니다.")}
    </section>`;
  };

  const renderEarningsStep = () => `
    <section class="guided-question-card wide" aria-labelledby="guided-ma-question-title">
      ${renderQuestionHeader({ eyebrow: "EPS 브리지", question: "합병 후 전망기간 순이익 효과는 얼마인가요?", description: "시너지 현재가치가 아니라 EPS와 같은 전망기간에 발생하는 세후 순이익 효과를 입력합니다." })}
      <div class="guided-ma-input-grid"><label><span>전망기간 세후 영업 시너지</span><div class="guided-input-wrap"><input data-ma-field="annualSynergy" type="number" value="${escapeHtml(state.annualSynergy)}" step="0.01" /><span>${escapeHtml(amountUnitLabel())}</span></div></label><label><span>기타 세후 조정</span><div class="guided-input-wrap"><input data-ma-field="annualOtherAdjustment" type="number" value="${escapeHtml(state.annualOtherAdjustment)}" step="0.01" /><span>${escapeHtml(amountUnitLabel())}</span></div></label></div>
      <div data-ma-validation>${renderValidation(5)}</div>
      ${renderEvidence("annualSynergy", "예: 같은 전망연도의 세후 시너지 +60, PPA 상각 등 기타 세후 조정 -10")}
      <div class="guided-message warning">기타 조정은 +이익 / −비용입니다. 시너지 PV에 포함된 금액을 EPS 순이익에 다시 더한다는 뜻이 아닙니다.</div>
    </section>`;

  const renderFundingStep = () => {
    const preview = calculateMerger({}, { includeScenarios: false });
    const allStock = preview && Math.abs(preview.cashConsideration) < 1e-12;
    return `<section class="guided-question-card wide" aria-labelledby="guided-ma-question-title">
      ${renderQuestionHeader({ eyebrow: "현금대가 조달", question: "현금대가는 내부현금과 신규차입 중 어떻게 조달하나요?", description: "내부현금의 세후 기회비용과 신규차입의 세후 이자비용을 EPS 브리지에 반영합니다." })}
      ${allStock ? '<div class="guided-message success">전액 주식대가이므로 현금 조달비용은 0으로 계산됩니다.</div>' : ""}
      <div class="guided-ma-funding-grid"><label><span>내부현금 비중</span><div class="guided-input-wrap"><input data-ma-field="internalCashPercent" type="number" value="${escapeHtml(state.internalCashPercent)}" min="0" max="100" step="0.1" ${allStock ? "disabled" : ""} /><span>%</span></div></label><label><span>내부현금 세전수익률</span><div class="guided-input-wrap"><input data-ma-field="cashYield" type="number" value="${escapeHtml(state.cashYield)}" min="0" max="100" step="0.01" ${allStock ? "disabled" : ""} /><span>%</span></div></label><label><span>신규차입 세전금리</span><div class="guided-input-wrap"><input data-ma-field="debtRate" type="number" value="${escapeHtml(state.debtRate)}" min="0" max="100" step="0.01" ${allStock ? "disabled" : ""} /><span>%</span></div></label><label><span>한계세율</span><div class="guided-input-wrap"><input data-ma-field="taxRate" type="number" value="${escapeHtml(state.taxRate)}" min="0" max="100" step="0.1" /><span>%</span></div></label></div>
      ${preview ? `<div class="guided-ma-deal-preview"><article><span>내부현금 / 신규차입</span><strong>${formatNumber(preview.internalCash, 2)} / ${formatNumber(preview.newDebt, 2)}</strong></article><article><span>세후 현금 기회비용</span><strong>${formatNumber(preview.afterTaxCashOpportunityCost, 4)}</strong></article><article><span>세후 신규 이자</span><strong>${formatNumber(preview.afterTaxInterest, 4)}</strong></article></div>` : ""}
      <div data-ma-validation>${renderValidation(6)}</div>
      ${renderEvidence("funding", "예: 현금대가의 40% 내부현금, 현금수익률 2%, 나머지 차입 5%, 세율 25%")}
    </section>`;
  };

  const reviewRows = () => {
    const result = calculateMerger({}, { includeScenarios: false });
    return [
      ["기준일 / 통화", `${state.valuationDate} / ${state.currency} · 백만 단위`, 0],
      ["인수기업 주가 / 주식수", `${formatNumber(state.acquirerPrice, 4)} / ${formatNumber(state.acquirerShares, 3)}백만주`, 1],
      ["피인수기업 주가 / 주식수", `${formatNumber(state.targetPrice, 4)} / ${formatNumber(state.targetShares, 3)}백만주`, 2],
      ["헤드라인 제안가", result ? `${formatNumber(result.offerPrice, 4)} · 현금 ${formatNumber(result.cashMixPercent, 2)}%` : "확인 필요", 3],
      ["시너지 PV / 비용 PV", `${formatNumber(state.synergyPV, 2)} / ${formatNumber(state.costPV, 2)}`, 4],
      ["연간 시너지 / 기타 조정", `${formatNumber(state.annualSynergy, 2)} / ${formatSigned(state.annualOtherAdjustment, 2)}`, 5],
      ["내부현금 / 차입", `${formatNumber(state.internalCashPercent, 2)}% / ${formatNumber(100 - Number(state.internalCashPercent || 0), 2)}%`, 6],
    ];
  };

  const renderReview = () => {
    const audit = readiness();
    const valid = allAssumptionsValid();
    return `<section class="guided-question-card wide" aria-labelledby="guided-ma-question-title">${renderQuestionHeader({ eyebrow: "최종 검토", question: "거래조건과 가치·EPS 가정의 기간을 확인해 주세요", description: "시너지 현재가치와 전망기간 순이익 효과를 분리했는지 마지막으로 확인합니다." })}<div class="guided-assumption-list">${reviewRows().map(([label, value, step]) => `<div class="guided-assumption-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><button type="button" data-ma-edit-step="${step}">수정</button></div>`).join("")}</div><div class="guided-readiness"><div><span>근거 메모</span><strong>${audit.completed}/${audit.total}</strong></div><div class="guided-readiness-track"><span style="width:${audit.percent}%"></span></div><small>기준주가·완전희석주식수·거래조건·시너지·조달 가정의 출처를 남겨 주세요.</small></div><div class="guided-message warning">이 결과는 투자은행식 거래경제성 분석입니다. 취득일 이전대가 공정가치, PPA와 영업권은 별도 회계 분석이 필요합니다.</div><div data-ma-validation>${valid ? '<div class="guided-message success">입력 검토가 끝났습니다. 거래가치와 EPS 효과를 계산할 수 있어요.</div>' : '<div class="guided-message error">일부 입력을 다시 확인해 주세요.</div>'}</div></section>`;
  };

  const renderDealPanel = (result) => `
    <div class="guided-result-hero guided-ma-result-hero"><div><span class="guided-eyebrow">M&amp;A 결과 · 버전 ${escapeHtml(state.lastVersion || 1)}</span><h3 id="guided-ma-result-title">헤드라인 지분매입가</h3><strong>${formatNumber(result.headlineEquityPurchasePrice, 2)}<small>${escapeHtml(amountUnitLabel())}</small></strong><p>피인수 1주당 ${formatNumber(result.offerPrice, 4)} · 프리미엄 ${formatSigned(result.premiumPercent * 100, 2)}%</p></div><div class="guided-result-badge">${result.cashMixPercent <= 0.0001 ? "전액 주식" : result.cashMixPercent >= 99.9999 ? "전액 현금" : "혼합대가"}</div></div>
    <div class="guided-ma-metric-grid"><article><span>현금대가</span><strong>${formatNumber(result.cashConsideration, 2)}</strong><small>${formatNumber(result.cashMixPercent, 2)}%</small></article><article><span>기준주가상 주식대가</span><strong>${formatNumber(result.stockConsiderationAtReference, 2)}</strong><small>${formatNumber(100 - result.cashMixPercent, 2)}%</small></article><article><span>교환비율</span><strong>${formatNumber(result.exchangeRatio, 6)}</strong><small>인수 신주 / 피인수 1주</small></article><article><span>발행신주</span><strong>${formatNumber(result.newShares, 3)}</strong><small>거래 후 총 ${formatNumber(result.combinedShares, 3)}백만주</small></article><article><span>피인수 독립 지분가치</span><strong>${formatNumber(result.targetEquityValue, 2)}</strong><small>프리미엄 ${formatNumber(result.premium, 2)}</small></article><article><span>Transaction EV</span><strong>${result.transactionEnterpriseValue === null ? "—" : formatNumber(result.transactionEnterpriseValue, 2)}</strong><small>지분매입가 + 피인수 순차입금</small></article></div>`;

  const renderValuePanel = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 2/4</span><h3 id="guided-ma-result-title">거래 후 가치와 주주군별 배분</h3><p>주식대가는 현금처럼 차감하지 않고, 발행신주에 따른 지분율로 잔존가치를 배분합니다.</p></div>
    <div class="guided-ma-bridge"><div><span>두 회사 독립 지분가치</span><strong>${formatNumber(result.acquirerEquityValue + result.targetEquityValue, 2)}</strong></div><div><span>+ 시너지 − 비용</span><strong>${formatSigned(result.netSynergy, 2)}</strong></div><div><span>현금 분배 전 결합 지분가치</span><strong>${formatNumber(result.equityBeforeCash, 2)}</strong></div><div><span>− 현금대가</span><strong>−${formatNumber(result.cashConsideration, 2)}</strong></div><div class="total"><span>거래 후 잔존 지분가치</span><strong>${formatNumber(result.postDealEquityValue, 2)}</strong></div></div>
    <div class="guided-ma-shareholder-grid"><article><span>기존 인수기업 주주</span><strong>${formatNumber(result.acquirerShareholderValue, 2)}</strong><small>지분율 ${formatNumber(result.acquirerOwnership * 100, 4)}% · 가치증감 ${formatSigned(result.acquirerValueGain, 2)} (${formatSigned(result.acquirerValueGainPercent * 100, 4)}%)</small></article><article><span>피인수기업 주주</span><strong>${formatNumber(result.targetShareholderValue, 2)}</strong><small>현금 포함 · 가치증감 ${formatSigned(result.targetValueGain, 2)} (${formatSigned(result.targetValueGainPercent * 100, 4)}%)</small></article><article><span>거래 후 내재 주당가치</span><strong>${formatNumber(result.postDealPrice, 6)}</strong><small>피인수 1주당 모델수령가 ${formatNumber(result.targetValuePerShare, 6)}</small></article></div>
    <div class="guided-result-note"><strong>가치배분 항등식</strong><p>두 주주군의 가치증감 합계 ${formatNumber(result.acquirerValueGain + result.targetValueGain, 4)} = 시너지 − 비용 ${formatNumber(result.netSynergy, 4)}.</p></div>`;

  const renderEpsPanel = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 3/4</span><h3 id="guided-ma-result-title">순이익과 EPS 증감 브리지</h3><p>전망기간 시작부터 100% 결합되고 시너지가 완전히 반영된 단순 pro forma입니다.</p></div>
    <div class="guided-ma-eps-bridge"><div><span>인수기업 + 피인수기업 순이익</span><strong>${formatNumber(result.acquirerNetIncome + result.targetNetIncome, 4)}</strong></div><div><span>+ 세후 영업 시너지</span><strong>${formatSigned(result.annualSynergy, 4)}</strong></div><div><span>− 현금 기회비용 − 세후 이자</span><strong>−${formatNumber(result.afterTaxCashOpportunityCost + result.afterTaxInterest, 4)}</strong></div><div><span>+ 기타 세후 조정</span><strong>${formatSigned(result.annualOtherAdjustment, 4)}</strong></div><div class="total"><span>Pro forma 순이익</span><strong>${formatNumber(result.proFormaNetIncome, 4)}</strong></div></div>
    <div class="guided-ma-eps-grid"><article><span>기존 인수기업 EPS</span><strong>${formatNumber(result.acquirerEps, 6)}</strong></article><article><span>Pro forma EPS</span><strong>${formatNumber(result.proFormaEps, 6)}</strong></article><article class="${result.epsChange >= 0 ? "positive" : "negative"}"><span>EPS 증감</span><strong>${formatSigned(result.epsChange, 6)}</strong><small>${result.epsChangePercent === null ? "증감률 N/M" : `${formatSigned(result.epsChangePercent * 100, 4)}%`}</small></article></div>
    <div class="guided-message warning">실제 취득일 가중평균주식수, PPA 상각 자동계산과 일회성 비용의 회계기간 배분은 포함하지 않습니다.</div>`;

  const passLabel = (value, tolerance) => value <= tolerance ? "통과" : "확인 필요";
  const renderChecksPanel = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 4/4</span><h3 id="guided-ma-result-title">손익분기·시나리오·범위 체크</h3><p>대가 구조가 바뀔 때의 가치배분과 계산 항등식을 확인합니다.</p></div>
    <div class="guided-ma-scenario-grid"><article><span>현재 거래 · 인수주주 가치증감</span><strong>${formatSigned(result.acquirerValueGain, 2)}</strong><small>시너지 커버리지 ${result.synergyCoverage === null ? "—" : `${formatNumber(result.synergyCoverage, 4)}x`}</small></article><article><span>전액 현금 · 인수주주 가치증감</span><strong>${formatSigned(result.allCash?.acquirerValueGain, 2)}</strong><small>발행신주 없음</small></article><article><span>전액 주식 · 인수주주 가치증감</span><strong>${formatSigned(result.allStock?.acquirerValueGain, 2)}</strong><small>현금 조달비용 0</small></article><article><span>손익분기 시너지</span><strong>${formatNumber(result.breakevenSynergy, 2)}</strong><small>그때 인수주주 증감 ${formatSigned(result.breakeven?.acquirerValueGain, 6)}</small></article></div>
    <div class="guided-assumption-list guided-ma-checks"><div class="guided-assumption-row"><span>현금 + 기준주가상 주식대가 = 헤드라인 매입가</span><strong>${passLabel(result.checks.consideration, result.checks.tolerance)}</strong></div><div class="guided-assumption-row"><span>발행신주 = 교환비율 × 피인수 주식수</span><strong>${passLabel(result.checks.shares, result.checks.tolerance)}</strong></div><div class="guided-assumption-row"><span>두 주주군 지분율 합계 = 100%</span><strong>${passLabel(result.checks.ownership, 1e-10)}</strong></div><div class="guided-assumption-row"><span>거래 후 가치 + 현금대가 = 현금 분배 전 가치</span><strong>${passLabel(result.checks.bridge, result.checks.tolerance)}</strong></div><div class="guided-assumption-row"><span>두 주주군 가치증감 합계 = 시너지 − 비용</span><strong>${passLabel(result.checks.allocation, result.checks.tolerance)}</strong></div></div>
    <div class="guided-result-note"><strong>취득회계와 분리</strong><p>회계상 취득일 이전대가는 취득일 현재 현금·발행지분·조건부대가 등의 공정가치입니다. 헤드라인 매입가와 다를 수 있으며, PPA·NCI·영업권은 이 계산기의 결과가 아닙니다.</p></div>`;

  const getResult = () => cachedResult || (cachedResult = calculateMerger());
  const renderResult = () => {
    const result = getResult();
    if (!result) return '<section class="guided-question-card"><div class="guided-message error">거래 분석을 계산할 수 없습니다. 입력을 확인해 주세요.</div></section>';
    const page = Math.min(Math.max(state.resultPage, 0), resultPanels.length - 1);
    const panels = [() => renderDealPanel(result), () => renderValuePanel(result), () => renderEpsPanel(result), () => renderChecksPanel(result)];
    return `<section class="guided-result guided-ma-result" aria-labelledby="guided-ma-result-title"><div class="guided-group-tabs" aria-label="합병 분석 결과 확인 순서">${resultPanels.map((label, index) => `<span class="${index === page ? "active" : ""} ${index < page ? "done" : ""}">${index < page ? "✓ " : ""}${escapeHtml(label)}</span>`).join("")}</div>${panels[page]()}<div class="guided-result-actions"><button type="button" class="secondary" data-ma-result-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← 이전 패널</button>${page < resultPanels.length - 1 ? `<button type="button" class="primary" data-ma-result-page="${page + 1}">다음: ${escapeHtml(resultPanels[page + 1])} →</button>` : '<button type="button" class="secondary" data-ma-action="back-to-review">가정 다시 검토</button><button type="button" class="primary" data-ma-action="new-analysis">새 M&amp;A 분석</button>'}</div></section>`;
  };

  const renderStepContent = () => {
    switch (state.step) {
      case 0: return renderScopeStep();
      case 1: return renderCompanyStep({ target: false });
      case 2: return renderCompanyStep({ target: true });
      case 3: return renderConsiderationStep();
      case 4: return renderSynergyStep();
      case 5: return renderEarningsStep();
      case 6: return renderFundingStep();
      case REVIEW_STEP: return renderReview();
      case RESULT_STEP: return renderResult();
      default: return "";
    }
  };

  const renderProgress = () => {
    const activeStep = Math.min(state.step, TOTAL_QUESTIONS - 1);
    const activeGroup = groups.findIndex((group) => activeStep >= group.start && activeStep < group.end);
    const progress = state.step === RESULT_STEP ? 100 : (state.step + 1) / TOTAL_QUESTIONS * 100;
    return `<header class="guided-progress-shell guided-ma-progress"><div class="guided-progress-topline"><div><span class="guided-product-label">M&amp;A · DEAL ECONOMICS</span><strong>${state.step === RESULT_STEP ? "분석 결과" : `${state.step + 1} / ${TOTAL_QUESTIONS}`}</strong></div><span class="guided-autosave">✓ 자동 저장됨</span><button type="button" class="guided-ma-exit" data-ma-action="exit">로드맵으로</button></div><div class="guided-group-tabs" aria-label="합병 분석 진행 구간">${groups.map((group, index) => `<span class="${index === activeGroup ? "active" : ""} ${index < activeGroup ? "done" : ""}">${index < activeGroup ? "✓ " : ""}${escapeHtml(group.label)}</span>`).join("")}</div><div class="guided-progress-track"><span style="width:${progress}%"></span></div></header>`;
  };

  const nextButtonLabel = () => ["다음: 인수기업", "다음: 피인수기업", "다음: 거래대가", "다음: 시너지", "다음: EPS 효과", "다음: 조달", "다음: 최종 검토", "계산하고 버전 저장"][state.step] || "다음";
  const renderNavigation = () => state.step === RESULT_STEP ? "" : `<footer class="guided-navigation"><button type="button" class="secondary" data-ma-action="previous" ${state.step === 0 ? "disabled" : ""}>← 이전</button><span class="guided-navigation-hint">Enter 키로 다음</span><button type="button" class="primary" data-ma-action="next" ${validateStep(state.step).error || (state.step === REVIEW_STEP && !allAssumptionsValid()) ? "disabled" : ""}>${escapeHtml(nextButtonLabel())} →</button></footer>`;

  const updateHeader = () => {
    const contentArea = mountedHost?.closest(".content-area");
    const header = contentArea?.previousElementSibling;
    if (!header?.matches("header.main-header")) return;
    const heading = header.querySelector("h2");
    const description = header.querySelector("p");
    if (heading) heading.textContent = "합병·주식교환 분석";
    if (description) description.textContent = "거래대가, 시너지 가치배분과 EPS 효과를 서로 구분해 단계별로 분석합니다.";
  };

  const render = () => {
    if (!mountedHost?.isConnected) return;
    mountedHost.innerHTML = `<div class="phase3-hub-inner guided-ma">${renderProgress()}<div class="guided-ma-stage">${renderStepContent()}${renderNavigation()}</div></div>`;
    updateHeader();
    const contentArea = mountedHost.closest(".content-area");
    if (contentArea) contentArea.scrollTop = 0;
    const focusTarget = mountedHost.querySelector("input, select, .guided-choice.selected, #guided-ma-question-title, #guided-ma-result-title");
    if (focusTarget) { if (focusTarget.matches("h1, h2, h3, h4")) focusTarget.setAttribute("tabindex", "-1"); try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus(); } }
  };

  const updateValidation = () => {
    if (!mountedHost?.isConnected) return;
    const target = mountedHost.querySelector("[data-ma-validation]");
    if (target) target.innerHTML = renderValidation(state.step);
    const next = mountedHost.querySelector('[data-ma-action="next"]');
    if (next) next.disabled = Boolean(validateStep(state.step).error) || (state.step === REVIEW_STEP && !allAssumptionsValid());
  };

  const saveSnapshot = (result) => {
    if (!result) return null;
    try {
      const raw = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
      const snapshots = Array.isArray(raw) ? raw : [];
      const version = Math.max(0, ...snapshots.map((item) => Number(item?.version) || 0)) + 1;
      snapshots.push({ schemaVersion: 1, modelVersion: "deal-economics-v1", version, savedAt: new Date().toISOString(), assumptions: { ...state, step: REVIEW_STEP }, result: { headlineEquityPurchasePrice: result.headlineEquityPurchasePrice, postDealEquityValue: result.postDealEquityValue, postDealPrice: result.postDealPrice, acquirerValueGain: result.acquirerValueGain, targetValueGain: result.targetValueGain, proFormaEps: result.proFormaEps, epsChangePercent: result.epsChangePercent } });
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots.slice(-20)));
      return version;
    } catch { return null; }
  };

  const leaveCalculator = () => {
    const host = mountedHost; const onExit = exitCallback;
    if (host) { delete host.dataset.phase3Mode; host.removeAttribute("aria-label"); }
    mountedHost = null; exitCallback = null;
    if (typeof onExit === "function") onExit();
  };

  const handleClick = (event) => {
    const host = event.currentTarget;
    if (!mountedHost || host !== mountedHost) return;
    const mode = event.target.closest("[data-ma-mode]");
    if (mode && host.contains(mode)) {
      state.considerationMode = mode.dataset.maMode === "direct" ? "direct" : "offer-mix";
      cachedResult = null; saveState(); render(); return;
    }
    const edit = event.target.closest("[data-ma-edit-step]");
    if (edit && host.contains(edit)) { state.step = Number(edit.dataset.maEditStep); saveState(); render(); return; }
    const resultPage = event.target.closest("[data-ma-result-page]");
    if (resultPage && host.contains(resultPage)) { state.resultPage = Math.min(Math.max(Number(resultPage.dataset.maResultPage) || 0, 0), resultPanels.length - 1); saveState(); render(); return; }
    const action = event.target.closest("[data-ma-action]");
    if (!action || !host.contains(action)) return;
    switch (action.dataset.maAction) {
      case "exit": leaveCalculator(); return;
      case "previous": state.step = Math.max(0, state.step - 1); break;
      case "next":
        if (validateStep(state.step).error) { updateValidation(); return; }
        if (state.step === REVIEW_STEP) { cachedResult = calculateMerger(); if (!cachedResult) { updateValidation(); return; } state.lastVersion = saveSnapshot(cachedResult); state.resultPage = 0; state.step = RESULT_STEP; }
        else state.step += 1;
        break;
      case "back-to-review": state.step = REVIEW_STEP; break;
      case "new-analysis": if (!confirm("현재 결과는 버전으로 보관됩니다. 새 M&A 분석을 시작할까요?")) return; state = createDefaultState(); cachedResult = null; break;
      default: return;
    }
    saveState(); render();
  };

  const handleInput = (event) => {
    if (!mountedHost || event.currentTarget !== mountedHost) return;
    const field = event.target.dataset.maField;
    const evidence = event.target.dataset.maEvidence;
    if (field) {
      const isText = event.target.type === "date" || event.target.tagName === "SELECT";
      state[field] = isText ? event.target.value : event.target.value === "" ? "" : Number(event.target.value);
      cachedResult = null; saveState(); updateValidation();
    }
    if (evidence) { state.evidence[evidence] = event.target.value; saveState(); }
  };

  const handleKeyDown = (event) => {
    if (!mountedHost || event.currentTarget !== mountedHost || event.key !== "Enter" || event.shiftKey || event.target.matches("textarea, button, select") || state.step === RESULT_STEP) return;
    const next = mountedHost.querySelector('[data-ma-action="next"]');
    if (next && !next.disabled) { event.preventDefault(); next.click(); }
  };

  const ensureEvents = (host) => {
    if (host.dataset.maEventsReady === "true") return;
    host.dataset.maEventsReady = "true";
    host.addEventListener("click", handleClick); host.addEventListener("input", handleInput); host.addEventListener("change", handleInput); host.addEventListener("keydown", handleKeyDown);
  };

  const mount = (host, options = {}) => {
    if (!host) return false;
    mountedHost = host; exitCallback = typeof options.onExit === "function" ? options.onExit : null;
    host.dataset.phase3Mode = "merger"; host.setAttribute("aria-label", "합병·주식교환 단계형 계산기"); ensureEvents(host); render(); return true;
  };

  const startNew = () => { state = createDefaultState(); cachedResult = null; saveState(); if (mountedHost) render(); return JSON.parse(JSON.stringify(state)); };

  globalThis.ValueScannerMerger = Object.freeze({
    calculate: (overrides = {}) => calculateMerger(overrides),
    getState: () => JSON.parse(JSON.stringify(state)),
    mount,
    startNew,
    validateStep: (step) => ({ ...validateStep(step) }),
  });
})();
