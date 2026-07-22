(() => {
  "use strict";

  const STORAGE_KEY = "value-scanner:wacc-guide-method-v1";
  const GUIDE_STEPS = 4;

  const methods = [
    {
      id: "industry",
      icon: "🏭",
      title: "순수접근법 (Bottom-up)",
      shortTitle: "순수접근법",
      description:
        "업종 평균 무차입 베타를 대상 기업의 자본구조에 맞게 다시 조정해 WACC을 계산해요.",
      purpose:
        "비상장기업, IPO 예정기업, 주가 이력이 짧거나 안정적인 개별 베타가 없는 기업에 적합해요.",
      preparation: [
        "대상 기업의 업종",
        "목표 부채비율(D/E)과 법인세율",
        "무위험이자율과 시장위험프리미엄",
        "타인자본비용",
      ],
      outerTab: "업종 베타",
      innerTab: "산업평균 선택",
    },
    {
      id: "regression",
      icon: "📈",
      title: "회귀분석법 (Top-down)",
      shortTitle: "회귀분석법",
      description:
        "회사의 주가 수익률과 시장 수익률을 비교해 개별 베타를 구한 뒤 WACC을 계산해요.",
      purpose:
        "충분한 거래 이력과 신뢰할 수 있는 주가 데이터가 있는 상장기업에 적합해요.",
      preparation: [
        "분석할 종목 또는 주가 수익률",
        "같은 기간의 시장 수익률",
        "무위험이자율과 시장위험프리미엄",
        "부채비율, 법인세율, 타인자본비용",
      ],
      outerTab: "회귀분석",
      innerTab: null,
    },
    {
      id: "direct",
      icon: "🧭",
      title: "펀더멘털 베타",
      shortTitle: "펀더멘털 베타",
      description:
        "사업위험과 영업레버리지, 향후 구조 변화를 반영해 검토한 무차입 베타를 직접 적용해요.",
      purpose:
        "신규 사업, 사업구조가 크게 바뀐 기업, 외부에서 검토된 베타를 이미 보유한 경우에 적합해요.",
      preparation: [
        "검토된 무차입 베타와 산정 근거",
        "목표 부채비율(D/E)과 법인세율",
        "무위험이자율과 시장위험프리미엄",
        "타인자본비용",
      ],
      outerTab: "업종 베타",
      innerTab: "직접 입력",
    },
    {
      id: "levered",
      icon: "🔄",
      title: "유사기업 비교법",
      shortTitle: "유사기업 비교법",
      description:
        "유사 상장사의 레버드 베타를 무차입화한 뒤 대상 기업의 자본구조로 다시 조정해요.",
      purpose:
        "사업모델과 위험구조가 비슷한 상장 비교기업을 구체적으로 선정할 수 있을 때 적합해요.",
      preparation: [
        "유사기업의 레버드 베타",
        "유사기업의 부채비율과 법인세율",
        "대상 기업의 목표 부채비율과 법인세율",
        "무위험이자율, 시장위험프리미엄, 타인자본비용",
      ],
      outerTab: "업종 베타",
      innerTab: "Levered β 역산",
    },
  ];

  const methodById = new Map(methods.map((method) => [method.id, method]));

  let guideStep = 0;
  let selectedMethodId = loadSelectedMethod();
  let guideRoot = null;
  let lastRenderSignature = "";
  let syncQueued = false;
  let active = false;
  let preparedMethodId = null;
  let preparationAttempts = 0;
  let preparationTimer = null;
  let preparationError = "";

  function loadSelectedMethod() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const value = raw.startsWith('"') ? JSON.parse(raw) : raw;
      return methods.some((method) => method.id === value) ? value : null;
    } catch {
      return null;
    }
  }

  const saveSelectedMethod = (methodId) => {
    try {
      localStorage.setItem(STORAGE_KEY, methodId);
    } catch {
      // The guide still works when browser storage is unavailable.
    }
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const selectedMethod = () => methodById.get(selectedMethodId) || null;

  const setClassState = (element, className, enabled = true) => {
    if (!element || element.classList.contains(className) === enabled) return;
    element.classList.toggle(className, enabled);
  };

  const ensureStylesheet = () => {
    if (document.querySelector('link[data-guided-workflows-style="true"]')) return;
    const link = document.createElement("link");
    const scriptUrl = document.currentScript?.src;
    link.rel = "stylesheet";
    link.dataset.guidedWorkflowsStyle = "true";
    link.href = scriptUrl
      ? new URL("guided-workflows.css", scriptUrl).href
      : "./assets/guided-workflows.css";
    document.head.append(link);
  };

  const setTrailingText = (element, value) => {
    if (!element) return;
    const textNodes = Array.from(element.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim(),
    );
    const textNode = textNodes[textNodes.length - 1];
    if (textNode) {
      if (textNode.nodeValue.trim() !== value) textNode.nodeValue = ` ${value}`;
      return;
    }
    element.append(document.createTextNode(` ${value}`));
  };

  const findWaccNavigationItem = () =>
    Array.from(document.querySelectorAll(".sidebar-nav .nav-item:not(.home-nav-item)")).find(
      (item) => item.textContent.includes("WACC"),
    ) || null;

  const isWaccPageActive = () => {
    const app = document.querySelector(".app");
    if (
      !app ||
      !document.querySelector(".home-nav-item") ||
      app.classList.contains("home-dashboard-mode")
    ) return false;
    const item = findWaccNavigationItem();
    return Boolean(item?.classList.contains("active"));
  };

  const normalizeUiText = () => {
    const navItem = findWaccNavigationItem();
    if (navItem) {
      setTrailingText(navItem, "WACC 계산하기");
      navItem.setAttribute("aria-label", "WACC 계산하기");
      const section = navItem.closest(".nav-section");
      setClassState(section, "guided-wacc-nav-section");
      const title = section?.querySelector(":scope > .nav-section-title");
      if (title && title.textContent !== "WACC 계산하기") title.textContent = "WACC 계산하기";
      section?.querySelector(".nav-sub-items")?.setAttribute("aria-hidden", "true");
    }

    if (!active) return;
    const method = selectedMethod();
    const header = document.querySelector(".main-content > .main-header");
    const heading = header?.querySelector("h2");
    const description = header?.querySelector("p");
    if (heading && heading.textContent !== "WACC 계산하기") {
      heading.textContent = "WACC 계산하기";
    }
    if (description) {
      const text =
        guideStep === 3 && method
          ? `${method.shortTitle}을 선택했어요. 안내에 따라 한 단계씩 계산해 보세요.`
          : "WACC을 계산하는 방법은 여러가지가 있어요. 목적에 맞는 계산방법을 선택하세요!";
      if (description.textContent !== text) description.textContent = text;
    }

    document.querySelectorAll(".main-content .card-title").forEach((title) => {
      const label = title.textContent.trim();
      if (label === "WACC 계산기") setTrailingText(title, "WACC 계산하기");
      if (label === "💰 WACC 산출 및 저장") title.textContent = "💰 WACC 계산하고 저장하기";
    });
    document.querySelectorAll(".main-content .step-label-text").forEach((label) => {
      if (label.textContent.trim() === "WACC 산출") label.textContent = "WACC 계산";
    });
  };

  const renderProgress = () => `
    <header class="guided-wacc-progress" aria-label="WACC 계산 진행 단계">
      <div>
        <span>GUIDED WACC</span>
        <strong>${guideStep + 1} / ${GUIDE_STEPS}</strong>
      </div>
      <div
        class="guided-wacc-progress-track"
        role="progressbar"
        aria-valuemin="1"
        aria-valuemax="${GUIDE_STEPS}"
        aria-valuenow="${guideStep + 1}"
        aria-valuetext="${guideStep + 1} / ${GUIDE_STEPS} 단계"
      >
        <span style="width:${((guideStep + 1) / GUIDE_STEPS) * 100}%"></span>
      </div>
    </header>
  `;

  const renderIntro = () => `
    <section class="guided-wacc-panel" aria-labelledby="guided-wacc-title">
      <div class="guided-wacc-eyebrow">첫 번째 단계 · 계산 경로 확인</div>
      <h3 id="guided-wacc-title" tabindex="-1">WACC을 계산하는 방법은 여러가지가 있어요. 목적에 맞는 계산방법을 선택하세요!</h3>
      <div class="guided-wacc-explanation">
        <strong>WACC은 미래 현금흐름을 현재가치로 바꾸는 할인율이에요.</strong>
        <p>회사의 상장 여부, 사용할 수 있는 시장 데이터, 평가 목적에 따라 베타를 구하는 출발점이 달라집니다. 먼저 상황에 맞는 경로를 함께 골라볼게요.</p>
      </div>
      <footer class="guided-wacc-actions end">
        <button type="button" class="primary" data-wacc-guide-action="next-methods">
          계산 방법 살펴보기 →
        </button>
      </footer>
    </section>
  `;

  const renderMethodSelection = () => `
    <section class="guided-wacc-panel" aria-labelledby="guided-wacc-title">
      <div class="guided-wacc-eyebrow">두 번째 단계 · 목적에 맞는 방법 선택</div>
      <h3 id="guided-wacc-title" tabindex="-1">어떤 상황에서 WACC을 계산하나요?</h3>
      <p class="guided-wacc-lead small">아래 네 가지 중 지금 분석에 가장 가까운 방법 하나를 선택해 주세요.</p>
      <div class="guided-wacc-method-list" role="group" aria-label="WACC 계산 방법">
        ${methods
          .map(
            (method) => `
              <button
                type="button"
                class="guided-wacc-method-option ${selectedMethodId === method.id ? "selected" : ""}"
                data-wacc-method-id="${escapeHtml(method.id)}"
                aria-pressed="${selectedMethodId === method.id}"
              >
                <span class="guided-wacc-method-icon" aria-hidden="true">${method.icon}</span>
                <span class="guided-wacc-method-copy">
                  <strong>${escapeHtml(method.title)}</strong>
                  <span>${escapeHtml(method.description)}</span>
                  <small><b>이럴 때 사용해요</b>${escapeHtml(method.purpose)}</small>
                </span>
                <span class="guided-wacc-method-check" aria-hidden="true">✓</span>
              </button>
            `,
          )
          .join("")}
      </div>
      <footer class="guided-wacc-actions">
        <button type="button" class="secondary" data-wacc-guide-action="previous-intro">← 이전</button>
        <button
          type="button"
          class="primary"
          data-wacc-guide-action="next-summary"
          ${selectedMethodId ? "" : "disabled"}
        >
          다음: 준비자료 확인 →
        </button>
      </footer>
    </section>
  `;

  const renderSummary = () => {
    const method = selectedMethod();
    if (!method) return renderMethodSelection();
    return `
      <section class="guided-wacc-panel" aria-labelledby="guided-wacc-title">
        <div class="guided-wacc-eyebrow">세 번째 단계 · 선택 확인</div>
        <h3 id="guided-wacc-title" tabindex="-1">${method.icon} ${escapeHtml(method.title)}으로 진행할게요</h3>
        <p class="guided-wacc-lead small">${escapeHtml(method.purpose)}</p>
        <div class="guided-wacc-summary">
          <strong>이 방법의 계산 흐름</strong>
          <p>${escapeHtml(method.description)}</p>
          <strong>미리 준비하면 좋은 자료</strong>
          <ul>
            ${method.preparation.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
        <p class="guided-wacc-note">준비되지 않은 값은 계산 화면의 기본값을 참고한 뒤, 근거를 확인해 수정할 수 있어요.</p>
        <footer class="guided-wacc-actions">
          <button type="button" class="secondary" data-wacc-guide-action="previous-methods">← 방법 다시 선택</button>
          <button type="button" class="primary" data-wacc-guide-action="start-calculator">
            ${escapeHtml(method.shortTitle)} 계산 시작 →
          </button>
        </footer>
      </section>
    `;
  };

  const renderCalculatorContext = () => {
    const method = selectedMethod();
    if (!method) return renderMethodSelection();

    if (preparationError) {
      return `
        <section class="guided-wacc-panel compact" aria-labelledby="guided-wacc-title">
          <div class="guided-wacc-eyebrow">네 번째 단계 · 계산기 준비</div>
          <h3 id="guided-wacc-title" tabindex="-1">계산기를 불러오지 못했어요</h3>
          <p class="guided-wacc-lead small">${escapeHtml(preparationError)}</p>
          <footer class="guided-wacc-actions">
            <button type="button" class="secondary" data-wacc-guide-action="previous-methods">← 방법 다시 선택</button>
            <button type="button" class="primary" data-wacc-guide-action="retry-calculator">다시 시도</button>
          </footer>
        </section>
      `;
    }

    if (preparedMethodId !== method.id) {
      return `
        <section class="guided-wacc-panel compact" aria-labelledby="guided-wacc-title" aria-live="polite">
          <div class="guided-wacc-eyebrow">네 번째 단계 · 계산기 준비</div>
          <h3 id="guided-wacc-title" tabindex="-1">${method.icon} ${escapeHtml(method.shortTitle)} 계산기를 준비하고 있어요</h3>
          <p class="guided-wacc-lead small">선택한 방법의 첫 단계로 안전하게 이동할게요.</p>
          <div class="guided-wacc-loading" aria-hidden="true"><span></span></div>
        </section>
      `;
    }

    return `
      <div class="guided-wacc-calculator-context" aria-label="선택한 WACC 계산 방법">
        <span>${method.icon}</span>
        <div>
          <strong>${escapeHtml(method.title)}</strong>
          <small>아래에는 지금 필요한 계산 단계 하나만 표시돼요.</small>
        </div>
        <button type="button" data-wacc-guide-action="previous-methods">방법 바꾸기</button>
      </div>
    `;
  };

  const renderGuide = ({ forceFocus = false } = {}) => {
    if (!guideRoot?.isConnected) return;
    const signature = [
      guideStep,
      selectedMethodId || "none",
      preparedMethodId || "pending",
      preparationError,
    ].join("|");
    if (signature === lastRenderSignature && guideRoot.firstElementChild) return;
    lastRenderSignature = signature;

    const content =
      guideStep === 0
        ? renderIntro()
        : guideStep === 1
          ? renderMethodSelection()
          : guideStep === 2
            ? renderSummary()
            : renderCalculatorContext();

    guideRoot.innerHTML = `
      <div class="guided-wacc-inner ${guideStep === 3 ? "calculator" : ""}">
        ${renderProgress()}
        ${content}
      </div>
    `;

    if (forceFocus) {
      const contentArea = guideRoot.closest(".content-area");
      if (contentArea) contentArea.scrollTop = 0;
      const target = guideRoot.querySelector("#guided-wacc-title");
      try {
        target?.focus({ preventScroll: true });
      } catch {
        // The content remains usable when programmatic focus is unavailable.
      }
    }
  };

  const nativeMethodTabs = () =>
    Array.from(document.querySelectorAll(".main-content > .method-tabs .method-tab"));

  const findNativeTab = (tabs, label) =>
    tabs.find((tab) => tab.textContent.trim().includes(label)) || null;

  const currentNativeSource = (method) =>
    method?.id === "regression"
      ? document.querySelector(".main-content .regression-beta-calculator")
      : document.querySelector(".main-content .pure-play-container");

  const markNativeSources = () => {
    document
      .querySelectorAll(".main-content .pure-play-container, .main-content .regression-beta-calculator")
      .forEach((source) => {
        const ready = guideStep === 3 && preparedMethodId === selectedMethodId;
        setClassState(source, "guided-wacc-native-source");
        setClassState(source, "guided-wacc-calculator-ready", ready);
        if (ready) source.removeAttribute("aria-hidden");
        else source.setAttribute("aria-hidden", "true");
      });
  };

  const clearPreparationTimer = () => {
    if (preparationTimer !== null) {
      clearTimeout(preparationTimer);
      preparationTimer = null;
    }
  };

  const schedulePreparation = (delay = 0) => {
    clearPreparationTimer();
    preparationTimer = setTimeout(() => {
      preparationTimer = null;
      prepareNativeCalculator();
    }, delay);
  };

  const preparationFailed = () => {
    preparationError =
      "기존 계산 화면을 찾을 수 없습니다. 잠시 후 다시 시도하거나 WACC 메뉴를 다시 열어 주세요.";
    preparedMethodId = null;
    markNativeSources();
    renderGuide({ forceFocus: true });
  };

  function prepareNativeCalculator() {
    if (!active || guideStep !== 3) return;
    const method = selectedMethod();
    if (!method) {
      guideStep = 1;
      renderGuide({ forceFocus: true });
      return;
    }

    if (preparedMethodId === method.id) {
      markNativeSources();
      return;
    }

    preparationAttempts += 1;
    if (preparationAttempts > 40) {
      preparationFailed();
      return;
    }

    const outerTab = findNativeTab(nativeMethodTabs(), method.outerTab);
    if (!outerTab) {
      schedulePreparation(25);
      return;
    }

    if (!outerTab.classList.contains("active")) {
      outerTab.click();
      schedulePreparation(0);
      return;
    }

    const source = currentNativeSource(method);
    if (!source) {
      schedulePreparation(25);
      return;
    }

    source.classList.add("guided-wacc-native-source");

    if (method.id === "regression") {
      const stepLabel = source.querySelector(".step-label-text")?.textContent.trim();
      if (stepLabel && stepLabel !== "데이터 입력") {
        const previous = source.querySelector(".step-nav-btn.prev");
        if (previous) {
          previous.click();
          schedulePreparation(0);
          return;
        }
      }
    } else {
      const innerTabs = Array.from(source.querySelectorAll(".tabs .tab"));
      const innerTab = method.innerTab ? findNativeTab(innerTabs, method.innerTab) : null;
      if (!innerTab) {
        const previous = source.querySelector(".step-nav-btn.prev");
        if (previous) {
          previous.click();
          schedulePreparation(0);
          return;
        }
        schedulePreparation(25);
        return;
      }
      if (!innerTab.classList.contains("active")) {
        innerTab.click();
        schedulePreparation(0);
        return;
      }
    }

    preparedMethodId = method.id;
    preparationError = "";
    markNativeSources();
    renderGuide();
    normalizeUiText();
    const firstHeading = source.querySelector(".card-title, h3");
    if (firstHeading) {
      firstHeading.setAttribute("tabindex", "-1");
      try {
        firstHeading.focus({ preventScroll: true });
      } catch {
        // The calculator remains usable without programmatic focus.
      }
    }
  }

  const resetPreparation = () => {
    clearPreparationTimer();
    preparedMethodId = null;
    preparationAttempts = 0;
    preparationError = "";
    markNativeSources();
  };

  const onGuideClick = (event) => {
    const methodButton = event.target.closest("[data-wacc-method-id]");
    if (methodButton && guideRoot?.contains(methodButton)) {
      const methodId = methodButton.dataset.waccMethodId;
      if (methodById.has(methodId)) {
        selectedMethodId = methodId;
        saveSelectedMethod(methodId);
        resetPreparation();
        lastRenderSignature = "";
        renderGuide();
        const selected = guideRoot.querySelector(`[data-wacc-method-id="${methodId}"]`);
        try {
          selected?.focus({ preventScroll: true });
        } catch {
          // Selection is still visible without programmatic focus.
        }
      }
      return;
    }

    const actionButton = event.target.closest("[data-wacc-guide-action]");
    if (!actionButton || !guideRoot?.contains(actionButton)) return;

    switch (actionButton.dataset.waccGuideAction) {
      case "next-methods":
        guideStep = 1;
        break;
      case "previous-intro":
        guideStep = 0;
        break;
      case "next-summary":
        if (!selectedMethod()) return;
        guideStep = 2;
        break;
      case "previous-methods":
        resetPreparation();
        guideStep = 1;
        document.querySelector(".main-content")?.classList.remove("guided-wacc-calculator-mode");
        break;
      case "start-calculator":
        if (!selectedMethod()) return;
        resetPreparation();
        guideStep = 3;
        document.querySelector(".main-content")?.classList.add("guided-wacc-calculator-mode");
        schedulePreparation();
        break;
      case "retry-calculator":
        resetPreparation();
        schedulePreparation();
        break;
      default:
        return;
    }

    lastRenderSignature = "";
    renderGuide({ forceFocus: true });
    normalizeUiText();
    markNativeSources();
  };

  const ensureGuideRoot = () => {
    const content = document.querySelector(".main-content > .content-area");
    if (!content) return null;
    let host = content.querySelector(":scope > .guided-wacc:not(.guided-multiples)");
    if (!host) {
      host = document.createElement("div");
      host.className = "guided-wacc";
      host.addEventListener("click", onGuideClick);
      content.prepend(host);
    }
    host.hidden = false;
    guideRoot = host;
    return host;
  };

  const activateGuide = () => {
    active = true;
    const main = document.querySelector(".main-content");
    setClassState(main, "guided-wacc-active");
    setClassState(main, "guided-wacc-calculator-mode", guideStep === 3);

    document.querySelectorAll(".main-content > .method-tabs").forEach((tabs) => {
      setClassState(tabs, "guided-wacc-native-tabs");
      tabs.setAttribute("aria-hidden", "true");
    });

    ensureGuideRoot();
    markNativeSources();
    normalizeUiText();
    renderGuide();
    if (guideStep === 3 && preparedMethodId !== selectedMethodId) schedulePreparation();
  };

  const deactivateGuide = () => {
    if (!active && !guideRoot) return;
    active = false;
    clearPreparationTimer();
    const main = document.querySelector(".main-content");
    main?.classList.remove("guided-wacc-active", "guided-wacc-calculator-mode");
    document.querySelectorAll(".guided-wacc-native-source").forEach((source) => {
      source.classList.remove("guided-wacc-native-source", "guided-wacc-calculator-ready");
      source.removeAttribute("aria-hidden");
    });
    document.querySelectorAll(".guided-wacc-native-tabs").forEach((tabs) => {
      tabs.classList.remove("guided-wacc-native-tabs");
      tabs.removeAttribute("aria-hidden");
    });
    if (guideRoot) guideRoot.hidden = true;
    guideRoot = null;
    guideStep = 0;
    preparedMethodId = null;
    preparationAttempts = 0;
    preparationError = "";
    lastRenderSignature = "";
  };

  const syncPage = () => {
    syncQueued = false;
    if (!document.querySelector(".home-nav-item")) return;
    normalizeUiText();
    if (isWaccPageActive()) activateGuide();
    else deactivateGuide();
  };

  const scheduleSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(syncPage);
  };

  globalThis.ValueScannerGuidedWacc = Object.freeze({
    getMethod: () => selectedMethodId,
    getMethods: () => methods.map(({ id, title, purpose }) => ({ id, title, purpose })),
    restart: () => {
      resetPreparation();
      guideStep = 0;
      lastRenderSignature = "";
      if (active) {
        document.querySelector(".main-content")?.classList.remove("guided-wacc-calculator-mode");
        renderGuide({ forceFocus: true });
        markNativeSources();
      }
    },
  });

  ensureStylesheet();
  syncPage();

  const appRoot = document.getElementById("root");
  if (appRoot) {
    new MutationObserver(scheduleSync).observe(appRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }
})();
