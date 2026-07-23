(() => {
  "use strict";

  const STORAGE_KEY = "value-scanner-guided-bond-v1";
  const SNAPSHOT_KEY = "value-scanner-bond-snapshots-v1";
  const TOTAL_QUESTIONS = 9;
  const REVIEW_STEP = TOTAL_QUESTIONS - 1;
  const RESULT_STEP = TOTAL_QUESTIONS;
  const resultPanels = ["가격 요약", "금리 위험", "금리 충격", "현금흐름"];
  const groups = [
    { label: "적용범위", start: 0, end: 2 },
    { label: "채권조건", start: 2, end: 5 },
    { label: "가격·금리", start: 5, end: 8 },
    { label: "최종검토", start: 8, end: 9 },
  ];
  const evidenceKeys = [
    "maturityDate", "faceValue", "annualCouponRate", "marketQuote", "dayCount",
  ];
  const DAY_MS = 86400000;

  const pad = (value) => String(value).padStart(2, "0");
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const daysInMonth = (year, month) => {
    if (month === 2) {
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
  };

  const parseIsoDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (
      year < 1900 || year > 2300 || month < 1 || month > 12 ||
      day < 1 || day > daysInMonth(year, month)
    ) return null;
    return { year, month, day };
  };

  const isoDate = (date) => `${date.year}-${pad(date.month)}-${pad(date.day)}`;
  const dateKey = (date) => date.year * 10000 + date.month * 100 + date.day;
  const compareDates = (left, right) => Math.sign(dateKey(left) - dateKey(right));
  const utcDayNumber = (date) =>
    Math.trunc(Date.UTC(date.year, date.month - 1, date.day) / DAY_MS);
  const actualDays = (start, end) => utcDayNumber(end) - utcDayNumber(start);
  const isMonthEnd = (date) => date.day === daysInMonth(date.year, date.month);

  const addYearsIso = (value, years) => {
    const date = parseIsoDate(value);
    if (!date) return value;
    const year = date.year + years;
    const day = isMonthEnd(date)
      ? daysInMonth(year, date.month)
      : Math.min(date.day, daysInMonth(year, date.month));
    return isoDate({ year, month: date.month, day });
  };

  const couponDateFromMaturity = (maturity, periodsBack, frequency) => {
    const monthsBack = periodsBack * (12 / frequency);
    const totalMonths = maturity.year * 12 + maturity.month - 1 - monthsBack;
    const year = Math.floor(totalMonths / 12);
    const month = totalMonths - year * 12 + 1;
    const day = isMonthEnd(maturity)
      ? daysInMonth(year, month)
      : Math.min(maturity.day, daysInMonth(year, month));
    return { year, month, day };
  };

  const buildCouponSchedule = (settlementValue, maturityValue, frequency) => {
    const settlement = parseIsoDate(settlementValue);
    const maturity = parseIsoDate(maturityValue);
    if (
      !settlement || !maturity || ![1, 2, 4].includes(frequency) ||
      compareDates(settlement, maturity) >= 0
    ) return null;

    const futureDates = [];
    let previousCoupon = null;
    for (let periodsBack = 0; periodsBack <= 2000; periodsBack += 1) {
      const candidate = couponDateFromMaturity(maturity, periodsBack, frequency);
      if (compareDates(candidate, settlement) > 0) {
        futureDates.unshift(candidate);
      } else {
        previousCoupon = candidate;
        break;
      }
    }
    if (!previousCoupon || !futureDates.length || futureDates.length > 1000) return null;
    return {
      settlement,
      maturity,
      previousCoupon,
      nextCoupon: futureDates[0],
      futureDates,
    };
  };

  const isLastDayOfFebruary = (date) =>
    date.month === 2 && date.day === daysInMonth(date.year, date.month);

  const days360Us = (start, end) => {
    let startDay = start.day;
    let endDay = end.day;
    const startFebruaryEnd = isLastDayOfFebruary(start);
    const endFebruaryEnd = isLastDayOfFebruary(end);

    if (startFebruaryEnd) startDay = 30;
    if (startFebruaryEnd && endFebruaryEnd) endDay = 30;
    if (startDay === 31) startDay = 30;
    if (endDay === 31 && startDay >= 30) endDay = 30;

    return (
      (end.year - start.year) * 360 +
      (end.month - start.month) * 30 +
      endDay - startDay
    );
  };

  const accruedFraction = (schedule, dayCount) => {
    const numerator = dayCount === "30/360-us"
      ? days360Us(schedule.previousCoupon, schedule.settlement)
      : actualDays(schedule.previousCoupon, schedule.settlement);
    const denominator = dayCount === "30/360-us"
      ? days360Us(schedule.previousCoupon, schedule.nextCoupon)
      : actualDays(schedule.previousCoupon, schedule.nextCoupon);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
      return null;
    }
    const alpha = numerator === 0 ? 0 : numerator / denominator;
    if (alpha < -1e-12 || alpha >= 1 + 1e-12) return null;
    return {
      alpha: Math.min(Math.max(alpha, 0), 1),
      elapsedDays: numerator,
      periodDays: denominator,
    };
  };

  const createDefaultState = () => {
    const settlementDate = today();
    return {
      step: 0,
      specialTerms: "none",
      scopeAcknowledged: false,
      calculationMode: "ytm-to-price",
      settlementDate,
      maturityDate: addYearsIso(settlementDate, 5),
      faceValue: 100,
      quantity: 1,
      annualCouponRate: 5,
      couponFrequency: 2,
      ytm: 4,
      cleanQuote: 104,
      dayCount: "actual-actual-icma",
      shockBps: 100,
      evidence: {},
      lastVersion: null,
      resultPage: 0,
    };
  };

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
      merged.calculationMode = saved.calculationMode === "price-to-ytm"
        ? "price-to-ytm"
        : "ytm-to-price";
      merged.dayCount = saved.dayCount === "30/360-us"
        ? "30/360-us"
        : "actual-actual-icma";
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
      calculationMode: input("calculationMode") === "price-to-ytm"
        ? "price-to-ytm"
        : "ytm-to-price",
      settlementDate: String(input("settlementDate") || ""),
      maturityDate: String(input("maturityDate") || ""),
      faceValue: finiteNumber(input("faceValue")),
      quantity: finiteNumber(input("quantity")),
      annualCouponRate: finiteNumber(input("annualCouponRate")),
      couponFrequency: finiteNumber(input("couponFrequency")),
      ytm: finiteNumber(input("ytm")),
      cleanQuote: finiteNumber(input("cleanQuote")),
      dayCount: input("dayCount") === "30/360-us" ? "30/360-us" : "actual-actual-icma",
      shockBps: finiteNumber(input("shockBps")),
    };

    if (
      (values.specialTerms === "present" && !values.scopeAcknowledged) ||
      values.faceValue === null || values.faceValue <= 0 || values.faceValue > 1000000000000 ||
      values.quantity === null || values.quantity <= 0 || !Number.isInteger(values.quantity) ||
      values.quantity > 1000000000000 ||
      values.annualCouponRate === null || values.annualCouponRate < 0 ||
      values.annualCouponRate > 100 ||
      ![1, 2, 4].includes(values.couponFrequency) ||
      values.shockBps === null || Math.abs(values.shockBps) > 100000
    ) return null;

    const schedule = buildCouponSchedule(
      values.settlementDate,
      values.maturityDate,
      values.couponFrequency,
    );
    if (!schedule) return null;
    const remainingDays = actualDays(schedule.settlement, schedule.maturity);
    if (remainingDays <= 0 || remainingDays > 36600) return null;
    const fraction = accruedFraction(schedule, values.dayCount);
    if (!fraction) return null;

    if (values.calculationMode === "ytm-to-price") {
      if (
        values.ytm === null || values.ytm > 100000 ||
        1 + (values.ytm / 100) / values.couponFrequency <= 0
      ) return null;
    } else if (
      values.cleanQuote === null || values.cleanQuote <= 0 || values.cleanQuote > 1000000
    ) return null;

    values.schedule = schedule;
    values.alpha = fraction.alpha;
    values.elapsedDays = fraction.elapsedDays;
    values.periodDays = fraction.periodDays;
    values.w = 1 - fraction.alpha;
    values.couponAmount =
      values.faceValue * (values.annualCouponRate / 100) / values.couponFrequency;
    values.accruedInterest = values.couponAmount * values.alpha;
    values.previousCouponDate = isoDate(schedule.previousCoupon);
    values.nextCouponDate = isoDate(schedule.nextCoupon);
    return values;
  };

  const cashFlowsAtYield = (input, yieldDecimal) => {
    const base = 1 + yieldDecimal / input.couponFrequency;
    if (!Number.isFinite(base) || base <= 0) return null;
    const cashFlows = [];
    let dirtyPrice = 0;
    let timeWeighted = 0;
    let convexityNumerator = 0;
    const count = input.schedule.futureDates.length;

    for (let index = 0; index < count; index += 1) {
      const tau = input.w + index;
      const interest = input.couponAmount;
      const principal = index === count - 1 ? input.faceValue : 0;
      const amount = interest + principal;
      const discountFactor = Math.pow(base, -tau);
      const presentValue = amount * discountFactor;
      if (!Number.isFinite(presentValue)) return null;
      const timeYears = tau / input.couponFrequency;
      dirtyPrice += presentValue;
      timeWeighted += timeYears * presentValue;
      convexityNumerator +=
        amount * tau * (tau + 1) /
        (input.couponFrequency ** 2 * Math.pow(base, tau + 2));
      cashFlows.push({
        index: index + 1,
        date: isoDate(input.schedule.futureDates[index]),
        tau,
        timeYears,
        interest,
        principal,
        amount,
        discountFactor,
        presentValue,
      });
    }
    if (!Number.isFinite(dirtyPrice) || dirtyPrice <= 0) return null;
    return {
      dirtyPrice,
      cashFlows,
      macaulayDuration: timeWeighted / dirtyPrice,
      modifiedDuration: (timeWeighted / dirtyPrice) / base,
      convexity: convexityNumerator / dirtyPrice,
    };
  };

  const dirtyPriceAtYield = (input, yieldDecimal) => {
    const base = 1 + yieldDecimal / input.couponFrequency;
    if (!Number.isFinite(base) || base <= 0) return null;
    let dirtyPrice = 0;
    const count = input.schedule.futureDates.length;
    for (let index = 0; index < count; index += 1) {
      const tau = input.w + index;
      const amount = input.couponAmount + (index === count - 1 ? input.faceValue : 0);
      const presentValue = amount * Math.pow(base, -tau);
      if (!Number.isFinite(presentValue)) return Number.POSITIVE_INFINITY;
      dirtyPrice += presentValue;
      if (!Number.isFinite(dirtyPrice)) return Number.POSITIVE_INFINITY;
    }
    return dirtyPrice;
  };

  const solveYield = (input, targetDirtyPrice) => {
    const frequency = input.couponFrequency;
    let low = -frequency + 1e-10;
    let high = Math.max(0.1, input.annualCouponRate / 100 + 0.1);
    const lowPrice = dirtyPriceAtYield(input, low);
    if (lowPrice === null || lowPrice < targetDirtyPrice) return null;

    let highPrice = dirtyPriceAtYield(input, high);
    while (highPrice !== null && highPrice > targetDirtyPrice && high < 1000000) {
      high = high * 2 + 0.1;
      highPrice = dirtyPriceAtYield(input, high);
    }
    if (highPrice === null || highPrice > targetDirtyPrice) return null;

    for (let iteration = 0; iteration < 240; iteration += 1) {
      const middle = (low + high) / 2;
      const middlePrice = dirtyPriceAtYield(input, middle);
      if (middlePrice === null) {
        low = middle;
      } else if (middlePrice > targetDirtyPrice) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return (low + high) / 2;
  };

  const shockResult = (input, baseResult, shockBps) => {
    const yieldDecimal = baseResult.ytmDecimal + shockBps / 10000;
    const exact = cashFlowsAtYield(input, yieldDecimal);
    const yieldChange = shockBps / 10000;
    const durationDirtyPrice =
      baseResult.dirtyPrice * (1 - baseResult.modifiedDuration * yieldChange);
    const durationConvexityDirtyPrice = baseResult.dirtyPrice * (
      1 -
      baseResult.modifiedDuration * yieldChange +
      0.5 * baseResult.convexity * yieldChange * yieldChange
    );
    return {
      shockBps,
      shockedYtm: yieldDecimal * 100,
      exactDirtyPrice: exact?.dirtyPrice ?? null,
      exactCleanPrice: exact ? exact.dirtyPrice - input.accruedInterest : null,
      durationDirtyPrice,
      durationCleanPrice: durationDirtyPrice - input.accruedInterest,
      durationConvexityDirtyPrice,
      durationConvexityCleanPrice: durationConvexityDirtyPrice - input.accruedInterest,
      durationError: exact ? durationDirtyPrice - exact.dirtyPrice : null,
      durationConvexityError: exact
        ? durationConvexityDirtyPrice - exact.dirtyPrice
        : null,
    };
  };

  const calculateBond = (overrides = {}) => {
    const input = normalizeInput(overrides);
    if (!input) return null;
    const targetCleanPrice = input.faceValue * input.cleanQuote / 100;
    const yieldDecimal = input.calculationMode === "price-to-ytm"
      ? solveYield(input, targetCleanPrice + input.accruedInterest)
      : input.ytm / 100;
    if (yieldDecimal === null) return null;
    const price = cashFlowsAtYield(input, yieldDecimal);
    if (!price) return null;

    const cleanPrice = price.dirtyPrice - input.accruedInterest;
    const cleanQuote = cleanPrice / input.faceValue * 100;
    const dirtyQuote = price.dirtyPrice / input.faceValue * 100;
    const accruedInterestQuote = input.accruedInterest / input.faceValue * 100;
    const dv01 = price.dirtyPrice * price.modifiedDuration * 0.0001;
    const baseResult = {
      ...input,
      schedule: undefined,
      ytmDecimal: yieldDecimal,
      ytm: yieldDecimal * 100,
      periodicYield: yieldDecimal / input.couponFrequency,
      effectiveAnnualYield: Math.pow(
        1 + yieldDecimal / input.couponFrequency,
        input.couponFrequency,
      ) - 1,
      dirtyPrice: price.dirtyPrice,
      cleanPrice,
      dirtyQuote,
      cleanQuote,
      accruedInterestQuote,
      macaulayDuration: price.macaulayDuration,
      modifiedDuration: price.modifiedDuration,
      convexity: price.convexity,
      dv01,
      cashFlows: price.cashFlows,
      totalDirtyValue: price.dirtyPrice * input.quantity,
      totalCleanValue: cleanPrice * input.quantity,
      totalAccruedInterest: input.accruedInterest * input.quantity,
      annualCouponAmount:
        input.faceValue * input.annualCouponRate / 100,
      currentYield: cleanPrice > 0
        ? (input.faceValue * input.annualCouponRate / 100) / cleanPrice
        : null,
    };
    const shockValues = Array.from(new Set([-100, -25, 25, 100, input.shockBps]))
      .sort((left, right) => left - right);
    baseResult.shockScenarios = shockValues.map((shockBps) =>
      shockResult(input, baseResult, shockBps));
    baseResult.customShock = baseResult.shockScenarios.find(
      (scenario) => scenario.shockBps === input.shockBps,
    );
    return baseResult;
  };

  const validateStep = (step) => {
    const result = { error: "", warning: "" };
    const number = (field) => finiteNumber(state[field]);
    switch (step) {
      case 0:
        if (state.specialTerms === "present" && !state.scopeAcknowledged)
          result.error = "미지원 특약이 있는 채권은 참고값이라는 점을 확인해야 진행할 수 있습니다.";
        break;
      case 1:
        if (!["ytm-to-price", "price-to-ytm"].includes(state.calculationMode))
          result.error = "계산 방향을 선택해 주세요.";
        break;
      case 2: {
        const schedule = buildCouponSchedule(
          state.settlementDate,
          state.maturityDate,
          number("couponFrequency") || 2,
        );
        if (!parseIsoDate(state.settlementDate) || !parseIsoDate(state.maturityDate))
          result.error = "결제일과 만기일을 올바른 날짜로 입력해 주세요.";
        else if (!schedule)
          result.error = "결제일은 만기일보다 앞서야 합니다.";
        else if (actualDays(schedule.settlement, schedule.maturity) > 36600)
          result.error = "잔존만기는 100년 이하여야 합니다.";
        break;
      }
      case 3:
        if (number("faceValue") === null || number("faceValue") <= 0)
          result.error = "액면금액은 0보다 커야 합니다.";
        else if (
          number("quantity") === null || number("quantity") <= 0 ||
          !Number.isInteger(number("quantity")) || number("quantity") > 1000000000000
        ) result.error = "보유 수량은 1 이상의 정수로 입력해 주세요.";
        break;
      case 4:
        if (
          number("annualCouponRate") === null || number("annualCouponRate") < 0 ||
          number("annualCouponRate") > 100
        ) result.error = "연 쿠폰율은 0%에서 100% 사이로 입력해 주세요.";
        else if (![1, 2, 4].includes(number("couponFrequency")))
          result.error = "지급주기는 연 1·2·4회 중에서 선택해 주세요.";
        break;
      case 5:
        if (
          state.calculationMode === "ytm-to-price" &&
          (number("ytm") === null || number("ytm") > 100000 ||
            1 + (number("ytm") / 100) / number("couponFrequency") <= 0)
        ) result.error = "YTM은 1 + YTM ÷ 지급횟수가 0보다 큰 범위로 입력해 주세요.";
        else if (
          state.calculationMode === "price-to-ytm" &&
          (number("cleanQuote") === null || number("cleanQuote") <= 0 ||
            number("cleanQuote") > 1000000)
        ) result.error = "Clean 가격은 액면 100당 0보다 큰 값으로 입력해 주세요.";
        break;
      case 6:
        if (!["actual-actual-icma", "30/360-us"].includes(state.dayCount))
          result.error = "일수계산 방식을 선택해 주세요.";
        break;
      case 7:
        if (number("shockBps") === null || Math.abs(number("shockBps")) > 100000)
          result.error = "금리 충격은 ±100,000bp 범위로 입력해 주세요.";
        else if (Math.abs(number("shockBps")) > 500)
          result.warning = "충격 폭이 큽니다. 듀레이션 근사보다 정확 재평가 가격을 우선 확인해 주세요.";
        break;
      case REVIEW_STEP:
        if (!calculateBond()) result.error = "현재 입력으로 채권 가격 또는 YTM을 계산할 수 없습니다.";
        break;
      default:
        break;
    }
    return result;
  };

  const allAssumptionsValid = () => {
    for (let step = 0; step <= REVIEW_STEP; step += 1) {
      if (validateStep(step).error) return false;
    }
    return true;
  };

  const readiness = () => {
    const completed = evidenceKeys.filter((key) =>
      String(state.evidence[key] || "").trim()).length;
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
    `<div class="guided-question-copy"><span class="guided-eyebrow">${escapeHtml(eyebrow)}</span><h3 id="guided-bond-question-title">${escapeHtml(question)}</h3><p>${escapeHtml(description)}</p></div>`;

  const renderEvidence = (key, placeholder) =>
    `<details class="guided-evidence"><summary><span>근거 자료 남기기</span><span class="guided-optional">선택</span></summary><label class="guided-evidence-label" for="bond-evidence-${escapeHtml(key)}">문서명 · 기준일 · 페이지 또는 산정 메모</label><textarea id="bond-evidence-${escapeHtml(key)}" data-bond-evidence="${escapeHtml(key)}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(state.evidence[key] || "")}</textarea></details>`;

  const renderHelp = (title, body) =>
    `<details class="guided-help"><summary>${escapeHtml(title)}</summary><div class="guided-help-body"><p>${escapeHtml(body)}</p></div></details>`;

  const renderScopeStep = () => `
    <section class="guided-question-card wide" aria-labelledby="guided-bond-question-title">
      ${renderQuestionHeader({
        eyebrow: "적용 범위",
        question: "일반 고정금리 채권인가요?",
        description: "이 계산기는 정기 후급 쿠폰과 만기 일시상환 구조를 기준으로 합니다.",
      })}
      <div class="guided-choice-grid guided-bond-scope-grid" role="group" aria-label="채권 구조">
        <button type="button" class="guided-choice ${state.specialTerms === "none" ? "selected" : ""}" data-bond-special-terms="none" aria-pressed="${state.specialTerms === "none"}"><span class="guided-choice-icon">✓</span><span class="guided-choice-copy"><strong>일반 고정금리 / 무이표</strong><small>연 1·2·4회 정기 쿠폰, 원금 만기 일시상환</small></span></button>
        <button type="button" class="guided-choice ${state.specialTerms === "present" ? "selected" : ""}" data-bond-special-terms="present" aria-pressed="${state.specialTerms === "present"}"><span class="guided-choice-icon">!</span><span class="guided-choice-copy"><strong>특수 조건 있음</strong><small>변동금리·콜·풋·상각·스텁·지수연동 등</small></span></button>
      </div>
      ${state.specialTerms === "present" ? `<button type="button" class="guided-bond-ack ${state.scopeAcknowledged ? "selected" : ""}" data-bond-action="toggle-scope" aria-pressed="${state.scopeAcknowledged}"><span>${state.scopeAcknowledged ? "✓" : "○"}</span><div><strong>특수 조건 미반영 참고값으로 사용</strong><small>실제 계약 현금흐름과 별도 모형이 필요함을 확인합니다.</small></div></button>` : ""}
      <div data-bond-validation>${renderValidation(0)}</div>
      <div class="guided-message warning">미지원: 변동·물가연동, 콜·풋, 분할상환, 비정규 첫·마지막 쿠폰, 영업일 조정, ex-coupon, OAS, 세금·부도·YTC.</div>
    </section>`;

  const renderModeStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-bond-question-title">
      ${renderQuestionHeader({
        eyebrow: "계산 방향",
        question: "YTM과 가격 중 무엇을 알고 있나요?",
        description: "수익률로 가격을 계산하거나, 시장 Clean 가격으로 YTM을 역산할 수 있습니다.",
      })}
      <div class="guided-choice-grid guided-bond-mode-grid" role="group" aria-label="계산 방향">
        <button type="button" class="guided-choice ${state.calculationMode === "ytm-to-price" ? "selected" : ""}" data-bond-mode="ytm-to-price" aria-pressed="${state.calculationMode === "ytm-to-price"}"><span class="guided-choice-icon">%</span><span class="guided-choice-copy"><strong>YTM → 가격</strong><small>요구수익률로 Clean·Dirty 가격 계산</small></span></button>
        <button type="button" class="guided-choice ${state.calculationMode === "price-to-ytm" ? "selected" : ""}" data-bond-mode="price-to-ytm" aria-pressed="${state.calculationMode === "price-to-ytm"}"><span class="guided-choice-icon">₩</span><span class="guided-choice-copy"><strong>Clean 가격 → YTM</strong><small>액면 100당 시장가격에서 만기수익률 역산</small></span></button>
      </div>
      <div data-bond-validation>${renderValidation(1)}</div>
      ${renderHelp("Clean과 Dirty 가격의 차이", "Dirty 가격은 실제 결제금액이며, Clean 가격은 Dirty 가격에서 경과이자를 뺀 호가입니다.")}
    </section>`;

  const renderDateStep = () => {
    const schedule = buildCouponSchedule(
      state.settlementDate,
      state.maturityDate,
      finiteNumber(state.couponFrequency) || 2,
    );
    return `
      <section class="guided-question-card" aria-labelledby="guided-bond-question-title">
        ${renderQuestionHeader({
          eyebrow: "결제·만기",
          question: "결제일과 만기일은 언제인가요?",
          description: "쿠폰 일정은 만기일에서 역산하며, 만기일이 월말이면 각 쿠폰일도 월말을 유지합니다.",
        })}
        <div class="guided-bond-input-grid">
          <label><span>결제일 <small>Settlement</small></span><input data-bond-field="settlementDate" type="date" value="${escapeHtml(state.settlementDate)}"></label>
          <label><span>만기일 <small>Maturity</small></span><input data-bond-field="maturityDate" type="date" value="${escapeHtml(state.maturityDate)}"></label>
        </div>
        ${schedule ? `<div class="guided-bond-schedule-preview"><div><span>직전 쿠폰일</span><strong>${escapeHtml(isoDate(schedule.previousCoupon))}</strong></div><div><span>다음 쿠폰일</span><strong>${escapeHtml(isoDate(schedule.nextCoupon))}</strong></div><div><span>남은 지급횟수</span><strong>${formatNumber(schedule.futureDates.length, 0)}회</strong></div></div>` : ""}
        <div data-bond-validation>${renderValidation(2)}</div>
        ${renderEvidence("maturityDate", "예: 채권 발행조건서 · 만기 및 이자지급 조항")}
      </section>`;
  };

  const renderFaceStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-bond-question-title">
      ${renderQuestionHeader({
        eyebrow: "평가 단위",
        question: "채권 1개의 액면과 보유 수량은 얼마인가요?",
        description: "호가는 액면 100당, 실제 가격과 DV01은 입력한 액면금액 기준으로 표시합니다.",
      })}
      <div class="guided-bond-input-grid">
        <label><span>액면금액</span><div class="guided-input-wrap"><input data-bond-field="faceValue" type="number" min="0.01" step="any" value="${escapeHtml(state.faceValue)}"><span>원</span></div></label>
        <label><span>보유 수량</span><div class="guided-input-wrap"><input data-bond-field="quantity" type="number" min="1" step="1" value="${escapeHtml(state.quantity)}"><span>개</span></div></label>
      </div>
      <div data-bond-validation>${renderValidation(3)}</div>
      ${renderEvidence("faceValue", "예: 거래명세 · 액면 1,000원 × 100개")}
    </section>`;

  const renderCouponStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-bond-question-title">
      ${renderQuestionHeader({
        eyebrow: "쿠폰 조건",
        question: "연 쿠폰율과 지급주기는 어떻게 되나요?",
        description: "쿠폰율 0%를 입력하면 같은 복리주기의 무이표채로 계산합니다.",
      })}
      <div class="guided-bond-input-grid">
        <label><span>연 쿠폰율</span><div class="guided-input-wrap"><input data-bond-field="annualCouponRate" type="number" min="0" max="100" step="any" value="${escapeHtml(state.annualCouponRate)}"><span>%</span></div></label>
        <label><span>연 지급횟수</span><select data-bond-field="couponFrequency"><option value="1" ${Number(state.couponFrequency) === 1 ? "selected" : ""}>연 1회</option><option value="2" ${Number(state.couponFrequency) === 2 ? "selected" : ""}>연 2회</option><option value="4" ${Number(state.couponFrequency) === 4 ? "selected" : ""}>연 4회</option></select></label>
      </div>
      <button type="button" class="guided-bond-zero" data-bond-set-field="annualCouponRate" data-bond-set-value="0">쿠폰율 0% · 무이표로 설정</button>
      <div data-bond-validation>${renderValidation(4)}</div>
      ${renderEvidence("annualCouponRate", "예: 표면이율 연 6%, 매년 1월·7월 후급")}
    </section>`;

  const renderQuoteStep = () => {
    const isYield = state.calculationMode === "ytm-to-price";
    return `
      <section class="guided-question-card" aria-labelledby="guided-bond-question-title">
        ${renderQuestionHeader({
          eyebrow: isYield ? "시장 수익률" : "시장 가격",
          question: isYield ? "채권의 연 YTM은 몇 %인가요?" : "액면 100당 Clean 가격은 얼마인가요?",
          description: isYield
            ? "명목 연 YTM을 쿠폰 지급횟수로 나누어 복리 할인합니다."
            : "경과이자를 더한 Dirty 가격과 일치하는 YTM을 이분법으로 역산합니다.",
        })}
        <div class="guided-primary-input">
          <input data-bond-field="${isYield ? "ytm" : "cleanQuote"}" type="number" step="any" value="${escapeHtml(isYield ? state.ytm : state.cleanQuote)}">
          <span>${isYield ? "%" : "액면 100당"}</span>
        </div>
        <div data-bond-validation>${renderValidation(5)}</div>
        ${renderEvidence("marketQuote", isYield ? "예: 2026-07-23 종가 YTM 4.00%" : "예: 2026-07-23 Clean 종가 102.50")}
        ${renderHelp("YTM 역산 범위", "각 기간 할인기준 1 + YTM ÷ 지급횟수가 0보다 큰 범위에서 가격과 일치하는 유일한 수익률을 찾습니다.")}
      </section>`;
  };

  const renderDayCountStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-bond-question-title">
      ${renderQuestionHeader({
        eyebrow: "경과이자",
        question: "경과일수는 어떤 방식으로 계산할까요?",
        description: "직전·다음 쿠폰일 사이의 경과비율을 쿠폰 1회 금액에 곱합니다.",
      })}
      <div class="guided-choice-grid guided-bond-daycount-grid" role="group" aria-label="일수계산 방식">
        <button type="button" class="guided-choice ${state.dayCount === "actual-actual-icma" ? "selected" : ""}" data-bond-day-count="actual-actual-icma" aria-pressed="${state.dayCount === "actual-actual-icma"}"><span class="guided-choice-icon">A</span><span class="guided-choice-copy"><strong>Actual/Actual ICMA</strong><small>실제 경과일수 ÷ 실제 쿠폰기간 일수</small></span></button>
        <button type="button" class="guided-choice ${state.dayCount === "30/360-us" ? "selected" : ""}" data-bond-day-count="30/360-us" aria-pressed="${state.dayCount === "30/360-us"}"><span class="guided-choice-icon">30</span><span class="guided-choice-copy"><strong>30/360 US</strong><small>미국식 월 30일·연 360일 기준</small></span></button>
      </div>
      <div data-bond-validation>${renderValidation(6)}</div>
      ${renderEvidence("dayCount", "예: 발행조건서 · Actual/Actual (ICMA)")}
      <div class="guided-message">결제일이 쿠폰일과 같으면 해당 쿠폰은 지급 완료로 보고 경과이자를 0으로 계산합니다.</div>
    </section>`;

  const renderShockStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-bond-question-title">
      ${renderQuestionHeader({
        eyebrow: "금리 민감도",
        question: "추가로 확인할 YTM 충격은 몇 bp인가요?",
        description: "정확 재평가와 듀레이션·컨벡시티 근사를 나란히 비교합니다.",
      })}
      <div class="guided-primary-input">
        <input data-bond-field="shockBps" type="number" step="any" value="${escapeHtml(state.shockBps)}">
        <span>bp</span>
      </div>
      <div class="guided-bond-quick-grid">
        ${[-100, -50, 50, 100].map((value) => `<button type="button" data-bond-set-field="shockBps" data-bond-set-value="${value}">${formatSigned(value, 0)}bp</button>`).join("")}
      </div>
      <div data-bond-validation>${renderValidation(7)}</div>
      ${renderHelp("DV01과 충격 분석의 차이", "DV01은 YTM 1bp 변화의 1차 근사입니다. 충격 분석의 정확 가격은 바뀐 YTM으로 모든 현금흐름을 다시 할인합니다.")}
    </section>`;

  const reviewRows = () => {
    const preview = calculateBond();
    return [
      ["계산 방향", state.calculationMode === "ytm-to-price" ? "YTM → 가격" : "Clean 가격 → YTM", 1],
      ["결제일 / 만기일", `${state.settlementDate} / ${state.maturityDate}`, 2],
      ["액면 / 수량", `${formatNumber(state.faceValue, 4)}원 / ${formatNumber(state.quantity, 0)}개`, 3],
      ["쿠폰 조건", `연 ${formatNumber(state.annualCouponRate, 6)}% · 연 ${formatNumber(state.couponFrequency, 0)}회`, 4],
      [
        state.calculationMode === "ytm-to-price" ? "입력 YTM" : "입력 Clean 가격",
        state.calculationMode === "ytm-to-price"
          ? `${formatNumber(state.ytm, 8)}%`
          : `${formatNumber(state.cleanQuote, 8)} / 액면 100`,
        5,
      ],
      ["일수계산", state.dayCount === "30/360-us" ? "30/360 US" : "Actual/Actual ICMA", 6],
      ["추가 충격", `${formatSigned(state.shockBps, 2)}bp`, 7],
      [
        "계산 미리보기",
        preview
          ? `Clean ${formatNumber(preview.cleanQuote, 6)} · YTM ${formatNumber(preview.ytm, 6)}%`
          : "입력 확인 필요",
        5,
      ],
    ];
  };

  const renderReview = () => {
    const audit = readiness();
    const valid = allAssumptionsValid();
    return `
      <section class="guided-question-card wide" aria-labelledby="guided-bond-question-title">
        ${renderQuestionHeader({
          eyebrow: "최종 검토",
          question: "채권 조건과 시장 입력을 확인해 주세요",
          description: "계산 후 Clean·Dirty 가격, YTM, 듀레이션, 컨벡시티, DV01과 현금흐름을 함께 저장합니다.",
        })}
        <div class="guided-assumption-list">${reviewRows().map(([label, value, step]) => `<div class="guided-assumption-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><button type="button" data-bond-edit-step="${step}">수정</button></div>`).join("")}</div>
        <div class="guided-readiness"><div><span>근거 메모</span><strong>${audit.completed}/${audit.total}</strong></div><div class="guided-readiness-track"><span style="width:${audit.percent}%"></span></div><small>발행조건, 가격·수익률 출처와 일수계산 기준을 남겨 주세요.</small></div>
        <div data-bond-validation>${valid ? '<div class="guided-message success">입력 검토가 끝났습니다. 가격과 금리 위험을 계산할 수 있어요.</div>' : '<div class="guided-message error">일부 입력을 다시 확인해 주세요.</div>'}</div>
        <div class="guided-message warning">정규 고정금리·만기 일시상환 기준입니다. 영업일 조정과 비정규 쿠폰은 반영하지 않습니다.</div>
      </section>`;
  };

  const renderSummary = (result) => `
    <div class="guided-result-hero guided-bond-result-hero"><div><span class="guided-eyebrow">채권 결과 · ${state.lastVersion ? `버전 ${escapeHtml(state.lastVersion)}` : "미저장"}</span><h3 id="guided-bond-result-title">Clean 가격</h3><strong>${formatNumber(result.cleanPrice, 6)}<small>원/채권</small></strong><p>액면 100당 ${formatNumber(result.cleanQuote, 6)} · 결제일 ${escapeHtml(result.settlementDate)}</p></div><div class="guided-result-badge">${result.calculationMode === "ytm-to-price" ? "YTM → PRICE" : "PRICE → YTM"}</div></div>
    <div class="guided-bond-value-grid">
      <article class="total"><span>총 Clean 가치</span><strong>${formatNumber(result.totalCleanValue, 4)}</strong><small>${formatNumber(result.quantity, 0)}개 기준</small></article>
      <article><span>Dirty 가격</span><strong>${formatNumber(result.dirtyPrice, 6)}</strong><small>액면 100당 ${formatNumber(result.dirtyQuote, 6)}</small></article>
      <article><span>경과이자</span><strong>${formatNumber(result.accruedInterest, 6)}</strong><small>α ${formatNumber(result.alpha, 9)}</small></article>
      <article><span>연 YTM</span><strong>${formatNumber(result.ytm, 8)}%</strong><small>유효연수익률 ${formatNumber(result.effectiveAnnualYield * 100, 8)}%</small></article>
      <article><span>다음 쿠폰일</span><strong>${escapeHtml(result.nextCouponDate)}</strong><small>${formatNumber(result.elapsedDays, 0)} / ${formatNumber(result.periodDays, 0)} 경과일</small></article>
    </div>
    <div class="guided-assumption-list guided-bond-checks"><div class="guided-assumption-row"><span>Dirty = Clean + 경과이자</span><strong>${Math.abs(result.dirtyPrice - result.cleanPrice - result.accruedInterest) < 1e-9 ? "통과" : "확인 필요"}</strong></div><div class="guided-assumption-row"><span>총 Dirty 가치</span><strong>${formatNumber(result.totalDirtyValue, 6)}</strong></div><div class="guided-assumption-row"><span>총 경과이자</span><strong>${formatNumber(result.totalAccruedInterest, 6)}</strong></div></div>`;

  const renderRiskPanel = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 2/4</span><h3 id="guided-bond-result-title">금리 민감도</h3><p>Dirty 가격의 YTM 변화 민감도를 현금흐름 현재가치로 계산합니다.</p></div>
    <div class="guided-bond-risk-grid">
      <article><span>Macaulay Duration</span><strong>${formatNumber(result.macaulayDuration, 9)}</strong><small>년</small></article>
      <article><span>Modified Duration</span><strong>${formatNumber(result.modifiedDuration, 9)}</strong><small>수익률 1 단위당</small></article>
      <article><span>Convexity</span><strong>${formatNumber(result.convexity, 9)}</strong><small>연 복리 기준</small></article>
      <article><span>DV01</span><strong>${formatNumber(result.dv01, 9)}</strong><small>원/채권 · YTM 1bp</small></article>
      <article><span>총 DV01</span><strong>${formatNumber(result.dv01 * result.quantity, 9)}</strong><small>${formatNumber(result.quantity, 0)}개 기준</small></article>
      <article><span>현재수익률</span><strong>${result.currentYield === null ? "—" : `${formatNumber(result.currentYield * 100, 8)}%`}</strong><small>연 쿠폰 ÷ Clean 가격</small></article>
    </div>
    <div class="guided-result-note"><strong>해석</strong><p>Modified Duration은 작은 평행 금리변화의 1차 가격근사, Convexity는 곡률 보정입니다. 신용스프레드와 수익률곡선의 비평행 변화는 별도입니다.</p></div>`;

  const renderShockPanel = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 3/4</span><h3 id="guided-bond-result-title">YTM 충격별 정확 가격과 근사</h3><p>경과이자는 고정하고 Dirty 가격을 재평가한 뒤 Clean 가격으로 환산합니다.</p></div>
    <div class="guided-table-wrap guided-bond-shock-table"><table><thead><tr><th>충격</th><th>충격 YTM</th><th>정확 Dirty</th><th>정확 Clean</th><th>Duration</th><th>Duration+Convexity</th><th>근사오차</th></tr></thead><tbody>${result.shockScenarios.map((scenario) => `<tr class="${scenario.shockBps === result.shockBps ? "base" : ""}"><th>${formatSigned(scenario.shockBps, 2)}bp</th><td>${formatNumber(scenario.shockedYtm, 8)}%</td><td>${scenario.exactDirtyPrice === null ? "계산 불가" : formatNumber(scenario.exactDirtyPrice, 8)}</td><td>${scenario.exactCleanPrice === null ? "—" : formatNumber(scenario.exactCleanPrice, 8)}</td><td>${formatNumber(scenario.durationDirtyPrice, 8)}</td><td>${formatNumber(scenario.durationConvexityDirtyPrice, 8)}</td><td>${scenario.durationConvexityError === null ? "—" : formatSigned(scenario.durationConvexityError, 8)}</td></tr>`).join("")}</tbody></table></div>
    <div class="guided-message">강조 행은 입력한 사용자 충격입니다. 금리 충격 후 1 + YTM ÷ 지급횟수가 0 이하이면 정확 재평가를 표시하지 않습니다.</div>`;

  const renderCashFlowPanel = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 4/4</span><h3 id="guided-bond-result-title">잔여 현금흐름과 현재가치</h3><p>결제일 이후 지급되는 쿠폰과 만기 원금만 포함합니다.</p></div>
    <div class="guided-bond-cashflow-summary"><div><span>직전 쿠폰일</span><strong>${escapeHtml(result.previousCouponDate)}</strong></div><div><span>다음 쿠폰일</span><strong>${escapeHtml(result.nextCouponDate)}</strong></div><div><span>경과비율 α</span><strong>${formatNumber(result.alpha, 10)}</strong></div><div><span>첫 할인기간 w</span><strong>${formatNumber(result.w, 10)}</strong></div></div>
    <div class="guided-table-wrap guided-bond-cashflow-table"><table><thead><tr><th>#</th><th>지급일</th><th>τ</th><th>쿠폰</th><th>원금</th><th>현금흐름</th><th>할인계수</th><th>현재가치</th></tr></thead><tbody>${result.cashFlows.map((flow) => `<tr><td>${flow.index}</td><td>${escapeHtml(flow.date)}</td><td>${formatNumber(flow.tau, 9)}</td><td>${formatNumber(flow.interest, 6)}</td><td>${formatNumber(flow.principal, 6)}</td><td>${formatNumber(flow.amount, 6)}</td><td>${formatNumber(flow.discountFactor, 10)}</td><td>${formatNumber(flow.presentValue, 8)}</td></tr>`).join("")}</tbody><tfoot><tr><th colspan="7">Dirty 가격</th><th>${formatNumber(result.dirtyPrice, 8)}</th></tr></tfoot></table></div>
    <div class="guided-result-note"><strong>일정 규칙</strong><p>만기일에서 동일 월수 간격으로 역산하고 월말을 유지합니다. 결제일이 쿠폰일이면 그날 쿠폰은 이미 지급된 것으로 제외합니다.</p></div>`;

  const getResult = () => cachedResult || (cachedResult = calculateBond());
  const renderResult = () => {
    const result = getResult();
    if (!result) {
      return '<section class="guided-question-card"><div class="guided-message error">채권 가격을 계산할 수 없습니다. 날짜와 시장 입력을 확인해 주세요.</div></section>';
    }
    const page = Math.min(Math.max(state.resultPage, 0), resultPanels.length - 1);
    const panels = [
      () => renderSummary(result),
      () => renderRiskPanel(result),
      () => renderShockPanel(result),
      () => renderCashFlowPanel(result),
    ];
    return `<section class="guided-result guided-bond-result" aria-labelledby="guided-bond-result-title"><div class="guided-group-tabs" aria-label="채권 결과 확인 순서">${resultPanels.map((label, index) => `<span class="${index === page ? "active" : ""} ${index < page ? "done" : ""}">${index < page ? "✓ " : ""}${escapeHtml(label)}</span>`).join("")}</div>${panels[page]()}<div class="guided-result-actions"><button type="button" class="secondary" data-bond-result-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← 이전 패널</button>${page < resultPanels.length - 1 ? `<button type="button" class="primary" data-bond-result-page="${page + 1}">다음: ${escapeHtml(resultPanels[page + 1])} →</button>` : '<button type="button" class="secondary" data-bond-action="back-to-review">가정 다시 검토</button><button type="button" class="primary" data-bond-action="new-analysis">새 채권 분석</button>'}</div></section>`;
  };

  const renderStepContent = () => {
    switch (state.step) {
      case 0: return renderScopeStep();
      case 1: return renderModeStep();
      case 2: return renderDateStep();
      case 3: return renderFaceStep();
      case 4: return renderCouponStep();
      case 5: return renderQuoteStep();
      case 6: return renderDayCountStep();
      case 7: return renderShockStep();
      case REVIEW_STEP: return renderReview();
      case RESULT_STEP: return renderResult();
      default: return "";
    }
  };

  const renderProgress = () => {
    const activeStep = Math.min(state.step, TOTAL_QUESTIONS - 1);
    const activeGroup = groups.findIndex((group) =>
      activeStep >= group.start && activeStep < group.end);
    const progress = state.step === RESULT_STEP
      ? 100
      : (state.step + 1) / TOTAL_QUESTIONS * 100;
    return `<header class="guided-progress-shell guided-bond-progress"><div class="guided-progress-topline"><div><span class="guided-product-label">FIXED-RATE BOND</span><strong>${state.step === RESULT_STEP ? "분석 결과" : `${state.step + 1} / ${TOTAL_QUESTIONS}`}</strong></div><span class="guided-autosave">✓ 자동 저장됨</span><button type="button" class="guided-bond-exit" data-bond-action="exit">로드맵으로</button></div><div class="guided-group-tabs" aria-label="채권 분석 진행 구간">${groups.map((group, index) => `<span class="${index === activeGroup ? "active" : ""} ${index < activeGroup ? "done" : ""}">${index < activeGroup ? "✓ " : ""}${escapeHtml(group.label)}</span>`).join("")}</div><div class="guided-progress-track"><span style="width:${progress}%"></span></div></header>`;
  };

  const nextButtonLabel = () => [
    "다음: 계산 방향",
    "다음: 결제·만기",
    "다음: 평가 단위",
    "다음: 쿠폰 조건",
    "다음: 시장 입력",
    "다음: 경과이자 기준",
    "다음: 금리 충격",
    "다음: 최종 검토",
    "계산하고 버전 저장",
  ][state.step] || "다음";

  const renderNavigation = () => state.step === RESULT_STEP
    ? ""
    : `<footer class="guided-navigation"><button type="button" class="secondary" data-bond-action="previous" ${state.step === 0 ? "disabled" : ""}>← 이전</button><span class="guided-navigation-hint">Enter 키로 다음</span><button type="button" class="primary" data-bond-action="next" ${validateStep(state.step).error || (state.step === REVIEW_STEP && !allAssumptionsValid()) ? "disabled" : ""}>${escapeHtml(nextButtonLabel())} →</button></footer>`;

  const updateHeader = () => {
    const contentArea = mountedHost?.closest(".content-area");
    const header = contentArea?.previousElementSibling;
    if (!header?.matches("header.main-header")) return;
    const heading = header.querySelector("h2");
    const description = header.querySelector("p");
    if (heading) heading.textContent = "채권 가격·금리 민감도";
    if (description) {
      description.textContent =
        "Clean·Dirty 가격과 YTM을 양방향으로 계산하고 듀레이션·컨벡시티·DV01을 확인합니다.";
    }
  };

  const render = () => {
    if (!mountedHost?.isConnected) return;
    mountedHost.innerHTML = `<div class="phase3-hub-inner guided-bond">${renderProgress()}<div class="guided-bond-stage">${renderStepContent()}${renderNavigation()}</div></div>`;
    updateHeader();
    const contentArea = mountedHost.closest(".content-area");
    if (contentArea) contentArea.scrollTop = 0;
    const focusTarget = mountedHost.querySelector(
      "input, select, .guided-choice.selected, #guided-bond-question-title, #guided-bond-result-title",
    );
    if (focusTarget) {
      if (focusTarget.matches("h1, h2, h3, h4")) focusTarget.setAttribute("tabindex", "-1");
      try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus(); }
    }
  };

  const updateValidation = () => {
    if (!mountedHost?.isConnected) return;
    const target = mountedHost.querySelector("[data-bond-validation]");
    if (target) target.innerHTML = renderValidation(state.step);
    const next = mountedHost.querySelector('[data-bond-action="next"]');
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
        modelVersion: "fixed-rate-bond-v1",
        version,
        savedAt: new Date().toISOString(),
        assumptions: { ...state, step: REVIEW_STEP },
        result: {
          cleanPrice: result.cleanPrice,
          dirtyPrice: result.dirtyPrice,
          accruedInterest: result.accruedInterest,
          cleanQuote: result.cleanQuote,
          ytm: result.ytm,
          macaulayDuration: result.macaulayDuration,
          modifiedDuration: result.modifiedDuration,
          convexity: result.convexity,
          dv01: result.dv01,
          totalCleanValue: result.totalCleanValue,
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

    const special = event.target.closest("[data-bond-special-terms]");
    if (special && host.contains(special)) {
      state.specialTerms = special.dataset.bondSpecialTerms === "present" ? "present" : "none";
      if (state.specialTerms === "none") state.scopeAcknowledged = false;
      cachedResult = null;
      saveState();
      render();
      return;
    }

    const mode = event.target.closest("[data-bond-mode]");
    if (mode && host.contains(mode)) {
      state.calculationMode = mode.dataset.bondMode === "price-to-ytm"
        ? "price-to-ytm"
        : "ytm-to-price";
      cachedResult = null;
      saveState();
      render();
      return;
    }

    const dayCount = event.target.closest("[data-bond-day-count]");
    if (dayCount && host.contains(dayCount)) {
      state.dayCount = dayCount.dataset.bondDayCount === "30/360-us"
        ? "30/360-us"
        : "actual-actual-icma";
      cachedResult = null;
      saveState();
      render();
      return;
    }

    const quick = event.target.closest("[data-bond-set-field]");
    if (quick && host.contains(quick)) {
      state[quick.dataset.bondSetField] = Number(quick.dataset.bondSetValue);
      cachedResult = null;
      saveState();
      render();
      return;
    }

    const edit = event.target.closest("[data-bond-edit-step]");
    if (edit && host.contains(edit)) {
      state.step = Number(edit.dataset.bondEditStep);
      saveState();
      render();
      return;
    }

    const resultPage = event.target.closest("[data-bond-result-page]");
    if (resultPage && host.contains(resultPage)) {
      state.resultPage = Math.min(
        Math.max(Number(resultPage.dataset.bondResultPage) || 0, 0),
        resultPanels.length - 1,
      );
      saveState();
      render();
      return;
    }

    const action = event.target.closest("[data-bond-action]");
    if (!action || !host.contains(action)) return;
    switch (action.dataset.bondAction) {
      case "toggle-scope":
        state.scopeAcknowledged = !state.scopeAcknowledged;
        cachedResult = null;
        break;
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
          cachedResult = calculateBond();
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
        if (!confirm("현재 결과는 버전으로 보관됩니다. 새 채권 분석을 시작할까요?")) return;
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
    const field = event.target.dataset.bondField;
    const evidence = event.target.dataset.bondEvidence;
    if (field) {
      state[field] = event.target.type === "date"
        ? event.target.value
        : event.target.value === ""
          ? ""
          : Number(event.target.value);
      cachedResult = null;
      saveState();
      updateValidation();
    }
    if (evidence) {
      state.evidence[evidence] = event.target.value;
      saveState();
    }
  };

  const handleKeyDown = (event) => {
    if (
      !mountedHost || event.currentTarget !== mountedHost || event.key !== "Enter" ||
      event.shiftKey || event.target.matches("textarea, button, select") ||
      state.step === RESULT_STEP
    ) return;
    const next = mountedHost.querySelector('[data-bond-action="next"]');
    if (next && !next.disabled) {
      event.preventDefault();
      next.click();
    }
  };

  const ensureEvents = (host) => {
    if (host.dataset.bondEventsReady === "true") return;
    host.dataset.bondEventsReady = "true";
    host.addEventListener("click", handleClick);
    host.addEventListener("input", handleInput);
    host.addEventListener("change", handleInput);
    host.addEventListener("keydown", handleKeyDown);
  };

  const mount = (host, options = {}) => {
    if (!host) return false;
    mountedHost = host;
    exitCallback = typeof options.onExit === "function" ? options.onExit : null;
    host.dataset.phase3Mode = "bond";
    host.setAttribute("aria-label", "채권 가격 및 금리 민감도 단계형 계산기");
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

  globalThis.ValueScannerBond = Object.freeze({
    calculate: (overrides = {}) => calculateBond(overrides),
    getState: () => JSON.parse(JSON.stringify(state)),
    mount,
    startNew,
    validateStep: (step) => ({ ...validateStep(step) }),
  });
})();
