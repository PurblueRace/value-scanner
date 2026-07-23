(() => {
  "use strict";

  const STORAGE_KEY = "value-scanner-guided-black-scholes-v1";
  const SNAPSHOT_KEY = "value-scanner-black-scholes-snapshots-v1";
  const TOTAL_QUESTIONS = 9;
  const RESULT_STEP = TOTAL_QUESTIONS;
  const REVIEW_STEP = TOTAL_QUESTIONS - 1;
  const resultPanels = ["요약", "Greeks", "민감도·체크"];
  const groups = [
    { label: "계약조건", start: 0, end: 4 },
    { label: "시장가정", start: 4, end: 8 },
    { label: "최종검토", start: 8, end: 9 },
  ];
  const evidenceKeys = [
    "stockPrice",
    "strikePrice",
    "timeToMaturity",
    "riskFreeRate",
    "volatility",
    "dividendYield",
  ];

  const today = () => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const createDefaultState = () => ({
    step: 0,
    optionType: "call",
    valuationDate: today(),
    stockPrice: 100,
    strikePrice: 100,
    quantity: 1,
    timeToMaturity: 1,
    riskFreeRate: 5,
    volatility: 20,
    dividendYield: 0,
    evidence: {},
    lastVersion: null,
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
      merged.optionType = saved.optionType === "put" ? "put" : "call";
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

  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The calculator remains usable when browser storage is unavailable.
    }
  };

  const erf = (value) => {
    const coefficients = [
      -1.3026537197817094, 0.6419697923564903, 0.019476473204185836,
      -0.00956151478680863, -0.000946595344482036, 0.000366839497852761,
      0.000042523324806907, -0.000020278578112534, -0.000001624290004647,
      0.00000130365583558, 1.5626441722e-8, -8.5238095915e-8,
      6.529054439e-9, 5.059343495e-9, -9.91364156e-10,
      -2.27365122e-10, 9.6467911e-11, 2.394038e-12, -6.886027e-12,
      8.94487e-13, 3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15,
      -1.523e-15, -9.4e-17, 1.21e-16, -2.8e-17,
    ];
    const negative = value < 0;
    const x = Math.abs(value);
    const t = 2 / (2 + x);
    const transformed = 4 * t - 2;
    let current = 0;
    let previous = 0;
    for (let index = coefficients.length - 1; index > 0; index -= 1) {
      const nextPrevious = current;
      current = transformed * current - previous + coefficients[index];
      previous = nextPrevious;
    }
    const complement = t * Math.exp(
      -x * x + 0.5 * (coefficients[0] + transformed * current) - previous,
    );
    return negative ? complement - 1 : 1 - complement;
  };

  const normalCdf = (value) => 0.5 * (1 + erf(value / Math.SQRT2));
  const normalPdf = (value) => Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);

  const calculateBlackScholes = (overrides = {}) => {
    const input = (field) =>
      Object.prototype.hasOwnProperty.call(overrides, field) ? overrides[field] : state[field];
    const optionType = input("optionType") === "put" ? "put" : "call";
    const stockPrice = finiteNumber(input("stockPrice"));
    const strikePrice = finiteNumber(input("strikePrice"));
    const quantity = finiteNumber(input("quantity"));
    const timeToMaturity = finiteNumber(input("timeToMaturity"));
    const riskFreePercent = finiteNumber(input("riskFreeRate"));
    const volatilityPercent = finiteNumber(input("volatility"));
    const dividendPercent = finiteNumber(input("dividendYield"));

    if (
      stockPrice === null ||
      stockPrice <= 0 ||
      strikePrice === null ||
      strikePrice <= 0 ||
      quantity === null ||
      quantity <= 0 ||
      !Number.isInteger(quantity) ||
      timeToMaturity === null ||
      timeToMaturity <= 0 ||
      timeToMaturity > 100 ||
      riskFreePercent === null ||
      riskFreePercent < -50 ||
      riskFreePercent > 100 ||
      volatilityPercent === null ||
      volatilityPercent <= 0 ||
      volatilityPercent > 500 ||
      dividendPercent === null ||
      dividendPercent < 0 ||
      dividendPercent > 100 ||
      quantity > 1000000000000
    ) {
      return null;
    }

    const riskFreeRate = riskFreePercent / 100;
    const volatility = volatilityPercent / 100;
    const dividendYield = dividendPercent / 100;
    const sqrtTime = Math.sqrt(timeToMaturity);
    const volatilityTime = volatility * sqrtTime;
    if (!Number.isFinite(volatilityTime) || volatilityTime <= 0) return null;

    const d1 =
      (Math.log(stockPrice / strikePrice) +
        (riskFreeRate - dividendYield + 0.5 * volatility * volatility) * timeToMaturity) /
      volatilityTime;
    const d2 = d1 - volatilityTime;
    const spotDiscount = Math.exp(-dividendYield * timeToMaturity);
    const strikeDiscount = Math.exp(-riskFreeRate * timeToMaturity);
    const discountedSpot = stockPrice * spotDiscount;
    const discountedStrike = strikePrice * strikeDiscount;
    const callPrice = discountedSpot * normalCdf(d1) - discountedStrike * normalCdf(d2);
    const putPrice = discountedStrike * normalCdf(-d2) - discountedSpot * normalCdf(-d1);
    const price = optionType === "put" ? putPrice : callPrice;
    const intrinsicValue = optionType === "put"
      ? Math.max(strikePrice - stockPrice, 0)
      : Math.max(stockPrice - strikePrice, 0);
    const timeValue = price - intrinsicValue;
    const commonGamma =
      (spotDiscount * normalPdf(d1)) /
      (stockPrice * volatility * sqrtTime);
    const vega = (stockPrice * spotDiscount * normalPdf(d1) * sqrtTime) / 100;

    const callDelta = spotDiscount * normalCdf(d1);
    const putDelta = spotDiscount * (normalCdf(d1) - 1);
    const callThetaAnnual =
      -(stockPrice * spotDiscount * normalPdf(d1) * volatility) / (2 * sqrtTime) -
      riskFreeRate * discountedStrike * normalCdf(d2) +
      dividendYield * discountedSpot * normalCdf(d1);
    const putThetaAnnual =
      -(stockPrice * spotDiscount * normalPdf(d1) * volatility) / (2 * sqrtTime) +
      riskFreeRate * discountedStrike * normalCdf(-d2) -
      dividendYield * discountedSpot * normalCdf(-d1);
    const callRho = (strikePrice * timeToMaturity * strikeDiscount * normalCdf(d2)) / 100;
    const putRho = (-strikePrice * timeToMaturity * strikeDiscount * normalCdf(-d2)) / 100;
    const delta = optionType === "put" ? putDelta : callDelta;
    const thetaPerDay = (optionType === "put" ? putThetaAnnual : callThetaAnnual) / 365;
    const rho = optionType === "put" ? putRho : callRho;
    const moneynessRatio = stockPrice / strikePrice;
    const inTheMoney = optionType === "put"
      ? stockPrice < strikePrice
      : stockPrice > strikePrice;
    const atTheMoney = Math.abs(stockPrice - strikePrice) / strikePrice <= 0.01;
    const moneynessLabel = atTheMoney ? "등가격(ATM)" : inTheMoney ? "내가격(ITM)" : "외가격(OTM)";
    const riskNeutralItmProbability = optionType === "put"
      ? normalCdf(-d2)
      : normalCdf(d2);
    const parityGap = callPrice - putPrice - (discountedSpot - discountedStrike);
    const forwardPrice = stockPrice * Math.exp(
      (riskFreeRate - dividendYield) * timeToMaturity,
    );

    return {
      optionType,
      stockPrice,
      strikePrice,
      timeToMaturity,
      riskFreeRate: riskFreePercent,
      volatility: volatilityPercent,
      dividendYield: dividendPercent,
      d1,
      d2,
      callPrice,
      putPrice,
      price,
      quantity,
      totalValue: price * quantity,
      companionPrice: optionType === "put" ? callPrice : putPrice,
      intrinsicValue,
      timeValue,
      delta,
      gamma: commonGamma,
      vega,
      thetaPerDay,
      rho,
      moneynessRatio,
      moneynessLabel,
      riskNeutralItmProbability,
      parityGap,
      forwardPrice,
      discountedSpot,
      discountedStrike,
    };
  };

  const formatNumber = (value, maximumFractionDigits = 2) =>
    new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits,
    }).format(Number(value) || 0);

  const formatSigned = (value, maximumFractionDigits = 4) => {
    const number = Number(value) || 0;
    const formatted = formatNumber(Math.abs(number), maximumFractionDigits);
    if (number > 0) return `+${formatted}`;
    if (number < 0) return `−${formatted}`;
    return formatted;
  };

  const optionTypeLabel = (type = state.optionType) =>
    type === "put" ? "유럽형 풋옵션" : "유럽형 콜옵션";

  const validateStep = (step) => {
    const result = { error: "", warning: "" };
    const number = (field) => finiteNumber(state[field]);

    switch (step) {
      case 0:
        if (state.optionType !== "call" && state.optionType !== "put")
          result.error = "평가할 옵션 유형을 선택해 주세요.";
        break;
      case 1:
        if (!state.valuationDate) result.error = "평가 기준일을 입력해 주세요.";
        else if (state.valuationDate > today())
          result.warning = "평가 기준일이 오늘보다 미래입니다. 시장자료 기준일을 확인해 주세요.";
        break;
      case 2:
        if (number("stockPrice") === null || number("stockPrice") <= 0)
          result.error = "기초자산 가격은 0보다 커야 합니다.";
        break;
      case 3:
        if (number("strikePrice") === null || number("strikePrice") <= 0)
          result.error = "행사가격은 0보다 커야 합니다.";
        else if (
          number("quantity") === null ||
          number("quantity") <= 0 ||
          !Number.isInteger(number("quantity")) ||
          number("quantity") > 1000000000000
        )
          result.error = "옵션 수량은 1 이상의 정수로 입력해 주세요.";
        break;
      case 4:
        if (
          number("timeToMaturity") === null ||
          number("timeToMaturity") <= 0 ||
          number("timeToMaturity") > 100
        )
          result.error = "잔존만기는 0년보다 크고 100년 이하여야 합니다.";
        else if (number("timeToMaturity") > 10)
          result.warning = "10년을 넘는 장기 옵션입니다. 기대존속기간과 계약 만기를 다시 확인해 주세요.";
        break;
      case 5:
        if (
          number("riskFreeRate") === null ||
          number("riskFreeRate") < -50 ||
          number("riskFreeRate") > 100
        )
          result.error = "무위험수익률은 -50%에서 100% 사이로 입력해 주세요.";
        else if (number("riskFreeRate") < -5 || number("riskFreeRate") > 20)
          result.warning = "일반적인 시장 범위를 크게 벗어났습니다. 통화와 만기 기준을 확인해 주세요.";
        break;
      case 6:
        if (
          number("volatility") === null ||
          number("volatility") <= 0 ||
          number("volatility") > 500
        )
          result.error = "연환산 변동성은 0%보다 크고 500% 이하여야 합니다.";
        else if (number("volatility") > 100)
          result.warning = "변동성이 100%를 넘습니다. 관측기간과 연환산 방식을 확인해 주세요.";
        break;
      case 7:
        if (
          number("dividendYield") === null ||
          number("dividendYield") < 0 ||
          number("dividendYield") > 100
        )
          result.error = "배당수익률은 0%에서 100% 사이로 입력해 주세요.";
        else if (number("dividendYield") > 20)
          result.warning = "배당수익률이 높은 편입니다. 일회성 배당이 포함됐는지 확인해 주세요.";
        break;
      case REVIEW_STEP:
        if (!calculateBlackScholes())
          result.error = "입력값으로 옵션가치를 계산할 수 없습니다. 가정을 다시 확인해 주세요.";
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
    return Boolean(calculateBlackScholes());
  };

  const readiness = () => {
    const completed = evidenceKeys.filter((key) =>
      String(state.evidence[key] || "").trim(),
    ).length;
    return {
      completed,
      total: evidenceKeys.length,
      percent: Math.round((completed / evidenceKeys.length) * 100),
    };
  };

  const renderValidation = (step) => {
    const { error, warning } = validateStep(step);
    if (error) return `<div class="guided-message error" role="alert">${escapeHtml(error)}</div>`;
    if (warning) return `<div class="guided-message warning">${escapeHtml(warning)}</div>`;
    return '<div class="guided-message" aria-live="polite"></div>';
  };

  const renderEvidence = (key, placeholder) => `
    <details class="guided-evidence">
      <summary>
        <span>근거 자료 남기기</span>
        <span class="guided-optional">선택</span>
      </summary>
      <label class="guided-evidence-label" for="bs-evidence-${escapeHtml(key)}">
        문서명 · 기준일 · 페이지 또는 산정 메모
      </label>
      <textarea
        id="bs-evidence-${escapeHtml(key)}"
        data-bs-evidence="${escapeHtml(key)}"
        rows="3"
        placeholder="${escapeHtml(placeholder)}"
      >${escapeHtml(state.evidence[key] || "")}</textarea>
    </details>
  `;

  const renderHelp = (title, body) => `
    <details class="guided-help">
      <summary>${escapeHtml(title)}</summary>
      <p>${escapeHtml(body)}</p>
    </details>
  `;

  const renderQuestionHeader = ({ eyebrow, question, description }) => `
    <div class="guided-question-copy">
      <span class="guided-eyebrow">${escapeHtml(eyebrow)}</span>
      <h3 id="guided-bs-question-title">${escapeHtml(question)}</h3>
      <p>${escapeHtml(description)}</p>
    </div>
  `;

  const renderTypeStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-bs-question-title">
      ${renderQuestionHeader({
        eyebrow: "옵션 유형",
        question: "어떤 유럽형 옵션을 평가할까요?",
        description: "만기에만 행사할 수 있는 바닐라 콜 또는 풋을 선택해 주세요.",
      })}
      <div class="guided-choice-grid guided-bs-type-grid" role="group" aria-label="옵션 유형">
        <button
          type="button"
          class="guided-choice ${state.optionType === "call" ? "selected" : ""}"
          data-bs-option-type="call"
          aria-pressed="${state.optionType === "call"}"
        >
          <span class="guided-choice-icon">C</span>
          <span class="guided-choice-copy">
            <strong>유럽형 콜옵션</strong>
            <small>만기에 기초자산을 행사가격으로 살 권리</small>
          </span>
        </button>
        <button
          type="button"
          class="guided-choice ${state.optionType === "put" ? "selected" : ""}"
          data-bs-option-type="put"
          aria-pressed="${state.optionType === "put"}"
        >
          <span class="guided-choice-icon">P</span>
          <span class="guided-choice-copy">
            <strong>유럽형 풋옵션</strong>
            <small>만기에 기초자산을 행사가격으로 팔 권리</small>
          </span>
        </button>
      </div>
      <div data-bs-validation>${renderValidation(0)}</div>
      <div class="guided-message warning">미국형 옵션, 중도행사, 장벽·리픽싱 조건은 이 계산기의 범위에 포함되지 않습니다.</div>
    </section>
  `;

  const renderDateStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-bs-question-title">
      ${renderQuestionHeader({
        eyebrow: "평가 기준일",
        question: "가격과 시장가정은 어느 날짜 기준인가요?",
        description: "주가, 금리와 변동성의 관측 기준일을 하나로 맞춰 주세요.",
      })}
      <div class="guided-primary-input date">
        <input
          id="guided-bs-valuation-date"
          data-bs-field="valuationDate"
          type="date"
          value="${escapeHtml(state.valuationDate)}"
          aria-describedby="guided-bs-validation"
        />
      </div>
      <div id="guided-bs-validation" data-bs-validation>${renderValidation(1)}</div>
      ${renderHelp(
        "왜 기준일을 맞춰야 하나요?",
        "블랙–숄즈의 주가, 무위험수익률, 변동성과 배당수익률은 같은 평가시점의 시장상황을 설명해야 합니다.",
      )}
    </section>
  `;

  const renderNumberStep = ({
    step,
    eyebrow,
    question,
    description,
    field,
    unit,
    min,
    max,
    inputStep,
    quickValues = [],
    helpTitle,
    helpBody,
    evidencePlaceholder,
  }) => `
    <section class="guided-question-card" aria-labelledby="guided-bs-question-title">
      ${renderQuestionHeader({ eyebrow, question, description })}
      <div class="guided-primary-input">
        <div class="guided-input-wrap">
          <input
            id="guided-bs-${escapeHtml(field)}"
            data-bs-field="${escapeHtml(field)}"
            type="number"
            inputmode="decimal"
            value="${escapeHtml(state[field])}"
            min="${escapeHtml(min)}"
            max="${escapeHtml(max)}"
            step="${escapeHtml(inputStep)}"
            aria-describedby="guided-bs-validation"
          />
          <span>${escapeHtml(unit)}</span>
        </div>
        ${
          quickValues.length
            ? `<div class="guided-quick-values" aria-label="빠른 값 선택">
                ${quickValues
                  .map(
                    (value) => `<button type="button" data-bs-set-field="${escapeHtml(field)}" data-bs-set-value="${escapeHtml(value)}">${escapeHtml(value)}${escapeHtml(unit)}</button>`,
                  )
                  .join("")}
              </div>`
            : ""
        }
        ${
          field === "strikePrice"
            ? `<div class="guided-bs-secondary-input">
                <label for="guided-bs-quantity">
                  <span>평가 수량</span>
                  <small>총 평가가치 계산용 · 가격식에는 영향 없음</small>
                </label>
                <div class="guided-input-wrap">
                  <input
                    id="guided-bs-quantity"
                    data-bs-field="quantity"
                    type="number"
                    inputmode="numeric"
                    value="${escapeHtml(state.quantity)}"
                    min="1"
                    max="1000000000000"
                    step="1"
                    aria-describedby="guided-bs-validation"
                  />
                  <span>개</span>
                </div>
              </div>`
            : ""
        }
      </div>
      <div id="guided-bs-validation" data-bs-validation>${renderValidation(step)}</div>
      ${renderEvidence(field, evidencePlaceholder)}
      ${renderHelp(helpTitle, helpBody)}
    </section>
  `;

  const reviewRows = () => [
    ["옵션 유형", optionTypeLabel(), 0],
    ["평가 기준일", state.valuationDate, 1],
    ["기초자산 가격", `${formatNumber(state.stockPrice, 4)}원`, 2],
    ["행사가격", `${formatNumber(state.strikePrice, 4)}원`, 3],
    ["평가 수량", `${formatNumber(state.quantity, 0)}개`, 3],
    ["잔존만기", `${formatNumber(state.timeToMaturity, 4)}년`, 4],
    ["무위험수익률", `${formatNumber(state.riskFreeRate, 4)}%`, 5],
    ["연환산 변동성", `${formatNumber(state.volatility, 4)}%`, 6],
    ["연속 배당수익률", `${formatNumber(state.dividendYield, 4)}%`, 7],
  ];

  const renderReview = () => {
    const auditReadiness = readiness();
    const valid = allAssumptionsValid();
    return `
      <section class="guided-question-card wide" aria-labelledby="guided-bs-question-title">
        ${renderQuestionHeader({
          eyebrow: "최종 검토",
          question: "계산 전에 옵션 조건과 시장가정을 확인해 주세요",
          description: "가격과 민감도는 옵션 1개당 원화 기준이며, 총 평가가치는 입력한 수량을 곱합니다.",
        })}
        <div class="guided-assumption-list">
          ${reviewRows()
            .map(
              ([label, value, step]) => `
                <div class="guided-assumption-row">
                  <span>${escapeHtml(label)}</span>
                  <strong>${escapeHtml(value)}</strong>
                  <button type="button" data-bs-edit-step="${step}">수정</button>
                </div>
              `,
            )
            .join("")}
        </div>
        <div class="guided-readiness">
          <div><span>근거 메모</span><strong>${auditReadiness.completed}/${auditReadiness.total}</strong></div>
          <div class="guided-readiness-track"><span style="width:${auditReadiness.percent}%"></span></div>
          <small>근거 메모는 선택사항이지만 공정가치 검토와 재현에 도움이 됩니다.</small>
        </div>
        <div class="guided-result-note guided-bs-scope-note">
          <strong>적용 범위</strong>
          <p>유럽형 바닐라 옵션, 일정한 금리·변동성, 연속 배당수익률을 가정합니다. 조기행사나 경로의존 조건에는 다른 모형이 필요합니다.</p>
        </div>
        <div data-bs-validation>
          ${
            valid
              ? '<div class="guided-message success">가정 검토가 끝났습니다. 옵션가치와 민감도를 계산할 수 있어요.</div>'
              : '<div class="guided-message error">일부 입력이 유효하지 않습니다. 수정 버튼으로 해당 가정을 확인해 주세요.</div>'
          }
        </div>
      </section>
    `;
  };

  const renderResultSummary = (result) => `
    <div class="guided-result-hero guided-bs-result-hero">
      <div>
        <span class="guided-eyebrow">블랙–숄즈 결과 · 버전 ${escapeHtml(state.lastVersion || 1)}</span>
        <h3 id="guided-bs-result-title">${escapeHtml(optionTypeLabel(result.optionType))} 이론가</h3>
        <strong>${formatNumber(result.price, 4)}<small>원</small></strong>
        <p>옵션 1개 기준 · 평가일 ${escapeHtml(state.valuationDate)}</p>
      </div>
      <div class="guided-result-badge">Black–Scholes</div>
    </div>
    <div class="guided-bs-value-grid">
      <article class="guided-bs-total-value">
        <span>총 평가가치</span>
        <strong>${formatNumber(result.totalValue, 4)}</strong>
        <small>${formatNumber(result.quantity, 0)}개 × ${formatNumber(result.price, 4)}원</small>
      </article>
      <article>
        <span>현재 내재가치</span>
        <strong>${formatNumber(result.intrinsicValue, 4)}</strong>
        <small>원</small>
      </article>
      <article>
        <span>잔여가치</span>
        <strong>${formatSigned(result.timeValue, 4)}</strong>
        <small>이론가 − 현재 내재가치</small>
      </article>
      <article>
        <span>반대 옵션 이론가</span>
        <strong>${formatNumber(result.companionPrice, 4)}</strong>
        <small>${result.optionType === "put" ? "콜옵션" : "풋옵션"}</small>
      </article>
      <article>
        <span>머니니스</span>
        <strong>${escapeHtml(result.moneynessLabel)}</strong>
        <small>S/K ${formatNumber(result.moneynessRatio, 4)}</small>
      </article>
    </div>
    <div class="guided-bs-equation">
      <span>S <strong>${formatNumber(result.stockPrice, 4)}</strong></span>
      <span>K <strong>${formatNumber(result.strikePrice, 4)}</strong></span>
      <span>T <strong>${formatNumber(result.timeToMaturity, 4)}년</strong></span>
      <span>σ <strong>${formatNumber(result.volatility, 4)}%</strong></span>
    </div>
    ${
      result.timeValue < 0
        ? '<div class="guided-message warning">유럽형 옵션은 중도행사가 불가능해 배당 조건에 따라 이론가가 현재 내재가치보다 낮을 수 있습니다.</div>'
        : '<div class="guided-message success">가격, 내재가치와 잔여가치가 계산됐습니다.</div>'
    }
  `;

  const greekCards = (result) => [
    ["Delta", formatSigned(result.delta, 6), "기초자산 가격이 1원 변할 때 옵션가치 변화"],
    ["Gamma", formatNumber(result.gamma, 8), "기초자산 가격이 1원 변할 때 Delta 변화"],
    ["Vega", formatSigned(result.vega, 6), "변동성이 1%p 오를 때 옵션가치 변화"],
    ["Theta", formatSigned(result.thetaPerDay, 6), "다른 조건이 같을 때 하루 경과 효과"],
    ["Rho", formatSigned(result.rho, 6), "무위험수익률이 1%p 오를 때 옵션가치 변화"],
  ];

  const renderGreeks = (result) => `
    <div class="guided-question-copy">
      <span class="guided-eyebrow">결과 · 2/3</span>
      <h3 id="guided-bs-result-title">주요 가격 민감도(Greeks)</h3>
      <p>각 수치는 다른 조건을 고정한 국소 민감도입니다. 큰 폭의 변화에는 뒤의 시나리오 표를 함께 사용하세요.</p>
    </div>
    <div class="guided-bs-greeks">
      ${greekCards(result)
        .map(
          ([label, value, description]) => `
            <article>
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
              <p>${escapeHtml(description)}</p>
            </article>
          `,
        )
        .join("")}
    </div>
    <div class="guided-result-note">
      <strong>해석 주의</strong>
      <p>Vega와 Rho는 각각 1%포인트 변화 기준이고, Theta는 1일 기준입니다. Gamma는 콜과 풋이 동일합니다.</p>
    </div>
  `;

  const renderSensitivity = (result) => {
    const stockOffsets = [-20, -10, 0, 10, 20];
    const volatilityOffsets = [-5, 0, 5];
    return `
      <div class="guided-question-copy">
        <span class="guided-eyebrow">결과 · 3/3</span>
        <h3 id="guided-bs-result-title">주가·변동성 시나리오와 모형 체크</h3>
        <p>기초자산 가격과 변동성을 동시에 바꿔 옵션가치가 어느 범위에서 움직이는지 확인하세요.</p>
      </div>
      <div class="guided-sensitivity guided-bs-sensitivity">
        <h4>옵션가치 민감도 <small>(원 / 옵션 1개)</small></h4>
        <div class="guided-table-wrap">
          <table>
            <thead>
              <tr>
                <th>기초자산 가격</th>
                ${volatilityOffsets
                  .map((offset) => `<th>σ ${formatNumber(Math.max(result.volatility + offset, 0.01), 2)}%</th>`)
                  .join("")}
              </tr>
            </thead>
            <tbody>
              ${stockOffsets
                .map((stockOffset) => {
                  const scenarioStock = result.stockPrice * (1 + stockOffset / 100);
                  return `
                    <tr>
                      <th>${formatNumber(scenarioStock, 4)} <small>(${formatSigned(stockOffset, 0)}%)</small></th>
                      ${volatilityOffsets
                        .map((volatilityOffset) => {
                          const scenario = calculateBlackScholes({
                            stockPrice: scenarioStock,
                            volatility: Math.max(result.volatility + volatilityOffset, 0.01),
                          });
                          return `<td class="${stockOffset === 0 && volatilityOffset === 0 ? "base" : ""}">${scenario ? formatNumber(scenario.price, 4) : "-"}</td>`;
                        })
                        .join("")}
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="guided-assumption-list guided-bs-checks">
        <div class="guided-assumption-row"><span>풋콜패리티 오차</span><strong>${formatNumber(Math.abs(result.parityGap), 10)}원</strong></div>
        <div class="guided-assumption-row"><span>선도가격</span><strong>${formatNumber(result.forwardPrice, 4)}원</strong></div>
        <div class="guided-assumption-row"><span>위험중립 만기 ITM 확률</span><strong>${formatNumber(result.riskNeutralItmProbability * 100, 4)}%</strong></div>
        <div class="guided-assumption-row"><span>d1 / d2</span><strong>${formatNumber(result.d1, 6)} / ${formatNumber(result.d2, 6)}</strong></div>
      </div>
      <div class="guided-message warning">위험중립 확률은 실제 발생확률 예측값이 아닙니다. 조기행사·변동성 스마일·점프·경로의존 조건은 별도 모형으로 평가하세요.</div>
    `;
  };

  const renderResult = () => {
    const result = calculateBlackScholes();
    if (!result) {
      return `
        <section class="guided-question-card">
          <div class="guided-message error">결과를 계산할 수 없습니다. 옵션 조건과 시장가정을 다시 확인해 주세요.</div>
        </section>
      `;
    }

    const page = Math.min(Math.max(state.resultPage, 0), resultPanels.length - 1);
    const panels = [
      () => renderResultSummary(result),
      () => renderGreeks(result),
      () => renderSensitivity(result),
    ];
    return `
      <section class="guided-result guided-bs-result" aria-labelledby="guided-bs-result-title">
        <div class="guided-group-tabs" aria-label="블랙–숄즈 결과 확인 순서">
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
          <button type="button" class="secondary" data-bs-result-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← 이전 패널</button>
          ${
            page < resultPanels.length - 1
              ? `<button type="button" class="primary" data-bs-result-page="${page + 1}">다음: ${escapeHtml(resultPanels[page + 1])} →</button>`
              : `
                <button type="button" class="secondary" data-bs-action="back-to-review">가정 다시 검토</button>
                <button type="button" class="primary" data-bs-action="new-analysis">새 옵션 분석</button>
              `
          }
        </div>
      </section>
    `;
  };

  const renderStepContent = () => {
    switch (state.step) {
      case 0:
        return renderTypeStep();
      case 1:
        return renderDateStep();
      case 2:
        return renderNumberStep({
          step: 2,
          eyebrow: "기초자산 가격",
          question: "평가기준일의 기초자산 가격은 얼마인가요?",
          description: "옵션과 동일한 기초자산·통화·기준시점의 관측가격을 입력해 주세요.",
          field: "stockPrice",
          unit: "원",
          min: 0.0001,
          max: 1000000000000,
          inputStep: 0.01,
          quickValues: [50, 100, 1000],
          helpTitle: "비상장 주식이라면 어떤 값을 쓰나요?",
          helpBody: "평가기준일의 주당 공정가치 또는 일관된 방식으로 산정한 기초자산 가치를 사용하고 산정 근거를 남기세요.",
          evidencePlaceholder: "예: 2026-07-23 종가, 거래소 공시 또는 주당가치 산정보고서",
        });
      case 3:
        return renderNumberStep({
          step: 3,
          eyebrow: "행사가격",
          question: "옵션의 행사가격은 얼마인가요?",
          description: "계약서에 정해진 옵션 1개당 행사대금을 입력해 주세요.",
          field: "strikePrice",
          unit: "원",
          min: 0.0001,
          max: 1000000000000,
          inputStep: 0.01,
          quickValues: [50, 100, 1000],
          helpTitle: "행사가격 조정 조건이 있다면요?",
          helpBody: "리픽싱이나 단계별 행사가격처럼 조건이 바뀌는 계약은 단일 블랙–숄즈 모형의 범위를 벗어납니다.",
          evidencePlaceholder: "예: 옵션계약서 제4조, 행사가격 100원",
        });
      case 4:
        return renderNumberStep({
          step: 4,
          eyebrow: "잔존만기",
          question: "평가기준일부터 만기까지 몇 년이 남았나요?",
          description: "일수 기준 잔존기간을 연 단위로 환산해 입력해 주세요.",
          field: "timeToMaturity",
          unit: "년",
          min: 0.0001,
          max: 100,
          inputStep: 0.01,
          quickValues: [0.5, 1, 3, 5],
          helpTitle: "기대존속기간을 써야 하는 경우도 있나요?",
          helpBody: "주식기준보상처럼 실제 행사시점이 계약만기보다 이를 것으로 예상되면 적용 회계기준에 따라 기대존속기간을 검토하세요.",
          evidencePlaceholder: "예: 만기 2027-07-23, 평가일 기준 잔존 1.00년",
        });
      case 5:
        return renderNumberStep({
          step: 5,
          eyebrow: "무위험수익률",
          question: "잔존만기와 같은 통화의 무위험수익률은 몇 %인가요?",
          description: "평가기준일의 만기 대응 국채·무위험 수익률을 연속복리 기준으로 입력해 주세요.",
          field: "riskFreeRate",
          unit: "%",
          min: -50,
          max: 100,
          inputStep: 0.01,
          quickValues: [2, 3.5, 5],
          helpTitle: "단순수익률 자료만 있다면요?",
          helpBody: "자료의 복리 방식과 만기를 확인해 계약 통화에 맞게 일관되게 변환하고 근거를 남기세요.",
          evidencePlaceholder: "예: 평가일 1년 만기 국고채 수익률, 연속복리 변환 메모",
        });
      case 6:
        return renderNumberStep({
          step: 6,
          eyebrow: "변동성",
          question: "기초자산의 연환산 변동성은 몇 %인가요?",
          description: "수익률 관측주기, 관측기간과 비교기업 선정 기준을 일관되게 적용해 주세요.",
          field: "volatility",
          unit: "%",
          min: 0.0001,
          max: 500,
          inputStep: 0.1,
          quickValues: [20, 30, 50],
          helpTitle: "비상장기업 변동성은 어떻게 정하나요?",
          helpBody: "사업과 규모가 유사한 상장 비교기업의 변동성을 같은 관측기간으로 계산하고 이상치·자본구조 차이를 검토하세요.",
          evidencePlaceholder: "예: 비교기업 5개, 주간수익률 3년, 중앙값 20%",
        });
      case 7:
        return renderNumberStep({
          step: 7,
          eyebrow: "배당수익률",
          question: "연속 배당수익률은 몇 %인가요?",
          description: "예상 배당을 기초자산 가격 대비 연환산 수익률로 입력하고 배당이 없으면 0%를 사용하세요.",
          field: "dividendYield",
          unit: "%",
          min: 0,
          max: 100,
          inputStep: 0.01,
          quickValues: [0, 1, 2, 5],
          helpTitle: "확정 현금배당이라면요?",
          helpBody: "큰 확정배당이 특정 시점에 예정된 경우 연속 배당수익률 근사보다 배당 현재가치를 별도로 조정하는 모형이 더 적합할 수 있습니다.",
          evidencePlaceholder: "예: 최근 배당정책과 예상 배당금으로 산정한 연속 배당수익률",
        });
      case REVIEW_STEP:
        return renderReview();
      case RESULT_STEP:
        return renderResult();
      default:
        return "";
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
      <header class="guided-progress-shell guided-bs-progress">
        <div class="guided-progress-topline">
          <div>
            <span class="guided-product-label">BLACK–SCHOLES</span>
            <strong>${state.step === RESULT_STEP ? "분석 결과" : `${state.step + 1} / ${TOTAL_QUESTIONS}`}</strong>
          </div>
          <span class="guided-autosave">✓ 자동 저장됨</span>
          <button type="button" class="guided-bs-exit" data-bs-action="exit">로드맵으로</button>
        </div>
        <div class="guided-group-tabs" aria-label="블랙–숄즈 진행 구간">
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
        <div class="guided-progress-track" aria-hidden="true"><span style="width:${progress}%"></span></div>
      </header>
    `;
  };

  const nextButtonLabel = () => {
    const labels = [
      "다음: 평가 기준일",
      "다음: 기초자산 가격",
      "다음: 행사가격",
      "다음: 잔존만기",
      "다음: 무위험수익률",
      "다음: 변동성",
      "다음: 배당수익률",
      "다음: 최종 검토",
      "계산하고 버전 저장",
    ];
    return labels[state.step] || "다음";
  };

  const renderNavigation = () => {
    if (state.step === RESULT_STEP) return "";
    const validation = validateStep(state.step);
    const finalBlocked = state.step === REVIEW_STEP && !allAssumptionsValid();
    return `
      <footer class="guided-navigation">
        <button type="button" class="secondary" data-bs-action="previous" ${state.step === 0 ? "disabled" : ""}>← 이전</button>
        <span class="guided-navigation-hint">Enter 키로 다음</span>
        <button type="button" class="primary" data-bs-action="next" ${validation.error || finalBlocked ? "disabled" : ""}>
          ${escapeHtml(nextButtonLabel())} →
        </button>
      </footer>
    `;
  };

  const updateHeader = () => {
    const contentArea = mountedHost?.closest(".content-area");
    const header = contentArea?.previousElementSibling;
    if (!header?.matches("header.main-header")) return;
    const heading = header.querySelector("h2");
    const description = header.querySelector("p");
    if (heading) heading.textContent = "블랙–숄즈 옵션가치평가";
    if (description) {
      description.textContent = "유럽형 콜·풋 옵션의 이론가와 Greeks를 한 질문씩 계산합니다.";
    }
  };

  const render = () => {
    if (!mountedHost?.isConnected) return;
    mountedHost.innerHTML = `
      <div class="phase3-hub-inner guided-bs">
        ${renderProgress()}
        <div class="guided-bs-stage">
          ${renderStepContent()}
          ${renderNavigation()}
        </div>
      </div>
    `;
    updateHeader();
    const contentArea = mountedHost.closest(".content-area");
    if (contentArea) contentArea.scrollTop = 0;
    const focusTarget = mountedHost.querySelector(
      ".guided-primary-input input, .guided-choice.selected, #guided-bs-question-title, #guided-bs-result-title",
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
    const validationHost = mountedHost.querySelector("[data-bs-validation]");
    if (validationHost) validationHost.innerHTML = renderValidation(state.step);
    const next = mountedHost.querySelector('[data-bs-action="next"]');
    if (next) {
      next.disabled = Boolean(validateStep(state.step).error) ||
        (state.step === REVIEW_STEP && !allAssumptionsValid());
    }
  };

  const saveSnapshot = () => {
    const result = calculateBlackScholes();
    if (!result) return null;
    try {
      const raw = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
      const snapshots = Array.isArray(raw) ? raw : [];
      const version = (Number(snapshots[snapshots.length - 1]?.version) || 0) + 1;
      snapshots.push({
        version,
        savedAt: new Date().toISOString(),
        assumptions: { ...state, step: REVIEW_STEP },
        result: {
          optionType: result.optionType,
          price: result.price,
          quantity: result.quantity,
          totalValue: result.totalValue,
          callPrice: result.callPrice,
          putPrice: result.putPrice,
          delta: result.delta,
          gamma: result.gamma,
          vega: result.vega,
          thetaPerDay: result.thetaPerDay,
          rho: result.rho,
        },
      });
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots.slice(-20)));
      return version;
    } catch {
      return 1;
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

    const typeButton = event.target.closest("[data-bs-option-type]");
    if (typeButton && host.contains(typeButton)) {
      state.optionType = typeButton.dataset.bsOptionType === "put" ? "put" : "call";
      saveState();
      render();
      return;
    }

    const quickButton = event.target.closest("[data-bs-set-field]");
    if (quickButton && host.contains(quickButton)) {
      state[quickButton.dataset.bsSetField] = Number(quickButton.dataset.bsSetValue);
      saveState();
      render();
      return;
    }

    const editButton = event.target.closest("[data-bs-edit-step]");
    if (editButton && host.contains(editButton)) {
      state.step = Number(editButton.dataset.bsEditStep);
      saveState();
      render();
      return;
    }

    const resultButton = event.target.closest("[data-bs-result-page]");
    if (resultButton && host.contains(resultButton)) {
      state.resultPage = Math.min(
        Math.max(Number(resultButton.dataset.bsResultPage) || 0, 0),
        resultPanels.length - 1,
      );
      saveState();
      render();
      return;
    }

    const actionButton = event.target.closest("[data-bs-action]");
    if (!actionButton || !host.contains(actionButton)) return;
    switch (actionButton.dataset.bsAction) {
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
          if (!allAssumptionsValid()) {
            updateValidation();
            return;
          }
          state.lastVersion = saveSnapshot();
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
        if (!confirm("현재 결과는 버전으로 보관됩니다. 새 블랙–숄즈 분석을 시작할까요?")) return;
        state = createDefaultState();
        break;
      default:
        return;
    }
    saveState();
    render();
  };

  const handleInput = (event) => {
    if (!mountedHost || event.currentTarget !== mountedHost) return;
    const field = event.target.dataset.bsField;
    const evidenceKey = event.target.dataset.bsEvidence;
    if (field) {
      state[field] = event.target.type === "date"
        ? event.target.value
        : event.target.value === ""
          ? ""
          : Number(event.target.value);
      saveState();
      updateValidation();
    }
    if (evidenceKey) {
      state.evidence[evidenceKey] = event.target.value;
      saveState();
    }
  };

  const handleKeyDown = (event) => {
    if (
      !mountedHost ||
      event.currentTarget !== mountedHost ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.target.matches("textarea, button") ||
      state.step === RESULT_STEP
    ) return;
    const next = mountedHost.querySelector('[data-bs-action="next"]');
    if (next && !next.disabled) {
      event.preventDefault();
      next.click();
    }
  };

  const ensureEvents = (host) => {
    if (host.dataset.bsEventsReady === "true") return;
    host.dataset.bsEventsReady = "true";
    host.addEventListener("click", handleClick);
    host.addEventListener("input", handleInput);
    host.addEventListener("keydown", handleKeyDown);
  };

  const mount = (host, options = {}) => {
    if (!host) return false;
    mountedHost = host;
    exitCallback = typeof options.onExit === "function" ? options.onExit : null;
    host.dataset.phase3Mode = "black-scholes";
    host.setAttribute("aria-label", "블랙–숄즈 옵션가치평가 단계형 계산기");
    ensureEvents(host);
    render();
    return true;
  };

  const startNew = () => {
    state = createDefaultState();
    saveState();
    if (mountedHost) render();
    return JSON.parse(JSON.stringify(state));
  };

  globalThis.ValueScannerBlackScholes = Object.freeze({
    calculate: (overrides = {}) => calculateBlackScholes(overrides),
    getState: () => JSON.parse(JSON.stringify(state)),
    mount,
    startNew,
    validateStep: (step) => ({ ...validateStep(step) }),
  });
})();
