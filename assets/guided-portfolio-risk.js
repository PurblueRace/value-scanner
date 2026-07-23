(() => {
  "use strict";

  const STORAGE_KEY = "value-scanner-guided-portfolio-risk-v1";
  const SNAPSHOT_KEY = "value-scanner-portfolio-risk-snapshots-v1";
  const TOTAL_QUESTIONS = 8;
  const REVIEW_STEP = TOTAL_QUESTIONS - 1;
  const RESULT_STEP = TOTAL_QUESTIONS;
  const MAX_ROWS = 100;
  const MAX_UNDO = 30;
  const resultPanels = ["두 장부 요약", "시장위험", "금리위험", "검증·방법"];
  const groups = [
    { label: "평가 기준", start: 0, end: 1 },
    { label: "시장위험", start: 1, end: 3 },
    { label: "금리위험", start: 3, end: 6 },
    { label: "분리 검토", start: 6, end: 8 },
  ];

  const today = () => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const defaultMarketRows = () => [
    { id: "m-1", name: "주식 포지션 A", marketValue: 60, beta: 1.2 },
    { id: "m-2", name: "주식 포지션 B", marketValue: 30, beta: 0.8 },
    { id: "m-3", name: "현금·저베타 포지션", marketValue: 10, beta: 0 },
  ];

  const defaultRateRows = () => [
    { id: "r-4", name: "채권 포지션 A", marketValue: 60, modifiedDuration: 2, convexity: 6 },
    { id: "r-5", name: "채권 포지션 B", marketValue: 40, modifiedDuration: 5, convexity: 30 },
  ];

  const createDefaultState = () => ({
    step: 0,
    valuationDate: today(),
    unitLabel: "억원",
    marketRows: defaultMarketRows(),
    marketShockPercent: -10,
    rateRows: defaultRateRows(),
    rateShockBps: 100,
    separationAcknowledged: false,
    evidence: {},
    nextRowId: 6,
    undoStack: [],
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

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const formatNumber = (value, digits = 3) => new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: digits,
  }).format(Number(value) || 0);
  const formatSigned = (value, digits = 3) => {
    const number = Number(value) || 0;
    const body = formatNumber(Math.abs(number), digits);
    return number > 0 ? `+${body}` : number < 0 ? `−${body}` : body;
  };

  const sanitizeRows = (rows, type, seenIds, counter) => {
    const sourceRows = Array.isArray(rows)
      ? rows
      : type === "market" ? defaultMarketRows() : defaultRateRows();
    return sourceRows.slice(0, MAX_ROWS).map((row, index) => {
      const prefix = type === "market" ? "m" : "r";
      let id = typeof row?.id === "string" && /^[mr]-[A-Za-z0-9_-]+$/.test(row.id)
        ? row.id
        : "";
      while (!id || seenIds.has(id)) {
        id = `${prefix}-${counter.value}`;
        counter.value += 1;
      }
      seenIds.add(id);
      const match = id.match(/-(\d+)$/);
      if (match) counter.value = Math.max(counter.value, Number(match[1]) + 1);
      const base = {
        id,
        name: typeof row?.name === "string" ? row.name : `${type === "market" ? "시장" : "금리"} 포지션 ${index + 1}`,
        marketValue: row?.marketValue ?? "",
      };
      return type === "market"
        ? { ...base, beta: row?.beta ?? "" }
        : { ...base, modifiedDuration: row?.modifiedDuration ?? "", convexity: row?.convexity ?? "" };
    });
  };

  const loadState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return createDefaultState();
      const merged = { ...createDefaultState(), ...saved };
      const seenIds = new Set();
      const counter = { value: Math.max(1, Math.trunc(Number(saved.nextRowId) || 1)) };
      merged.marketRows = sanitizeRows(saved.marketRows, "market", seenIds, counter);
      merged.rateRows = sanitizeRows(saved.rateRows, "rate", seenIds, counter);
      if (!hasOwn(saved, "marketShockPercent") && hasOwn(saved, "equityShock")) {
        merged.marketShockPercent = saved.equityShock;
      }
      merged.nextRowId = counter.value;
      merged.step = Math.min(Math.max(Math.trunc(Number(saved.step) || 0), 0), RESULT_STEP);
      merged.resultPage = Math.min(
        Math.max(Math.trunc(Number(saved.resultPage) || 0), 0),
        resultPanels.length - 1,
      );
      merged.valuationDate = typeof saved.valuationDate === "string" ? saved.valuationDate : today();
      merged.unitLabel = typeof saved.unitLabel === "string" ? saved.unitLabel.slice(0, 20) : "억원";
      merged.separationAcknowledged = Boolean(saved.separationAcknowledged);
      merged.evidence = saved.evidence && typeof saved.evidence === "object" ? saved.evidence : {};
      merged.undoStack = [];
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

  const validateRows = (rows, type) => {
    const errors = {};
    const normalized = [];
    const seen = new Set();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { errors, normalized, error: "포지션을 한 행 이상 추가해 주세요." };
    }
    if (rows.length > MAX_ROWS) {
      return { errors, normalized, error: `포지션은 장부별 최대 ${MAX_ROWS}행까지 입력할 수 있습니다.` };
    }
    rows.forEach((row, index) => {
      const rowErrors = [];
      const id = typeof row?.id === "string" ? row.id : "";
      const name = typeof row?.name === "string" ? row.name.trim() : "";
      const marketValue = finiteNumber(row?.marketValue ?? row?.value);
      if (!id || seen.has(id)) rowErrors.push("행 식별자가 없거나 중복되었습니다.");
      seen.add(id);
      if (!name) rowErrors.push("포지션명을 입력해 주세요.");
      else if (name.length > 80) rowErrors.push("포지션명은 80자 이내로 입력해 주세요.");
      if (marketValue === null || marketValue <= 0 || marketValue > 1e15) {
        rowErrors.push("시장가치는 0보다 크고 1,000조 이하의 수로 입력해 주세요.");
      }
      if (type === "market") {
        const beta = finiteNumber(row?.beta);
        if (beta === null || beta < -10 || beta > 10) {
          rowErrors.push("베타는 -10에서 10 사이로 입력해 주세요.");
        }
        normalized.push({ id, name, marketValue, beta });
      } else {
        const modifiedDuration = finiteNumber(row?.modifiedDuration ?? row?.duration);
        const convexity = finiteNumber(row?.convexity);
        const convexityMissing = row?.convexity === "" || row?.convexity === null || row?.convexity === undefined;
        if (modifiedDuration === null || modifiedDuration < 0 || modifiedDuration > 100) {
          rowErrors.push("수정듀레이션은 0에서 100 사이로 입력해 주세요.");
        }
        if (!convexityMissing && (convexity === null || convexity < 0 || convexity > 10000)) {
          rowErrors.push("볼록성은 비워 두거나 0에서 10,000 사이로 입력해 주세요.");
        }
        normalized.push({
          id,
          name,
          marketValue,
          modifiedDuration,
          convexity: convexityMissing ? null : convexity,
        });
      }
      if (rowErrors.length) errors[id || `row-${index}`] = rowErrors;
    });
    const error = Object.keys(errors).length
      ? `${Object.keys(errors).length}개 행의 입력을 확인해 주세요.`
      : null;
    return { errors, normalized, error };
  };

  const calculateMarketBook = (overrides = {}) => {
    const nested = overrides?.marketRisk && typeof overrides.marketRisk === "object"
      ? overrides.marketRisk
      : {};
    const rows = hasOwn(nested, "rows")
      ? nested.rows
      : hasOwn(overrides, "marketRows") ? overrides.marketRows : state.marketRows;
    const marketShockPercent = finiteNumber(
      hasOwn(overrides, "marketShockPercent")
        ? overrides.marketShockPercent
        : hasOwn(nested, "marketShockPercent")
          ? nested.marketShockPercent
          : hasOwn(nested, "shockPercent")
            ? nested.shockPercent
            : hasOwn(overrides, "equityShock") ? overrides.equityShock : state.marketShockPercent,
    );
    const validation = validateRows(rows, "market");
    if (validation.error || marketShockPercent === null || marketShockPercent < -100 || marketShockPercent > 100) return null;
    const totalMarketValue = validation.normalized.reduce((sum, row) => sum + row.marketValue, 0);
    if (!Number.isFinite(totalMarketValue) || totalMarketValue <= 0) return null;
    const positions = validation.normalized.map((row) => {
      const weight = row.marketValue / totalMarketValue;
      const betaContribution = weight * row.beta;
      const shockPnl = row.marketValue * row.beta * marketShockPercent / 100;
      return {
        ...row,
        value: row.marketValue,
        weight,
        betaContribution,
        weightedBetaContribution: betaContribution,
        shockPnl,
        afterShockValue: row.marketValue + shockPnl,
      };
    });
    const portfolioBeta = positions.reduce((sum, row) => sum + row.betaContribution, 0);
    const shockPnl = totalMarketValue * portfolioBeta * marketShockPercent / 100;
    return {
      bookType: "market",
      totalMarketValue,
      portfolioMarketValue: totalMarketValue,
      portfolioBeta,
      marketShockPercent,
      shockPercent: marketShockPercent,
      shockDecimal: marketShockPercent / 100,
      shockPnl,
      shockPnL: shockPnl,
      afterShockValue: totalMarketValue + shockPnl,
      postShockValue: totalMarketValue + shockPnl,
      rows: positions,
      positions,
    };
  };

  const calculateRateBook = (overrides = {}) => {
    const nested = overrides?.rateRisk && typeof overrides.rateRisk === "object"
      ? overrides.rateRisk
      : {};
    const rows = hasOwn(nested, "rows")
      ? nested.rows
      : hasOwn(overrides, "rateRows") ? overrides.rateRows : state.rateRows;
    const rateShockBps = finiteNumber(
      hasOwn(overrides, "rateShockBps")
        ? overrides.rateShockBps
        : hasOwn(nested, "rateShockBps") ? nested.rateShockBps : state.rateShockBps,
    );
    const validation = validateRows(rows, "rate");
    if (validation.error || rateShockBps === null || rateShockBps < -5000 || rateShockBps > 5000) return null;
    const totalMarketValue = validation.normalized.reduce((sum, row) => sum + row.marketValue, 0);
    if (!Number.isFinite(totalMarketValue) || totalMarketValue <= 0) return null;
    const convexityComplete = validation.normalized.every((row) => row.convexity !== null);
    const positions = validation.normalized.map((row) => {
      const weight = row.marketValue / totalMarketValue;
      const durationContribution = weight * row.modifiedDuration;
      const convexityContribution = row.convexity === null ? null : weight * row.convexity;
      return {
        ...row,
        value: row.marketValue,
        duration: row.modifiedDuration,
        weight,
        durationContribution,
        weightedDurationContribution: durationContribution,
        convexityContribution,
        weightedConvexityContribution: convexityContribution,
        dv01: row.marketValue * row.modifiedDuration * 0.0001,
      };
    });
    const portfolioModifiedDuration = positions.reduce((sum, row) => sum + row.durationContribution, 0);
    const portfolioConvexity = convexityComplete
      ? positions.reduce((sum, row) => sum + row.convexityContribution, 0)
      : null;
    const shockRateChange = rateShockBps / 10000;
    const durationOnlyPnl = -totalMarketValue * portfolioModifiedDuration * shockRateChange;
    const convexityAdjustment = portfolioConvexity === null
      ? null
      : 0.5 * totalMarketValue * portfolioConvexity * shockRateChange * shockRateChange;
    const convexityAdjustedPnl = convexityAdjustment === null
      ? null
      : durationOnlyPnl + convexityAdjustment;
    return {
      bookType: "rate",
      totalMarketValue,
      portfolioMarketValue: totalMarketValue,
      portfolioModifiedDuration,
      modifiedDuration: portfolioModifiedDuration,
      duration: portfolioModifiedDuration,
      dv01: totalMarketValue * portfolioModifiedDuration * 0.0001,
      portfolioDV01: totalMarketValue * portfolioModifiedDuration * 0.0001,
      portfolioConvexity,
      convexity: portfolioConvexity,
      convexityComplete,
      missingConvexityRowIds: positions.filter((row) => row.convexity === null).map((row) => row.id),
      shockBasisPoints: rateShockBps,
      shockRateChange,
      durationOnlyPnl,
      durationOnlyPnL: durationOnlyPnl,
      durationPnl: durationOnlyPnl,
      convexityAdjustment,
      convexityAdjustedPnl,
      convexityAdjustedPnL: convexityAdjustedPnl,
      convexityPnl: convexityAdjustedPnl,
      afterShockDurationOnly: totalMarketValue + durationOnlyPnl,
      afterShockConvexity: convexityAdjustedPnl === null ? null : totalMarketValue + convexityAdjustedPnl,
      afterShockValue: convexityAdjustedPnl === null ? null : totalMarketValue + convexityAdjustedPnl,
      postShockValue: convexityAdjustedPnl === null ? null : totalMarketValue + convexityAdjustedPnl,
      rows: positions,
      positions,
    };
  };

  const calculatePortfolioRisk = (overrides = {}) => {
    const marketRisk = calculateMarketBook(overrides);
    const rateRisk = calculateRateBook(overrides);
    if (!marketRisk || !rateRisk) return null;
    return {
      modelVersion: "separate-market-rate-risk-v1",
      valuationDate: hasOwn(overrides, "valuationDate") ? overrides.valuationDate : state.valuationDate,
      unitLabel: hasOwn(overrides, "unitLabel") ? overrides.unitLabel : state.unitLabel,
      marketRisk,
      rateRisk,
      presentationRule: "separate-books-no-aggregation",
    };
  };

  const marketValidation = () => validateRows(state.marketRows, "market");
  const rateValidation = () => validateRows(state.rateRows, "rate");

  const validateStep = (step) => {
    const marketShockPercent = finiteNumber(state.marketShockPercent);
    const rateShockBps = finiteNumber(state.rateShockBps);
    switch (step) {
      case 0:
        if (!/^\d{4}-\d{2}-\d{2}$/.test(state.valuationDate || "")) return { error: "평가 기준일을 입력해 주세요." };
        if (!String(state.unitLabel || "").trim()) return { error: "금액 단위를 입력해 주세요." };
        return { error: null };
      case 1:
        return { error: marketValidation().error };
      case 2:
        if (marketShockPercent === null || marketShockPercent < -100 || marketShockPercent > 100) {
          return { error: "주식시장 충격은 -100%에서 +100% 사이로 입력해 주세요." };
        }
        return { error: null };
      case 3:
        return { error: rateValidation().error };
      case 4:
        if (rateShockBps === null || rateShockBps < -5000 || rateShockBps > 5000) {
          return { error: "금리 충격은 -5,000bp에서 +5,000bp 사이로 입력해 주세요." };
        }
        return { error: null };
      case 5: {
        const validation = rateValidation();
        if (validation.error) return { error: validation.error };
        const missing = validation.normalized.filter((row) => row.convexity === null).length;
        return {
          error: null,
          warning: missing ? `${missing}개 행의 볼록성이 비어 있어 볼록성 보정 결과는 표시하지 않습니다.` : null,
        };
      }
      case 6:
        return {
          error: state.separationAcknowledged
            ? null
            : "시장위험과 금리위험을 합산하지 않고 별도 결과로 해석한다는 점을 확인해 주세요.",
        };
      case REVIEW_STEP:
        return { error: allAssumptionsValid() ? null : "이전 단계의 입력을 다시 확인해 주세요." };
      default:
        return { error: null };
    }
  };

  const allAssumptionsValid = () => {
    for (let step = 0; step < REVIEW_STEP; step += 1) {
      if (validateStep(step).error) return false;
    }
    return Boolean(calculatePortfolioRisk());
  };

  const renderQuestionHeader = ({ eyebrow, question, description }) => `
    <div class="guided-question-copy">
      <span class="guided-eyebrow">${escapeHtml(eyebrow)}</span>
      <h3 id="guided-pr-question-title">${escapeHtml(question)}</h3>
      <p>${escapeHtml(description)}</p>
    </div>`;

  const renderValidation = (step) => {
    const { error, warning } = validateStep(step);
    if (error) return `<div class="guided-message error" role="alert">${escapeHtml(error)}</div>`;
    if (warning) return `<div class="guided-message warning">${escapeHtml(warning)}</div>`;
    return '<div class="guided-message" aria-live="polite"></div>';
  };

  const renderEvidence = (key, placeholder) => `
    <details class="guided-evidence">
      <summary><span>근거 자료 남기기</span><span class="guided-optional">선택</span></summary>
      <label class="guided-evidence-label" for="pr-evidence-${escapeHtml(key)}">문서명 · 기준일 · 산정 메모</label>
      <textarea id="pr-evidence-${escapeHtml(key)}" data-pr-evidence="${escapeHtml(key)}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(state.evidence[key] || "")}</textarea>
    </details>`;

  const renderBasisStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-pr-question-title">
      ${renderQuestionHeader({
        eyebrow: "평가 기준",
        question: "어느 날짜, 어떤 금액 단위로 장부를 볼까요?",
        description: "두 장부의 금액은 같은 단위를 사용하지만 합산하지 않습니다.",
      })}
      <div class="guided-pr-basis-grid">
        <label><span>평가 기준일</span><input data-pr-field="valuationDate" type="date" value="${escapeHtml(state.valuationDate)}" /></label>
        <label><span>금액 단위</span><input data-pr-field="unitLabel" type="text" maxlength="20" value="${escapeHtml(state.unitLabel)}" placeholder="예: 억원" /></label>
      </div>
      <div data-pr-validation>${renderValidation(0)}</div>
    </section>`;

  const rowErrorText = (row, type) => {
    const validation = validateRows(type === "market" ? state.marketRows : state.rateRows, type);
    return validation.errors[row.id]?.join(" ") || "";
  };

  const renderRowActions = (type, row) => `
    <div class="guided-pr-row-actions">
      <button type="button" class="secondary" data-pr-row-action="duplicate" data-pr-book="${type}" data-pr-row-id="${escapeHtml(row.id)}" aria-label="${escapeHtml(row.name)} 행 복제">복제</button>
      <button type="button" class="secondary" data-pr-row-action="delete" data-pr-book="${type}" data-pr-row-id="${escapeHtml(row.id)}" aria-label="${escapeHtml(row.name)} 행 삭제">삭제</button>
    </div>`;

  const renderMarketRow = (row, index) => {
    const error = rowErrorText(row, "market");
    return `
      <article class="guided-pr-position-card ${error ? "has-error" : ""}" data-pr-row-card="${escapeHtml(row.id)}">
        <header><span class="guided-pr-row-number">시장위험 ${index + 1}</span><code>${escapeHtml(row.id)}</code></header>
        <div class="guided-pr-row-grid market">
          <label class="name"><span>포지션명</span><input data-pr-book="market" data-pr-row-id="${escapeHtml(row.id)}" data-pr-row-field="name" type="text" maxlength="80" value="${escapeHtml(row.name)}" /></label>
          <label><span>시장가치</span><div class="guided-input-wrap"><input data-pr-book="market" data-pr-row-id="${escapeHtml(row.id)}" data-pr-row-field="marketValue" type="number" min="0.000001" max="1000000000000000" step="0.01" value="${escapeHtml(row.marketValue)}" /><span>${escapeHtml(state.unitLabel)}</span></div></label>
          <label><span>베타</span><input data-pr-book="market" data-pr-row-id="${escapeHtml(row.id)}" data-pr-row-field="beta" type="number" min="-10" max="10" step="0.01" value="${escapeHtml(row.beta)}" /></label>
        </div>
        <div class="guided-pr-row-error" data-pr-row-error-id="${escapeHtml(row.id)}" role="alert">${escapeHtml(error)}</div>
        ${renderRowActions("market", row)}
      </article>`;
  };

  const renderRateRow = (row, index) => {
    const error = rowErrorText(row, "rate");
    return `
      <article class="guided-pr-position-card ${error ? "has-error" : ""}" data-pr-row-card="${escapeHtml(row.id)}">
        <header><span class="guided-pr-row-number">금리위험 ${index + 1}</span><code>${escapeHtml(row.id)}</code></header>
        <div class="guided-pr-row-grid rate">
          <label class="name"><span>포지션명</span><input data-pr-book="rate" data-pr-row-id="${escapeHtml(row.id)}" data-pr-row-field="name" type="text" maxlength="80" value="${escapeHtml(row.name)}" /></label>
          <label><span>시장가치</span><div class="guided-input-wrap"><input data-pr-book="rate" data-pr-row-id="${escapeHtml(row.id)}" data-pr-row-field="marketValue" type="number" min="0.000001" max="1000000000000000" step="0.01" value="${escapeHtml(row.marketValue)}" /><span>${escapeHtml(state.unitLabel)}</span></div></label>
          <label><span>수정듀레이션</span><input data-pr-book="rate" data-pr-row-id="${escapeHtml(row.id)}" data-pr-row-field="modifiedDuration" type="number" min="0" max="100" step="0.001" value="${escapeHtml(row.modifiedDuration)}" /></label>
          <label><span>볼록성 <small>선택</small></span><input data-pr-book="rate" data-pr-row-id="${escapeHtml(row.id)}" data-pr-row-field="convexity" type="number" min="0" max="10000" step="0.001" value="${escapeHtml(row.convexity)}" placeholder="미입력 가능" /></label>
        </div>
        <div class="guided-pr-row-error" data-pr-row-error-id="${escapeHtml(row.id)}" role="alert">${escapeHtml(error)}</div>
        ${renderRowActions("rate", row)}
      </article>`;
  };

  const renderRowsStep = (type) => {
    const isMarket = type === "market";
    const rows = isMarket ? state.marketRows : state.rateRows;
    const step = isMarket ? 1 : 3;
    return `
      <section class="guided-question-card wide" aria-labelledby="guided-pr-question-title">
        ${renderQuestionHeader(isMarket
          ? { eyebrow: "시장위험 장부", question: "시장가치와 베타를 포지션별로 입력해 주세요", description: "가중 베타와 각 행의 기여도를 시장위험 장부 안에서만 계산합니다." }
          : { eyebrow: "금리위험 장부", question: "시장가치·수정듀레이션·볼록성을 입력해 주세요", description: "듀레이션과 DV01은 항상 계산하고, 볼록성은 모든 행이 있을 때만 보정합니다." })}
        <div class="guided-pr-book-toolbar">
          <span>${rows.length}개 포지션 · 영구 ID 유지</span>
          <div>
            <button type="button" class="secondary" data-pr-row-action="undo" ${state.undoStack.length ? "" : "disabled"}>↶ 실행 취소</button>
            <button type="button" class="primary" data-pr-row-action="add" data-pr-book="${type}" ${rows.length >= MAX_ROWS ? "disabled" : ""}>+ 행 추가</button>
          </div>
        </div>
        <div class="guided-pr-position-list" aria-label="${isMarket ? "시장위험" : "금리위험"} 포지션 목록">
          ${rows.map((row, index) => isMarket ? renderMarketRow(row, index) : renderRateRow(row, index)).join("")}
        </div>
        <div data-pr-validation>${renderValidation(step)}</div>
        ${renderEvidence(isMarket ? "marketRows" : "rateRows", isMarket
          ? "예: 월말 보유명세, 시장가치 기준, 베타 출처"
          : "예: 채권 평가명세, 수정듀레이션·볼록성 기준일")}
      </section>`;
  };

  const renderMarketShockStep = () => {
    const result = calculateMarketBook();
    return `
      <section class="guided-question-card" aria-labelledby="guided-pr-question-title">
        ${renderQuestionHeader({ eyebrow: "시장 충격", question: "주식시장이 몇 % 움직이는 시나리오인가요?", description: "선형 베타 근사 손익 = 시장가치 × 포트폴리오 베타 × 시장충격입니다." })}
        <label class="guided-primary-input"><span>주식시장 충격률</span><div class="guided-input-wrap"><input data-pr-field="marketShockPercent" type="number" min="-100" max="100" step="0.1" value="${escapeHtml(state.marketShockPercent)}" /><span>%</span></div></label>
        <div class="guided-pr-quick-grid">
          ${[-20, -10, -5, 5, 10, 20].map((shock) => `<button type="button" class="${Number(state.marketShockPercent) === shock ? "selected" : ""}" data-pr-set-field="marketShockPercent" data-pr-set-value="${shock}">${formatSigned(shock, 0)}%</button>`).join("")}
        </div>
        ${result ? `<div class="guided-pr-preview"><div><span>포트폴리오 베타</span><strong>${formatNumber(result.portfolioBeta, 6)}</strong></div><div><span>예상 손익</span><strong>${formatSigned(result.shockPnl, 6)} ${escapeHtml(state.unitLabel)}</strong></div></div>` : ""}
        <div data-pr-validation>${renderValidation(2)}</div>
        <div class="guided-message warning">베타를 이용한 1차 선형 시나리오이며, 개별 종목의 비선형 반응이나 상관구조는 반영하지 않습니다.</div>
      </section>`;
  };

  const renderRateShockStep = () => {
    const result = calculateRateBook();
    return `
      <section class="guided-question-card" aria-labelledby="guided-pr-question-title">
        ${renderQuestionHeader({ eyebrow: "금리 충격", question: "평행 금리 충격은 몇 bp인가요?", description: "양수는 금리 상승, 음수는 금리 하락입니다." })}
        <label class="guided-primary-input"><span>금리 충격</span><div class="guided-input-wrap"><input data-pr-field="rateShockBps" type="number" min="-5000" max="5000" step="1" value="${escapeHtml(state.rateShockBps)}" /><span>bp</span></div></label>
        <div class="guided-pr-quick-grid">
          ${[-200, -100, -50, 50, 100, 200].map((shock) => `<button type="button" class="${Number(state.rateShockBps) === shock ? "selected" : ""}" data-pr-set-field="rateShockBps" data-pr-set-value="${shock}">${formatSigned(shock, 0)}bp</button>`).join("")}
        </div>
        ${result ? `<div class="guided-pr-preview"><div><span>DV01</span><strong>${formatNumber(result.dv01, 8)} ${escapeHtml(state.unitLabel)}</strong></div><div><span>듀레이션 손익</span><strong>${formatSigned(result.durationOnlyPnl, 6)} ${escapeHtml(state.unitLabel)}</strong></div></div>` : ""}
        <div data-pr-validation>${renderValidation(4)}</div>
        <div class="guided-message warning">평행 이동과 작은 금리변화를 전제로 한 근사치입니다. 커브 비평행 이동과 신용스프레드 변화는 별도입니다.</div>
      </section>`;
  };

  const renderConvexityAuditStep = () => {
    const result = calculateRateBook();
    const validation = rateValidation();
    const missing = validation.normalized.filter((row) => row.convexity === null).map((row) => row.id);
    const invalid = Boolean(validation.error || !result);
    return `
      <section class="guided-question-card" aria-labelledby="guided-pr-question-title">
        ${renderQuestionHeader({ eyebrow: "볼록성 점검", question: "볼록성 보정값을 표시할 수 있나요?", description: "부분 입력을 0으로 간주하지 않고, 모든 행이 입력된 경우에만 보정 결과를 냅니다." })}
        <div class="guided-pr-audit-card ${invalid || missing.length ? "warning" : "success"}">
          <span>${invalid ? "금리위험 입력 확인" : missing.length ? "보정 결과 미표시" : "볼록성 보정 가능"}</span>
          <strong>${invalid ? "행 입력을 먼저 수정해 주세요" : missing.length ? `${missing.length}개 행 누락` : `포트폴리오 볼록성 ${formatNumber(result.portfolioConvexity, 6)}`}</strong>
          <p>${invalid ? "유효한 행만으로 보정값을 추정하지 않습니다." : missing.length ? `누락 ID: ${missing.join(", ")}` : "모든 금리위험 행에 볼록성이 입력되었습니다."}</p>
        </div>
        <div data-pr-validation>${renderValidation(5)}</div>
        <div class="guided-result-note"><strong>엄격한 누락 처리</strong><p>한 행이라도 볼록성이 없으면 포트폴리오 볼록성, 볼록성 조정손익, 보정 후 가치는 모두 ‘미표시’로 남깁니다. 듀레이션 손익과 DV01은 그대로 제공합니다.</p></div>
      </section>`;
  };

  const renderSeparationStep = () => `
    <section class="guided-question-card" aria-labelledby="guided-pr-question-title">
      ${renderQuestionHeader({ eyebrow: "분리 원칙", question: "시장위험과 금리위험을 별도 장부로 해석할까요?", description: "공통 위험점수나 합산 손익을 만들면 서로 다른 충격 단위를 잘못 섞게 됩니다." })}
      <button type="button" class="guided-choice guided-pr-separation ${state.separationAcknowledged ? "selected" : ""}" data-pr-action="toggle-separation" aria-pressed="${state.separationAcknowledged}">
        <span class="guided-choice-icon">${state.separationAcknowledged ? "✓" : "○"}</span>
        <span class="guided-choice-copy"><strong>두 장부를 완전히 분리해 표시</strong><small>시장 충격 손익과 금리 충격 손익을 더하지 않고 각각 해석합니다.</small></span>
      </button>
      <div data-pr-validation>${renderValidation(6)}</div>
      <div class="guided-message warning">이 계산기는 시장위험 장부와 금리위험 장부 사이의 중복 포지션, 헤지 관계, 상관관계를 추정하지 않습니다.</div>
    </section>`;

  const reviewRows = () => {
    const market = calculateMarketBook();
    const rate = calculateRateBook();
    return [
      ["평가 기준", `${state.valuationDate} · ${state.unitLabel}`, 0],
      ["시장위험 장부", `${state.marketRows.length}행 · 합계 ${market ? formatNumber(market.totalMarketValue, 6) : "—"} ${state.unitLabel}`, 1],
      ["시장 충격", `${formatSigned(state.marketShockPercent, 3)}%`, 2],
      ["금리위험 장부", `${state.rateRows.length}행 · 합계 ${rate ? formatNumber(rate.totalMarketValue, 6) : "—"} ${state.unitLabel}`, 3],
      ["금리 충격", `${formatSigned(state.rateShockBps, 3)}bp`, 4],
      ["볼록성", rate?.convexityComplete ? "모든 행 입력 · 보정값 표시" : "일부 누락 · 보정값 미표시", 5],
      ["결과 원칙", state.separationAcknowledged ? "두 장부 별도 표시" : "확인 필요", 6],
    ];
  };

  const renderReview = () => `
    <section class="guided-question-card wide" aria-labelledby="guided-pr-question-title">
      ${renderQuestionHeader({ eyebrow: "최종 검토", question: "두 장부의 입력을 각각 확인해 주세요", description: "계산하면 현재 가정을 새 버전으로 저장합니다." })}
      <div class="guided-assumption-list">
        ${reviewRows().map(([label, value, step]) => `<div class="guided-assumption-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><button type="button" data-pr-edit-step="${step}">수정</button></div>`).join("")}
      </div>
      <div class="guided-pr-review-split"><article><span>시장위험 결과</span><p>가중 베타 · 시장충격 손익</p></article><article><span>금리위험 결과</span><p>수정듀레이션 · DV01 · 조건부 볼록성 보정</p></article></div>
      <div class="guided-message warning"><strong>합산하지 않습니다.</strong> 두 장부의 손익과 위험지표는 서로 다른 시나리오 결과입니다.</div>
      <div data-pr-validation>${allAssumptionsValid() ? '<div class="guided-message success">입력 검토가 끝났습니다. 두 장부를 별도로 계산할 수 있어요.</div>' : renderValidation(REVIEW_STEP)}</div>
    </section>`;

  const renderResultSummary = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 1/4 · 버전 ${escapeHtml(state.lastVersion || 1)}</span><h3 id="guided-pr-result-title">시장위험과 금리위험을 따로 확인하세요</h3><p>두 결과는 합계나 공통 점수로 환산하지 않습니다.</p></div>
    <div class="guided-pr-split-results">
      <article class="market"><span>시장위험 장부</span><strong>β ${formatNumber(result.marketRisk.portfolioBeta, 6)}</strong><p>${formatSigned(result.marketRisk.shockPercent, 3)}% 충격 손익 <b>${formatSigned(result.marketRisk.shockPnl, 6)} ${escapeHtml(result.unitLabel)}</b></p><small>충격 후 ${formatNumber(result.marketRisk.afterShockValue, 6)} ${escapeHtml(result.unitLabel)}</small></article>
      <article class="rate"><span>금리위험 장부</span><strong>D ${formatNumber(result.rateRisk.portfolioModifiedDuration, 6)}</strong><p>${formatSigned(result.rateRisk.shockBasisPoints, 3)}bp 듀레이션 손익 <b>${formatSigned(result.rateRisk.durationOnlyPnl, 6)} ${escapeHtml(result.unitLabel)}</b></p><small>DV01 ${formatNumber(result.rateRisk.dv01, 8)} ${escapeHtml(result.unitLabel)}</small></article>
    </div>
    <div class="guided-message warning"><strong>통합 손익 없음</strong> 시장충격 손익과 금리충격 손익은 더하지 않습니다.</div>`;

  const renderMarketResult = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 2/4</span><h3 id="guided-pr-result-title">시장위험 장부</h3><p>시장가치 가중 베타와 행별 기여도입니다.</p></div>
    <div class="guided-pr-metric-grid"><article><span>시장가치 합계</span><strong>${formatNumber(result.totalMarketValue, 6)}</strong><small>${escapeHtml(state.unitLabel)}</small></article><article><span>포트폴리오 베타</span><strong>${formatNumber(result.portfolioBeta, 8)}</strong><small>Σ(가중치 × 베타)</small></article><article><span>충격 손익</span><strong>${formatSigned(result.shockPnl, 8)}</strong><small>${formatSigned(result.shockPercent, 3)}% 시나리오</small></article><article><span>충격 후 가치</span><strong>${formatNumber(result.afterShockValue, 8)}</strong><small>${escapeHtml(state.unitLabel)}</small></article></div>
    <div class="guided-pr-result-rows">${result.positions.map((row) => `<article><header><strong>${escapeHtml(row.name)}</strong><code>${escapeHtml(row.id)}</code></header><div><span>가중치</span><b>${formatNumber(row.weight * 100, 5)}%</b></div><div><span>베타</span><b>${formatNumber(row.beta, 6)}</b></div><div><span>베타 기여도</span><b>${formatNumber(row.betaContribution, 8)}</b></div><div><span>충격 손익</span><b>${formatSigned(row.shockPnl, 8)} ${escapeHtml(state.unitLabel)}</b></div></article>`).join("")}</div>
    <div class="guided-result-note"><strong>시장위험 공식</strong><p>포트폴리오 베타 = Σ(시장가치 비중 × 행 베타). 충격 손익 = 시장가치 합계 × 포트폴리오 베타 × 시장충격률.</p></div>`;

  const renderRateResult = (result) => `
    <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 3/4</span><h3 id="guided-pr-result-title">금리위험 장부</h3><p>수정듀레이션과 DV01, 입력이 완전한 경우의 볼록성 보정입니다.</p></div>
    <div class="guided-pr-metric-grid"><article><span>시장가치 합계</span><strong>${formatNumber(result.totalMarketValue, 6)}</strong><small>${escapeHtml(state.unitLabel)}</small></article><article><span>수정듀레이션</span><strong>${formatNumber(result.portfolioModifiedDuration, 8)}</strong><small>년</small></article><article><span>DV01</span><strong>${formatNumber(result.dv01, 10)}</strong><small>${escapeHtml(state.unitLabel)} / 1bp</small></article><article><span>듀레이션 손익</span><strong>${formatSigned(result.durationOnlyPnl, 8)}</strong><small>${formatSigned(result.shockBasisPoints, 3)}bp</small></article><article><span>포트폴리오 볼록성</span><strong>${result.portfolioConvexity === null ? "미표시" : formatNumber(result.portfolioConvexity, 8)}</strong><small>${result.convexityComplete ? "모든 행 입력" : "일부 행 누락"}</small></article><article><span>볼록성 보정 손익</span><strong>${result.convexityAdjustedPnl === null ? "미표시" : formatSigned(result.convexityAdjustedPnl, 8)}</strong><small>${result.afterShockValue === null ? "보정 후 가치도 미표시" : `보정 후 ${formatNumber(result.afterShockValue, 8)}`}</small></article></div>
    <div class="guided-pr-result-rows">${result.positions.map((row) => `<article><header><strong>${escapeHtml(row.name)}</strong><code>${escapeHtml(row.id)}</code></header><div><span>가중치</span><b>${formatNumber(row.weight * 100, 5)}%</b></div><div><span>듀레이션 기여도</span><b>${formatNumber(row.durationContribution, 8)}</b></div><div><span>행 DV01</span><b>${formatNumber(row.dv01, 10)}</b></div><div><span>볼록성 기여도</span><b>${row.convexityContribution === null ? "미입력" : formatNumber(row.convexityContribution, 8)}</b></div></article>`).join("")}</div>
    ${result.convexityComplete ? '<div class="guided-message success">모든 행의 볼록성이 있어 2차 보정 결과를 표시했습니다.</div>' : '<div class="guided-message warning">일부 행의 볼록성이 없어 포트폴리오 볼록성과 보정 결과를 표시하지 않았습니다.</div>'}`;

  const renderAuditResult = (result) => {
    const marketWeight = result.marketRisk.positions.reduce((sum, row) => sum + row.weight, 0);
    const rateWeight = result.rateRisk.positions.reduce((sum, row) => sum + row.weight, 0);
    const durationRebuild = result.rateRisk.positions.reduce((sum, row) => sum + row.durationContribution, 0);
    return `
      <div class="guided-question-copy"><span class="guided-eyebrow">결과 · 4/4</span><h3 id="guided-pr-result-title">계산 검증과 적용 범위</h3><p>각 장부 안의 합계만 검증하고 장부 간 합산은 하지 않습니다.</p></div>
      <div class="guided-assumption-list">
        <div class="guided-assumption-row"><span>시장위험 가중치 합계</span><strong>${formatNumber(marketWeight, 10)} · ${Math.abs(marketWeight - 1) < 1e-10 ? "통과" : "확인 필요"}</strong></div>
        <div class="guided-assumption-row"><span>금리위험 가중치 합계</span><strong>${formatNumber(rateWeight, 10)} · ${Math.abs(rateWeight - 1) < 1e-10 ? "통과" : "확인 필요"}</strong></div>
        <div class="guided-assumption-row"><span>듀레이션 기여도 재합산</span><strong>${formatNumber(durationRebuild, 10)} · ${Math.abs(durationRebuild - result.rateRisk.portfolioModifiedDuration) < 1e-10 ? "통과" : "확인 필요"}</strong></div>
        <div class="guided-assumption-row"><span>볼록성 완전성</span><strong>${result.rateRisk.convexityComplete ? "모든 행 입력" : `${result.rateRisk.missingConvexityRowIds.length}개 누락 · 보정 미표시`}</strong></div>
        <div class="guided-assumption-row"><span>장부 간 합산 지표</span><strong>생성하지 않음</strong></div>
      </div>
      <div class="guided-result-note"><strong>적용 범위</strong><p>시장위험은 베타 선형 근사, 금리위험은 평행이동에 대한 수정듀레이션과 선택적 볼록성 근사입니다. 포지션 중복, 상관관계, 수익률곡선 비평행 이동, 신용스프레드 변화는 반영하지 않습니다.</p></div>
      <div class="guided-message warning">시장위험 장부를 바꿔도 금리위험 결과는 변하지 않으며, 금리위험 장부를 바꿔도 시장위험 결과는 변하지 않습니다.</div>`;
  };

  const getResult = () => cachedResult || (cachedResult = calculatePortfolioRisk());
  const renderResult = () => {
    const result = getResult();
    if (!result) return '<section class="guided-question-card"><div class="guided-message error">입력값을 확인해 주세요. 두 장부 결과를 계산할 수 없습니다.</div></section>';
    const page = Math.min(Math.max(state.resultPage, 0), resultPanels.length - 1);
    const panels = [
      () => renderResultSummary(result),
      () => renderMarketResult(result.marketRisk),
      () => renderRateResult(result.rateRisk),
      () => renderAuditResult(result),
    ];
    return `<section class="guided-result guided-pr-result" aria-labelledby="guided-pr-result-title">
      <div class="guided-group-tabs" aria-label="포트폴리오 위험 결과 확인 순서">${resultPanels.map((label, index) => `<span class="${index === page ? "active" : ""} ${index < page ? "done" : ""}">${index < page ? "✓ " : ""}${escapeHtml(label)}</span>`).join("")}</div>
      ${panels[page]()}
      <div class="guided-result-actions"><button type="button" class="secondary" data-pr-result-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← 이전 패널</button>${page < resultPanels.length - 1 ? `<button type="button" class="primary" data-pr-result-page="${page + 1}">다음: ${escapeHtml(resultPanels[page + 1])} →</button>` : '<button type="button" class="secondary" data-pr-action="back-to-review">가정 다시 검토</button><button type="button" class="primary" data-pr-action="new-analysis">새 분석</button>'}</div>
    </section>`;
  };

  const renderStepContent = () => {
    switch (state.step) {
      case 0: return renderBasisStep();
      case 1: return renderRowsStep("market");
      case 2: return renderMarketShockStep();
      case 3: return renderRowsStep("rate");
      case 4: return renderRateShockStep();
      case 5: return renderConvexityAuditStep();
      case 6: return renderSeparationStep();
      case REVIEW_STEP: return renderReview();
      case RESULT_STEP: return renderResult();
      default: return "";
    }
  };

  const renderProgress = () => {
    const activeStep = Math.min(state.step, TOTAL_QUESTIONS - 1);
    const activeGroup = groups.findIndex((group) => activeStep >= group.start && activeStep < group.end);
    const progress = state.step === RESULT_STEP ? 100 : (state.step + 1) / TOTAL_QUESTIONS * 100;
    return `<header class="guided-progress-shell guided-pr-progress">
      <div class="guided-progress-topline"><div><span class="guided-product-label">PORTFOLIO RISK · TWO BOOKS</span><strong>${state.step === RESULT_STEP ? "분석 결과" : `${state.step + 1} / ${TOTAL_QUESTIONS}`}</strong></div><span class="guided-autosave">✓ 자동 저장됨</span><button type="button" class="guided-pr-exit" data-pr-action="exit">로드맵으로</button></div>
      <div class="guided-group-tabs" aria-label="포트폴리오 위험 진행 구간">${groups.map((group, index) => `<span class="${index === activeGroup ? "active" : ""} ${index < activeGroup ? "done" : ""}">${index < activeGroup ? "✓ " : ""}${escapeHtml(group.label)}</span>`).join("")}</div>
      <div class="guided-progress-track" role="progressbar" aria-valuemin="1" aria-valuemax="${TOTAL_QUESTIONS}" aria-valuenow="${Math.min(state.step + 1, TOTAL_QUESTIONS)}"><span style="width:${progress}%"></span></div>
    </header>`;
  };

  const nextButtonLabel = () => [
    "다음: 시장위험 장부", "다음: 시장 충격", "다음: 금리위험 장부", "다음: 금리 충격",
    "다음: 볼록성 점검", "다음: 분리 원칙", "다음: 최종 검토", "계산하고 버전 저장",
  ][state.step] || "다음";

  const renderNavigation = () => state.step === RESULT_STEP ? "" : `
    <footer class="guided-navigation">
      <button type="button" class="secondary" data-pr-action="previous" ${state.step === 0 ? "disabled" : ""}>← 이전</button>
      <span class="guided-navigation-hint">Enter 키로 다음</span>
      <button type="button" class="primary" data-pr-action="next" ${validateStep(state.step).error || (state.step === REVIEW_STEP && !allAssumptionsValid()) ? "disabled" : ""}>${escapeHtml(nextButtonLabel())} →</button>
    </footer>`;

  const updateHeader = () => {
    const contentArea = mountedHost?.closest(".content-area");
    const header = contentArea?.previousElementSibling;
    if (!header?.matches("header.main-header")) return;
    const heading = header.querySelector("h2");
    const description = header.querySelector("p");
    if (heading) heading.textContent = "자산베타·포트폴리오 금리위험";
    if (description) description.textContent = "시장위험 장부와 금리위험 장부를 합산하지 않고 각각 계산합니다.";
  };

  const render = () => {
    if (!mountedHost?.isConnected) return;
    mountedHost.innerHTML = `<div class="phase3-hub-inner guided-pr">${renderProgress()}<div class="guided-pr-stage">${renderStepContent()}${renderNavigation()}</div></div>`;
    updateHeader();
    const contentArea = mountedHost.closest(".content-area");
    if (contentArea) contentArea.scrollTop = 0;
    const focusTarget = mountedHost.querySelector("input, .guided-choice.selected, #guided-pr-question-title, #guided-pr-result-title");
    if (focusTarget) {
      if (focusTarget.matches("h1, h2, h3, h4")) focusTarget.setAttribute("tabindex", "-1");
      try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus(); }
    }
  };

  const updateRowValidation = (type) => {
    if (!mountedHost?.isConnected) return;
    const validation = type === "market" ? marketValidation() : rateValidation();
    const rows = type === "market" ? state.marketRows : state.rateRows;
    rows.forEach((row) => {
      const target = mountedHost.querySelector(`[data-pr-row-error-id="${row.id}"]`);
      if (target) target.textContent = (validation.errors[row.id] || []).join(" ");
      const card = mountedHost.querySelector(`[data-pr-row-card="${row.id}"]`);
      if (card) card.classList.toggle("has-error", Boolean(validation.errors[row.id]));
    });
  };

  const updateValidation = (type = null) => {
    if (!mountedHost?.isConnected) return;
    if (type) updateRowValidation(type);
    const target = mountedHost.querySelector("[data-pr-validation]");
    if (target) target.innerHTML = renderValidation(state.step);
    const next = mountedHost.querySelector('[data-pr-action="next"]');
    if (next) next.disabled = Boolean(validateStep(state.step).error) || (state.step === REVIEW_STEP && !allAssumptionsValid());
  };

  const pushUndo = () => {
    state.undoStack.push({
      marketRows: clone(state.marketRows),
      rateRows: clone(state.rateRows),
      nextRowId: state.nextRowId,
    });
    if (state.undoStack.length > MAX_UNDO) state.undoStack = state.undoStack.slice(-MAX_UNDO);
  };

  const allocateRowId = (type) => {
    const used = new Set([...state.marketRows, ...state.rateRows].map((row) => row.id));
    const prefix = type === "market" ? "m" : "r";
    let id;
    do {
      id = `${prefix}-${state.nextRowId}`;
      state.nextRowId += 1;
    } while (used.has(id));
    return id;
  };

  const changeRows = (action, type, rowId) => {
    if (action === "undo") {
      const prior = state.undoStack.pop();
      if (!prior) return false;
      state.marketRows = prior.marketRows;
      state.rateRows = prior.rateRows;
      state.nextRowId = prior.nextRowId;
      cachedResult = null;
      return true;
    }
    const key = type === "market" ? "marketRows" : type === "rate" ? "rateRows" : null;
    if (!key) return false;
    const rows = state[key];
    if (action === "add") {
      if (rows.length >= MAX_ROWS) return false;
      pushUndo();
      rows.push(type === "market"
        ? { id: allocateRowId(type), name: `시장 포지션 ${rows.length + 1}`, marketValue: "", beta: "" }
        : { id: allocateRowId(type), name: `금리 포지션 ${rows.length + 1}`, marketValue: "", modifiedDuration: "", convexity: "" });
    } else if (action === "duplicate") {
      const index = rows.findIndex((row) => row.id === rowId);
      if (index < 0 || rows.length >= MAX_ROWS) return false;
      pushUndo();
      const copy = { ...rows[index], id: allocateRowId(type), name: `${rows[index].name || "포지션"} 복사본` };
      rows.splice(index + 1, 0, copy);
    } else if (action === "delete") {
      const index = rows.findIndex((row) => row.id === rowId);
      if (index < 0) return false;
      pushUndo();
      rows.splice(index, 1);
    } else {
      return false;
    }
    cachedResult = null;
    return true;
  };

  const saveSnapshot = (result) => {
    if (!result) return null;
    try {
      const raw = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
      const snapshots = Array.isArray(raw) ? raw : [];
      const version = Math.max(0, ...snapshots.map((item) => Number(item?.version) || 0)) + 1;
      snapshots.push({
        schemaVersion: 1,
        modelVersion: result.modelVersion,
        version,
        savedAt: new Date().toISOString(),
        assumptions: {
          valuationDate: state.valuationDate,
          unitLabel: state.unitLabel,
          marketRisk: { rows: clone(state.marketRows) },
          marketShockPercent: state.marketShockPercent,
          rateRisk: { rows: clone(state.rateRows) },
          rateShockBps: state.rateShockBps,
          separationAcknowledged: state.separationAcknowledged,
          evidence: clone(state.evidence),
        },
        result: { marketRisk: clone(result.marketRisk), rateRisk: clone(result.rateRisk) },
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
    if (host) { delete host.dataset.phase3Mode; host.removeAttribute("aria-label"); }
    mountedHost = null;
    exitCallback = null;
    if (typeof onExit === "function") onExit();
  };

  const handleClick = (event) => {
    const host = event.currentTarget;
    if (!mountedHost || host !== mountedHost) return;
    const rowAction = event.target.closest("[data-pr-row-action]");
    if (rowAction && host.contains(rowAction)) {
      if (changeRows(rowAction.dataset.prRowAction, rowAction.dataset.prBook, rowAction.dataset.prRowId)) {
        saveState();
        render();
      }
      return;
    }
    const quick = event.target.closest("[data-pr-set-field]");
    if (quick && host.contains(quick)) {
      state[quick.dataset.prSetField] = Number(quick.dataset.prSetValue);
      cachedResult = null;
      saveState();
      render();
      return;
    }
    const edit = event.target.closest("[data-pr-edit-step]");
    if (edit && host.contains(edit)) {
      state.step = Math.min(Math.max(Number(edit.dataset.prEditStep) || 0, 0), REVIEW_STEP);
      saveState();
      render();
      return;
    }
    const resultButton = event.target.closest("[data-pr-result-page]");
    if (resultButton && host.contains(resultButton)) {
      state.resultPage = Math.min(Math.max(Number(resultButton.dataset.prResultPage) || 0, 0), resultPanels.length - 1);
      saveState();
      render();
      return;
    }
    const actionButton = event.target.closest("[data-pr-action]");
    if (!actionButton || !host.contains(actionButton)) return;
    switch (actionButton.dataset.prAction) {
      case "exit":
        leaveCalculator();
        return;
      case "toggle-separation":
        state.separationAcknowledged = !state.separationAcknowledged;
        break;
      case "previous":
        state.step = Math.max(0, state.step - 1);
        break;
      case "next":
        if (validateStep(state.step).error) { updateValidation(); return; }
        if (state.step === REVIEW_STEP) {
          if (!allAssumptionsValid()) { updateValidation(); return; }
          cachedResult = calculatePortfolioRisk();
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
        if (typeof confirm === "function" && !confirm("현재 결과는 버전으로 저장됩니다. 새 포트폴리오 위험 분석을 시작할까요?")) return;
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
    const rowField = event.target.dataset.prRowField;
    const rowId = event.target.dataset.prRowId;
    const book = event.target.dataset.prBook;
    if (rowField && rowId && (book === "market" || book === "rate")) {
      const rows = book === "market" ? state.marketRows : state.rateRows;
      const row = rows.find((item) => item.id === rowId);
      if (row) {
        const nextValue = rowField === "name"
          ? event.target.value
          : event.target.value === "" ? "" : Number(event.target.value);
        if (row[rowField] === nextValue) return;
        pushUndo();
        row[rowField] = nextValue;
        cachedResult = null;
        saveState();
        updateValidation(book);
      }
      return;
    }
    const field = event.target.dataset.prField;
    if (field) {
      state[field] = event.target.type === "date" || event.target.type === "text"
        ? event.target.value
        : event.target.value === "" ? "" : Number(event.target.value);
      cachedResult = null;
      saveState();
      updateValidation();
    }
    const evidenceKey = event.target.dataset.prEvidence;
    if (evidenceKey) {
      state.evidence[evidenceKey] = event.target.value;
      saveState();
    }
  };

  const handleKeyDown = (event) => {
    if (!mountedHost || event.currentTarget !== mountedHost || event.key !== "Enter" || event.shiftKey ||
      event.target.matches("textarea, button") || state.step === RESULT_STEP ||
      (event.target.dataset.prRowField && state.step !== REVIEW_STEP)) return;
    const next = mountedHost.querySelector('[data-pr-action="next"]');
    if (next && !next.disabled) { event.preventDefault(); next.click(); }
  };

  const ensureEvents = (host) => {
    if (host.dataset.prEventsReady === "true") return;
    host.dataset.prEventsReady = "true";
    host.addEventListener("click", handleClick);
    host.addEventListener("input", handleInput);
    host.addEventListener("change", handleInput);
    host.addEventListener("keydown", handleKeyDown);
  };

  const mount = (host, options = {}) => {
    if (!host) return false;
    mountedHost = host;
    exitCallback = typeof options.onExit === "function" ? options.onExit : null;
    host.dataset.phase3Mode = "portfolio-risk";
    host.setAttribute("aria-label", "자산베타·포트폴리오 금리위험 단계별 계산기");
    ensureEvents(host);
    render();
    return true;
  };

  const startNew = () => {
    state = createDefaultState();
    cachedResult = null;
    saveState();
    if (mountedHost) render();
    return clone(state);
  };

  globalThis.ValueScannerPortfolioRisk = Object.freeze({
    calculate: (overrides = {}) => calculatePortfolioRisk(overrides),
    calculateMarketRisk: (overrides = {}) => calculateMarketBook(
      hasOwn(overrides, "rows")
        ? { marketRisk: overrides, ...(hasOwn(overrides, "marketShockPercent") ? { marketShockPercent: overrides.marketShockPercent } : {}) }
        : overrides,
    ),
    calculateRateRisk: (overrides = {}) => calculateRateBook(
      hasOwn(overrides, "rows")
        ? { rateRisk: overrides, ...(hasOwn(overrides, "rateShockBps") ? { rateShockBps: overrides.rateShockBps } : {}) }
        : overrides,
    ),
    calculateMarketBook: (overrides = {}) => calculateMarketBook(overrides),
    calculateRateBook: (overrides = {}) => calculateRateBook(overrides),
    getState: () => clone(state),
    mount,
    startNew,
    validateStep: (step) => ({ ...validateStep(step) }),
  });
})();
