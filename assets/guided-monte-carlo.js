(() => {
  "use strict";

  const STORAGE_KEY = "value-scanner-guided-monte-carlo-v1";
  const SNAPSHOT_KEY = "value-scanner-monte-carlo-snapshots-v1";
  const TOTAL_QUESTIONS = 10;
  const REVIEW_STEP = TOTAL_QUESTIONS - 1;
  const RESULT_STEP = TOTAL_QUESTIONS;
  const resultPanels = ["요약", "분포·정밀도", "민감도"];
  const groups = [
    { label: "계약조건", start: 0, end: 4 },
    { label: "시장가정", start: 4, end: 8 },
    { label: "시뮬레이션", start: 8, end: 9 },
    { label: "최종검토", start: 9, end: 10 },
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
    payoffStyle: "european",
    optionType: "call",
    valuationDate: today(),
    stockPrice: 100,
    strikePrice: 100,
    quantity: 1,
    payoutAmount: 100,
    timeToMaturity: 1,
    riskFreeRate: 5,
    volatility: 20,
    dividendYield: 0,
    pathCount: 50000,
    timeSteps: 12,
    randomSeed: 42,
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
      merged.payoffStyle = ["european", "asian", "digital"].includes(saved.payoffStyle)
        ? saved.payoffStyle
        : "european";
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
  let cachedResult = null;

  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage is helpful but not required for the calculation itself.
    }
  };

  const erf = (value) => {
    const coefficients = [
      -1.3026537197817094, 0.6419697923564903, 0.019476473204185836,
      -0.00956151478680863, -0.000946595344482036, 0.000366839497852761,
      0.000042523324806907, -0.000020278578112534, -0.000001624290004647,
      0.00000130365583558, 1.5626441722e-8, -8.5238095915e-8,
      6.529054439e-9, 5.059343495e-9, -9.91364156e-10, -2.27365122e-10,
      9.6467911e-11, 2.394038e-12, -6.886027e-12, 8.94487e-13,
      3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15, -1.523e-15,
      -9.4e-17, 1.21e-16, -2.8e-17,
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

  const normalizeInput = (overrides = {}) => {
    const input = (field) =>
      Object.prototype.hasOwnProperty.call(overrides, field) ? overrides[field] : state[field];
    const payoffStyle = ["european", "asian", "digital"].includes(input("payoffStyle"))
      ? input("payoffStyle")
      : null;
    const optionType = ["call", "put"].includes(input("optionType"))
      ? input("optionType")
      : null;
    const values = {
      payoffStyle,
      optionType,
      stockPrice: finiteNumber(input("stockPrice")),
      strikePrice: finiteNumber(input("strikePrice")),
      quantity: finiteNumber(input("quantity")),
      payoutAmount: finiteNumber(input("payoutAmount")),
      timeToMaturity: finiteNumber(input("timeToMaturity")),
      riskFreeRate: finiteNumber(input("riskFreeRate")),
      volatility: finiteNumber(input("volatility")),
      dividendYield: finiteNumber(input("dividendYield")),
      pathCount: finiteNumber(input("pathCount")),
      timeSteps: payoffStyle === "asian" ? finiteNumber(input("timeSteps")) : 1,
      randomSeed: finiteNumber(input("randomSeed")),
    };

    if (
      !values.payoffStyle ||
      !values.optionType ||
      values.stockPrice === null || values.stockPrice <= 0 ||
      values.strikePrice === null || values.strikePrice <= 0 ||
      values.quantity === null || values.quantity <= 0 ||
      !Number.isInteger(values.quantity) || values.quantity > 1000000000000 ||
      values.timeToMaturity === null || values.timeToMaturity <= 0 ||
      values.timeToMaturity > 100 ||
      values.riskFreeRate === null || values.riskFreeRate < -50 ||
      values.riskFreeRate > 100 ||
      values.volatility === null || values.volatility <= 0 || values.volatility > 500 ||
      values.dividendYield === null || values.dividendYield < 0 ||
      values.dividendYield > 100 ||
      values.pathCount === null || !Number.isInteger(values.pathCount) ||
      values.pathCount < 2000 || values.pathCount > 200000 ||
      values.pathCount % 2 !== 0 ||
      values.timeSteps === null || !Number.isInteger(values.timeSteps) ||
      values.timeSteps < 1 || values.timeSteps > 365 ||
      values.randomSeed === null || !Number.isInteger(values.randomSeed) ||
      values.randomSeed < 0 || values.randomSeed > 4294967295 ||
      values.pathCount * values.timeSteps > 12600000 ||
      (values.payoffStyle === "digital" &&
        (values.payoutAmount === null || values.payoutAmount <= 0 ||
          values.payoutAmount > 1000000000000))
    ) return null;

    return values;
  };

  const mulberry32 = (seed) => {
    let current = seed >>> 0;
    return () => {
      current += 0x6d2b79f5;
      let value = current;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  };

  const createNormalSource = (random) => {
    let spare = null;
    return () => {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return value;
      }
      let first = 0;
      while (first <= Number.EPSILON) first = random();
      const second = random();
      const radius = Math.sqrt(-2 * Math.log(first));
      const angle = 2 * Math.PI * second;
      spare = radius * Math.sin(angle);
      return radius * Math.cos(angle);
    };
  };

  const percentile = (sorted, probability) => {
    if (!sorted.length) return 0;
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  };

  const payoffFor = (input, underlying) => {
    const inTheMoney = input.optionType === "call"
      ? underlying > input.strikePrice
      : underlying < input.strikePrice;
    if (input.payoffStyle === "digital") return inTheMoney ? input.payoutAmount : 0;
    return input.optionType === "call"
      ? Math.max(underlying - input.strikePrice, 0)
      : Math.max(input.strikePrice - underlying, 0);
  };

  const analyticBenchmark = (input) => {
    if (input.payoffStyle === "asian") return null;
    const time = input.timeToMaturity;
    const rate = input.riskFreeRate / 100;
    const dividend = input.dividendYield / 100;
    const volatility = input.volatility / 100;
    const sqrtTime = Math.sqrt(time);
    const d1 = (
      Math.log(input.stockPrice / input.strikePrice) +
      (rate - dividend + 0.5 * volatility * volatility) * time
    ) / (volatility * sqrtTime);
    const d2 = d1 - volatility * sqrtTime;
    const strikeDiscount = Math.exp(-rate * time);
    if (input.payoffStyle === "digital") {
      return input.payoutAmount * strikeDiscount * (
        input.optionType === "call" ? normalCdf(d2) : normalCdf(-d2)
      );
    }
    const discountedSpot = input.stockPrice * Math.exp(-dividend * time);
    const discountedStrike = input.strikePrice * strikeDiscount;
    return input.optionType === "call"
      ? discountedSpot * normalCdf(d1) - discountedStrike * normalCdf(d2)
      : discountedStrike * normalCdf(-d2) - discountedSpot * normalCdf(-d1);
  };

  const runSimulation = (
    input,
    { collectDistribution = true, computeGreeks = true } = {},
  ) => {
    const random = mulberry32(input.randomSeed);
    const normal = createNormalSource(random);
    const pairCount = Math.ceil(input.pathCount / 2);
    const effectivePaths = pairCount * 2;
    const time = input.timeToMaturity;
    const rate = input.riskFreeRate / 100;
    const dividend = input.dividendYield / 100;
    const volatility = input.volatility / 100;
    const timeStep = time / input.timeSteps;
    const drift = (rate - dividend - 0.5 * volatility * volatility) * timeStep;
    const diffusion = volatility * Math.sqrt(timeStep);
    const discount = Math.exp(-rate * time);
    const supportsGreeks = computeGreeks && input.payoffStyle !== "digital";
    const spotBump = Math.min(
      Math.max(input.stockPrice * 0.005, 0.01),
      input.stockPrice / 2,
    );
    const volatilityBump = Math.min(0.5, input.volatility / 2);
    const volatilityUp = (input.volatility + volatilityBump) / 100;
    const volatilityDown = (input.volatility - volatilityBump) / 100;
    const driftUp = (rate - dividend - 0.5 * volatilityUp * volatilityUp) * timeStep;
    const driftDown = (rate - dividend - 0.5 * volatilityDown * volatilityDown) * timeStep;
    const diffusionUp = volatilityUp * Math.sqrt(timeStep);
    const diffusionDown = volatilityDown * Math.sqrt(timeStep);
    const payoffSamples = collectDistribution ? [] : null;
    const checkpoints = [
      Math.max(1, Math.ceil(pairCount * 0.25)),
      Math.max(1, Math.ceil(pairCount * 0.5)),
      pairCount,
    ];
    const convergence = [];
    let checkpointIndex = 0;
    let valueMean = 0;
    let valueM2 = 0;
    let deltaMean = 0;
    let deltaM2 = 0;
    let vegaMean = 0;
    let vegaM2 = 0;
    let terminalSum = 0;
    let underlyingSum = 0;
    let itmCount = 0;

    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      let positivePath = input.stockPrice;
      let negativePath = input.stockPrice;
      let positiveAverage = 0;
      let negativeAverage = 0;
      let positiveVolUp = input.stockPrice;
      let negativeVolUp = input.stockPrice;
      let positiveVolDown = input.stockPrice;
      let negativeVolDown = input.stockPrice;
      let positiveVolUpAverage = 0;
      let negativeVolUpAverage = 0;
      let positiveVolDownAverage = 0;
      let negativeVolDownAverage = 0;
      for (let stepIndex = 0; stepIndex < input.timeSteps; stepIndex += 1) {
        const shock = normal();
        positivePath *= Math.exp(drift + diffusion * shock);
        negativePath *= Math.exp(drift - diffusion * shock);
        positiveAverage += positivePath;
        negativeAverage += negativePath;
        if (supportsGreeks) {
          positiveVolUp *= Math.exp(driftUp + diffusionUp * shock);
          negativeVolUp *= Math.exp(driftUp - diffusionUp * shock);
          positiveVolDown *= Math.exp(driftDown + diffusionDown * shock);
          negativeVolDown *= Math.exp(driftDown - diffusionDown * shock);
          positiveVolUpAverage += positiveVolUp;
          negativeVolUpAverage += negativeVolUp;
          positiveVolDownAverage += positiveVolDown;
          negativeVolDownAverage += negativeVolDown;
        }
      }

      positiveAverage /= input.timeSteps;
      negativeAverage /= input.timeSteps;
      positiveVolUpAverage /= input.timeSteps;
      negativeVolUpAverage /= input.timeSteps;
      positiveVolDownAverage /= input.timeSteps;
      negativeVolDownAverage /= input.timeSteps;
      const positiveUnderlying = input.payoffStyle === "asian"
        ? positiveAverage
        : positivePath;
      const negativeUnderlying = input.payoffStyle === "asian"
        ? negativeAverage
        : negativePath;
      const positivePayoff = payoffFor(input, positiveUnderlying) * discount;
      const negativePayoff = payoffFor(input, negativeUnderlying) * discount;
      const pairMean = (positivePayoff + negativePayoff) / 2;
      if (payoffSamples) payoffSamples.push(positivePayoff, negativePayoff);
      const sampleCount = pairIndex + 1;
      const valueDelta = pairMean - valueMean;
      valueMean += valueDelta / sampleCount;
      valueM2 += valueDelta * (pairMean - valueMean);

      if (supportsGreeks) {
        const positiveSpotUp = positiveUnderlying * ((input.stockPrice + spotBump) / input.stockPrice);
        const negativeSpotUp = negativeUnderlying * ((input.stockPrice + spotBump) / input.stockPrice);
        const positiveSpotDown = positiveUnderlying * ((input.stockPrice - spotBump) / input.stockPrice);
        const negativeSpotDown = negativeUnderlying * ((input.stockPrice - spotBump) / input.stockPrice);
        const spotUpPair = (
          payoffFor(input, positiveSpotUp) + payoffFor(input, negativeSpotUp)
        ) * discount / 2;
        const spotDownPair = (
          payoffFor(input, positiveSpotDown) + payoffFor(input, negativeSpotDown)
        ) * discount / 2;
        const deltaSample = (spotUpPair - spotDownPair) / (2 * spotBump);
        const deltaChange = deltaSample - deltaMean;
        deltaMean += deltaChange / sampleCount;
        deltaM2 += deltaChange * (deltaSample - deltaMean);

        const positiveUpUnderlying = input.payoffStyle === "asian"
          ? positiveVolUpAverage
          : positiveVolUp;
        const negativeUpUnderlying = input.payoffStyle === "asian"
          ? negativeVolUpAverage
          : negativeVolUp;
        const positiveDownUnderlying = input.payoffStyle === "asian"
          ? positiveVolDownAverage
          : positiveVolDown;
        const negativeDownUnderlying = input.payoffStyle === "asian"
          ? negativeVolDownAverage
          : negativeVolDown;
        const volatilityUpPair = (
          payoffFor(input, positiveUpUnderlying) + payoffFor(input, negativeUpUnderlying)
        ) * discount / 2;
        const volatilityDownPair = (
          payoffFor(input, positiveDownUnderlying) + payoffFor(input, negativeDownUnderlying)
        ) * discount / 2;
        const vegaSample = (volatilityUpPair - volatilityDownPair) / (2 * volatilityBump);
        const vegaChange = vegaSample - vegaMean;
        vegaMean += vegaChange / sampleCount;
        vegaM2 += vegaChange * (vegaSample - vegaMean);
      }
      terminalSum += positivePath + negativePath;
      underlyingSum += positiveUnderlying + negativeUnderlying;
      itmCount += Number(input.optionType === "call"
        ? positiveUnderlying > input.strikePrice
        : positiveUnderlying < input.strikePrice);
      itmCount += Number(input.optionType === "call"
        ? negativeUnderlying > input.strikePrice
        : negativeUnderlying < input.strikePrice);

      if (pairIndex + 1 === checkpoints[checkpointIndex]) {
        convergence.push({
          paths: (pairIndex + 1) * 2,
          estimate: valueMean,
        });
        checkpointIndex += 1;
      }
    }

    const value = valueMean;
    const variance = pairCount > 1 ? Math.max(valueM2 / (pairCount - 1), 0) : 0;
    const standardError = Math.sqrt(variance / pairCount);
    const margin = 1.96 * standardError;
    const deltaStandardError = supportsGreeks && pairCount > 1
      ? Math.sqrt(Math.max(deltaM2 / (pairCount - 1), 0) / pairCount)
      : null;
    const vegaStandardError = supportsGreeks && pairCount > 1
      ? Math.sqrt(Math.max(vegaM2 / (pairCount - 1), 0) / pairCount)
      : null;
    const benchmark = analyticBenchmark(input);
    const sortedPayoffs = payoffSamples ? payoffSamples.sort((a, b) => a - b) : [];
    const precisionBase = Math.max(
      Math.abs(value),
      (input.payoffStyle === "digital" ? input.payoutAmount : input.stockPrice) * 0.01,
    );
    const confidenceHalfWidthRatio = margin / precisionBase;

    return {
      ...input,
      value,
      totalValue: value * input.quantity,
      effectivePaths,
      pairCount,
      standardError,
      relativeStandardError: standardError / precisionBase,
      confidenceHalfWidthRatio,
      precisionLabel: confidenceHalfWidthRatio <= 0.01
        ? "안정"
        : confidenceHalfWidthRatio <= 0.03
          ? "참고 가능"
          : "경로 확대 권고",
      confidenceLow: value - margin,
      confidenceHigh: value + margin,
      delta: supportsGreeks ? deltaMean : null,
      deltaStandardError,
      deltaConfidenceLow: supportsGreeks ? deltaMean - 1.96 * deltaStandardError : null,
      deltaConfidenceHigh: supportsGreeks ? deltaMean + 1.96 * deltaStandardError : null,
      vega: supportsGreeks ? vegaMean : null,
      vegaStandardError,
      vegaConfidenceLow: supportsGreeks ? vegaMean - 1.96 * vegaStandardError : null,
      vegaConfidenceHigh: supportsGreeks ? vegaMean + 1.96 * vegaStandardError : null,
      spotBump,
      volatilityBump,
      benchmark,
      benchmarkGap: benchmark === null ? null : value - benchmark,
      expectedTerminalPrice: terminalSum / effectivePaths,
      expectedPayoffUnderlying: underlyingSum / effectivePaths,
      itmProbability: itmCount / effectivePaths,
      payoffP05: percentile(sortedPayoffs, 0.05),
      payoffP50: percentile(sortedPayoffs, 0.5),
      payoffP95: percentile(sortedPayoffs, 0.95),
      convergence,
      antithetic: true,
    };
  };

  const calculateMonteCarlo = (overrides = {}) => {
    const input = normalizeInput(overrides);
    return input ? runSimulation(input) : null;
  };

  const payoffStyleLabel = (style = state.payoffStyle) => ({
    european: "유럽형 바닐라",
    asian: "산술평균 아시아형",
    digital: "현금지급 디지털",
  }[style] || "옵션");

  const optionTypeLabel = (type = state.optionType) => type === "put" ? "풋" : "콜";
  const contractLabel = (input = state) =>
    `${payoffStyleLabel(input.payoffStyle)} ${optionTypeLabel(input.optionType)}`;

  const validateStep = (step) => {
    const result = { error: "", warning: "" };
    const number = (field) => finiteNumber(state[field]);
    switch (step) {
      case 0:
        if (!['european', 'asian', 'digital'].includes(state.payoffStyle) ||
          !['call', 'put'].includes(state.optionType))
          result.error = "지급구조와 콜·풋 방향을 선택해 주세요.";
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
        else if (number("quantity") === null || number("quantity") <= 0 ||
          !Number.isInteger(number("quantity")) || number("quantity") > 1000000000000)
          result.error = "계약 수량은 1 이상의 정수로 입력해 주세요.";
        else if (state.payoffStyle === "digital" &&
          (number("payoutAmount") === null || number("payoutAmount") <= 0 ||
            number("payoutAmount") > 1000000000000))
          result.error = "디지털 옵션의 만기 현금지급액은 0보다 커야 합니다.";
        break;
      case 4:
        if (number("timeToMaturity") === null || number("timeToMaturity") <= 0 ||
          number("timeToMaturity") > 100)
          result.error = "잔존만기는 0년보다 크고 100년 이하여야 합니다.";
        break;
      case 5:
        if (number("riskFreeRate") === null || number("riskFreeRate") < -50 ||
          number("riskFreeRate") > 100)
          result.error = "무위험수익률은 -50%에서 100% 사이로 입력해 주세요.";
        else if (number("riskFreeRate") < -5 || number("riskFreeRate") > 20)
          result.warning = "일반적인 시장 범위를 크게 벗어납니다. 통화와 만기를 확인해 주세요.";
        break;
      case 6:
        if (number("volatility") === null || number("volatility") <= 0 ||
          number("volatility") > 500)
          result.error = "연환산 변동성은 0%보다 크고 500% 이하여야 합니다.";
        else if (number("volatility") > 100)
          result.warning = "변동성이 100%를 넘습니다. 관측기간과 연환산 방식을 확인해 주세요.";
        break;
      case 7:
        if (number("dividendYield") === null || number("dividendYield") < 0 ||
          number("dividendYield") > 100)
          result.error = "배당수익률은 0%에서 100% 사이로 입력해 주세요.";
        break;
      case 8:
        if (number("pathCount") === null || !Number.isInteger(number("pathCount")) ||
          number("pathCount") < 2000 || number("pathCount") > 200000 ||
          number("pathCount") % 2 !== 0)
          result.error = "경로 수는 2,000에서 200,000 사이의 짝수로 입력해 주세요.";
        else if (state.payoffStyle === "asian" &&
          (number("timeSteps") === null || !Number.isInteger(number("timeSteps")) ||
          number("timeSteps") < 1 || number("timeSteps") > 365))
          result.error = "경로당 시점 수는 1에서 365 사이의 정수로 입력해 주세요.";
        else if (number("randomSeed") === null || !Number.isInteger(number("randomSeed")) ||
          number("randomSeed") < 0 || number("randomSeed") > 4294967295)
          result.error = "난수 시드는 0에서 4,294,967,295 사이의 정수로 입력해 주세요.";
        else if (number("pathCount") * (state.payoffStyle === "asian" ? number("timeSteps") : 1) > 12600000)
          result.error = "브라우저 계산량을 위해 경로 수 × 관측 시점을 12,600,000 이하로 줄여 주세요.";
        else if (number("pathCount") < 5000)
          result.warning = "경로 수가 적어 신뢰구간이 넓을 수 있습니다. 결과의 표준오차를 확인하세요.";
        break;
      case REVIEW_STEP:
        if (!normalizeInput()) result.error = "일부 입력이 유효하지 않습니다. 가정을 다시 확인해 주세요.";
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
    return Boolean(normalizeInput());
  };

  const readiness = () => {
    const completed = evidenceKeys.filter((key) => String(state.evidence[key] || "").trim()).length;
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

  const renderQuestionHeader = ({ eyebrow, question, description }) => `
    <div class="guided-question-copy">
      <span class="guided-eyebrow">${escapeHtml(eyebrow)}</span>
      <h3 id="guided-mc-question-title">${escapeHtml(question)}</h3>
      <p>${escapeHtml(description)}</p>
    </div>
  `;

  const renderEvidence = (key, placeholder) => `
    <details class="guided-evidence">
      <summary><span>근거 자료 남기기</span><span class="guided-optional">선택</span></summary>
      <label class="guided-evidence-label" for="mc-evidence-${escapeHtml(key)}">문서명 · 기준일 · 페이지 또는 산정 메모</label>
      <textarea id="mc-evidence-${escapeHtml(key)}" data-mc-evidence="${escapeHtml(key)}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(state.evidence[key] || "")}</textarea>
    </details>
  `;

  const renderHelp = (title, body) => `
    <details class="guided-help">
      <summary>${escapeHtml(title)}</summary>
      <div class="guided-help-body"><p>${escapeHtml(body)}</p></div>
    </details>
  `;

  const renderPayoffStep = () => {
    const styles = [
      ["european", "EU", "유럽형 바닐라", "만기 주가와 행사가격의 차액"],
      ["asian", "AVG", "산술평균 아시아형", "경로상 관측 주가의 산술평균으로 지급액 결정"],
      ["digital", "01", "현금지급 디지털", "만기 조건 충족 시 정해진 현금 지급"],
    ];
    return `
      <section class="guided-question-card wide" aria-labelledby="guided-mc-question-title">
        ${renderQuestionHeader({
          eyebrow: "지급구조",
          question: "어떤 조건부 지급액을 시뮬레이션할까요?",
          description: "현재 버전은 위험중립 GBM 경로로 유럽형·산술평균 아시아형·현금지급 디지털 옵션을 평가합니다.",
        })}
        <div class="guided-mc-section-label">지급 기준</div>
        <div class="guided-choice-grid guided-mc-style-grid" role="group" aria-label="지급구조">
          ${styles.map(([value, code, title, description]) => `
            <button type="button" class="guided-choice ${state.payoffStyle === value ? "selected" : ""}" data-mc-payoff-style="${value}" aria-pressed="${state.payoffStyle === value}">
              <span class="guided-choice-icon">${code}</span>
              <span class="guided-choice-copy"><strong>${title}</strong><small>${description}</small></span>
            </button>
          `).join("")}
        </div>
        <div class="guided-mc-section-label">방향</div>
        <div class="guided-choice-grid guided-mc-direction-grid" role="group" aria-label="옵션 방향">
          <button type="button" class="guided-choice ${state.optionType === "call" ? "selected" : ""}" data-mc-option-type="call" aria-pressed="${state.optionType === "call"}">
            <span class="guided-choice-icon">C</span><span class="guided-choice-copy"><strong>콜</strong><small>기준가격을 웃돌 때 가치 발생</small></span>
          </button>
          <button type="button" class="guided-choice ${state.optionType === "put" ? "selected" : ""}" data-mc-option-type="put" aria-pressed="${state.optionType === "put"}">
            <span class="guided-choice-icon">P</span><span class="guided-choice-copy"><strong>풋</strong><small>기준가격을 밑돌 때 가치 발생</small></span>
          </button>
        </div>
        <div data-mc-validation>${renderValidation(0)}</div>
        ${state.payoffStyle === "asian" ? '<div class="guided-message warning">미래 관측치만 산술평균하며 평가일 이전에 이미 관측된 가격은 반영하지 않습니다.</div>' : ""}
        <div class="guided-message warning">장벽·리픽싱·조기행사·금리확률과정은 아직 포함하지 않습니다. 계약조건이 이 범위와 맞는지 먼저 확인하세요.</div>
      </section>
    `;
  };

  const renderDateStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-mc-question-title">
      ${renderQuestionHeader({
        eyebrow: "평가 기준일",
        question: "계약조건과 시장가정은 어느 날짜 기준인가요?",
        description: "주가·금리·변동성·배당률을 같은 평가시점으로 맞춰 주세요.",
      })}
      <div class="guided-primary-input date">
        <input id="guided-mc-valuation-date" data-mc-field="valuationDate" type="date" value="${escapeHtml(state.valuationDate)}" aria-describedby="guided-mc-validation" />
      </div>
      <div id="guided-mc-validation" data-mc-validation>${renderValidation(1)}</div>
      ${renderHelp("왜 기준일이 필요한가요?", "같은 계약도 시장가정의 관측시점이 달라지면 재현 가능한 평가가 되지 않기 때문입니다.")}
    </section>
  `;

  const renderNumberStep = ({
    step, eyebrow, question, description, field, unit, min, max, inputStep,
    quickValues = [], helpTitle, helpBody, evidencePlaceholder,
  }) => `
    <section class="guided-question-card" aria-labelledby="guided-mc-question-title">
      ${renderQuestionHeader({ eyebrow, question, description })}
      <div class="guided-primary-input">
        <div class="guided-input-wrap">
          <input id="guided-mc-${escapeHtml(field)}" data-mc-field="${escapeHtml(field)}" type="number" inputmode="decimal" value="${escapeHtml(state[field])}" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(inputStep)}" aria-describedby="guided-mc-validation" />
          <span>${escapeHtml(unit)}</span>
        </div>
        ${quickValues.length ? `<div class="guided-quick-values" aria-label="빠른 값 선택">${quickValues.map((value) => `<button type="button" data-mc-set-field="${escapeHtml(field)}" data-mc-set-value="${escapeHtml(value)}">${escapeHtml(value)}${escapeHtml(unit)}</button>`).join("")}</div>` : ""}
      </div>
      <div id="guided-mc-validation" data-mc-validation>${renderValidation(step)}</div>
      ${renderEvidence(field, evidencePlaceholder)}
      ${renderHelp(helpTitle, helpBody)}
    </section>
  `;

  const renderContractStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-mc-question-title">
      ${renderQuestionHeader({
        eyebrow: "계약 지급조건",
        question: "행사가격과 평가 수량을 입력해 주세요",
        description: state.payoffStyle === "digital"
          ? "조건 충족 시 계약 1개당 지급되는 현금액도 함께 입력합니다."
          : "옵션가치는 1개당 계산하고 평가 수량을 곱해 총가치를 표시합니다.",
      })}
      <div class="guided-mc-contract-grid">
        <label><span>행사가격</span><div class="guided-input-wrap"><input data-mc-field="strikePrice" type="number" inputmode="decimal" value="${escapeHtml(state.strikePrice)}" min="0.0001" max="1000000000000" step="0.01" aria-describedby="guided-mc-validation" /><span>원</span></div></label>
        <label><span>평가 수량</span><div class="guided-input-wrap"><input data-mc-field="quantity" type="number" inputmode="numeric" value="${escapeHtml(state.quantity)}" min="1" max="1000000000000" step="1" aria-describedby="guided-mc-validation" /><span>개</span></div></label>
        ${state.payoffStyle === "digital" ? `<label class="wide"><span>조건 충족 시 현금지급액</span><div class="guided-input-wrap"><input data-mc-field="payoutAmount" type="number" inputmode="decimal" value="${escapeHtml(state.payoutAmount)}" min="0.0001" max="1000000000000" step="0.01" aria-describedby="guided-mc-validation" /><span>원/개</span></div></label>` : ""}
      </div>
      <div id="guided-mc-validation" data-mc-validation>${renderValidation(3)}</div>
      ${renderEvidence("strikePrice", "예: 옵션 계약서 제3조 행사가격 100원, 수량 10,000개")}
      ${renderHelp("아시아형의 평균은 어떻게 계산하나요?", "평가기준일부터 만기까지 균등한 각 시점의 모의 주가를 산술평균합니다. 최초 주가는 평균에서 제외합니다.")}
    </section>
  `;

  const renderSimulationStep = () => `
    <section class="guided-question-card wide" aria-labelledby="guided-mc-question-title">
      ${renderQuestionHeader({
        eyebrow: "시뮬레이션 설정",
        question: "경로 수·관측 시점·난수 시드를 정해 주세요",
        description: "같은 시드를 사용하면 같은 결과가 재현됩니다. 대칭 난수를 짝지어 표준오차를 줄입니다.",
      })}
      <div class="guided-mc-simulation-grid">
        <label><span>총 경로 수</span><small>2,000 ~ 200,000 · 짝수</small><div class="guided-input-wrap"><input data-mc-field="pathCount" type="number" inputmode="numeric" value="${escapeHtml(state.pathCount)}" min="2000" max="200000" step="2000" aria-describedby="guided-mc-validation" /><span>개</span></div></label>
        ${state.payoffStyle === "asian"
          ? `<label><span>미래 관측 시점</span><small>1 ~ 365 · S₀ 제외</small><div class="guided-input-wrap"><input data-mc-field="timeSteps" type="number" inputmode="numeric" value="${escapeHtml(state.timeSteps)}" min="1" max="365" step="1" aria-describedby="guided-mc-validation" /><span>회</span></div></label>`
          : '<div class="guided-mc-fixed-setting"><span>지급 판정 시점</span><strong>만기 1회</strong><small>경로의 중간 시점은 지급액에 영향을 주지 않음</small></div>'}
        <label><span>난수 시드</span><small>재현용 정수</small><div class="guided-input-wrap"><input data-mc-field="randomSeed" type="number" inputmode="numeric" value="${escapeHtml(state.randomSeed)}" min="0" max="4294967295" step="1" aria-describedby="guided-mc-validation" /></div></label>
      </div>
      <div class="guided-quick-values" aria-label="경로 수 빠른 선택">
        ${[10000, 50000, 100000, 200000].map((value) => `<button type="button" data-mc-set-field="pathCount" data-mc-set-value="${value}">${formatNumber(value, 0)}경로</button>`).join("")}
      </div>
      <div id="guided-mc-validation" data-mc-validation>${renderValidation(8)}</div>
      <div class="guided-result-note"><strong>분산 감소</strong><p>모든 정규충격 Z에 대해 −Z 경로를 함께 생성하는 대칭변량(antithetic variates)을 사용하며, 95% 신뢰구간은 독립적인 경로쌍 평균의 표준오차로 계산합니다.</p></div>
    </section>
  `;

  const reviewRows = () => [
    ["지급구조", contractLabel(), 0],
    ["평가 기준일", state.valuationDate, 1],
    ["기초자산 가격", `${formatNumber(state.stockPrice, 4)}원`, 2],
    ["행사가격", `${formatNumber(state.strikePrice, 4)}원`, 3],
    ["평가 수량", `${formatNumber(state.quantity, 0)}개`, 3],
    ...(state.payoffStyle === "digital" ? [["현금지급액", `${formatNumber(state.payoutAmount, 4)}원/개`, 3]] : []),
    ["잔존만기", `${formatNumber(state.timeToMaturity, 4)}년`, 4],
    ["무위험수익률", `${formatNumber(state.riskFreeRate, 4)}%`, 5],
    ["연환산 변동성", `${formatNumber(state.volatility, 4)}%`, 6],
    ["연속 배당수익률", `${formatNumber(state.dividendYield, 4)}%`, 7],
    ["경로 / 관측시점 / 시드", `${formatNumber(state.pathCount, 0)} / ${state.payoffStyle === "asian" ? formatNumber(state.timeSteps, 0) : "1"} / ${formatNumber(state.randomSeed, 0)}`, 8],
  ];

  const renderReview = () => {
    const auditReadiness = readiness();
    const valid = allAssumptionsValid();
    return `
      <section class="guided-question-card wide" aria-labelledby="guided-mc-question-title">
        ${renderQuestionHeader({
          eyebrow: "최종 검토",
          question: "계약조건, 시장가정과 시뮬레이션 설정을 확인해 주세요",
          description: "모형 범위와 지급구조가 실제 계약과 일치할 때만 결과를 사용하세요.",
        })}
        <div class="guided-assumption-list">
          ${reviewRows().map(([label, value, step]) => `<div class="guided-assumption-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><button type="button" data-mc-edit-step="${step}">수정</button></div>`).join("")}
        </div>
        <div class="guided-readiness">
          <div><span>근거 메모</span><strong>${auditReadiness.completed}/${auditReadiness.total}</strong></div>
          <div class="guided-readiness-track"><span style="width:${auditReadiness.percent}%"></span></div>
          <small>계약서, 시장자료 기준일과 변동성 산정 근거를 남기면 재현과 검토에 도움이 됩니다.</small>
        </div>
        <div class="guided-result-note"><strong>모형 범위</strong><p>상수 금리·변동성·연속배당을 가진 위험중립 기하브라운운동(GBM)을 가정합니다. 실제 확률예측, 신용위험, 조기행사, 장벽, 점프와 변동성 스마일은 별도 모형이 필요합니다.</p></div>
        <div data-mc-validation>${valid ? '<div class="guided-message success">입력 검토가 끝났습니다. 시뮬레이션을 실행할 수 있어요.</div>' : '<div class="guided-message error">일부 입력이 유효하지 않습니다. 수정 버튼으로 확인해 주세요.</div>'}</div>
      </section>
    `;
  };

  const renderSummary = (result) => `
    <div class="guided-result-hero guided-mc-result-hero">
      <div>
        <span class="guided-eyebrow">몬테카를로 결과 · 버전 ${escapeHtml(state.lastVersion || 1)}</span>
        <h3 id="guided-mc-result-title">${escapeHtml(contractLabel(result))} 추정가치</h3>
        <strong>${formatNumber(result.value, 4)}<small>원/개</small></strong>
        <p>평가일 ${escapeHtml(state.valuationDate)} · 시드 ${formatNumber(result.randomSeed, 0)}</p>
      </div>
      <div class="guided-result-badge">Risk-neutral GBM</div>
    </div>
    <div class="guided-mc-summary-grid">
      <article class="total"><span>총 평가가치</span><strong>${formatNumber(result.totalValue, 4)}</strong><small>${formatNumber(result.quantity, 0)}개 × ${formatNumber(result.value, 4)}원</small></article>
      <article><span>95% 신뢰구간</span><strong>${formatNumber(result.confidenceLow, 4)} ~ ${formatNumber(result.confidenceHigh, 4)}</strong><small>옵션 1개 기준</small></article>
      <article><span>표준오차 · ${escapeHtml(result.precisionLabel)}</span><strong>${formatNumber(result.standardError, 6)}</strong><small>95% 반폭 비율 ${formatNumber(result.confidenceHalfWidthRatio * 100, 3)}%</small></article>
      <article><span>실제 생성 경로</span><strong>${formatNumber(result.effectivePaths, 0)}</strong><small>${formatNumber(result.pairCount, 0)}개 대칭 경로쌍</small></article>
      <article><span>${result.benchmark === null ? "조건 충족 확률" : "해석해 기준가"}</span><strong>${result.benchmark === null ? `${formatNumber(result.itmProbability * 100, 4)}%` : `${formatNumber(result.benchmark, 4)}원`}</strong><small>${result.benchmark === null ? "위험중립 경로 비율" : `차이 ${formatSigned(result.benchmarkGap, 6)}원`}</small></article>
    </div>
    <div class="guided-result-note"><strong>결과 읽기</strong><p>신뢰구간은 시뮬레이션 표본오차만 나타냅니다. 입력가정·모형선택·시장자료 오차까지 포함한 가치범위는 아닙니다.</p></div>
  `;

  const renderDistribution = (result) => `
    <div class="guided-question-copy">
      <span class="guided-eyebrow">결과 · 2/3</span>
      <h3 id="guided-mc-result-title">지급액 분포와 수렴 상태</h3>
      <p>할인된 옵션 1개당 지급액 분포와 경로 수 증가에 따른 추정가 변화를 확인하세요.</p>
    </div>
    <div class="guided-mc-distribution-grid">
      <article><span>5% 분위수</span><strong>${formatNumber(result.payoffP05, 4)}</strong><small>할인 지급액</small></article>
      <article><span>중앙값</span><strong>${formatNumber(result.payoffP50, 4)}</strong><small>할인 지급액</small></article>
      <article><span>95% 분위수</span><strong>${formatNumber(result.payoffP95, 4)}</strong><small>할인 지급액</small></article>
      <article><span>만기 예상 주가</span><strong>${formatNumber(result.expectedTerminalPrice, 4)}</strong><small>위험중립 평균</small></article>
      <article><span>${result.payoffStyle === "asian" ? "평균주가 예상값" : "지급판정 주가 평균"}</span><strong>${formatNumber(result.expectedPayoffUnderlying, 4)}</strong><small>${result.payoffStyle === "asian" ? "관측시점 산술평균" : "만기 주가"}</small></article>
      <article><span>ITM 경로 비율</span><strong>${formatNumber(result.itmProbability * 100, 4)}%</strong><small>실제 발생확률 예측 아님</small></article>
    </div>
    <div class="guided-mc-convergence">
      <h4>경로 수별 누적 추정가</h4>
      ${result.convergence.map((item) => `<div><span>${formatNumber(item.paths, 0)} 경로</span><strong>${formatNumber(item.estimate, 6)}원</strong></div>`).join("")}
    </div>
    ${result.benchmark === null ? '<div class="guided-message warning">산술평균 아시아형에는 이 화면의 해석해 기준가가 없습니다. 경로 수·관측시점·시드를 바꿔 안정성을 추가 검토하세요.</div>' : `<div class="guided-message ${Math.abs(result.benchmarkGap) <= 1.96 * result.standardError ? "success" : "warning"}">해석해 기준가 ${formatNumber(result.benchmark, 6)}원은 ${Math.abs(result.benchmarkGap) <= 1.96 * result.standardError ? "95% 신뢰구간과 일관됩니다." : "현재 95% 신뢰구간 밖입니다. 경로 수를 늘려 확인하세요."}</div>`}
  `;

  const scenarioValue = (result, stockOffset, volatilityOffset) => {
    if (stockOffset === 0 && volatilityOffset === 0) return result.value;
    const scenarioInput = normalizeInput({
      ...result,
      stockPrice: result.stockPrice * (1 + stockOffset / 100),
      volatility: Math.max(result.volatility + volatilityOffset, 0.01),
      pathCount: Math.min(result.pathCount, 5000),
    });
    return scenarioInput
      ? runSimulation(scenarioInput, { collectDistribution: false, computeGreeks: false }).value
      : null;
  };

  const renderSensitivity = (result) => {
    const stockOffsets = [-10, 0, 10];
    const volatilityOffsets = [-5, 0, 5];
    return `
      <div class="guided-question-copy">
        <span class="guided-eyebrow">결과 · 3/3</span>
        <h3 id="guided-mc-result-title">주가·변동성 민감도</h3>
        <p>중앙값은 전체 경로 결과이고, 주변 시나리오는 같은 시드와 최대 5,000경로를 사용해 빠르게 비교합니다.</p>
      </div>
      ${result.delta === null
        ? '<div class="guided-message warning">디지털 지급액은 경계에서 불연속이므로 이 버전에서는 숫자 Delta·Vega 대신 시나리오 표만 제공합니다.</div>'
        : `<div class="guided-mc-greek-grid">
            <article><span>Delta</span><strong>${formatSigned(result.delta, 6)}</strong><small>95% CI ${formatSigned(result.deltaConfidenceLow, 6)} ~ ${formatSigned(result.deltaConfidenceHigh, 6)}</small></article>
            <article><span>Vega · 변동성 1%p</span><strong>${formatSigned(result.vega, 6)}</strong><small>95% CI ${formatSigned(result.vegaConfidenceLow, 6)} ~ ${formatSigned(result.vegaConfidenceHigh, 6)}</small></article>
          </div>`}
      <div class="guided-sensitivity guided-mc-sensitivity">
        <h4>옵션 1개당 추정가 <small>(원)</small></h4>
        <div class="guided-table-wrap"><table><thead><tr><th>기초자산 가격</th>${volatilityOffsets.map((offset) => `<th>σ ${formatNumber(Math.max(result.volatility + offset, 0.01), 2)}%</th>`).join("")}</tr></thead><tbody>${stockOffsets.map((stockOffset) => `<tr><th>${formatNumber(result.stockPrice * (1 + stockOffset / 100), 4)} <small>(${formatSigned(stockOffset, 0)}%)</small></th>${volatilityOffsets.map((volatilityOffset) => { const value = scenarioValue(result, stockOffset, volatilityOffset); return `<td class="${stockOffset === 0 && volatilityOffset === 0 ? "base" : ""}">${value === null ? "-" : formatNumber(value, 4)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
      </div>
      <div class="guided-assumption-list guided-mc-checks">
        <div class="guided-assumption-row"><span>사용한 난수 시드</span><strong>${formatNumber(result.randomSeed, 0)}</strong></div>
        <div class="guided-assumption-row"><span>경로당 관측 시점</span><strong>${formatNumber(result.timeSteps, 0)}회</strong></div>
        <div class="guided-assumption-row"><span>분산 감소</span><strong>대칭변량 적용</strong></div>
        <div class="guided-assumption-row"><span>해석해 차이</span><strong>${result.benchmarkGap === null ? "해당 없음" : `${formatSigned(result.benchmarkGap, 6)}원`}</strong></div>
      </div>
      <div class="guided-message warning">민감도는 선택한 GBM 가정 안의 비교입니다. 큰 폭의 주가·변동성 변화에서는 상수 변동성과 연속배당 가정도 함께 재검토하세요.</div>
    `;
  };

  const getResult = () => {
    if (cachedResult) return cachedResult;
    cachedResult = calculateMonteCarlo();
    return cachedResult;
  };

  const renderResult = () => {
    const result = getResult();
    if (!result) return '<section class="guided-question-card"><div class="guided-message error">시뮬레이션을 실행할 수 없습니다. 입력을 다시 확인해 주세요.</div></section>';
    const page = Math.min(Math.max(state.resultPage, 0), resultPanels.length - 1);
    const panels = [() => renderSummary(result), () => renderDistribution(result), () => renderSensitivity(result)];
    return `
      <section class="guided-result guided-mc-result" aria-labelledby="guided-mc-result-title">
        <div class="guided-group-tabs" aria-label="몬테카를로 결과 확인 순서">${resultPanels.map((label, index) => `<span class="${index === page ? "active" : ""} ${index < page ? "done" : ""}">${index < page ? "✓ " : ""}${escapeHtml(label)}</span>`).join("")}</div>
        ${panels[page]()}
        <div class="guided-result-actions">
          <button type="button" class="secondary" data-mc-result-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← 이전 패널</button>
          ${page < resultPanels.length - 1 ? `<button type="button" class="primary" data-mc-result-page="${page + 1}">다음: ${escapeHtml(resultPanels[page + 1])} →</button>` : '<button type="button" class="secondary" data-mc-action="back-to-review">가정 다시 검토</button><button type="button" class="primary" data-mc-action="new-analysis">새 시뮬레이션</button>'}
        </div>
      </section>
    `;
  };

  const renderStepContent = () => {
    switch (state.step) {
      case 0: return renderPayoffStep();
      case 1: return renderDateStep();
      case 2: return renderNumberStep({ step: 2, eyebrow: "기초자산 가격", question: "평가기준일의 기초자산 가격은 얼마인가요?", description: "계약의 기초자산·통화·기준시점과 일치하는 관측가격을 입력해 주세요.", field: "stockPrice", unit: "원", min: 0.0001, max: 1000000000000, inputStep: 0.01, quickValues: [50, 100, 1000], helpTitle: "비상장 주식이라면 어떤 값을 쓰나요?", helpBody: "평가기준일의 주당 공정가치 또는 일관된 방식으로 산정한 기초자산 가치를 사용하고 근거를 남기세요.", evidencePlaceholder: "예: 2026-07-23 종가 또는 주당가치 산정보고서" });
      case 3: return renderContractStep();
      case 4: return renderNumberStep({ step: 4, eyebrow: "잔존만기", question: "평가기준일부터 만기까지 몇 년이 남았나요?", description: "일수를 365일 기준 연수로 환산해 입력해 주세요.", field: "timeToMaturity", unit: "년", min: 0.0001, max: 100, inputStep: 0.01, quickValues: [0.5, 1, 3, 5], helpTitle: "아시아형 관측주기는 어떻게 반영하나요?", helpBody: "잔존만기는 전체 기간이고, 뒤의 관측 시점 수가 경로상 평균 계산 빈도를 결정합니다.", evidencePlaceholder: "예: 평가일 2026-07-23, 만기 2027-07-23, 잔존 1.00년" });
      case 5: return renderNumberStep({ step: 5, eyebrow: "무위험수익률", question: "잔존만기와 같은 통화의 무위험수익률은 몇 %인가요?", description: "평가기준일의 만기 대응 무위험수익률을 연속복리 기준으로 입력해 주세요.", field: "riskFreeRate", unit: "%", min: -50, max: 100, inputStep: 0.01, quickValues: [2, 3.5, 5], helpTitle: "단순수익률 자료만 있다면요?", helpBody: "자료의 복리 방식과 만기를 확인해 일관되게 연속복리로 변환하고 근거를 남기세요.", evidencePlaceholder: "예: 1년 만기 국고채 수익률의 연속복리 변환 메모" });
      case 6: return renderNumberStep({ step: 6, eyebrow: "변동성", question: "기초자산의 연환산 변동성은 몇 %인가요?", description: "관측기간·수익률 정의·비교기업 선정 기준이 일관된 값을 사용해 주세요.", field: "volatility", unit: "%", min: 0.0001, max: 500, inputStep: 0.1, quickValues: [20, 30, 50], helpTitle: "이 모형은 변동성 스마일을 반영하나요?", helpBody: "아니요. 모든 경로와 기간에 하나의 상수 변동성을 사용하므로 행사가·만기별 내재변동성 차이는 별도 검토가 필요합니다.", evidencePlaceholder: "예: 비교기업 5개 3년 일간수익률 중앙값 30%" });
      case 7: return renderNumberStep({ step: 7, eyebrow: "배당수익률", question: "연속 배당수익률은 몇 %인가요?", description: "예상 배당을 기초자산 가격 대비 연환산 수익률로 입력하고 배당이 없으면 0%를 사용하세요.", field: "dividendYield", unit: "%", min: 0, max: 100, inputStep: 0.01, quickValues: [0, 1, 2, 5], helpTitle: "확정 현금배당도 같은 방식인가요?", helpBody: "큰 확정배당은 연속배당수익률 근사보다 배당락 시점과 금액을 경로에 직접 반영하는 모형이 더 적합합니다.", evidencePlaceholder: "예: 최근 배당정책과 예상 배당금으로 산정한 연속 배당수익률" });
      case 8: return renderSimulationStep();
      case REVIEW_STEP: return renderReview();
      case RESULT_STEP: return renderResult();
      default: return "";
    }
  };

  const renderProgress = () => {
    const activeStep = Math.min(state.step, TOTAL_QUESTIONS - 1);
    const activeGroup = groups.findIndex((group) => activeStep >= group.start && activeStep < group.end);
    const progress = state.step === RESULT_STEP ? 100 : ((state.step + 1) / TOTAL_QUESTIONS) * 100;
    return `
      <header class="guided-progress-shell guided-mc-progress">
        <div class="guided-progress-topline"><div><span class="guided-product-label">MONTE CARLO · GBM</span><strong>${state.step === RESULT_STEP ? "분석 결과" : `${state.step + 1} / ${TOTAL_QUESTIONS}`}</strong></div><span class="guided-autosave">✓ 자동 저장됨</span><button type="button" class="guided-mc-exit" data-mc-action="exit">로드맵으로</button></div>
        <div class="guided-group-tabs" aria-label="몬테카를로 진행 구간">${groups.map((group, index) => `<span class="${index === activeGroup ? "active" : ""} ${index < activeGroup ? "done" : ""}">${index < activeGroup ? "✓ " : ""}${escapeHtml(group.label)}</span>`).join("")}</div>
        <div class="guided-progress-track" aria-hidden="true"><span style="width:${progress}%"></span></div>
      </header>
    `;
  };

  const nextButtonLabel = () => [
    "다음: 평가 기준일", "다음: 기초자산 가격", "다음: 지급조건", "다음: 잔존만기",
    "다음: 무위험수익률", "다음: 변동성", "다음: 배당수익률", "다음: 시뮬레이션 설정",
    "다음: 최종 검토", "시뮬레이션 실행·버전 저장",
  ][state.step] || "다음";

  const renderNavigation = () => {
    if (state.step === RESULT_STEP) return "";
    const validation = validateStep(state.step);
    const finalBlocked = state.step === REVIEW_STEP && !allAssumptionsValid();
    return `<footer class="guided-navigation"><button type="button" class="secondary" data-mc-action="previous" ${state.step === 0 ? "disabled" : ""}>← 이전</button><span class="guided-navigation-hint">Enter 키로 다음</span><button type="button" class="primary" data-mc-action="next" ${validation.error || finalBlocked ? "disabled" : ""}>${escapeHtml(nextButtonLabel())} →</button></footer>`;
  };

  const updateHeader = () => {
    const contentArea = mountedHost?.closest(".content-area");
    const header = contentArea?.previousElementSibling;
    if (!header?.matches("header.main-header")) return;
    const heading = header.querySelector("h2");
    const description = header.querySelector("p");
    if (heading) heading.textContent = "몬테카를로 시뮬레이션";
    if (description) description.textContent = "재현 가능한 위험중립 경로로 조건부 지급액과 신뢰구간을 계산합니다.";
  };

  const render = () => {
    if (!mountedHost?.isConnected) return;
    mountedHost.innerHTML = `<div class="phase3-hub-inner guided-mc">${renderProgress()}<div class="guided-mc-stage">${renderStepContent()}${renderNavigation()}</div></div>`;
    updateHeader();
    const contentArea = mountedHost.closest(".content-area");
    if (contentArea) contentArea.scrollTop = 0;
    const focusTarget = mountedHost.querySelector(".guided-primary-input input, .guided-choice.selected, #guided-mc-question-title, #guided-mc-result-title");
    if (focusTarget) {
      if (focusTarget.matches("h1, h2, h3, h4")) focusTarget.setAttribute("tabindex", "-1");
      try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus(); }
    }
  };

  const updateValidation = () => {
    if (!mountedHost?.isConnected) return;
    const validationHost = mountedHost.querySelector("[data-mc-validation]");
    if (validationHost) validationHost.innerHTML = renderValidation(state.step);
    const next = mountedHost.querySelector('[data-mc-action="next"]');
    if (next) next.disabled = Boolean(validateStep(state.step).error) ||
      (state.step === REVIEW_STEP && !allAssumptionsValid());
  };

  const saveSnapshot = (result) => {
    if (!result) return null;
    try {
      const raw = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
      const snapshots = Array.isArray(raw) ? raw : [];
      const version = (Number(snapshots[snapshots.length - 1]?.version) || 0) + 1;
      snapshots.push({
        schemaVersion: 1,
        algorithmVersion: "mc-gbm-antithetic-v1",
        version,
        savedAt: new Date().toISOString(),
        assumptions: { ...state, step: REVIEW_STEP },
        result: {
          contract: contractLabel(result), value: result.value, totalValue: result.totalValue,
          confidenceLow: result.confidenceLow, confidenceHigh: result.confidenceHigh,
          standardError: result.standardError, pathCount: result.effectivePaths,
          pairCount: result.pairCount, timeSteps: result.timeSteps,
          seed: result.randomSeed, confidenceLevel: 0.95, antithetic: true,
          benchmark: result.benchmark, delta: result.delta, vega: result.vega,
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
    if (host) { delete host.dataset.phase3Mode; host.removeAttribute("aria-label"); }
    mountedHost = null;
    exitCallback = null;
    if (typeof onExit === "function") onExit();
  };

  const handleClick = (event) => {
    const host = event.currentTarget;
    if (!mountedHost || host !== mountedHost) return;
    const styleButton = event.target.closest("[data-mc-payoff-style]");
    if (styleButton && host.contains(styleButton)) {
      state.payoffStyle = styleButton.dataset.mcPayoffStyle;
      cachedResult = null;
      saveState();
      render();
      return;
    }
    const typeButton = event.target.closest("[data-mc-option-type]");
    if (typeButton && host.contains(typeButton)) {
      state.optionType = typeButton.dataset.mcOptionType === "put" ? "put" : "call";
      cachedResult = null;
      saveState();
      render();
      return;
    }
    const quickButton = event.target.closest("[data-mc-set-field]");
    if (quickButton && host.contains(quickButton)) {
      state[quickButton.dataset.mcSetField] = Number(quickButton.dataset.mcSetValue);
      cachedResult = null;
      saveState();
      render();
      return;
    }
    const editButton = event.target.closest("[data-mc-edit-step]");
    if (editButton && host.contains(editButton)) {
      state.step = Number(editButton.dataset.mcEditStep);
      saveState();
      render();
      return;
    }
    const resultButton = event.target.closest("[data-mc-result-page]");
    if (resultButton && host.contains(resultButton)) {
      state.resultPage = Math.min(Math.max(Number(resultButton.dataset.mcResultPage) || 0, 0), resultPanels.length - 1);
      saveState();
      render();
      return;
    }
    const actionButton = event.target.closest("[data-mc-action]");
    if (!actionButton || !host.contains(actionButton)) return;
    switch (actionButton.dataset.mcAction) {
      case "exit": leaveCalculator(); return;
      case "previous": state.step = Math.max(0, state.step - 1); break;
      case "next":
        if (validateStep(state.step).error) { updateValidation(); return; }
        if (state.step === REVIEW_STEP) {
          if (!allAssumptionsValid()) { updateValidation(); return; }
          cachedResult = calculateMonteCarlo();
          state.lastVersion = saveSnapshot(cachedResult);
          state.resultPage = 0;
          state.step = RESULT_STEP;
        } else state.step += 1;
        break;
      case "back-to-review": state.step = REVIEW_STEP; break;
      case "new-analysis":
        if (!confirm("현재 결과는 버전으로 보관됩니다. 새 몬테카를로 분석을 시작할까요?")) return;
        state = createDefaultState();
        cachedResult = null;
        break;
      default: return;
    }
    saveState();
    render();
  };

  const handleInput = (event) => {
    if (!mountedHost || event.currentTarget !== mountedHost) return;
    const field = event.target.dataset.mcField;
    const evidenceKey = event.target.dataset.mcEvidence;
    if (field) {
      state[field] = event.target.type === "date" ? event.target.value :
        event.target.value === "" ? "" : Number(event.target.value);
      cachedResult = null;
      saveState();
      updateValidation();
    }
    if (evidenceKey) { state.evidence[evidenceKey] = event.target.value; saveState(); }
  };

  const handleKeyDown = (event) => {
    if (!mountedHost || event.currentTarget !== mountedHost || event.key !== "Enter" ||
      event.shiftKey || event.target.matches("textarea, button") || state.step === RESULT_STEP) return;
    const next = mountedHost.querySelector('[data-mc-action="next"]');
    if (next && !next.disabled) { event.preventDefault(); next.click(); }
  };

  const ensureEvents = (host) => {
    if (host.dataset.mcEventsReady === "true") return;
    host.dataset.mcEventsReady = "true";
    host.addEventListener("click", handleClick);
    host.addEventListener("input", handleInput);
    host.addEventListener("keydown", handleKeyDown);
  };

  const mount = (host, options = {}) => {
    if (!host) return false;
    mountedHost = host;
    exitCallback = typeof options.onExit === "function" ? options.onExit : null;
    host.dataset.phase3Mode = "monte-carlo";
    host.setAttribute("aria-label", "몬테카를로 시뮬레이션 단계형 계산기");
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

  globalThis.ValueScannerMonteCarlo = Object.freeze({
    calculate: (overrides = {}) => calculateMonteCarlo(overrides),
    getState: () => JSON.parse(JSON.stringify(state)),
    mount,
    startNew,
    validateStep: (step) => ({ ...validateStep(step) }),
  });
})();
