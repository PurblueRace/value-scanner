(() => {
  "use strict";

  const STORAGE_KEY = "value-scanner-guided-convertible-bond-v1";
  const SNAPSHOT_KEY = "value-scanner-convertible-bond-snapshots-v1";
  const TOTAL_QUESTIONS = 8;
  const REVIEW_STEP = TOTAL_QUESTIONS - 1;
  const RESULT_STEP = TOTAL_QUESTIONS;
  const resultPanels = ["요약", "일반채권", "전환권", "민감도·체크"];
  const groups = [
    { label: "적용범위", start: 0, end: 2 },
    { label: "계약조건", start: 2, end: 4 },
    { label: "시장가정", start: 4, end: 6 },
    { label: "모형·검토", start: 6, end: 8 },
  ];
  const evidenceKeys = [
    "faceValue", "conversionPrice", "riskFreeRate", "creditSpread", "volatility", "dividendYield",
  ];

  const today = () => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const createDefaultState = () => ({
    step: 0,
    specialTerms: "none",
    scopeAcknowledged: false,
    valuationDate: today(),
    quantity: 1,
    faceValue: 1000,
    annualCouponRate: 3,
    couponFrequency: 2,
    timeToMaturity: 3,
    redemptionRate: 100,
    stockPrice: 100,
    conversionPrice: 100,
    conversionStyle: "american",
    conversionStartYear: 0,
    riskFreeRate: 4,
    creditSpread: 2,
    volatility: 25,
    dividendYield: 1,
    precision: "standard",
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

  const formatSigned = (value, maximumFractionDigits = 4) => {
    const number = Number(value) || 0;
    const formatted = formatNumber(Math.abs(number), maximumFractionDigits);
    if (number > 0) return `+${formatted}`;
    if (number < 0) return `−${formatted}`;
    return formatted;
  };

  const loadState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return createDefaultState();
      const merged = { ...createDefaultState(), ...saved };
      merged.specialTerms = saved.specialTerms === "present" ? "present" : "none";
      merged.scopeAcknowledged = Boolean(saved.scopeAcknowledged);
      merged.conversionStyle = saved.conversionStyle === "maturity" ? "maturity" : "american";
      merged.precision = saved.precision === "high" ? "high" : "standard";
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
      specialTerms: input("specialTerms") === "present" ? "present" : "none",
      scopeAcknowledged: Boolean(input("scopeAcknowledged")),
      quantity: finiteNumber(input("quantity")),
      faceValue: finiteNumber(input("faceValue")),
      annualCouponRate: finiteNumber(input("annualCouponRate")),
      couponFrequency: finiteNumber(input("couponFrequency")),
      timeToMaturity: finiteNumber(input("timeToMaturity")),
      redemptionRate: finiteNumber(input("redemptionRate")),
      stockPrice: finiteNumber(input("stockPrice")),
      conversionPrice: finiteNumber(input("conversionPrice")),
      conversionStyle: input("conversionStyle") === "maturity" ? "maturity" : "american",
      conversionStartYear: finiteNumber(input("conversionStartYear")),
      riskFreeRate: finiteNumber(input("riskFreeRate")),
      creditSpread: finiteNumber(input("creditSpread")),
      volatility: finiteNumber(input("volatility")),
      dividendYield: finiteNumber(input("dividendYield")),
      precision: input("precision") === "high" ? "high" : "standard",
    };
    const payments = values.timeToMaturity === null || values.couponFrequency === null
      ? null
      : values.timeToMaturity * values.couponFrequency;
    if (
      (values.specialTerms === "present" && !values.scopeAcknowledged) ||
      values.quantity === null || values.quantity <= 0 || !Number.isInteger(values.quantity) ||
      values.quantity > 1000000000000 ||
      values.faceValue === null || values.faceValue <= 0 || values.faceValue > 1000000000000 ||
      values.annualCouponRate === null || values.annualCouponRate < 0 || values.annualCouponRate > 100 ||
      ![1, 2, 4, 12].includes(values.couponFrequency) ||
      values.timeToMaturity === null || values.timeToMaturity <= 0 || values.timeToMaturity > 30 ||
      payments === null || Math.abs(payments - Math.round(payments)) > 1e-8 ||
      Math.round(payments) < 1 || Math.round(payments) > 360 ||
      values.redemptionRate === null || values.redemptionRate <= 0 || values.redemptionRate > 300 ||
      values.stockPrice === null || values.stockPrice <= 0 || values.stockPrice > 1000000000000 ||
      values.conversionPrice === null || values.conversionPrice <= 0 || values.conversionPrice > 1000000000000 ||
      values.conversionStartYear === null || values.conversionStartYear < 0 ||
      values.conversionStartYear > values.timeToMaturity ||
      values.riskFreeRate === null || values.riskFreeRate < -20 || values.riskFreeRate > 100 ||
      values.creditSpread === null || values.creditSpread < 0 || values.creditSpread > 100 ||
      values.volatility === null || values.volatility <= 0 || values.volatility > 300 ||
      values.dividendYield === null || values.dividendYield < 0 || values.dividendYield > 100
    ) return null;
    values.paymentCount = Math.round(payments);
    values.redemptionAmount = values.faceValue * values.redemptionRate / 100;
    values.conversionRatio = values.faceValue / values.conversionPrice;
    const baseSteps = values.precision === "high" ? 600 : 300;
    values.latticeSteps = Math.ceil(baseSteps / values.paymentCount) * values.paymentCount;
    return values;
  };

  const crrParameters = (input) => {
    const timeStep = input.timeToMaturity / input.latticeSteps;
    const volatility = input.volatility / 100;
    const rate = input.riskFreeRate / 100;
    const dividend = input.dividendYield / 100;
    const up = Math.exp(volatility * Math.sqrt(timeStep));
    const down = 1 / up;
    const probability = (Math.exp((rate - dividend) * timeStep) - down) / (up - down);
    if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return null;
    return {
      timeStep,
      up,
      down,
      probability,
      discount: Math.exp(-rate * timeStep),
    };
  };

  const straightBondAt = (input, time) => {
    const yieldRate = (input.riskFreeRate + input.creditSpread) / 100;
    const coupon = input.faceValue * input.annualCouponRate / 100 / input.couponFrequency;
    let value = input.redemptionAmount * Math.exp(-yieldRate * (input.timeToMaturity - time));
    for (let payment = 1; payment <= input.paymentCount; payment += 1) {
      const paymentTime = payment / input.couponFrequency;
      if (paymentTime > time + 1e-10) value += coupon * Math.exp(-yieldRate * (paymentTime - time));
    }
    return value;
  };

  const optionComponent = (input, allowEarlyConversion) => {
    const parameters = crrParameters(input);
    if (!parameters) return null;
    const { up, down, probability, discount, timeStep } = parameters;
    let values = new Float64Array(input.latticeSteps + 1);
    let stock = input.stockPrice * Math.pow(down, input.latticeSteps);
    const stockRatio = up / down;
    for (let node = 0; node <= input.latticeSteps; node += 1) {
      values[node] = Math.max(input.conversionRatio * stock - input.redemptionAmount, 0);
      stock *= stockRatio;
    }

    for (let step = input.latticeSteps - 1; step >= 0; step -= 1) {
      const time = step * timeStep;
      const bondFloor = straightBondAt(input, time);
      let nodeStock = input.stockPrice * Math.pow(down, step);
      for (let node = 0; node <= step; node += 1) {
        const continuation = discount * (
          probability * values[node + 1] + (1 - probability) * values[node]
        );
        const exercise = allowEarlyConversion && time + 1e-10 >= input.conversionStartYear
          ? Math.max(input.conversionRatio * nodeStock - bondFloor, 0)
          : 0;
        values[node] = Math.max(continuation, exercise);
        nodeStock *= stockRatio;
      }
    }
    return { value: values[0], parameters };
  };

  const calculateConvertible = (overrides = {}, { includeConvergence = true } = {}) => {
    const input = normalizeInput(overrides);
    if (!input) return null;
    const maturityOption = optionComponent(input, false);
    const earlyOption = optionComponent(input, true);
    if (!maturityOption || !earlyOption) return null;
    const straightBondValue = straightBondAt(input, 0);
    const optionValue = input.conversionStyle === "american"
      ? earlyOption.value
      : maturityOption.value;
    const convertibleValue = straightBondValue + optionValue;
    const currentConversionValue = input.conversionRatio * input.stockPrice;
    const alternativeInput = includeConvergence
      ? normalizeInput({ ...input, precision: input.precision === "high" ? "standard" : "high" })
      : null;
    const alternativeOption = alternativeInput
      ? optionComponent(alternativeInput, input.conversionStyle === "american")
      : null;
    const alternativeValue = alternativeOption
      ? straightBondAt(alternativeInput, 0) + alternativeOption.value
      : null;
    return {
      ...input,
      straightBondValue,
      maturityOptionValue: maturityOption.value,
      earlyOptionValue: earlyOption.value,
      optionValue,
      convertibleValue,
      totalValue: convertibleValue * input.quantity,
      currentConversionValue,
      conversionPremium: currentConversionValue === 0
        ? null
        : convertibleValue / currentConversionValue - 1,
      earlyConversionPremium: earlyOption.value - maturityOption.value,
      bondWeight: convertibleValue === 0 ? 0 : straightBondValue / convertibleValue,
      optionWeight: convertibleValue === 0 ? 0 : optionValue / convertibleValue,
      couponAmount: input.faceValue * input.annualCouponRate / 100 / input.couponFrequency,
      yieldRate: input.riskFreeRate + input.creditSpread,
      alternativePrecisionValue: alternativeValue,
      convergenceGap: alternativeValue === null ? null : convertibleValue - alternativeValue,
      ...maturityOption.parameters,
    };
  };

  const validateStep = (step) => {
    const result = { error: "", warning: "" };
    const number = (field) => finiteNumber(state[field]);
    switch (step) {
      case 0:
        if (state.specialTerms === "present" && !state.scopeAcknowledged)
          result.error = "특약 미반영 참고값이라는 점을 확인해야 진행할 수 있습니다.";
        break;
      case 1:
        if (!state.valuationDate) result.error = "평가 기준일을 입력해 주세요.";
        else if (number("quantity") === null || number("quantity") <= 0 ||
          !Number.isInteger(number("quantity")) || number("quantity") > 1000000000000)
          result.error = "평가 수량은 1 이상의 정수로 입력해 주세요.";
        break;
      case 2: {
        const paymentCount = number("timeToMaturity") * number("couponFrequency");
        if (number("faceValue") === null || number("faceValue") <= 0)
          result.error = "액면금액은 0보다 커야 합니다.";
        else if (number("annualCouponRate") === null || number("annualCouponRate") < 0 || number("annualCouponRate") > 100)
          result.error = "연 쿠폰율은 0%에서 100% 사이로 입력해 주세요.";
        else if (![1, 2, 4, 12].includes(number("couponFrequency")))
          result.error = "쿠폰 지급주기를 연 1·2·4·12회 중에서 선택해 주세요.";
        else if (number("timeToMaturity") === null || number("timeToMaturity") <= 0 || number("timeToMaturity") > 30)
          result.error = "잔존만기는 0년보다 크고 30년 이하여야 합니다.";
        else if (!Number.isFinite(paymentCount) || Math.abs(paymentCount - Math.round(paymentCount)) > 1e-8)
          result.error = "잔존만기는 선택한 쿠폰주기의 완전한 기간 수가 되도록 입력해 주세요.";
        else if (number("redemptionRate") === null || number("redemptionRate") <= 0 || number("redemptionRate") > 300)
          result.error = "만기상환율은 0%보다 크고 300% 이하여야 합니다.";
        break;
      }
      case 3:
        if (number("stockPrice") === null || number("stockPrice") <= 0)
          result.error = "현재 주가는 0보다 커야 합니다.";
        else if (number("conversionPrice") === null || number("conversionPrice") <= 0)
          result.error = "현재 적용 전환가는 0보다 커야 합니다.";
        else if (number("conversionStartYear") === null || number("conversionStartYear") < 0 ||
          number("conversionStartYear") > number("timeToMaturity"))
          result.error = "전환 가능 시작시점은 0년부터 잔존만기 사이여야 합니다.";
        break;
      case 4:
        if (number("riskFreeRate") === null || number("riskFreeRate") < -20 || number("riskFreeRate") > 100)
          result.error = "무위험수익률은 -20%에서 100% 사이로 입력해 주세요.";
        else if (number("creditSpread") === null || number("creditSpread") < 0 || number("creditSpread") > 100)
          result.error = "신용스프레드는 0%에서 100% 사이로 입력해 주세요.";
        break;
      case 5:
        if (number("volatility") === null || number("volatility") <= 0 || number("volatility") > 300)
          result.error = "변동성은 0%보다 크고 300% 이하여야 합니다.";
        else if (number("dividendYield") === null || number("dividendYield") < 0 || number("dividendYield") > 100)
          result.error = "배당수익률은 0%에서 100% 사이로 입력해 주세요.";
        break;
      case 6: {
        const input = normalizeInput();
        if (!input) result.error = "앞 단계의 입력을 다시 확인해 주세요.";
        else if (!crrParameters(input)) result.error = "현재 가정에서는 CRR 위험중립확률이 0과 1 사이가 아닙니다. 금리·배당·변동성·격자를 조정해 주세요.";
        break;
      }
      case REVIEW_STEP:
        if (!calculateConvertible({}, { includeConvergence: false }))
          result.error = "현재 입력으로 전환사채 가치를 계산할 수 없습니다.";
        break;
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

  const renderQuestionHeader = ({ eyebrow, question, description }) => `<div class="guided-question-copy"><span class="guided-eyebrow">${escapeHtml(eyebrow)}</span><h3 id="guided-cb-question-title">${escapeHtml(question)}</h3><p>${escapeHtml(description)}</p></div>`;
  const renderEvidence = (key, placeholder) => `<details class="guided-evidence"><summary><span>근거 자료 남기기</span><span class="guided-optional">선택</span></summary><label class="guided-evidence-label" for="cb-evidence-${escapeHtml(key)}">문서명 · 조항 · 기준일 또는 산정 메모</label><textarea id="cb-evidence-${escapeHtml(key)}" data-cb-evidence="${escapeHtml(key)}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(state.evidence[key] || "")}</textarea></details>`;
  const renderHelp = (title, body) => `<details class="guided-help"><summary>${escapeHtml(title)}</summary><div class="guided-help-body"><p>${escapeHtml(body)}</p></div></details>`;

  const renderScopeStep = () => `
    <section class="guided-question-card wide" aria-labelledby="guided-cb-question-title">
      ${renderQuestionHeader({ eyebrow: "적용 범위", question: "콜·풋·미래 리픽싱 같은 복잡한 특약이 있나요?", description: "먼저 이 단순형 분리모형으로 평가할 수 있는 계약인지 확인합니다." })}
      <div class="guided-choice-grid guided-cb-scope-grid" role="group" aria-label="복잡한 특약 여부">
        <button type="button" class="guided-choice ${state.specialTerms === "none" ? "selected" : ""}" data-cb-special-terms="none" aria-pressed="${state.specialTerms === "none"}"><span class="guided-choice-icon">✓</span><span class="guided-choice-copy"><strong>없음 / 조정 전환가 확정</strong><small>고정 전환가, 쿠폰, 만기상환 조건 중심</small></span></button>
        <button type="button" class="guided-choice ${state.specialTerms === "present" ? "selected" : ""}" data-cb-special-terms="present" aria-pressed="${state.specialTerms === "present"}"><span class="guided-choice-icon">!</span><span class="guided-choice-copy"><strong>특약 있음</strong><small>발행자 콜·투자자 풋·미래 조건부 리픽싱 등</small></span></button>
      </div>
      ${state.specialTerms === "present" ? `<button type="button" class="guided-cb-ack ${state.scopeAcknowledged ? "selected" : ""}" data-cb-action="toggle-scope" aria-pressed="${state.scopeAcknowledged}"><span>${state.scopeAcknowledged ? "✓" : "○"}</span><div><strong>특약 미반영 참고값으로만 사용</strong><small>실제 공정가치에는 별도 경로의존·콜/풋 모형이 필요함을 확인합니다.</small></div></button>` : ""}
      <div data-cb-validation>${renderValidation(0)}</div>
      <div class="guided-message warning">지원: 고정 쿠폰·만기·상환금액, 현재 확정 전환가, 만기형 또는 기간 중 전환형. 미지원: 미래 조건부 리픽싱, 콜·풋, 부도회수율, 희석과 CoCo 조건.</div>
    </section>`;

  const renderBasisStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-cb-question-title">
      ${renderQuestionHeader({ eyebrow: "평가 기준", question: "평가일과 보유 수량은 어떻게 되나요?", description: "시장가정의 기준일과 총 평가가치에 곱할 전환사채 수량을 입력합니다." })}
      <div class="guided-cb-basis-grid"><label><span>평가 기준일</span><input data-cb-field="valuationDate" type="date" value="${escapeHtml(state.valuationDate)}" aria-describedby="guided-cb-validation" /></label><label><span>평가 수량</span><div class="guided-input-wrap"><input data-cb-field="quantity" type="number" inputmode="numeric" value="${escapeHtml(state.quantity)}" min="1" max="1000000000000" step="1" aria-describedby="guided-cb-validation" /><span>개</span></div></label></div>
      <div id="guided-cb-validation" data-cb-validation>${renderValidation(1)}</div>
    </section>`;

  const renderBondTermsStep = () => `
    <section class="guided-question-card wide" aria-labelledby="guided-cb-question-title">
      ${renderQuestionHeader({ eyebrow: "일반채권 조건", question: "액면·쿠폰·만기상환 조건을 입력해 주세요", description: "쿠폰은 정기 후급, 만기상환액은 액면 대비 비율로 계산합니다." })}
      <div class="guided-cb-input-grid">
        <label><span>액면금액</span><div class="guided-input-wrap"><input data-cb-field="faceValue" type="number" value="${escapeHtml(state.faceValue)}" min="0.0001" max="1000000000000" step="1" /><span>원</span></div></label>
        <label><span>연 쿠폰율</span><div class="guided-input-wrap"><input data-cb-field="annualCouponRate" type="number" value="${escapeHtml(state.annualCouponRate)}" min="0" max="100" step="0.01" /><span>%</span></div></label>
        <label><span>연 쿠폰 횟수</span><select data-cb-field="couponFrequency"><option value="1" ${state.couponFrequency === 1 ? "selected" : ""}>연 1회</option><option value="2" ${state.couponFrequency === 2 ? "selected" : ""}>반기 2회</option><option value="4" ${state.couponFrequency === 4 ? "selected" : ""}>분기 4회</option><option value="12" ${state.couponFrequency === 12 ? "selected" : ""}>월 12회</option></select></label>
        <label><span>잔존만기</span><div class="guided-input-wrap"><input data-cb-field="timeToMaturity" type="number" value="${escapeHtml(state.timeToMaturity)}" min="0.083333" max="30" step="0.25" /><span>년</span></div></label>
        <label class="wide"><span>만기상환율 · 액면 대비</span><div class="guided-input-wrap"><input data-cb-field="redemptionRate" type="number" value="${escapeHtml(state.redemptionRate)}" min="0.01" max="300" step="0.01" /><span>%</span></div></label>
      </div>
      <div data-cb-validation>${renderValidation(2)}</div>
      ${renderEvidence("faceValue", "예: 발행조건서 액면 1,000원, 연 3%, 반기 지급, 3년, 만기 100% 상환")}
      ${renderHelp("경과이자는 반영하나요?", "이 버전은 평가일이 쿠폰 지급 직후인 ex-coupon 시점이라고 가정합니다. 중간일 평가의 경과이자·clean/dirty price는 별도 조정이 필요합니다.")}
    </section>`;

  const renderConversionStep = () => `
    <section class="guided-question-card wide" aria-labelledby="guided-cb-question-title">
      ${renderQuestionHeader({ eyebrow: "전환 조건", question: "현재 주가와 적용 전환가를 입력해 주세요", description: "전환비율은 액면금액 ÷ 현재 적용 전환가로 계산합니다." })}
      <div class="guided-cb-input-grid">
        <label><span>현재 주가</span><div class="guided-input-wrap"><input data-cb-field="stockPrice" type="number" value="${escapeHtml(state.stockPrice)}" min="0.0001" max="1000000000000" step="0.01" /><span>원</span></div></label>
        <label><span>현재 적용 전환가</span><div class="guided-input-wrap"><input data-cb-field="conversionPrice" type="number" value="${escapeHtml(state.conversionPrice)}" min="0.0001" max="1000000000000" step="0.01" /><span>원/주</span></div></label>
      </div>
      <div class="guided-cb-ratio-preview"><span>전환비율</span><strong>${finiteNumber(state.faceValue) && finiteNumber(state.conversionPrice) ? formatNumber(state.faceValue / state.conversionPrice, 6) : "—"}주/CB</strong></div>
      <div class="guided-choice-grid guided-cb-conversion-grid" role="group" aria-label="전환 가능 방식">
        <button type="button" class="guided-choice ${state.conversionStyle === "american" ? "selected" : ""}" data-cb-conversion-style="american" aria-pressed="${state.conversionStyle === "american"}"><span class="guided-choice-icon">A</span><span class="guided-choice-copy"><strong>기간 중 전환 가능</strong><small>전환 가능 시점마다 계속보유와 전환을 비교</small></span></button>
        <button type="button" class="guided-choice ${state.conversionStyle === "maturity" ? "selected" : ""}" data-cb-conversion-style="maturity" aria-pressed="${state.conversionStyle === "maturity"}"><span class="guided-choice-icon">T</span><span class="guided-choice-copy"><strong>만기 전환형</strong><small>만기에만 주식 전환 여부를 결정</small></span></button>
      </div>
      ${state.conversionStyle === "american" ? `<label class="guided-cb-start"><span>평가기준일부터 전환 가능 시작까지</span><div class="guided-input-wrap"><input data-cb-field="conversionStartYear" type="number" value="${escapeHtml(state.conversionStartYear)}" min="0" max="${escapeHtml(state.timeToMaturity)}" step="0.01" /><span>년</span></div></label>` : ""}
      <div data-cb-validation>${renderValidation(3)}</div>
      ${renderEvidence("conversionPrice", "예: 평가일 현재 리픽싱 반영 전환가 100원, 전환청구기간 즉시 시작")}
      <div class="guided-message warning">평가일 이전에 확정된 리픽싱은 조정된 전환가로 반영할 수 있지만, 미래 주가에 따라 바뀌는 리픽싱은 지원하지 않습니다.</div>
    </section>`;

  const renderMarketStep = ({ step, type }) => {
    const isRates = type === "rates";
    return `
      <section class="guided-question-card wide" aria-labelledby="guided-cb-question-title">
        ${renderQuestionHeader(isRates
          ? { eyebrow: "할인율", question: "무위험수익률과 신용스프레드는 몇 %인가요?", description: "일반채권 현금흐름은 두 금리의 합으로, 전환권은 무위험금리로 할인합니다." }
          : { eyebrow: "주가 위험", question: "변동성과 배당수익률은 몇 %인가요?", description: "CRR 주가트리에 사용할 연환산 변동성과 연속 배당수익률을 입력합니다." })}
        <div class="guided-cb-input-grid">
          ${isRates
            ? `<label><span>무위험수익률</span><div class="guided-input-wrap"><input data-cb-field="riskFreeRate" type="number" value="${escapeHtml(state.riskFreeRate)}" min="-20" max="100" step="0.01" /><span>%</span></div></label><label><span>신용스프레드</span><div class="guided-input-wrap"><input data-cb-field="creditSpread" type="number" value="${escapeHtml(state.creditSpread)}" min="0" max="100" step="0.01" /><span>%p</span></div></label>`
            : `<label><span>연환산 변동성</span><div class="guided-input-wrap"><input data-cb-field="volatility" type="number" value="${escapeHtml(state.volatility)}" min="0.0001" max="300" step="0.1" /><span>%</span></div></label><label><span>연속 배당수익률</span><div class="guided-input-wrap"><input data-cb-field="dividendYield" type="number" value="${escapeHtml(state.dividendYield)}" min="0" max="100" step="0.01" /><span>%</span></div></label>`}
        </div>
        <div data-cb-validation>${renderValidation(step)}</div>
        ${isRates
          ? `${renderEvidence("riskFreeRate", "예: 3년 만기 국고채 연속복리 4.0%")} ${renderEvidence("creditSpread", "예: 동일 만기 회사채 수익률 6.0% − 국고채 4.0% = 2.0%p")}`
          : `${renderEvidence("volatility", "예: 비교기업 3년 일간수익률 연환산 중앙값 25%")} ${renderEvidence("dividendYield", "예: 예상 배당금 기준 연속 배당수익률 1%")}`}
        ${renderHelp(isRates ? "신용스프레드는 어디에 쓰이나요?" : "변동성 스마일을 반영하나요?", isRates ? "채권요소의 계약상 현금흐름만 무위험금리+신용스프레드로 할인합니다. 부도확률과 회수율을 직접 모형화하지는 않습니다." : "아니요. 전체 기간에 하나의 상수 변동성을 쓰는 단순 CRR 모형입니다.")}
      </section>`;
  };

  const renderPrecisionStep = () => {
    const input = normalizeInput();
    const probability = input ? crrParameters(input)?.probability : null;
    return `
      <section class="guided-question-card" aria-labelledby="guided-cb-question-title">
        ${renderQuestionHeader({ eyebrow: "격자 정밀도", question: "표준 또는 고정밀 격자를 선택해 주세요", description: "쿠폰일과 트리 노드가 맞도록 쿠폰기간 수의 배수로 자동 조정합니다." })}
        <div class="guided-choice-grid guided-cb-precision-grid" role="group" aria-label="격자 정밀도">
          <button type="button" class="guided-choice ${state.precision === "standard" ? "selected" : ""}" data-cb-precision="standard" aria-pressed="${state.precision === "standard"}"><span class="guided-choice-icon">300</span><span class="guided-choice-copy"><strong>표준</strong><small>약 300단계 · 빠른 검토</small></span></button>
          <button type="button" class="guided-choice ${state.precision === "high" ? "selected" : ""}" data-cb-precision="high" aria-pressed="${state.precision === "high"}"><span class="guided-choice-icon">600</span><span class="guided-choice-copy"><strong>고정밀</strong><small>약 600단계 · 수렴 확인</small></span></button>
        </div>
        ${input ? `<div class="guided-cb-model-preview"><div><span>실제 격자</span><strong>${formatNumber(input.latticeSteps, 0)}단계</strong></div><div><span>쿠폰 횟수</span><strong>${formatNumber(input.paymentCount, 0)}회</strong></div><div><span>위험중립확률 p</span><strong>${probability === null ? "계산 불가" : formatNumber(probability, 9)}</strong></div></div>` : ""}
        <div data-cb-validation>${renderValidation(6)}</div>
        <div class="guided-result-note"><strong>단순형 분리모형</strong><p>일반채권 현금흐름은 신용스프레드로 할인하고, 전환권은 CRR 주가트리에서 무위험금리로 평가합니다. 완전한 Tsiveriotis–Fernandes 모형은 아닙니다.</p></div>
      </section>`;
  };

  const reviewRows = () => {
    const input = normalizeInput();
    return [
      ["특약", state.specialTerms === "none" ? "복잡한 특약 없음" : "특약 미반영 참고값", 0],
      ["평가일 / 수량", `${state.valuationDate} / ${formatNumber(state.quantity, 0)}개`, 1],
      ["액면 / 쿠폰", `${formatNumber(state.faceValue, 2)}원 / 연 ${formatNumber(state.annualCouponRate, 4)}%`, 2],
      ["잔존만기 / 상환율", `${formatNumber(state.timeToMaturity, 4)}년 / ${formatNumber(state.redemptionRate, 4)}%`, 2],
      ["주가 / 전환가", `${formatNumber(state.stockPrice, 4)}원 / ${formatNumber(state.conversionPrice, 4)}원`, 3],
      ["전환 방식", state.conversionStyle === "american" ? `${formatNumber(state.conversionStartYear, 4)}년 후부터 전환` : "만기에만 전환", 3],
      ["무위험 / 신용스프레드", `${formatNumber(state.riskFreeRate, 4)}% / ${formatNumber(state.creditSpread, 4)}%p`, 4],
      ["변동성 / 배당", `${formatNumber(state.volatility, 4)}% / ${formatNumber(state.dividendYield, 4)}%`, 5],
      ["격자", input ? `${formatNumber(input.latticeSteps, 0)}단계` : "확인 필요", 6],
    ];
  };

  const renderReview = () => {
    const audit = readiness();
    const valid = allAssumptionsValid();
    return `<section class="guided-question-card wide" aria-labelledby="guided-cb-question-title">${renderQuestionHeader({ eyebrow: "최종 검토", question: "전환사채 조건과 모형 범위를 확인해 주세요", description: "결과는 일반채권 가치와 전환권 가치를 분리한 단순형 기준가입니다." })}<div class="guided-assumption-list">${reviewRows().map(([label, value, step]) => `<div class="guided-assumption-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><button type="button" data-cb-edit-step="${step}">수정</button></div>`).join("")}</div><div class="guided-readiness"><div><span>근거 메모</span><strong>${audit.completed}/${audit.total}</strong></div><div class="guided-readiness-track"><span style="width:${audit.percent}%"></span></div><small>발행조건서, 전환가 조정내역, 금리·스프레드·변동성 출처를 남겨 주세요.</small></div><div class="guided-message warning">발행자 콜·투자자 풋·미래 조건부 리픽싱·부도회수율·희석은 미반영입니다.</div><div data-cb-validation>${valid ? '<div class="guided-message success">입력 검토가 끝났습니다. 채권요소와 전환권을 계산할 수 있어요.</div>' : '<div class="guided-message error">일부 입력 또는 CRR 조건을 다시 확인해 주세요.</div>'}</div></section>`;
  };

  const renderSummary = (result) => `
    <div class="guided-result-hero guided-cb-result-hero"><div><span class="guided-eyebrow">전환사채 결과 · 버전 ${escapeHtml(state.lastVersion || 1)}</span><h3 id="guided-cb-result-title">전환사채 추정가치</h3><strong>${formatNumber(result.convertibleValue, 4)}<small>원/CB</small></strong><p>일반채권 + 전환권 분리모형 · 평가일 ${escapeHtml(state.valuationDate)}</p></div><div class="guided-result-badge">CRR · ${formatNumber(result.latticeSteps, 0)} steps</div></div>
    <div class="guided-cb-value-grid"><article class="total"><span>총 평가가치</span><strong>${formatNumber(result.totalValue, 4)}</strong><small>${formatNumber(result.quantity, 0)}개 × ${formatNumber(result.convertibleValue, 4)}원</small></article><article><span>일반채권 가치</span><strong>${formatNumber(result.straightBondValue, 4)}</strong><small>비중 ${formatNumber(result.bondWeight * 100, 3)}%</small></article><article><span>전환권 가치</span><strong>${formatNumber(result.optionValue, 4)}</strong><small>비중 ${formatNumber(result.optionWeight * 100, 3)}%</small></article><article><span>현재 전환가치</span><strong>${formatNumber(result.currentConversionValue, 4)}</strong><small>${formatNumber(result.conversionRatio, 6)}주 × ${formatNumber(result.stockPrice, 4)}원</small></article><article><span>전환 프리미엄</span><strong>${result.conversionPremium === null ? "—" : `${formatSigned(result.conversionPremium * 100, 4)}%`}</strong><small>CB 가치 ÷ 현재 전환가치 − 1</small></article></div>
    <div class="guided-message warning">고정 전환가 단순형 CB 기준가입니다. 콜·풋·미래 리픽싱·부도회수율은 반영하지 않았습니다.</div>`;

  const renderBondPanel = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 2/4</span><h3 id="guided-cb-result-title">일반채권 가치 구성</h3><p>쿠폰과 만기상환액을 무위험수익률 + 신용스프레드로 할인한 채권요소입니다.</p></div>
    <div class="guided-cb-bond-grid"><article><span>일반채권 가치</span><strong>${formatNumber(result.straightBondValue, 6)}</strong><small>원/CB</small></article><article><span>쿠폰 1회 금액</span><strong>${formatNumber(result.couponAmount, 6)}</strong><small>총 ${formatNumber(result.paymentCount, 0)}회</small></article><article><span>만기상환액</span><strong>${formatNumber(result.redemptionAmount, 6)}</strong><small>액면의 ${formatNumber(result.redemptionRate, 4)}%</small></article><article><span>채권 할인율</span><strong>${formatNumber(result.yieldRate, 4)}%</strong><small>무위험 ${formatNumber(result.riskFreeRate, 4)}% + 스프레드 ${formatNumber(result.creditSpread, 4)}%p</small></article></div>
    <div class="guided-result-note"><strong>쿠폰 시점 가정</strong><p>평가일과 각 전환 판단시점은 쿠폰 지급 직후(ex-coupon)로 정의합니다. 중간일의 경과이자와 clean/dirty 가격 조정은 별도입니다.</p></div>`;

  const renderOptionPanel = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 3/4</span><h3 id="guided-cb-result-title">전환권 가치와 CRR 조건</h3><p>주가트리에서 계속보유가치와 전환가치를 비교하고, 채권요소와 분리해 표시합니다.</p></div>
    <div class="guided-cb-option-grid"><article><span>선택 모형 전환권</span><strong>${formatNumber(result.optionValue, 6)}</strong><small>${result.conversionStyle === "american" ? "기간 중 전환 가능" : "만기 전환형"}</small></article><article><span>만기형 전환권</span><strong>${formatNumber(result.maturityOptionValue, 6)}</strong><small>조기전환 없음</small></article><article><span>기간 중 전환권</span><strong>${formatNumber(result.earlyOptionValue, 6)}</strong><small>시작 ${formatNumber(result.conversionStartYear, 4)}년</small></article><article><span>조기전환 프리미엄</span><strong>${formatNumber(result.earlyConversionPremium, 6)}</strong><small>기간 중 − 만기형</small></article></div>
    <div class="guided-cb-crr-grid"><div><span>u / d</span><strong>${formatNumber(result.up, 9)} / ${formatNumber(result.down, 9)}</strong></div><div><span>위험중립확률 p</span><strong>${formatNumber(result.probability, 9)}</strong></div><div><span>Δt / 할인계수</span><strong>${formatNumber(result.timeStep, 9)} / ${formatNumber(result.discount, 9)}</strong></div></div>
    <div class="guided-result-note"><strong>분리모형 한계</strong><p>신용위험을 채권요소에만 고정 스프레드로 반영합니다. 주가와 신용위험의 상관 및 전환 전후 현금흐름의 신용할인 전환을 다루는 완전한 TF 모형은 아닙니다.</p></div>`;

  const scenarioResult = (result, overrides) => calculateConvertible({ ...result, ...overrides }, { includeConvergence: false });
  const renderSensitivity = (result) => {
    const stockOffsets = [-20, 0, 20];
    const volatilityOffsets = [-10, 0, 10];
    const creditScenarios = [Math.max(result.creditSpread - 1, 0), result.creditSpread, result.creditSpread + 1];
    const creditResults = creditScenarios.map((creditSpread) => scenarioResult(result, { creditSpread }));
    return `<div class="guided-question-copy"><span class="guided-eyebrow">결과 · 4/4</span><h3 id="guided-cb-result-title">주가·변동성·신용스프레드 민감도</h3><p>한 번에 지정한 가정만 바꿔 전환권과 채권요소의 방향을 구분해 확인합니다.</p></div><div class="guided-sensitivity guided-cb-sensitivity"><h4>주가·변동성별 CB 가치 <small>(원/CB)</small></h4><div class="guided-table-wrap"><table><thead><tr><th>현재 주가</th>${volatilityOffsets.map((offset) => `<th>σ ${formatNumber(Math.max(result.volatility + offset, 0.01), 2)}%</th>`).join("")}</tr></thead><tbody>${stockOffsets.map((stockOffset) => `<tr><th>${formatNumber(result.stockPrice * (1 + stockOffset / 100), 4)} <small>(${formatSigned(stockOffset, 0)}%)</small></th>${volatilityOffsets.map((volatilityOffset) => { const scenario = stockOffset === 0 && volatilityOffset === 0 ? result : scenarioResult(result, { stockPrice: result.stockPrice * (1 + stockOffset / 100), volatility: Math.max(result.volatility + volatilityOffset, 0.01) }); return `<td class="${stockOffset === 0 && volatilityOffset === 0 ? "base" : ""}">${scenario ? formatNumber(scenario.convertibleValue, 4) : "-"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div></div><div class="guided-cb-credit-grid">${creditResults.map((scenario, index) => `<article class="${index === 1 ? "base" : ""}"><span>스프레드 ${formatNumber(creditScenarios[index], 2)}%p</span><strong>${scenario ? formatNumber(scenario.convertibleValue, 4) : "-"}</strong><small>${scenario ? `채권 ${formatNumber(scenario.straightBondValue, 4)} + 옵션 ${formatNumber(scenario.optionValue, 4)}` : "계산 불가"}</small></article>`).join("")}</div><div class="guided-assumption-list guided-cb-checks"><div class="guided-assumption-row"><span>분해 오차 · CB − 채권 − 전환권</span><strong>${formatNumber(Math.abs(result.convertibleValue - result.straightBondValue - result.optionValue), 10)}원</strong></div><div class="guided-assumption-row"><span>기간 중 ≥ 만기형 전환권</span><strong>${result.earlyOptionValue + 1e-10 >= result.maturityOptionValue ? "통과" : "확인 필요"}</strong></div><div class="guided-assumption-row"><span>300/600 격자 차이</span><strong>${result.convergenceGap === null ? "—" : `${formatSigned(result.convergenceGap, 6)}원`}</strong></div><div class="guided-assumption-row"><span>스프레드 +1%p 가치 방향</span><strong>${creditResults[2] && creditResults[2].convertibleValue <= result.convertibleValue + 1e-8 ? "하락 · 통과" : "확인 필요"}</strong></div></div><div class="guided-message warning">이 민감도는 미반영 특약의 가치를 대신하지 않습니다. 특히 리픽싱 시나리오는 확률가중 공정가치로 해석하면 안 됩니다.</div>`;
  };

  const getResult = () => cachedResult || (cachedResult = calculateConvertible());
  const renderResult = () => {
    const result = getResult();
    if (!result) return '<section class="guided-question-card"><div class="guided-message error">전환사채 가치를 계산할 수 없습니다. 입력과 CRR 확률을 확인해 주세요.</div></section>';
    const page = Math.min(Math.max(state.resultPage, 0), resultPanels.length - 1);
    const panels = [() => renderSummary(result), () => renderBondPanel(result), () => renderOptionPanel(result), () => renderSensitivity(result)];
    return `<section class="guided-result guided-cb-result" aria-labelledby="guided-cb-result-title"><div class="guided-group-tabs" aria-label="전환사채 결과 확인 순서">${resultPanels.map((label, index) => `<span class="${index === page ? "active" : ""} ${index < page ? "done" : ""}">${index < page ? "✓ " : ""}${escapeHtml(label)}</span>`).join("")}</div>${panels[page]()}<div class="guided-result-actions"><button type="button" class="secondary" data-cb-result-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← 이전 패널</button>${page < resultPanels.length - 1 ? `<button type="button" class="primary" data-cb-result-page="${page + 1}">다음: ${escapeHtml(resultPanels[page + 1])} →</button>` : '<button type="button" class="secondary" data-cb-action="back-to-review">가정 다시 검토</button><button type="button" class="primary" data-cb-action="new-analysis">새 CB 분석</button>'}</div></section>`;
  };

  const renderStepContent = () => {
    switch (state.step) {
      case 0: return renderScopeStep();
      case 1: return renderBasisStep();
      case 2: return renderBondTermsStep();
      case 3: return renderConversionStep();
      case 4: return renderMarketStep({ step: 4, type: "rates" });
      case 5: return renderMarketStep({ step: 5, type: "equity" });
      case 6: return renderPrecisionStep();
      case REVIEW_STEP: return renderReview();
      case RESULT_STEP: return renderResult();
      default: return "";
    }
  };

  const renderProgress = () => {
    const activeStep = Math.min(state.step, TOTAL_QUESTIONS - 1);
    const activeGroup = groups.findIndex((group) => activeStep >= group.start && activeStep < group.end);
    const progress = state.step === RESULT_STEP ? 100 : (state.step + 1) / TOTAL_QUESTIONS * 100;
    return `<header class="guided-progress-shell guided-cb-progress"><div class="guided-progress-topline"><div><span class="guided-product-label">CONVERTIBLE BOND · CRR</span><strong>${state.step === RESULT_STEP ? "분석 결과" : `${state.step + 1} / ${TOTAL_QUESTIONS}`}</strong></div><span class="guided-autosave">✓ 자동 저장됨</span><button type="button" class="guided-cb-exit" data-cb-action="exit">로드맵으로</button></div><div class="guided-group-tabs" aria-label="전환사채 진행 구간">${groups.map((group, index) => `<span class="${index === activeGroup ? "active" : ""} ${index < activeGroup ? "done" : ""}">${index < activeGroup ? "✓ " : ""}${escapeHtml(group.label)}</span>`).join("")}</div><div class="guided-progress-track"><span style="width:${progress}%"></span></div></header>`;
  };

  const nextButtonLabel = () => ["다음: 평가 기준", "다음: 일반채권 조건", "다음: 전환 조건", "다음: 할인율", "다음: 주가 위험", "다음: 격자 정밀도", "다음: 최종 검토", "계산하고 버전 저장"][state.step] || "다음";
  const renderNavigation = () => state.step === RESULT_STEP ? "" : `<footer class="guided-navigation"><button type="button" class="secondary" data-cb-action="previous" ${state.step === 0 ? "disabled" : ""}>← 이전</button><span class="guided-navigation-hint">Enter 키로 다음</span><button type="button" class="primary" data-cb-action="next" ${validateStep(state.step).error || (state.step === REVIEW_STEP && !allAssumptionsValid()) ? "disabled" : ""}>${escapeHtml(nextButtonLabel())} →</button></footer>`;

  const updateHeader = () => {
    const contentArea = mountedHost?.closest(".content-area");
    const header = contentArea?.previousElementSibling;
    if (!header?.matches("header.main-header")) return;
    const heading = header.querySelector("h2");
    const description = header.querySelector("p");
    if (heading) heading.textContent = "전환사채 가치평가";
    if (description) description.textContent = "일반채권 가치와 고정 전환가 전환권을 분리해 단계별로 계산합니다.";
  };

  const render = () => {
    if (!mountedHost?.isConnected) return;
    mountedHost.innerHTML = `<div class="phase3-hub-inner guided-cb">${renderProgress()}<div class="guided-cb-stage">${renderStepContent()}${renderNavigation()}</div></div>`;
    updateHeader();
    const contentArea = mountedHost.closest(".content-area");
    if (contentArea) contentArea.scrollTop = 0;
    const focusTarget = mountedHost.querySelector("input, select, .guided-choice.selected, #guided-cb-question-title, #guided-cb-result-title");
    if (focusTarget) { if (focusTarget.matches("h1, h2, h3, h4")) focusTarget.setAttribute("tabindex", "-1"); try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus(); } }
  };

  const updateValidation = () => {
    if (!mountedHost?.isConnected) return;
    const target = mountedHost.querySelector("[data-cb-validation]");
    if (target) target.innerHTML = renderValidation(state.step);
    const next = mountedHost.querySelector('[data-cb-action="next"]');
    if (next) next.disabled = Boolean(validateStep(state.step).error) || (state.step === REVIEW_STEP && !allAssumptionsValid());
  };

  const saveSnapshot = (result) => {
    if (!result) return null;
    try {
      const raw = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
      const snapshots = Array.isArray(raw) ? raw : [];
      const version = Math.max(0, ...snapshots.map((item) => Number(item?.version) || 0)) + 1;
      snapshots.push({ schemaVersion: 1, modelVersion: "simple-split-crr-v1", version, savedAt: new Date().toISOString(), assumptions: { ...state, step: REVIEW_STEP }, result: { convertibleValue: result.convertibleValue, straightBondValue: result.straightBondValue, optionValue: result.optionValue, totalValue: result.totalValue, latticeSteps: result.latticeSteps, probability: result.probability } });
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
    const special = event.target.closest("[data-cb-special-terms]");
    if (special && host.contains(special)) { state.specialTerms = special.dataset.cbSpecialTerms === "present" ? "present" : "none"; if (state.specialTerms === "none") state.scopeAcknowledged = false; cachedResult = null; saveState(); render(); return; }
    const style = event.target.closest("[data-cb-conversion-style]");
    if (style && host.contains(style)) { state.conversionStyle = style.dataset.cbConversionStyle === "maturity" ? "maturity" : "american"; cachedResult = null; saveState(); render(); return; }
    const precision = event.target.closest("[data-cb-precision]");
    if (precision && host.contains(precision)) { state.precision = precision.dataset.cbPrecision === "high" ? "high" : "standard"; cachedResult = null; saveState(); render(); return; }
    const edit = event.target.closest("[data-cb-edit-step]");
    if (edit && host.contains(edit)) { state.step = Number(edit.dataset.cbEditStep); saveState(); render(); return; }
    const resultPage = event.target.closest("[data-cb-result-page]");
    if (resultPage && host.contains(resultPage)) { state.resultPage = Math.min(Math.max(Number(resultPage.dataset.cbResultPage) || 0, 0), resultPanels.length - 1); saveState(); render(); return; }
    const action = event.target.closest("[data-cb-action]");
    if (!action || !host.contains(action)) return;
    switch (action.dataset.cbAction) {
      case "toggle-scope": state.scopeAcknowledged = !state.scopeAcknowledged; cachedResult = null; break;
      case "exit": leaveCalculator(); return;
      case "previous": state.step = Math.max(0, state.step - 1); break;
      case "next":
        if (validateStep(state.step).error) { updateValidation(); return; }
        if (state.step === REVIEW_STEP) { cachedResult = calculateConvertible(); if (!cachedResult) { updateValidation(); return; } state.lastVersion = saveSnapshot(cachedResult); state.resultPage = 0; state.step = RESULT_STEP; }
        else state.step += 1;
        break;
      case "back-to-review": state.step = REVIEW_STEP; break;
      case "new-analysis": if (!confirm("현재 결과는 버전으로 보관됩니다. 새 전환사채 분석을 시작할까요?")) return; state = createDefaultState(); cachedResult = null; break;
      default: return;
    }
    saveState(); render();
  };

  const handleInput = (event) => {
    if (!mountedHost || event.currentTarget !== mountedHost) return;
    const field = event.target.dataset.cbField;
    const evidence = event.target.dataset.cbEvidence;
    if (field) { state[field] = event.target.type === "date" ? event.target.value : event.target.tagName === "SELECT" ? Number(event.target.value) : event.target.value === "" ? "" : Number(event.target.value); cachedResult = null; saveState(); updateValidation(); }
    if (evidence) { state.evidence[evidence] = event.target.value; saveState(); }
  };

  const handleKeyDown = (event) => {
    if (!mountedHost || event.currentTarget !== mountedHost || event.key !== "Enter" || event.shiftKey || event.target.matches("textarea, button, select") || state.step === RESULT_STEP) return;
    const next = mountedHost.querySelector('[data-cb-action="next"]');
    if (next && !next.disabled) { event.preventDefault(); next.click(); }
  };

  const ensureEvents = (host) => {
    if (host.dataset.cbEventsReady === "true") return;
    host.dataset.cbEventsReady = "true";
    host.addEventListener("click", handleClick); host.addEventListener("input", handleInput); host.addEventListener("change", handleInput); host.addEventListener("keydown", handleKeyDown);
  };

  const mount = (host, options = {}) => {
    if (!host) return false;
    mountedHost = host; exitCallback = typeof options.onExit === "function" ? options.onExit : null;
    host.dataset.phase3Mode = "convertible-bond"; host.setAttribute("aria-label", "전환사채 가치평가 단계형 계산기"); ensureEvents(host); render(); return true;
  };

  const startNew = () => { state = createDefaultState(); cachedResult = null; saveState(); if (mountedHost) render(); return JSON.parse(JSON.stringify(state)); };

  globalThis.ValueScannerConvertibleBond = Object.freeze({
    calculate: (overrides = {}) => calculateConvertible(overrides),
    getState: () => JSON.parse(JSON.stringify(state)),
    mount,
    startNew,
    validateStep: (step) => ({ ...validateStep(step) }),
  });
})();
