(() => {
  "use strict";

  const STORAGE_KEY = "value-scanner-guided-interest-rate-swap-v1";
  const SNAPSHOT_KEY = "value-scanner-interest-rate-swap-snapshots-v1";
  const TOTAL_QUESTIONS = 8;
  const REVIEW_STEP = TOTAL_QUESTIONS - 1;
  const RESULT_STEP = TOTAL_QUESTIONS;
  const resultPanels = ["요약", "레그·현금흐름", "금리위험"];
  const groups = [
    { label: "계약 범위", start: 0, end: 2 },
    { label: "계약 조건", start: 2, end: 4 },
    { label: "금리 곡선", start: 4, end: 6 },
    { label: "위험·검토", start: 6, end: 8 },
  ];
  const evidenceKeys = ["notional", "fixedRate", "curveRates"];

  const today = () => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const createDefaultState = () => ({
    step: 0,
    contractBasis: "new",
    direction: "pay-fixed",
    valuationDate: today(),
    notional: 100000000,
    fixedRate: 4,
    timeToMaturity: 3,
    paymentFrequency: 2,
    curveMode: "flat",
    flatRate: 5,
    spotRates: [5, 5, 5, 5, 5, 5],
    forwardRates: [5, 5, 5, 5, 5, 5],
    scenarioBumpBp: 100,
    evidence: {},
    lastVersion: null,
    resultPage: 0,
  });

  const escapeHtml = (value) => String(value ?? "")
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

  const formatNumber = (value, maximumFractionDigits = 2) =>
    new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(Number(value) || 0);

  const formatSigned = (value, maximumFractionDigits = 2) => {
    const number = Number(value) || 0;
    const formatted = formatNumber(Math.abs(number), maximumFractionDigits);
    if (number > 0) return `+${formatted}`;
    if (number < 0) return `−${formatted}`;
    return formatted;
  };

  const normalizeDirection = (value) => {
    if (["pay-fixed", "pay_fixed", "payFixed", "payer"].includes(value)) return "pay-fixed";
    if (["receive-fixed", "receive_fixed", "receiveFixed", "receiver"].includes(value))
      return "receive-fixed";
    return null;
  };

  const normalizeCurveMode = (value) => {
    if (value === "flat") return "flat";
    if (["spot", "zero", "zero-spot"].includes(value)) return "spot";
    if (["forward", "forwards"].includes(value)) return "forward";
    return null;
  };

  const normalizeRates = (value) => {
    if (Array.isArray(value)) return value.map(finiteNumber);
    if (typeof value === "string") {
      return value.split(/[\s,;]+/).filter(Boolean).map(finiteNumber);
    }
    return null;
  };

  const normalizeStoredRates = (value, fallback) => {
    const rates = normalizeRates(value);
    return rates && rates.every((rate) => rate !== null) ? rates : [...fallback];
  };

  const loadState = () => {
    const defaults = createDefaultState();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return defaults;
      const merged = { ...defaults, ...saved };
      merged.contractBasis = saved.contractBasis === "reset" ? "reset" : "new";
      merged.direction = normalizeDirection(saved.direction) || defaults.direction;
      merged.curveMode = normalizeCurveMode(saved.curveMode) || defaults.curveMode;
      merged.spotRates = normalizeStoredRates(saved.spotRates, defaults.spotRates);
      merged.forwardRates = normalizeStoredRates(saved.forwardRates, defaults.forwardRates);
      merged.step = Math.min(Math.max(Math.trunc(Number(saved.step) || 0), 0), RESULT_STEP);
      merged.resultPage = Math.min(
        Math.max(Math.trunc(Number(saved.resultPage) || 0), 0),
        resultPanels.length - 1,
      );
      merged.evidence = saved.evidence && typeof saved.evidence === "object"
        ? saved.evidence
        : {};
      return merged;
    } catch {
      return defaults;
    }
  };

  let state = loadState();
  let mountedHost = null;
  let exitCallback = null;
  let cachedResult = null;

  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 저장소가 차단돼도 계산은 계속 사용할 수 있습니다.
    }
  };

  const valueFrom = (overrides, names, fallbackName) => {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name];
    }
    return state[fallbackName];
  };

  const normalizeInput = (overrides = {}) => {
    const direction = normalizeDirection(valueFrom(overrides, ["direction", "position"], "direction"));
    const curveMode = normalizeCurveMode(
      valueFrom(overrides, ["curveMode", "curveType"], "curveMode"),
    );
    const notional = finiteNumber(
      valueFrom(overrides, ["notional", "principal", "N"], "notional"),
    );
    const fixedRate = finiteNumber(
      valueFrom(overrides, ["fixedRate", "fixedRatePercent", "couponRate", "K"], "fixedRate"),
    );
    const timeToMaturity = finiteNumber(
      valueFrom(
        overrides,
        ["timeToMaturity", "maturityYears", "maturity", "T"],
        "timeToMaturity",
      ),
    );
    const paymentFrequency = finiteNumber(
      valueFrom(
        overrides,
        ["paymentFrequency", "frequency", "paymentsPerYear", "m"],
        "paymentFrequency",
      ),
    );
    const flatRate = finiteNumber(
      valueFrom(overrides, ["flatRate", "curveRate", "marketRate", "rate", "r"], "flatRate"),
    );
    const scenarioBumpBp = finiteNumber(
      valueFrom(overrides, ["scenarioBumpBp", "scenarioBp", "bumpBp"], "scenarioBumpBp"),
    );
    const paymentCount = timeToMaturity === null || paymentFrequency === null
      ? null
      : timeToMaturity * paymentFrequency;
    const roundedPaymentCount = paymentCount === null ? null : Math.round(paymentCount);

    let rates = null;
    if (curveMode === "spot") {
      rates = normalizeRates(valueFrom(
        overrides,
        ["spotRates", "spotCurve", "curveRates", "rates"],
        "spotRates",
      ));
    } else if (curveMode === "forward") {
      rates = normalizeRates(valueFrom(
        overrides,
        ["forwardRates", "forwardCurve", "curveRates", "rates"],
        "forwardRates",
      ));
    }

    if (
      !direction ||
      !curveMode ||
      notional === null || notional <= 0 || notional > 1000000000000000 ||
      fixedRate === null || fixedRate < -100 || fixedRate > 100 ||
      timeToMaturity === null || timeToMaturity <= 0 || timeToMaturity > 30 ||
      ![1, 2, 4, 12].includes(paymentFrequency) ||
      paymentCount === null ||
      Math.abs(paymentCount - roundedPaymentCount) > 1e-8 ||
      roundedPaymentCount < 1 || roundedPaymentCount > 60 ||
      scenarioBumpBp === null || scenarioBumpBp <= 0 || scenarioBumpBp > 1000 ||
      (curveMode === "flat" && (
        flatRate === null ||
        flatRate <= -100 * paymentFrequency
      )) ||
      (curveMode !== "flat" && (
        !rates ||
        rates.length !== roundedPaymentCount ||
        rates.some((rate) =>
          rate === null || rate <= -100 * paymentFrequency)
      ))
    ) return null;

    return {
      contractBasis: valueFrom(overrides, ["contractBasis"], "contractBasis") === "reset"
        ? "reset"
        : "new",
      direction,
      position: direction,
      notional,
      fixedRate,
      timeToMaturity,
      paymentFrequency,
      paymentCount: roundedPaymentCount,
      curveMode,
      flatRate,
      spotRates: curveMode === "spot" ? rates : null,
      forwardRates: curveMode === "forward" ? rates : null,
      scenarioBumpBp,
    };
  };

  const buildDiscountFactors = (input) => {
    const factors = [];
    if (input.curveMode === "flat") {
      const periodBase = 1 + (input.flatRate / 100) / input.paymentFrequency;
      if (periodBase <= 0) return null;
      for (let period = 1; period <= input.paymentCount; period += 1)
        factors.push(Math.pow(periodBase, -period));
    } else if (input.curveMode === "spot") {
      for (let period = 1; period <= input.paymentCount; period += 1) {
        const periodBase = 1 + (input.spotRates[period - 1] / 100) / input.paymentFrequency;
        if (periodBase <= 0) return null;
        factors.push(Math.pow(periodBase, -period));
      }
    } else {
      let accumulation = 1;
      for (let period = 1; period <= input.paymentCount; period += 1) {
        const periodBase =
          1 + (input.forwardRates[period - 1] / 100) / input.paymentFrequency;
        if (periodBase <= 0) return null;
        accumulation *= periodBase;
        factors.push(1 / accumulation);
      }
    }
    if (factors.some((factor) => !Number.isFinite(factor) || factor <= 0)) return null;
    return factors;
  };

  const calculateCore = (input) => {
    const discountFactors = buildDiscountFactors(input);
    if (!discountFactors) return null;
    const frequency = input.paymentFrequency;
    const fixedRateDecimal = input.fixedRate / 100;
    const annuityFactor = discountFactors.reduce(
      (sum, discountFactor) => sum + discountFactor / frequency,
      0,
    );
    const maturityDiscountFactor = discountFactors[discountFactors.length - 1];
    const fixedLegPresentValue = input.notional * fixedRateDecimal * annuityFactor;
    const floatingLegPresentValue = input.notional * (1 - maturityDiscountFactor);
    const parRateDecimal = (1 - maturityDiscountFactor) / annuityFactor;
    const payFixedValue = floatingLegPresentValue - fixedLegPresentValue;
    const directionSign = input.direction === "pay-fixed" ? 1 : -1;
    const value = directionSign * payFixedValue;

    let previousDiscountFactor = 1;
    const cashFlows = discountFactors.map((discountFactor, index) => {
      const period = index + 1;
      const impliedForwardRateDecimal =
        frequency * (previousDiscountFactor / discountFactor - 1);
      const fixedCashFlow = input.notional * fixedRateDecimal / frequency;
      const floatingCashFlow = input.notional * impliedForwardRateDecimal / frequency;
      const fixedPresentValue = fixedCashFlow * discountFactor;
      const floatingPresentValue = floatingCashFlow * discountFactor;
      const payFixedNetCashFlow = floatingCashFlow - fixedCashFlow;
      const selectedNetCashFlow = directionSign * payFixedNetCashFlow;
      const selectedNetPresentValue = selectedNetCashFlow * discountFactor;
      previousDiscountFactor = discountFactor;
      return {
        period,
        paymentTime: period / frequency,
        discountFactor,
        impliedForwardRate: impliedForwardRateDecimal * 100,
        fixedCashFlow,
        floatingCashFlow,
        fixedPresentValue,
        floatingPresentValue,
        netCashFlow: selectedNetCashFlow,
        netPresentValue: selectedNetPresentValue,
      };
    });

    return {
      ...input,
      discountFactors,
      maturityDiscountFactor,
      Pn: maturityDiscountFactor,
      annuityFactor,
      fixedLegPresentValue,
      fixedLegPV: fixedLegPresentValue,
      fixedPV: fixedLegPresentValue,
      fixedLegValue: fixedLegPresentValue,
      floatingLegPresentValue,
      floatingLegPV: floatingLegPresentValue,
      floatingPV: floatingLegPresentValue,
      floatingLegValue: floatingLegPresentValue,
      parRate: parRateDecimal * 100,
      parSwapRate: parRateDecimal * 100,
      parRateDecimal,
      payFixedValue,
      value,
      swapValue: value,
      cashFlows,
    };
  };

  const bumpCurve = (input, bumpBp) => {
    const bumpPercent = bumpBp / 100;
    if (input.curveMode === "flat") return { ...input, flatRate: input.flatRate + bumpPercent };
    if (input.curveMode === "spot") {
      return {
        ...input,
        spotRates: input.spotRates.map((rate) => rate + bumpPercent),
      };
    }
    return {
      ...input,
      forwardRates: input.forwardRates.map((rate) => rate + bumpPercent),
    };
  };

  const calculateInterestRateSwap = (overrides = {}, { includeRisk = true } = {}) => {
    const input = normalizeInput(overrides);
    if (!input) return null;
    const result = calculateCore(input);
    if (!result) return null;
    if (!includeRisk) return result;

    const plusOneBp = calculateCore(bumpCurve(input, 1));
    const minusOneBp = calculateCore(bumpCurve(input, -1));
    const scenarioUp = calculateCore(bumpCurve(input, input.scenarioBumpBp));
    const scenarioDown = calculateCore(bumpCurve(input, -input.scenarioBumpBp));
    const dv01 = plusOneBp && minusOneBp
      ? (plusOneBp.value - minusOneBp.value) / 2
      : null;
    const fixedLegDv01 = plusOneBp && minusOneBp
      ? (plusOneBp.fixedLegPresentValue - minusOneBp.fixedLegPresentValue) / 2
      : null;
    const floatingLegDv01 = plusOneBp && minusOneBp
      ? (plusOneBp.floatingLegPresentValue - minusOneBp.floatingLegPresentValue) / 2
      : null;
    return {
      ...result,
      dv01,
      absoluteDV01: dv01 === null ? null : Math.abs(dv01),
      signedOneBpChange: dv01,
      plusOneBpChange: dv01,
      rateUpOneBpChange: dv01,
      fixedLegDv01,
      floatingLegDv01,
      scenarioUp: scenarioUp ? {
        bumpBp: input.scenarioBumpBp,
        value: scenarioUp.value,
        change: scenarioUp.value - result.value,
        parRate: scenarioUp.parRate,
      } : null,
      scenarioDown: scenarioDown ? {
        bumpBp: -input.scenarioBumpBp,
        value: scenarioDown.value,
        change: scenarioDown.value - result.value,
        parRate: scenarioDown.parRate,
      } : null,
    };
  };

  const requiredRateCount = () => {
    const maturity = finiteNumber(state.timeToMaturity);
    const frequency = finiteNumber(state.paymentFrequency);
    if (
      maturity === null || frequency === null ||
      ![1, 2, 4, 12].includes(frequency) ||
      maturity <= 0
    ) return 0;
    const count = maturity * frequency;
    return Math.abs(count - Math.round(count)) <= 1e-8 ? Math.round(count) : 0;
  };

  const ensureCurveLength = () => {
    const count = requiredRateCount();
    if (!count) return;
    const fallback = finiteNumber(state.flatRate) ?? 5;
    ["spotRates", "forwardRates"].forEach((field) => {
      const source = Array.isArray(state[field]) ? state[field] : [];
      const next = [];
      for (let index = 0; index < count; index += 1) {
        const previous = finiteNumber(source[index]);
        const last = finiteNumber(source[source.length - 1]);
        next.push(previous ?? last ?? fallback);
      }
      state[field] = next;
    });
  };

  const validateStep = (step) => {
    const result = { error: "", warning: "" };
    const number = (field) => finiteNumber(state[field]);
    switch (step) {
      case 0:
        if (!["new", "reset"].includes(state.contractBasis))
          result.error = "신규 계약 또는 변동금리 리셋 직후 중 하나를 선택해 주세요.";
        break;
      case 1:
        if (!normalizeDirection(state.direction))
          result.error = "고정금리 지급 또는 수취 방향을 선택해 주세요.";
        break;
      case 2:
        if (!state.valuationDate) result.error = "평가 기준일을 입력해 주세요.";
        else if (number("notional") === null || number("notional") <= 0)
          result.error = "명목원금은 0보다 커야 합니다.";
        else if (number("notional") > 1000000000000000)
          result.error = "명목원금은 1,000조 이하여야 합니다.";
        break;
      case 3: {
        const count = number("timeToMaturity") * number("paymentFrequency");
        if (number("fixedRate") === null || number("fixedRate") < -100 ||
          number("fixedRate") > 100)
          result.error = "고정금리는 -100%에서 100% 사이로 입력해 주세요.";
        else if (number("timeToMaturity") === null || number("timeToMaturity") <= 0 ||
          number("timeToMaturity") > 30)
          result.error = "잔존만기는 0년보다 크고 30년 이하여야 합니다.";
        else if (![1, 2, 4, 12].includes(number("paymentFrequency")))
          result.error = "지급주기는 연 1·2·4·12회 중에서 선택해 주세요.";
        else if (!Number.isFinite(count) || Math.abs(count - Math.round(count)) > 1e-8)
          result.error = "잔존만기는 선택한 지급주기의 완전한 기간 수가 되어야 합니다.";
        else if (Math.round(count) > 60)
          result.error = "현금흐름은 최대 60개까지 입력할 수 있습니다.";
        break;
      }
      case 4:
        if (!normalizeCurveMode(state.curveMode))
          result.error = "평탄·스폿·포워드 중 금리곡선 입력 방식을 선택해 주세요.";
        break;
      case 5: {
        const count = requiredRateCount();
        if (!count) result.error = "앞 단계의 만기와 지급주기를 다시 확인해 주세요.";
        else if (state.curveMode === "flat") {
          if (number("flatRate") === null)
            result.error = "평탄 금리를 입력해 주세요.";
          else if (number("flatRate") <= -100 * number("paymentFrequency"))
            result.error = "할인계수가 양수가 되도록 평탄 금리를 조정해 주세요.";
        } else {
          const rates = state.curveMode === "spot" ? state.spotRates : state.forwardRates;
          if (!Array.isArray(rates) || rates.length !== count ||
            rates.some((rate) => finiteNumber(rate) === null))
            result.error = `각 지급시점의 금리 ${count}개를 모두 입력해 주세요.`;
          else if (rates.some((rate) =>
            Number(rate) <= -100 * number("paymentFrequency")))
            result.error = "할인계수가 양수가 되도록 금리 입력값을 조정해 주세요.";
        }
        break;
      }
      case 6:
        if (number("scenarioBumpBp") === null || number("scenarioBumpBp") <= 0 ||
          number("scenarioBumpBp") > 1000)
          result.error = "시나리오 이동폭은 0bp보다 크고 1,000bp 이하여야 합니다.";
        else {
          const riskResult = calculateInterestRateSwap();
          if (!riskResult)
            result.error = "앞 단계의 입력과 금리곡선을 다시 확인해 주세요.";
          else if (riskResult.dv01 === null)
            result.error = "현재 금리에서는 ±1bp 할인계수가 양수가 되지 않습니다.";
          else if (!riskResult.scenarioUp || !riskResult.scenarioDown)
            result.error = "선택한 시나리오 폭에서 할인계수가 양수가 되도록 이동폭을 줄여 주세요.";
        }
        break;
      case REVIEW_STEP:
        if (!calculateInterestRateSwap({}, { includeRisk: false }))
          result.error = "현재 입력으로 스왑 가치를 계산할 수 없습니다.";
        break;
      default:
        break;
    }
    return result;
  };

  const allAssumptionsValid = () => {
    for (let step = 0; step <= REVIEW_STEP; step += 1)
      if (validateStep(step).error) return false;
    return true;
  };

  const readiness = () => {
    const completed = evidenceKeys.filter(
      (key) => String(state.evidence[key] || "").trim(),
    ).length;
    return {
      completed,
      total: evidenceKeys.length,
      percent: Math.round(completed / evidenceKeys.length * 100),
    };
  };

  const renderValidation = (step) => {
    const { error, warning } = validateStep(step);
    if (error) return `<div class="guided-message error" role="alert">${escapeHtml(error)}</div>`;
    if (warning) return `<div class="guided-message warning">${escapeHtml(warning)}</div>`;
    return '<div class="guided-message" aria-live="polite"></div>';
  };

  const renderQuestionHeader = ({ eyebrow, question, description }) =>
    `<div class="guided-question-copy"><span class="guided-eyebrow">${escapeHtml(eyebrow)}</span><h3 id="guided-irs-question-title">${escapeHtml(question)}</h3><p>${escapeHtml(description)}</p></div>`;

  const renderEvidence = (key, placeholder) =>
    `<details class="guided-evidence"><summary><span>근거 자료 남기기</span><span class="guided-optional">선택</span></summary><label class="guided-evidence-label" for="irs-evidence-${escapeHtml(key)}">문서명 · 조항 · 기준일 또는 산정 메모</label><textarea id="irs-evidence-${escapeHtml(key)}" data-irs-evidence="${escapeHtml(key)}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(state.evidence[key] || "")}</textarea></details>`;

  const renderScopeStep = () => `
    <section class="guided-question-card wide" aria-labelledby="guided-irs-question-title">
      ${renderQuestionHeader({
        eyebrow: "적용 범위",
        question: "신규 계약인가요, 변동금리 리셋 직후인가요?",
        description: "이 계산기는 평가시점의 변동금리 레그 가치가 명목원금과 같아지는 표준 단일통화 IRS를 다룹니다.",
      })}
      <div class="guided-choice-grid guided-irs-scope-grid" role="group" aria-label="계약 기준">
        <button type="button" class="guided-choice ${state.contractBasis === "new" ? "selected" : ""}" data-irs-contract-basis="new" aria-pressed="${state.contractBasis === "new"}"><span class="guided-choice-icon">N</span><span class="guided-choice-copy"><strong>신규 계약</strong><small>첫 지급기간이 방금 시작됨</small></span></button>
        <button type="button" class="guided-choice ${state.contractBasis === "reset" ? "selected" : ""}" data-irs-contract-basis="reset" aria-pressed="${state.contractBasis === "reset"}"><span class="guided-choice-icon">R</span><span class="guided-choice-copy"><strong>리셋 직후</strong><small>변동금리가 방금 재설정됨</small></span></button>
      </div>
      <div class="guided-message warning">평가기간 중간의 경과이자, 서로 다른 레그 주기, 기초금리 스프레드, 담보·복수통화 조건은 이 단순형 범위에 포함되지 않습니다.</div>
      <div data-irs-validation>${renderValidation(0)}</div>
    </section>`;

  const renderDirectionStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-irs-question-title">
      ${renderQuestionHeader({
        eyebrow: "포지션",
        question: "고정금리를 지급하나요, 수취하나요?",
        description: "같은 계약도 포지션 방향에 따라 평가가치와 금리 민감도의 부호가 반대가 됩니다.",
      })}
      <div class="guided-choice-grid guided-irs-direction-grid" role="group" aria-label="스왑 방향">
        <button type="button" class="guided-choice ${state.direction === "pay-fixed" ? "selected" : ""}" data-irs-direction="pay-fixed" aria-pressed="${state.direction === "pay-fixed"}"><span class="guided-choice-icon">↑</span><span class="guided-choice-copy"><strong>고정 지급 · 변동 수취</strong><small>금리 상승 시 일반적으로 가치 상승</small></span></button>
        <button type="button" class="guided-choice ${state.direction === "receive-fixed" ? "selected" : ""}" data-irs-direction="receive-fixed" aria-pressed="${state.direction === "receive-fixed"}"><span class="guided-choice-icon">↓</span><span class="guided-choice-copy"><strong>고정 수취 · 변동 지급</strong><small>금리 하락 시 일반적으로 가치 상승</small></span></button>
      </div>
      <div data-irs-validation>${renderValidation(1)}</div>
    </section>`;

  const renderBasisStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-irs-question-title">
      ${renderQuestionHeader({
        eyebrow: "평가 기준",
        question: "평가일과 명목원금은 얼마인가요?",
        description: "명목원금은 실제 교환하지 않고 두 레그의 이자 현금흐름 산정 기준으로 사용합니다.",
      })}
      <div class="guided-input-grid guided-irs-basis-grid">
        <label><span>평가 기준일</span><input type="date" data-irs-field="valuationDate" value="${escapeHtml(state.valuationDate)}"></label>
        <label><span>명목원금</span><div class="guided-input-suffix"><input type="number" min="0.01" step="1000000" data-irs-field="notional" value="${escapeHtml(state.notional)}"><span>원</span></div></label>
      </div>
      ${renderEvidence("notional", "계약서 명목원금 조항")}
      <div data-irs-validation>${renderValidation(2)}</div>
    </section>`;

  const renderTermsStep = () => {
    const count = requiredRateCount();
    return `
      <section class="guided-question-card" aria-labelledby="guided-irs-question-title">
        ${renderQuestionHeader({
          eyebrow: "고정 레그",
          question: "고정금리·잔존만기·지급주기는 어떻게 되나요?",
          description: "고정 레그와 변동 레그가 같은 주기로 지급되는 표준 구조를 가정합니다.",
        })}
        <div class="guided-input-grid guided-irs-terms-grid">
          <label><span>계약 고정금리</span><div class="guided-input-suffix"><input type="number" min="-100" max="100" step="0.01" data-irs-field="fixedRate" value="${escapeHtml(state.fixedRate)}"><span>%</span></div></label>
          <label><span>잔존만기</span><div class="guided-input-suffix"><input type="number" min="0.083333" max="30" step="0.25" data-irs-field="timeToMaturity" value="${escapeHtml(state.timeToMaturity)}"><span>년</span></div></label>
          <label><span>연 지급횟수</span><select data-irs-field="paymentFrequency">${[1, 2, 4, 12].map((frequency) => `<option value="${frequency}" ${Number(state.paymentFrequency) === frequency ? "selected" : ""}>연 ${frequency}회</option>`).join("")}</select></label>
        </div>
        <div class="guided-irs-period-preview"><span>예상 현금흐름 수</span><strong>${count || "—"}회</strong><small>각 기간 말 지급 · 원금 교환 없음</small></div>
        ${renderEvidence("fixedRate", "계약서 고정금리 및 지급주기 조항")}
        <div data-irs-validation>${renderValidation(3)}</div>
      </section>`;
  };

  const renderCurveModeStep = () => `
    <section class="guided-question-card wide" aria-labelledby="guided-irs-question-title">
      ${renderQuestionHeader({
        eyebrow: "금리 곡선",
        question: "할인곡선을 어떤 방식으로 입력할까요?",
        description: "모든 레그를 하나의 곡선으로 할인하고 변동 현금흐름도 같은 곡선에서 도출합니다.",
      })}
      <div class="guided-choice-grid guided-irs-curve-grid" role="group" aria-label="금리곡선 방식">
        <button type="button" class="guided-choice ${state.curveMode === "flat" ? "selected" : ""}" data-irs-curve-mode="flat" aria-pressed="${state.curveMode === "flat"}"><span class="guided-choice-icon">—</span><span class="guided-choice-copy"><strong>평탄 금리</strong><small>모든 만기에 동일한 금리</small></span></button>
        <button type="button" class="guided-choice ${state.curveMode === "spot" ? "selected" : ""}" data-irs-curve-mode="spot" aria-pressed="${state.curveMode === "spot"}"><span class="guided-choice-icon">S</span><span class="guided-choice-copy"><strong>스폿 금리</strong><small>지급시점별 제로금리</small></span></button>
        <button type="button" class="guided-choice ${state.curveMode === "forward" ? "selected" : ""}" data-irs-curve-mode="forward" aria-pressed="${state.curveMode === "forward"}"><span class="guided-choice-icon">F</span><span class="guided-choice-copy"><strong>포워드 금리</strong><small>기간별 선도금리</small></span></button>
      </div>
      <div class="guided-result-note"><strong>복리 기준</strong><p>연 ${formatNumber(state.paymentFrequency, 0)}회 복리로 할인합니다. 스폿 금리 zᵢ는 Dᵢ=(1+zᵢ/m)⁻ⁱ, 포워드 금리 fᵢ는 Dᵢ=∏(1+fⱼ/m)⁻¹로 변환합니다.</p></div>
      <div data-irs-validation>${renderValidation(4)}</div>
    </section>`;

  const renderRateInputs = (rates, mode) => {
    const count = requiredRateCount();
    const frequency = Number(state.paymentFrequency) || 1;
    return `<div class="guided-irs-rate-grid">${Array.from({ length: count }, (_, index) => {
      const time = (index + 1) / frequency;
      return `<label><span>${formatNumber(time, 4)}년 ${mode === "spot" ? "스폿" : "포워드"}</span><div class="guided-input-suffix"><input type="number" step="0.01" data-irs-rate-index="${index}" data-irs-rate-kind="${mode}" value="${escapeHtml(rates[index] ?? "")}"><span>%</span></div></label>`;
    }).join("")}</div>`;
  };

  const renderRatesStep = () => {
    ensureCurveLength();
    let body = "";
    if (state.curveMode === "flat") {
      body = `<div class="guided-input-grid guided-irs-flat-grid"><label><span>전 만기 평탄 금리</span><div class="guided-input-suffix"><input type="number" step="0.01" data-irs-field="flatRate" value="${escapeHtml(state.flatRate)}"><span>%</span></div></label></div>`;
    } else if (state.curveMode === "spot") {
      body = renderRateInputs(state.spotRates, "spot");
    } else {
      body = renderRateInputs(state.forwardRates, "forward");
    }
    return `
      <section class="guided-question-card wide" aria-labelledby="guided-irs-question-title">
        ${renderQuestionHeader({
          eyebrow: "시장 입력",
          question: state.curveMode === "flat" ? "평탄 금리는 몇 %인가요?" : `${state.curveMode === "spot" ? "스폿" : "포워드"} 금리를 지급시점별로 입력해 주세요.`,
          description: "금리는 퍼센트 단위이며 계약의 지급주기와 같은 복리 기준으로 입력합니다.",
        })}
        ${body}
        ${renderEvidence("curveRates", "평가일 금리곡선 출처와 부트스트랩 메모")}
        <div data-irs-validation>${renderValidation(5)}</div>
      </section>`;
  };

  const renderRiskStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-irs-question-title">
      ${renderQuestionHeader({
        eyebrow: "위험 시나리오",
        question: "평행 금리 시나리오를 몇 bp로 볼까요?",
        description: "DV01은 별도로 ±1bp 중앙차분하고, 여기서 정한 폭은 결과의 상승·하락 시나리오에 사용합니다.",
      })}
      <div class="guided-input-grid guided-irs-risk-grid">
        <label><span>시나리오 이동폭</span><div class="guided-input-suffix"><input type="number" min="1" max="1000" step="1" data-irs-field="scenarioBumpBp" value="${escapeHtml(state.scenarioBumpBp)}"><span>bp</span></div></label>
      </div>
      <div class="guided-irs-scenario-preview"><article><span>하락 시나리오</span><strong>−${formatNumber(state.scenarioBumpBp, 0)}bp</strong></article><article><span>상승 시나리오</span><strong>+${formatNumber(state.scenarioBumpBp, 0)}bp</strong></article></div>
      <div data-irs-validation>${renderValidation(6)}</div>
    </section>`;

  const renderReview = () => {
    const ready = readiness();
    const valid = allAssumptionsValid();
    const curveDescription = state.curveMode === "flat"
      ? `평탄 ${formatNumber(state.flatRate, 4)}%`
      : `${state.curveMode === "spot" ? "스폿" : "포워드"} ${requiredRateCount()}개`;
    const rows = [
      ["계약 기준", state.contractBasis === "new" ? "신규 계약" : "리셋 직후", 0],
      ["포지션", state.direction === "pay-fixed" ? "고정 지급 · 변동 수취" : "고정 수취 · 변동 지급", 1],
      ["명목원금", `${formatNumber(state.notional, 2)}원`, 2],
      ["고정 조건", `${formatNumber(state.fixedRate, 4)}% · ${formatNumber(state.timeToMaturity, 4)}년 · 연 ${formatNumber(state.paymentFrequency, 0)}회`, 3],
      ["금리 곡선", curveDescription, 5],
      ["시나리오", `±${formatNumber(state.scenarioBumpBp, 0)}bp`, 6],
    ];
    return `
      <section class="guided-question-card wide" aria-labelledby="guided-irs-question-title">
        ${renderQuestionHeader({
          eyebrow: "최종 검토",
          question: "계약과 금리곡선 가정을 확인해 주세요.",
          description: "고정·변동 레그 현재가치, 파 스왑금리와 금리위험을 함께 계산합니다.",
        })}
        <div class="guided-readiness"><div><span>근거 기록 완성도</span><strong>${ready.completed}/${ready.total}</strong></div><div class="guided-readiness-track"><span style="width:${ready.percent}%"></span></div></div>
        <div class="guided-assumption-list">${rows.map(([label, value, step]) => `<button type="button" class="guided-assumption-row" data-irs-edit-step="${step}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>수정</small></button>`).join("")}</div>
        <div class="guided-result-note"><strong>모형 범위</strong><p>표준 단일통화 IRS, 동일 지급주기, 신규 또는 리셋 직후, 단일 할인곡선 기준입니다. 경과이자·기초금리 스프레드·복수곡선·담보조정은 미반영입니다.</p></div>
        <div data-irs-validation>${valid ? '<div class="guided-message success">입력 검토가 끝났습니다. 스왑 가치를 계산할 수 있어요.</div>' : '<div class="guided-message error">일부 입력을 다시 확인해 주세요.</div>'}</div>
      </section>`;
  };

  const getResult = () => cachedResult || (cachedResult = calculateInterestRateSwap());

  const renderSummary = (result) => `
    <div class="guided-result-hero guided-irs-result-hero">
      <div><span class="guided-eyebrow">IRS 결과 · 버전 ${escapeHtml(state.lastVersion || 1)}</span><h3 id="guided-irs-result-title">이자율스왑 추정가치</h3><strong>${formatSigned(result.value, 2)}<small>원</small></strong><p>${result.direction === "pay-fixed" ? "고정 지급 · 변동 수취" : "고정 수취 · 변동 지급"} · 평가일 ${escapeHtml(state.valuationDate)}</p></div>
      <div class="guided-result-badge">${result.curveMode.toUpperCase()} CURVE</div>
    </div>
    <div class="guided-irs-summary-grid">
      <article class="total"><span>스왑 가치</span><strong>${formatSigned(result.value, 2)}</strong><small>${result.direction === "pay-fixed" ? "변동 레그 − 고정 레그" : "고정 레그 − 변동 레그"} · ${result.value >= 0 ? "자산" : "부채"}</small></article>
      <article><span>파 스왑금리</span><strong>${formatNumber(result.parRate, 6)}%</strong><small>현재 곡선에서 가치가 0인 고정금리</small></article>
      <article><span>금리 +1bp 변화</span><strong>${formatSigned(result.dv01, 2)}</strong><small>±1bp 중앙차분 DV01</small></article>
      <article><span>만기 할인계수 Pₙ</span><strong>${formatNumber(result.maturityDiscountFactor, 9)}</strong><small>${formatNumber(result.timeToMaturity, 4)}년</small></article>
      <article><span>스왑 연금계수 A</span><strong>${formatNumber(result.annuityFactor, 9)}</strong><small>Σ Dᵢ / ${formatNumber(result.paymentFrequency, 0)}</small></article>
    </div>
    <div class="guided-message warning">양수는 선택한 포지션에 유리한 가치, 음수는 불리한 가치입니다. 실제 청산가에는 신용·담보·유동성 조정이 추가될 수 있습니다.</div>`;

  const renderLegs = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 2/3</span><h3 id="guided-irs-result-title">레그 현재가치와 현금흐름</h3><p>각 기간의 선도금리, 현금흐름과 할인 현재가치를 같은 곡선에서 계산했습니다.</p></div>
    <div class="guided-irs-leg-grid">
      <article><span>고정 레그 현재가치</span><strong>${formatNumber(result.fixedLegPresentValue, 4)}</strong><small>N × K × A</small></article>
      <article><span>변동 레그 현재가치</span><strong>${formatNumber(result.floatingLegPresentValue, 4)}</strong><small>N × (1 − Pₙ)</small></article>
      <article><span>고정 레그 +1bp</span><strong>${formatSigned(result.fixedLegDv01, 4)}</strong><small>할인곡선 평행 이동</small></article>
      <article><span>변동 레그 +1bp</span><strong>${formatSigned(result.floatingLegDv01, 4)}</strong><small>할인·선도 동시 이동</small></article>
    </div>
    <div class="guided-table-wrap guided-irs-cashflow-table">
      <table>
        <thead><tr><th>회차</th><th>시점</th><th>할인계수</th><th>선도금리</th><th>고정 현금흐름</th><th>변동 현금흐름</th><th>선택 포지션 순PV</th></tr></thead>
        <tbody>${result.cashFlows.map((flow) => `<tr><th>${flow.period}</th><td>${formatNumber(flow.paymentTime, 4)}년</td><td>${formatNumber(flow.discountFactor, 9)}</td><td>${formatNumber(flow.impliedForwardRate, 6)}%</td><td>${formatNumber(flow.fixedCashFlow, 2)}</td><td>${formatNumber(flow.floatingCashFlow, 2)}</td><td class="${flow.netPresentValue >= 0 ? "positive" : "negative"}">${formatSigned(flow.netPresentValue, 2)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><th colspan="4">현재가치 합계</th><td>${formatNumber(result.fixedLegPresentValue, 2)}</td><td>${formatNumber(result.floatingLegPresentValue, 2)}</td><td>${formatSigned(result.value, 2)}</td></tr></tfoot>
      </table>
    </div>`;

  const renderRisk = (result) => {
    const zeroRateCheck = calculateInterestRateSwap(
      { ...result, fixedRate: result.parRate },
      { includeRisk: false },
    );
    const oppositeDirection = calculateInterestRateSwap(
      {
        ...result,
        direction: result.direction === "pay-fixed" ? "receive-fixed" : "pay-fixed",
      },
      { includeRisk: false },
    );
    const flatSpotCheck = result.curveMode === "flat"
      ? calculateInterestRateSwap(
        {
          ...result,
          curveMode: "spot",
          spotRates: Array(result.paymentCount).fill(result.flatRate),
        },
        { includeRisk: false },
      )
      : null;
    return `
      <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 3/3</span><h3 id="guided-irs-result-title">평행 금리 시나리오와 검산</h3><p>금리곡선 전체를 같은 폭으로 이동해 포지션 가치의 방향과 비선형성을 확인합니다.</p></div>
      <div class="guided-irs-scenario-grid">
        <article><span>금리 −${formatNumber(result.scenarioBumpBp, 0)}bp</span><strong>${formatSigned(result.scenarioDown.value, 2)}</strong><small>기준 대비 ${formatSigned(result.scenarioDown.change, 2)}</small><em>파금리 ${formatNumber(result.scenarioDown.parRate, 6)}%</em></article>
        <article class="base"><span>기준 곡선</span><strong>${formatSigned(result.value, 2)}</strong><small>파금리 ${formatNumber(result.parRate, 6)}%</small><em>DV01 ${formatSigned(result.dv01, 2)}</em></article>
        <article><span>금리 +${formatNumber(result.scenarioBumpBp, 0)}bp</span><strong>${formatSigned(result.scenarioUp.value, 2)}</strong><small>기준 대비 ${formatSigned(result.scenarioUp.change, 2)}</small><em>파금리 ${formatNumber(result.scenarioUp.parRate, 6)}%</em></article>
      </div>
      <div class="guided-assumption-list guided-irs-checks">
        <div class="guided-assumption-row"><span>레그 차이와 스왑가치 일치</span><strong>${Math.abs(Math.abs(result.floatingLegPresentValue - result.fixedLegPresentValue) - Math.abs(result.value)) < Math.max(1e-6, result.notional * 1e-12) ? "통과" : "확인 필요"}</strong></div>
        <div class="guided-assumption-row"><span>파금리 적용 시 가치 0</span><strong>${zeroRateCheck && Math.abs(zeroRateCheck.value) < Math.max(1e-6, result.notional * 1e-12) ? "통과" : "확인 필요"}</strong></div>
        <div class="guided-assumption-row"><span>반대 포지션 가치 부호</span><strong>${oppositeDirection && Math.abs(oppositeDirection.value + result.value) < Math.max(1e-6, result.notional * 1e-12) ? "통과" : "확인 필요"}</strong></div>
        ${flatSpotCheck ? `<div class="guided-assumption-row"><span>평탄 곡선 = 동일 스폿 곡선</span><strong>${Math.abs(flatSpotCheck.value - result.value) < Math.max(1e-6, result.notional * 1e-12) ? "통과" : "확인 필요"}</strong></div>` : ""}
      </div>
      <div class="guided-result-note"><strong>DV01 해석</strong><p>${formatSigned(result.dv01, 2)}원은 선택한 포지션에서 금리곡선이 +1bp 움직일 때의 중앙차분 가치변화입니다. 일반적인 PV01 절댓값 표기와 부호가 다를 수 있습니다.</p></div>`;
  };

  const renderResult = () => {
    const result = getResult();
    if (!result) {
      return '<section class="guided-question-card"><div class="guided-message error">스왑 가치를 계산할 수 없습니다. 입력과 할인곡선을 확인해 주세요.</div></section>';
    }
    const page = Math.min(Math.max(state.resultPage, 0), resultPanels.length - 1);
    const panels = [
      () => renderSummary(result),
      () => renderLegs(result),
      () => renderRisk(result),
    ];
    return `
      <section class="guided-result guided-irs-result" aria-labelledby="guided-irs-result-title">
        <div class="guided-group-tabs" aria-label="이자율스왑 결과 확인 순서">${resultPanels.map((label, index) => `<span class="${index === page ? "active" : ""} ${index < page ? "done" : ""}">${index < page ? "✓ " : ""}${escapeHtml(label)}</span>`).join("")}</div>
        ${panels[page]()}
        <div class="guided-result-actions">
          <button type="button" class="secondary" data-irs-result-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← 이전 패널</button>
          ${page < resultPanels.length - 1
    ? `<button type="button" class="primary" data-irs-result-page="${page + 1}">다음: ${escapeHtml(resultPanels[page + 1])} →</button>`
    : '<button type="button" class="secondary" data-irs-action="back-to-review">가정 다시 검토</button><button type="button" class="primary" data-irs-action="new-analysis">새 IRS 분석</button>'}
        </div>
      </section>`;
  };

  const renderStepContent = () => {
    switch (state.step) {
      case 0: return renderScopeStep();
      case 1: return renderDirectionStep();
      case 2: return renderBasisStep();
      case 3: return renderTermsStep();
      case 4: return renderCurveModeStep();
      case 5: return renderRatesStep();
      case 6: return renderRiskStep();
      case REVIEW_STEP: return renderReview();
      case RESULT_STEP: return renderResult();
      default: return "";
    }
  };

  const renderProgress = () => {
    const activeStep = Math.min(state.step, TOTAL_QUESTIONS - 1);
    const activeGroup = groups.findIndex(
      (group) => activeStep >= group.start && activeStep < group.end,
    );
    const progress = state.step === RESULT_STEP
      ? 100
      : ((state.step + 1) / TOTAL_QUESTIONS) * 100;
    return `
      <header class="guided-progress-shell guided-irs-progress">
        <div class="guided-progress-topline"><div><span class="guided-product-label">INTEREST RATE SWAP · SINGLE CURVE</span><strong>${state.step === RESULT_STEP ? "분석 결과" : `${state.step + 1} / ${TOTAL_QUESTIONS}`}</strong></div><span class="guided-autosave">✓ 자동 저장됨</span><button type="button" class="guided-irs-exit" data-irs-action="exit">로드맵으로</button></div>
        <div class="guided-group-tabs" aria-label="이자율스왑 진행 구간">${groups.map((group, index) => `<span class="${index === activeGroup ? "active" : ""} ${index < activeGroup ? "done" : ""}">${index < activeGroup ? "✓ " : ""}${escapeHtml(group.label)}</span>`).join("")}</div>
        <div class="guided-progress-track"><span style="width:${progress}%"></span></div>
      </header>`;
  };

  const nextButtonLabel = () => [
    "다음: 포지션",
    "다음: 평가 기준",
    "다음: 고정 조건",
    "다음: 금리곡선 방식",
    "다음: 시장 금리",
    "다음: 위험 시나리오",
    "다음: 최종 검토",
    "계산하고 버전 저장",
  ][state.step] || "다음";

  const renderNavigation = () => state.step === RESULT_STEP ? "" : `
    <footer class="guided-navigation">
      <button type="button" class="secondary" data-irs-action="previous" ${state.step === 0 ? "disabled" : ""}>← 이전</button>
      <span class="guided-navigation-hint">Enter 키로 다음</span>
      <button type="button" class="primary" data-irs-action="next" ${validateStep(state.step).error || (state.step === REVIEW_STEP && !allAssumptionsValid()) ? "disabled" : ""}>${escapeHtml(nextButtonLabel())} →</button>
    </footer>`;

  const updateHeader = () => {
    const contentArea = mountedHost?.closest(".content-area");
    const header = contentArea?.previousElementSibling;
    if (!header?.matches("header.main-header")) return;
    const heading = header.querySelector("h2");
    const description = header.querySelector("p");
    if (heading) heading.textContent = "이자율스왑 가치평가";
    if (description)
      description.textContent = "고정·변동 레그 현재가치와 파금리, DV01을 단계별로 계산합니다.";
  };

  const render = () => {
    if (!mountedHost?.isConnected) return;
    mountedHost.innerHTML = `<div class="phase3-hub-inner guided-irs">${renderProgress()}<div class="guided-irs-stage">${renderStepContent()}${renderNavigation()}</div></div>`;
    updateHeader();
    const contentArea = mountedHost.closest(".content-area");
    if (contentArea) contentArea.scrollTop = 0;
    const focusTarget = mountedHost.querySelector(
      "input, select, .guided-choice.selected, #guided-irs-question-title, #guided-irs-result-title",
    );
    if (focusTarget) {
      if (focusTarget.matches("h1, h2, h3, h4")) focusTarget.setAttribute("tabindex", "-1");
      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        focusTarget.focus();
      }
    }
  };

  const updateValidation = () => {
    if (!mountedHost?.isConnected) return;
    const target = mountedHost.querySelector("[data-irs-validation]");
    if (target) target.innerHTML = renderValidation(state.step);
    const next = mountedHost.querySelector('[data-irs-action="next"]');
    if (next) {
      next.disabled = Boolean(validateStep(state.step).error) ||
        (state.step === REVIEW_STEP && !allAssumptionsValid());
    }
  };

  const saveSnapshot = (result) => {
    if (!result) return null;
    try {
      const raw = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
      const snapshots = Array.isArray(raw) ? raw : [];
      const version = Math.max(
        0,
        ...snapshots.map((item) => Number(item?.version) || 0),
      ) + 1;
      snapshots.push({
        schemaVersion: 1,
        modelVersion: "single-curve-irs-v1",
        version,
        savedAt: new Date().toISOString(),
        assumptions: { ...state, step: REVIEW_STEP },
        result: {
          value: result.value,
          fixedLegPresentValue: result.fixedLegPresentValue,
          floatingLegPresentValue: result.floatingLegPresentValue,
          parRate: result.parRate,
          dv01: result.dv01,
          maturityDiscountFactor: result.maturityDiscountFactor,
          annuityFactor: result.annuityFactor,
        },
      });
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots.slice(-20)));
      return version;
    } catch {
      return null;
    }
  };

  const leaveCalculator = () => {
    const host = mountedHost;
    const onExit = exitCallback;
    if (host) {
      delete host.dataset.phase3Mode;
      host.removeAttribute("aria-label");
    }
    mountedHost = null;
    exitCallback = null;
    if (typeof onExit === "function") onExit();
  };

  const handleClick = (event) => {
    const host = event.currentTarget;
    if (!mountedHost || host !== mountedHost) return;

    const basis = event.target.closest("[data-irs-contract-basis]");
    if (basis && host.contains(basis)) {
      state.contractBasis = basis.dataset.irsContractBasis === "reset" ? "reset" : "new";
      cachedResult = null;
      saveState();
      render();
      return;
    }

    const direction = event.target.closest("[data-irs-direction]");
    if (direction && host.contains(direction)) {
      state.direction = direction.dataset.irsDirection === "receive-fixed"
        ? "receive-fixed"
        : "pay-fixed";
      cachedResult = null;
      saveState();
      render();
      return;
    }

    const curveMode = event.target.closest("[data-irs-curve-mode]");
    if (curveMode && host.contains(curveMode)) {
      state.curveMode = normalizeCurveMode(curveMode.dataset.irsCurveMode) || "flat";
      ensureCurveLength();
      cachedResult = null;
      saveState();
      render();
      return;
    }

    const edit = event.target.closest("[data-irs-edit-step]");
    if (edit && host.contains(edit)) {
      state.step = Number(edit.dataset.irsEditStep);
      saveState();
      render();
      return;
    }

    const resultPage = event.target.closest("[data-irs-result-page]");
    if (resultPage && host.contains(resultPage)) {
      state.resultPage = Math.min(
        Math.max(Number(resultPage.dataset.irsResultPage) || 0, 0),
        resultPanels.length - 1,
      );
      saveState();
      render();
      return;
    }

    const action = event.target.closest("[data-irs-action]");
    if (!action || !host.contains(action)) return;
    switch (action.dataset.irsAction) {
      case "exit":
        leaveCalculator();
        return;
      case "previous":
        state.step = Math.max(0, state.step - 1);
        break;
      case "next":
        if (validateStep(state.step).error) {
          updateValidation();
          return;
        }
        if (state.step === REVIEW_STEP) {
          cachedResult = calculateInterestRateSwap();
          if (!cachedResult) {
            updateValidation();
            return;
          }
          state.lastVersion = saveSnapshot(cachedResult);
          state.resultPage = 0;
          state.step = RESULT_STEP;
        } else {
          state.step += 1;
        }
        break;
      case "back-to-review":
        state.step = REVIEW_STEP;
        break;
      case "new-analysis":
        if (!confirm("현재 결과는 버전으로 보관됩니다. 새 이자율스왑 분석을 시작할까요?"))
          return;
        state = createDefaultState();
        cachedResult = null;
        break;
      default:
        return;
    }
    saveState();
    render();
  };

  const handleInput = (event) => {
    if (!mountedHost || event.currentTarget !== mountedHost) return;
    const field = event.target.dataset.irsField;
    const evidence = event.target.dataset.irsEvidence;
    const rateIndex = event.target.dataset.irsRateIndex;
    const rateKind = event.target.dataset.irsRateKind;
    if (field) {
      state[field] = event.target.type === "date"
        ? event.target.value
        : event.target.value === "" ? "" : Number(event.target.value);
      if (field === "timeToMaturity" || field === "paymentFrequency") ensureCurveLength();
      cachedResult = null;
      saveState();
      updateValidation();
    }
    if (rateIndex !== undefined && rateKind) {
      const targetField = rateKind === "spot" ? "spotRates" : "forwardRates";
      const index = Number(rateIndex);
      if (Number.isInteger(index) && index >= 0) {
        if (!Array.isArray(state[targetField])) state[targetField] = [];
        state[targetField][index] = event.target.value === "" ? "" : Number(event.target.value);
        cachedResult = null;
        saveState();
        updateValidation();
      }
    }
    if (evidence) {
      state.evidence[evidence] = event.target.value;
      saveState();
    }
  };

  const handleKeyDown = (event) => {
    if (
      !mountedHost ||
      event.currentTarget !== mountedHost ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.target.matches("textarea, button, select") ||
      state.step === RESULT_STEP
    ) return;
    const next = mountedHost.querySelector('[data-irs-action="next"]');
    if (next && !next.disabled) {
      event.preventDefault();
      next.click();
    }
  };

  const ensureEvents = (host) => {
    if (host.dataset.irsEventsReady === "true") return;
    host.dataset.irsEventsReady = "true";
    host.addEventListener("click", handleClick);
    host.addEventListener("input", handleInput);
    host.addEventListener("change", handleInput);
    host.addEventListener("keydown", handleKeyDown);
  };

  const mount = (host, options = {}) => {
    if (!host) return false;
    mountedHost = host;
    exitCallback = typeof options.onExit === "function" ? options.onExit : null;
    host.dataset.phase3Mode = "interest-rate-swap";
    host.setAttribute("aria-label", "이자율스왑 가치평가 단계형 계산기");
    ensureEvents(host);
    render();
    return true;
  };

  const startNew = () => {
    state = createDefaultState();
    cachedResult = null;
    saveState();
    if (mountedHost) render();
    return JSON.parse(JSON.stringify(state));
  };

  globalThis.ValueScannerInterestRateSwap = Object.freeze({
    calculate: (overrides = {}) => calculateInterestRateSwap(overrides),
    getState: () => JSON.parse(JSON.stringify(state)),
    mount,
    startNew,
    validateStep: (step) => ({ ...validateStep(step) }),
  });
})();
