(() => {
  "use strict";

  const TOTAL_STEPS = 3;

  const purposes = [
    {
      id: "comparables",
      icon: "🏢",
      title: "비교기업 분석",
      description:
        "사업과 규모가 비슷한 상장사의 PER, PBR, EV/EBITDA를 비교해 대상 기업의 상대가치 범위를 살펴봐요.",
      bestFor: "동종 상장사와 비교해 현재 가치 수준을 가늠하고 싶을 때",
      materials: [
        "대상 기업과 비교기업 3~5곳의 최근 주가와 시가총액",
        "같은 기준일의 매출, 영업이익, EBITDA, 순이익과 자본총계",
        "순차입금, 비경상 손익처럼 기업 간 수치를 맞추는 데 필요한 조정 항목",
        "사업 구성, 성장률, 수익성 등 비교기업 선정 근거",
      ],
      nextAction:
        "먼저 사업 구조와 규모가 가장 비슷한 기업 3~5곳을 정하고, 모든 수치를 같은 기준일과 회계 기준으로 맞춰 주세요.",
    },
    {
      id: "transactions",
      icon: "🤝",
      title: "IPO·거래 분석",
      description:
        "유사 IPO 공모 사례나 M&A 거래에서 형성된 멀티플을 참고해 공모가·거래가의 범위를 살펴봐요.",
      bestFor: "IPO 공모가나 인수·매각 협상 가격을 검토하고 싶을 때",
      materials: [
        "유사 IPO 또는 M&A 사례의 발표일·거래 완료일과 거래 구조",
        "공모가, 인수가격, 지분율과 당시 기업가치 또는 주주가치",
        "거래 당시의 매출, EBITDA, 순이익과 순차입금",
        "경영권 프리미엄, 시장 상황, 시점 차이를 설명할 자료",
      ],
      nextAction:
        "가격과 재무 수치의 기준 시점이 같은 사례부터 모으고, 경영권 프리미엄이나 시장 상황이 다른 거래는 별도로 표시해 주세요.",
    },
    {
      id: "dcf-check",
      icon: "🔎",
      title: "DCF 교차검증",
      description:
        "DCF로 계산한 가치가 시장의 상대가치 수준과 크게 어긋나지 않는지 멀티플 관점에서 한 번 더 점검해요.",
      bestFor: "DCF 결과의 합리적인 범위와 주요 차이 원인을 확인하고 싶을 때",
      materials: [
        "DCF에서 계산한 기업가치, 주주가치와 기준일",
        "DCF에 사용한 매출, EBITDA, 순이익과 순차입금",
        "비교기업의 동일 기준 멀티플과 중앙값 또는 적정 범위",
        "DCF와 멀티플 결과 차이를 설명할 성장률·수익성·위험 가정",
      ],
      nextAction:
        "DCF 기준일과 비교기업 멀티플의 기준일을 먼저 맞춘 뒤, 두 결과의 차이가 성장률·수익성·위험 중 어디에서 생겼는지 기록해 주세요.",
    },
  ];

  const purposeById = new Map(purposes.map((purpose) => [purpose.id, purpose]));

  let currentStep = 0;
  let selectedPurposeId = null;
  let guideRoot = null;
  let active = false;
  let syncQueued = false;
  let lastRenderSignature = "";
  let shouldFocusOnMount = true;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const selectedPurpose = () => purposeById.get(selectedPurposeId) || null;

  const ensureStylesheet = () => {
    const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(
      (link) => link.href.includes("guided-workflows.css"),
    );
    if (existing) return;

    const link = document.createElement("link");
    const scriptUrl = document.currentScript?.src;
    link.rel = "stylesheet";
    link.dataset.guidedWorkflowsStyle = "true";
    link.href = scriptUrl
      ? new URL("guided-workflows.css", scriptUrl).href
      : "./assets/guided-workflows.css";
    document.head.append(link);
  };

  const findMultiplesNavigationItem = () =>
    Array.from(document.querySelectorAll(".sidebar-nav .nav-item:not(.home-nav-item)")).find(
      (item) => item.textContent.includes("멀티플"),
    ) || null;

  const isMultiplesPageActive = () => {
    const app = document.querySelector(".app");
    if (
      !app ||
      !document.querySelector(".home-nav-item") ||
      app.classList.contains("home-dashboard-mode")
    ) return false;
    return Boolean(findMultiplesNavigationItem()?.classList.contains("active"));
  };

  const normalizeHeader = () => {
    if (!active) return;
    const header = document.querySelector(".main-content > .main-header");
    const heading = header?.querySelector("h2");
    const description = header?.querySelector("p");

    if (heading && heading.textContent.trim() !== "멀티플 분석") {
      heading.textContent = "멀티플 분석";
    }
    const friendlyDescription =
      "목적을 하나 고르면 멀티플 분석에 필요한 자료를 한 단계씩 안내해 드려요.";
    if (description && description.textContent.trim() !== friendlyDescription) {
      description.textContent = friendlyDescription;
    }
  };

  const renderProgress = () => `
    <header class="guided-multiples-progress guided-wacc-progress" aria-label="멀티플 분석 안내 진행 단계">
      <div>
        <span>GUIDED MULTIPLES</span>
        <strong>${currentStep + 1} / ${TOTAL_STEPS}</strong>
      </div>
      <div
        class="guided-multiples-progress-track guided-wacc-progress-track"
        role="progressbar"
        aria-valuemin="1"
        aria-valuemax="${TOTAL_STEPS}"
        aria-valuenow="${currentStep + 1}"
        aria-valuetext="${currentStep + 1} / ${TOTAL_STEPS} 단계"
      >
        <span style="width:${((currentStep + 1) / TOTAL_STEPS) * 100}%"></span>
      </div>
    </header>
  `;

  const renderIntro = () => `
    <section class="guided-multiples-panel guided-wacc-panel" aria-labelledby="guided-multiples-title">
      <div class="guided-multiples-eyebrow guided-wacc-eyebrow">첫 번째 단계 · 분석 방향 알아보기</div>
      <h3 id="guided-multiples-title" tabindex="-1">멀티플 분석, 어떤 때 쓰는지부터 살펴볼까요?</h3>
      <p class="guided-multiples-lead guided-wacc-lead small">
        멀티플은 비슷한 기업이나 거래 사례의 가격 수준을 비교해 대상 기업의 상대가치 범위를 살펴보는 방법이에요.
      </p>
      <div class="guided-multiples-explanation guided-wacc-explanation">
        <strong>현재 멀티플 자동 계산 기능은 아직 준비 중이에요.</strong>
        <p>지금은 분석 목적을 먼저 고르고, 실제 계산 전에 어떤 자료가 필요한지 차례로 정리할 수 있어요. 계산이 완료되는 것처럼 표시하지 않습니다.</p>
      </div>
      <footer class="guided-multiples-actions guided-wacc-actions end">
        <button type="button" class="primary" data-multiples-action="next-purpose">
          분석 목적 고르기 →
        </button>
      </footer>
    </section>
  `;

  const renderPurposeSelection = () => `
    <section class="guided-multiples-panel guided-wacc-panel" aria-labelledby="guided-multiples-title">
      <div class="guided-multiples-eyebrow guided-wacc-eyebrow">두 번째 단계 · 목적 하나 선택</div>
      <h3 id="guided-multiples-title" tabindex="-1">어떤 목적으로 멀티플을 확인하시나요?</h3>
      <p class="guided-multiples-lead guided-wacc-lead small">지금 하려는 분석과 가장 가까운 목적 하나를 선택해 주세요.</p>
      <div
        class="guided-multiples-purpose-list guided-wacc-method-list"
        role="group"
        aria-label="멀티플 분석 목적"
      >
        ${purposes
          .map(
            (purpose) => `
              <button
                type="button"
                class="guided-multiples-purpose-option guided-wacc-method-option ${
                  selectedPurposeId === purpose.id ? "selected" : ""
                }"
                data-multiples-purpose="${escapeHtml(purpose.id)}"
                aria-pressed="${selectedPurposeId === purpose.id}"
              >
                <span class="guided-multiples-purpose-icon guided-wacc-method-icon" aria-hidden="true">${purpose.icon}</span>
                <span class="guided-multiples-purpose-copy guided-wacc-method-copy">
                  <strong>${escapeHtml(purpose.title)}</strong>
                  <span>${escapeHtml(purpose.description)}</span>
                  <small><b>이럴 때 적합해요</b>${escapeHtml(purpose.bestFor)}</small>
                </span>
                <span class="guided-multiples-purpose-check guided-wacc-method-check" aria-hidden="true">✓</span>
              </button>
            `,
          )
          .join("")}
      </div>
      <p class="guided-multiples-note guided-wacc-note">목적을 선택해도 아직 가치가 계산되거나 저장되지는 않아요.</p>
      <footer class="guided-multiples-actions guided-wacc-actions">
        <button type="button" class="secondary" data-multiples-action="previous-intro">← 이전</button>
        <button
          type="button"
          class="primary"
          data-multiples-action="next-summary"
          ${selectedPurposeId ? "" : "disabled"}
        >
          다음: 필요한 자료 확인 →
        </button>
      </footer>
    </section>
  `;

  const renderSummary = () => {
    const purpose = selectedPurpose();
    if (!purpose) return renderPurposeSelection();

    return `
      <section class="guided-multiples-panel guided-wacc-panel" aria-labelledby="guided-multiples-title">
        <div class="guided-multiples-eyebrow guided-wacc-eyebrow">세 번째 단계 · 준비 자료와 다음 행동</div>
        <h3 id="guided-multiples-title" tabindex="-1">${purpose.icon} ${escapeHtml(purpose.title)} 준비 목록이에요</h3>
        <p class="guided-multiples-lead guided-wacc-lead small">${escapeHtml(purpose.bestFor)}</p>
        <div class="guided-multiples-summary guided-wacc-summary">
          <strong>미리 준비할 자료</strong>
          <ul>
            ${purpose.materials.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
          <strong>지금 할 수 있는 다음 행동</strong>
          <p>${escapeHtml(purpose.nextAction)}</p>
        </div>
        <p class="guided-multiples-note guided-wacc-note">
          멀티플 자동 계산 기능은 아직 제공되지 않아요. 이 화면은 계산 결과가 아니라 분석 준비 안내입니다.
        </p>
        <footer class="guided-multiples-actions guided-wacc-actions">
          <button type="button" class="secondary" data-multiples-action="previous-purpose">← 이전</button>
          <button type="button" class="primary" data-multiples-action="restart">처음부터 다시 시작</button>
        </footer>
      </section>
    `;
  };

  const renderGuide = ({ forceFocus = false } = {}) => {
    if (!guideRoot?.isConnected) return;

    const signature = `${currentStep}|${selectedPurposeId || "none"}`;
    if (signature === lastRenderSignature && guideRoot.firstElementChild) {
      if (forceFocus) focusCurrentHeading();
      return;
    }
    lastRenderSignature = signature;

    const content =
      currentStep === 0
        ? renderIntro()
        : currentStep === 1
          ? renderPurposeSelection()
          : renderSummary();

    guideRoot.innerHTML = `
      <div class="guided-multiples-inner guided-wacc-inner">
        ${renderProgress()}
        <div class="guided-multiples-stage" aria-live="polite">
          ${content}
        </div>
      </div>
    `;

    if (forceFocus) {
      const contentArea = guideRoot.closest(".content-area");
      if (contentArea) contentArea.scrollTop = 0;
      focusCurrentHeading();
    }
  };

  const focusCurrentHeading = () => {
    const heading = guideRoot?.querySelector("#guided-multiples-title");
    if (!heading) return;
    try {
      heading.focus({ preventScroll: true });
    } catch {
      heading.focus();
    }
  };

  const focusSelectedPurpose = () => {
    const button = guideRoot?.querySelector(
      `[data-multiples-purpose="${selectedPurposeId}"]`,
    );
    try {
      button?.focus({ preventScroll: true });
    } catch {
      button?.focus();
    }
  };

  const hideNativeContent = () => {
    const content = document.querySelector(".main-content > .content-area");
    if (!content) return;

    Array.from(content.children).forEach((child) => {
      if (child === guideRoot) return;
      if (!child.hasAttribute("data-guided-multiples-managed")) {
        child.dataset.guidedMultiplesManaged = "true";
        child.dataset.guidedMultiplesWasHidden = String(child.hidden);
        child.dataset.guidedMultiplesHadAriaHidden = String(child.hasAttribute("aria-hidden"));
        child.dataset.guidedMultiplesAriaHidden = child.getAttribute("aria-hidden") || "";
      }
      child.classList.add("guided-multiples-native-source");
      child.hidden = true;
      child.setAttribute("aria-hidden", "true");
    });
  };

  const restoreNativeContent = () => {
    document.querySelectorAll('[data-guided-multiples-managed="true"]').forEach((child) => {
      child.hidden = child.dataset.guidedMultiplesWasHidden === "true";
      if (child.dataset.guidedMultiplesHadAriaHidden === "true") {
        child.setAttribute("aria-hidden", child.dataset.guidedMultiplesAriaHidden || "true");
      } else {
        child.removeAttribute("aria-hidden");
      }
      child.classList.remove("guided-multiples-native-source");
      delete child.dataset.guidedMultiplesManaged;
      delete child.dataset.guidedMultiplesWasHidden;
      delete child.dataset.guidedMultiplesHadAriaHidden;
      delete child.dataset.guidedMultiplesAriaHidden;
    });
  };

  const onGuideClick = (event) => {
    const purposeButton = event.target.closest("[data-multiples-purpose]");
    if (purposeButton && guideRoot?.contains(purposeButton)) {
      const purposeId = purposeButton.dataset.multiplesPurpose;
      if (!purposeById.has(purposeId)) return;
      selectedPurposeId = purposeId;
      lastRenderSignature = "";
      renderGuide();
      focusSelectedPurpose();
      return;
    }

    const actionButton = event.target.closest("[data-multiples-action]");
    if (!actionButton || !guideRoot?.contains(actionButton)) return;

    switch (actionButton.dataset.multiplesAction) {
      case "next-purpose":
        currentStep = 1;
        break;
      case "previous-intro":
        currentStep = 0;
        break;
      case "next-summary":
        if (!selectedPurpose()) return;
        currentStep = 2;
        break;
      case "previous-purpose":
        currentStep = 1;
        break;
      case "restart":
        currentStep = 0;
        selectedPurposeId = null;
        break;
      default:
        return;
    }

    lastRenderSignature = "";
    renderGuide({ forceFocus: true });
  };

  const ensureGuideRoot = () => {
    const content = document.querySelector(".main-content > .content-area");
    if (!content) return null;

    let host = content.querySelector(":scope > .guided-multiples");
    if (!host) {
      host = document.createElement("div");
      host.className = "guided-multiples guided-wacc";
      host.setAttribute("aria-label", "멀티플 분석 단계별 안내");
      host.addEventListener("click", onGuideClick);
      content.prepend(host);
      shouldFocusOnMount = true;
    }
    host.hidden = false;
    guideRoot = host;
    return host;
  };

  const activateGuide = () => {
    active = true;
    document.querySelector(".main-content")?.classList.add("guided-multiples-active");
    if (!ensureGuideRoot()) return;

    normalizeHeader();
    hideNativeContent();
    renderGuide({ forceFocus: shouldFocusOnMount });
    shouldFocusOnMount = false;
  };

  const deactivateGuide = () => {
    if (!active && !guideRoot) return;
    active = false;
    document.querySelector(".main-content")?.classList.remove("guided-multiples-active");
    restoreNativeContent();
    if (guideRoot?.isConnected) guideRoot.remove();
    guideRoot = null;
    currentStep = 0;
    selectedPurposeId = null;
    lastRenderSignature = "";
    shouldFocusOnMount = true;
  };

  const syncPage = () => {
    syncQueued = false;
    if (isMultiplesPageActive()) activateGuide();
    else deactivateGuide();
  };

  const scheduleSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(syncPage);
  };

  const restartGuide = () => {
    currentStep = 0;
    selectedPurposeId = null;
    lastRenderSignature = "";
    if (active) renderGuide({ forceFocus: true });
  };

  globalThis.ValueScannerGuidedMultiples = Object.freeze({
    restart: restartGuide,
    getState: () => ({
      active,
      step: currentStep + 1,
      selectedPurpose: selectedPurposeId,
      calculationAvailable: false,
    }),
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
