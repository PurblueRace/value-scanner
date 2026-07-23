(() => {
  "use strict";

  const featureGroups = [
    {
      id: "options-simulation",
      phase: "3A",
      roadmapTitle: "시장모형",
      eyebrow: "옵션 · 복합상품",
      title: "옵션과 시뮬레이션",
      description: "바닐라 옵션부터 복잡한 전환 조건까지 모형의 범위를 구분해 준비합니다.",
      features: [
        {
          code: "BS",
          title: "블랙–숄즈 옵션가치평가",
          description:
            "유럽형 콜·풋 옵션의 이론가와 델타·감마·베가 등 주요 민감도를 계산합니다.",
          purpose:
            "단순 유럽형 옵션이나 주식기준보상의 공정가치와 주요 가격 민감도를 설명할 때 사용합니다.",
          methodNote:
            "연속 배당수익률을 반영한 블랙–숄즈–머튼 모형으로 유럽형 콜·풋을 평가합니다.",
          tags: ["유럽형 옵션", "콜·풋", "Greeks"],
          status: "사용 가능",
          tone: "ready",
          calculator: "black-scholes",
        },
        {
          code: "MC",
          title: "몬테카를로 시뮬레이션",
          description:
            "주가·금리·변동성 경로를 반복 생성해 복잡한 권리와 조건부 지급액의 가치 범위를 분석합니다.",
          purpose:
            "경로 의존 조건이나 조건부 지급처럼 닫힌 해가 어려운 계약의 가치 범위와 불확실성을 추정할 때 사용합니다.",
          tags: ["확률 경로", "신뢰구간", "민감도"],
          status: "공통 엔진 예정",
          tone: "engine",
        },
        {
          code: "CB",
          title: "전환사채 가치평가",
          description:
            "일반채권 가치와 전환권을 나누고 조기상환·콜·풋·리픽싱 조건을 반영합니다.",
          purpose:
            "채권요소와 전환권을 분리해 복합금융상품의 공정가치와 계약조건별 영향을 검토할 때 사용합니다.",
          methodNote:
            "조기행사와 리픽싱은 블랙–숄즈가 아닌 별도 시뮬레이션 모형으로 설계할 예정입니다.",
          tags: ["채권 + 전환권", "리픽싱", "조기행사"],
          status: "고급모형 설계",
          tone: "design",
        },
      ],
    },
    {
      id: "fixed-income",
      phase: "3B",
      roadmapTitle: "금리·복합상품",
      eyebrow: "채권 · 파생상품",
      title: "금리상품 가치평가",
      description: "기준가격과 금리위험을 구분하고, 현금흐름과 커브를 일관되게 연결합니다.",
      features: [
        {
          code: "D+C",
          title: "채권 가격·금리 민감도",
          description:
            "기준가격은 쿠폰과 원금을 할인해 구하고, 듀레이션·볼록성으로 금리변동 시 가격을 조정합니다.",
          purpose:
            "채권의 기준가격과 금리 변화에 따른 가격위험을 구분해 설명하고 검토할 때 사용합니다.",
          methodNote:
            "쿠폰·원금의 기준가격과 듀레이션·볼록성에 의한 금리변동 가격은 구분해 보여줄 예정입니다.",
          tags: ["수정 듀레이션", "볼록성", "금리충격"],
          status: "모형 확정",
          tone: "ready",
        },
        {
          code: "β+D",
          title: "자산베타·포트폴리오 금리위험",
          description:
            "보유자산의 시장가치 가중 베타와 현금흐름 듀레이션을 구분해 주식시장·금리 충격에 대한 포트폴리오 위험을 점검합니다.",
          purpose:
            "여러 자산으로 구성된 포트폴리오의 시장위험과 금리위험을 따로 측정하고 목표 위험수준에 맞춘 조정 방향을 검토할 때 사용합니다.",
          methodNote:
            "베타는 시장가치 가중 위험으로, 듀레이션은 현금흐름 시점에 따른 금리 민감도로 나누어 보여줄 예정입니다.",
          tags: ["시장가치 가중 베타", "포트폴리오 듀레이션", "충격 시나리오"],
          status: "위험모형 설계",
          tone: "design",
        },
        {
          code: "IRS",
          title: "스왑계약 가치평가",
          description:
            "고정·변동 레그의 현재가치를 비교해 이자율스왑의 순가치와 공정고정금리를 계산합니다.",
          purpose:
            "고정·변동 현금흐름을 비교해 스왑의 순가치, 공정고정금리와 금리 민감도를 검토할 때 사용합니다.",
          tags: ["이자율스왑", "고정·변동 레그", "DV01"],
          status: "커브 설계",
          tone: "design",
        },
      ],
    },
    {
      id: "merger",
      phase: "3C",
      roadmapTitle: "M&A 거래",
      eyebrow: "M&A 거래",
      title: "합병 가치평가",
      description: "기업가치, 주당가치와 회계상 이전대가를 서로 다른 결과로 구분합니다.",
      features: [
        {
          code: "M&A",
          title: "합병·주식교환 분석",
          description:
            "합병 시너지의 현재가치, 협상 가능한 주식교환비율, 현금·주식·조건부대가의 취득일 공정가치를 분석합니다.",
          purpose:
            "시너지, 주식교환비율과 거래대가를 구분해 합병조건과 취득일 공정가치를 검토할 때 사용합니다.",
          tags: ["합병 시너지", "주식교환비율", "합병대가 공정가치"],
          status: "거래모형 설계",
          tone: "design",
        },
      ],
    },
  ];

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const featureSteps = featureGroups.flatMap((group) =>
    group.features.map((feature, featureIndex) => ({ group, feature, featureIndex })),
  );
  const totalSteps = featureSteps.length + 1;
  let currentStep = 0;

  const renderProgress = () => {
    const progress = ((currentStep + 1) / totalSteps) * 100;
    const current = currentStep > 0 ? featureSteps[currentStep - 1] : null;
    const label = current
      ? `${current.group.phase} · ${current.group.roadmapTitle}`
      : "소개";

    return `
      <header class="guided-progress-shell phase3-step-progress">
        <div class="guided-progress-topline">
          <div>
            <span class="guided-product-label">PHASE 3 GUIDE</span>
            <strong>${currentStep + 1} / ${totalSteps}</strong>
          </div>
          <span class="guided-autosave">${escapeHtml(label)}</span>
        </div>
        <div
          class="guided-progress-track"
          role="progressbar"
          aria-label="고급 가치평가 기능 탐색 진행률"
          aria-valuemin="1"
          aria-valuemax="${totalSteps}"
          aria-valuenow="${currentStep + 1}"
          aria-valuetext="${currentStep + 1} / ${totalSteps} 단계"
        >
          <span style="width:${progress}%"></span>
        </div>
      </header>
    `;
  };

  const renderIntroStep = () => `
    <section class="phase3-hero phase3-step-card phase3-intro-step" aria-labelledby="phase3-hub-title">
      <div>
        <span class="phase3-kicker">PHASE 3 · 소개</span>
        <h2 id="phase3-hub-title" tabindex="-1">고급 가치평가를 하나씩 살펴볼까요?</h2>
        <p>옵션·복합상품, 금리상품과 M&amp;A는 목적에 따라 필요한 모형이 달라요. 첫 번째 블랙–숄즈 계산기는 지금 사용할 수 있고, 나머지 기능은 구현 순서대로 안내할게요.</p>
        <p><strong>진행 순서:</strong> 시장모형 → 금리·복합상품 → M&amp;A 거래</p>
        <div class="step-nav phase3-step-navigation">
          <span></span>
          <button type="button" class="step-nav-btn next" data-phase3-action="next">
            첫 번째 기능 보기 →
          </button>
        </div>
      </div>
    </section>
  `;

  const renderFeatureStep = ({ group, feature, featureIndex }) => {
    const titleId = `phase3-${group.id}-${featureIndex}-title`;
    return `
      <article class="phase3-feature-card phase3-step-card" aria-labelledby="${escapeHtml(titleId)}">
        <div class="phase3-feature-topline">
          <span class="phase3-code" aria-hidden="true">${escapeHtml(feature.code)}</span>
          <span class="phase3-status ${escapeHtml(feature.tone)}" aria-label="상태: ${escapeHtml(feature.status)}">
            ${feature.calculator ? "✓" : "◷"} ${escapeHtml(feature.status)}
          </span>
        </div>

        <span class="phase3-kicker">${escapeHtml(group.phase)} · ${escapeHtml(group.eyebrow)}</span>
        <h3 id="${escapeHtml(titleId)}" tabindex="-1">${escapeHtml(feature.title)}</h3>
        <p>${escapeHtml(feature.description)}</p>

        <div class="phase3-feature-purpose">
          <strong>이 기능은 언제 사용하나요?</strong>
          <p>${escapeHtml(feature.purpose)}</p>
        </div>

        <div class="phase3-feature-context">
          <strong>${escapeHtml(group.title)}</strong>
          <p>${escapeHtml(group.description)}</p>
        </div>

        ${
          feature.methodNote
            ? `<div class="phase3-feature-method-note">
                <strong>모형 적용 원칙</strong>
                <p>${escapeHtml(feature.methodNote)}</p>
              </div>`
            : ""
        }

        <div class="phase3-tags" aria-label="포함 기능">
          ${feature.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
        </div>
        ${
          feature.calculator
            ? `<button type="button" class="phase3-launch-button" data-phase3-launch="${escapeHtml(feature.calculator)}">단계별 계산 시작 →</button>`
            : '<button type="button" disabled aria-disabled="true">Phase 3 · 구현 예정</button>'
        }
      </article>
    `;
  };

  const renderFeatureNavigation = () => {
    const isLast = currentStep === totalSteps - 1;
    return `
      <div class="step-nav phase3-step-navigation" aria-label="고급 가치평가 기능 이동">
        <button type="button" class="step-nav-btn prev" data-phase3-action="previous">
          ← 이전
        </button>
        <button
          type="button"
          class="step-nav-btn next"
          data-phase3-action="${isLast ? "restart" : "next"}"
        >
          ${isLast ? "처음부터 다시 보기" : "다음 기능 →"}
        </button>
      </div>
    `;
  };

  const renderHub = () => `
    <div class="phase3-hub-inner">
      ${renderProgress()}
      <div class="phase3-step-stage" aria-live="polite">
        ${currentStep === 0 ? renderIntroStep() : renderFeatureStep(featureSteps[currentStep - 1])}
        ${currentStep === 0 ? "" : renderFeatureNavigation()}
      </div>
    </div>
  `;

  const replaceNavText = (item, label) => {
    const textNodes = Array.from(item.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim(),
    );
    const target = textNodes[textNodes.length - 1];
    if (target && target.nodeValue !== label) target.nodeValue = label;
  };

  const updateNavigation = () => {
    const sectionTitle = Array.from(document.querySelectorAll(".nav-section-title")).find((element) =>
      element.textContent.includes("Phase 3"),
    );
    if (!sectionTitle) return;

    if (sectionTitle.textContent.trim() !== "Phase 3: 고급 가치평가") {
      sectionTitle.textContent = "Phase 3: 고급 가치평가";
    }
    const section = sectionTitle.closest(".nav-section");
    const item = section?.querySelector(".nav-item");
    if (!item) return;

    const currentLabel = item.textContent.trim();
    if (
      currentLabel.includes("주식선택권") ||
      currentLabel.includes("BOPM") ||
      currentLabel.includes("고급 가치평가")
    ) {
      replaceNavText(item, "고급 가치평가");
      item.dataset.shortLabel = "고급";
      item.setAttribute("aria-label", "Phase 3 고급 가치평가");
    }
  };

  const updateHeader = (source) => {
    const contentArea = source.closest(".content-area");
    const header = contentArea?.previousElementSibling;
    if (!header?.matches("header.main-header")) return;
    const host = source.previousElementSibling;
    if (host?.classList.contains("phase3-hub") && host.dataset.phase3Mode) return;
    const title = header.querySelector("h2");
    const description = header.querySelector("p");
    if (title && title.textContent.trim() !== "Phase 3 고급 가치평가") {
      title.textContent = "Phase 3 고급 가치평가";
    }
    if (
      description &&
      description.textContent.trim() !==
        "블랙–숄즈 옵션 분석을 사용할 수 있으며 나머지 고급 기능은 순차적으로 구현합니다."
    ) {
      description.textContent =
        "블랙–숄즈 옵션 분석을 사용할 수 있으며 나머지 고급 기능은 순차적으로 구현합니다.";
    }
  };

  const focusCurrentStep = (host) => {
    const heading = host.querySelector(
      currentStep === 0 ? "#phase3-hub-title" : ".phase3-step-card h3",
    );
    try {
      heading?.focus({ preventScroll: true });
    } catch {
      // The step remains usable if programmatic focus is unsupported.
    }
  };

  const renderCurrentStep = (host, { focus = true } = {}) => {
    host.innerHTML = renderHub();
    if (focus) focusCurrentStep(host);
    const contentArea = host.closest(".content-area");
    if (contentArea) contentArea.scrollTop = 0;
  };

  const handlePhase3Click = (event) => {
    const host = event.currentTarget;
    const launchButton = event.target.closest("[data-phase3-launch]");
    if (launchButton && host.contains(launchButton)) {
      if (
        launchButton.dataset.phase3Launch === "black-scholes" &&
        globalThis.ValueScannerBlackScholes?.mount
      ) {
        globalThis.ValueScannerBlackScholes.mount(host, {
          onExit: () => {
            renderCurrentStep(host);
            const source = host.nextElementSibling;
            if (source?.classList.contains("stock-option-container")) updateHeader(source);
          },
        });
      }
      return;
    }

    const button = event.target.closest("[data-phase3-action]");
    if (!button || !host.contains(button)) return;

    switch (button.dataset.phase3Action) {
      case "previous":
        currentStep = Math.max(0, currentStep - 1);
        break;
      case "next":
        currentStep = Math.min(totalSteps - 1, currentStep + 1);
        break;
      case "restart":
        currentStep = 0;
        break;
      default:
        return;
    }

    renderCurrentStep(host);
  };

  const ensureHubEvents = (host) => {
    if (host.dataset.phase3EventsReady === "true") return;
    host.dataset.phase3EventsReady = "true";
    host.addEventListener("click", handlePhase3Click);
  };

  const mountPhase3Hub = (source) => {
    source.classList.add("phase3-legacy-source");
    let host = source.previousElementSibling;
    const isNew = !host?.classList.contains("phase3-hub");
    if (isNew) {
      host = document.createElement("div");
      host.className = "phase3-hub";
      source.before(host);
      renderCurrentStep(host, { focus: false });
    }

    ensureHubEvents(host);

    updateHeader(source);

    if (isNew) focusCurrentStep(host);
  };

  const updateAssetBetaLabels = (purePlay) => {
    if (!purePlay) return;
    purePlay
      .querySelectorAll(".form-label, .result-label, .card-title, .step-label-text")
      .forEach((element) => {
        const label = element.textContent.trim();
        if (label === "Unlevered Beta (βu)") {
          element.textContent = "자산 베타 / 무차입 베타 (βA, βu)";
        } else if (label === "βu 산출") {
          element.textContent = "자산 β 산출";
        }
      });
  };

  let syncQueued = false;

  const syncPage = () => {
    syncQueued = false;
    updateNavigation();
    updateAssetBetaLabels(document.querySelector(".pure-play-container"));

    const source = document.querySelector(".stock-option-container");
    const existingHub = document.querySelector(".phase3-hub");

    if (source) {
      if (!existingHub || !source.classList.contains("phase3-legacy-source")) {
        mountPhase3Hub(source);
      } else {
        updateHeader(source);
      }
    } else if (existingHub) {
      existingHub.remove();
    }
  };

  const scheduleSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(syncPage);
  };

  syncPage();

  const root = document.getElementById("root");
  if (root) {
    new MutationObserver(scheduleSync).observe(root, {
      childList: true,
      subtree: true,
    });
  }
})();
