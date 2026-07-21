(() => {
  "use strict";

  const featureGroups = [
    {
      id: "options-simulation",
      eyebrow: "옵션 · 복합상품",
      title: "옵션과 시뮬레이션",
      description: "바닐라 옵션부터 복잡한 전환 조건까지 모형의 범위를 구분해 준비합니다.",
      features: [
        {
          code: "BS",
          title: "블랙–숄즈 옵션가치평가",
          description:
            "유럽형 콜·풋 옵션의 이론가와 델타·감마·베가 등 주요 민감도를 계산합니다.",
          tags: ["유럽형 옵션", "콜·풋", "Greeks"],
          status: "1순위 구현",
          tone: "priority",
        },
        {
          code: "MC",
          title: "몬테카를로 시뮬레이션",
          description:
            "주가·금리·변동성 경로를 반복 생성해 복잡한 권리와 조건부 지급액의 가치 범위를 분석합니다.",
          tags: ["확률 경로", "신뢰구간", "민감도"],
          status: "공통 엔진 예정",
          tone: "engine",
        },
        {
          code: "CB",
          title: "전환사채 가치평가",
          description:
            "일반채권 가치와 전환권을 나누고 조기상환·콜·풋·리픽싱 조건을 반영합니다.",
          tags: ["채권 + 전환권", "리픽싱", "조기행사"],
          status: "고급모형 설계",
          tone: "design",
        },
      ],
    },
    {
      id: "fixed-income",
      eyebrow: "채권 · 파생상품",
      title: "금리상품 가치평가",
      description: "기준가격과 금리위험을 구분하고, 현금흐름과 커브를 일관되게 연결합니다.",
      features: [
        {
          code: "D+C",
          title: "채권 가격·금리 민감도",
          description:
            "기준가격은 쿠폰과 원금을 할인해 구하고, 듀레이션·볼록성으로 금리변동 시 가격을 조정합니다.",
          tags: ["수정 듀레이션", "볼록성", "금리충격"],
          status: "모형 확정",
          tone: "ready",
        },
        {
          code: "IRS",
          title: "스왑계약 가치평가",
          description:
            "고정·변동 레그의 현재가치를 비교해 이자율스왑의 순가치와 공정고정금리를 계산합니다.",
          tags: ["이자율스왑", "고정·변동 레그", "DV01"],
          status: "커브 설계",
          tone: "design",
        },
      ],
    },
    {
      id: "merger",
      eyebrow: "M&A 거래",
      title: "합병 가치평가",
      description: "기업가치, 주당가치와 회계상 이전대가를 서로 다른 결과로 구분합니다.",
      features: [
        {
          code: "M&A",
          title: "합병·주식교환 분석",
          description:
            "합병 시너지의 현재가치, 협상 가능한 주식교환비율, 현금·주식·조건부대가의 취득일 공정가치를 분석합니다.",
          tags: ["합병 시너지", "주식교환비율", "합병대가 공정가치"],
          status: "거래모형 설계",
          tone: "design",
        },
      ],
    },
  ];

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const featureCard = (feature, groupId, index) => {
    const titleId = `phase3-${groupId}-${index}-title`;
    return `
      <article class="phase3-feature-card" aria-labelledby="${escapeHtml(titleId)}">
        <div class="phase3-feature-topline">
          <span class="phase3-code" aria-hidden="true">${escapeHtml(feature.code)}</span>
          <span class="phase3-status ${escapeHtml(feature.tone)}" aria-label="상태: ${escapeHtml(feature.status)}">
            ◷ ${escapeHtml(feature.status)}
          </span>
        </div>
        <h4 id="${escapeHtml(titleId)}">${escapeHtml(feature.title)}</h4>
        <p>${escapeHtml(feature.description)}</p>
        <div class="phase3-tags" aria-label="포함 기능">
          ${feature.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
        </div>
        <button type="button" disabled aria-disabled="true">Phase 3 · 구현 예정</button>
      </article>
    `;
  };

  const renderHub = () => `
    <div class="phase3-hub-inner">
      <section class="phase3-hero" aria-labelledby="phase3-hub-title">
        <div>
          <span class="phase3-kicker">PHASE 3</span>
          <h2 id="phase3-hub-title" tabindex="-1">고급 가치평가</h2>
          <p>복잡한 금융상품과 거래 가치평가 기능을 순차적으로 준비하고 있어요.</p>
        </div>
        <div class="phase3-hero-summary">
          <strong>6개 기능</strong>
          <span>설계 반영 · 구현 예정</span>
        </div>
      </section>

      <div class="phase3-roadmap" aria-label="Phase 3 구현 순서">
        <span class="active"><b>3A</b> 시장모형</span>
        <span><b>3B</b> 금리·복합상품</span>
        <span><b>3C</b> M&amp;A 거래</span>
      </div>

      ${featureGroups
        .map(
          (group) => `
            <section class="phase3-group" aria-labelledby="phase3-${escapeHtml(group.id)}-title">
              <header>
                <span>${escapeHtml(group.eyebrow)}</span>
                <h3 id="phase3-${escapeHtml(group.id)}-title">${escapeHtml(group.title)}</h3>
                <p>${escapeHtml(group.description)}</p>
              </header>
              <div class="phase3-feature-grid count-${group.features.length}">
                ${group.features
                  .map((feature, index) => featureCard(feature, group.id, index))
                  .join("")}
              </div>
            </section>
          `,
        )
        .join("")}

      <aside class="phase3-method-note" aria-labelledby="phase3-method-note-title">
        <div class="phase3-method-note-icon" aria-hidden="true">i</div>
        <div>
          <strong id="phase3-method-note-title">모형을 섞지 않고 정확하게 만들 예정입니다</strong>
          <ul>
            <li>이항모형은 제거하고, 바닐라 옵션은 블랙–숄즈 모델로 대체합니다.</li>
            <li>전환사채의 조기행사·리픽싱은 블랙–숄즈가 아닌 별도 시뮬레이션 모형으로 설계합니다.</li>
            <li>채권 기준가격과 듀레이션·볼록성에 의한 금리변동 가격은 구분해 보여줍니다.</li>
          </ul>
        </div>
      </aside>
    </div>
  `;

  const renderBetaRoadmap = () => `
    <section class="beta-risk-roadmap" aria-labelledby="beta-risk-roadmap-title">
      <div class="beta-risk-roadmap-heading">
        <div>
          <span>PHASE 3 확장 예정</span>
          <h3 id="beta-risk-roadmap-title">고급 위험·포트폴리오 조정</h3>
        </div>
        <b>계산기는 별도 구성</b>
      </div>
      <div class="beta-risk-roadmap-grid">
        <article>
          <span class="beta-risk-code">βA</span>
          <div>
            <strong>자산 베타 고도화</strong>
            <p>부채베타를 포함한 자산 베타, 비교기업 가중치와 목표 자본구조 재레버링을 연결합니다.</p>
          </div>
          <small>◷ 준비 중</small>
        </article>
        <article>
          <span class="beta-risk-code">D</span>
          <div>
            <strong>자산 포트폴리오 듀레이션 조정</strong>
            <p>시장가치 가중 듀레이션과 DV01을 집계하고 목표 듀레이션에 필요한 조정 규모를 제안합니다.</p>
          </div>
          <small>◷ 준비 중</small>
        </article>
      </div>
      <p class="beta-risk-roadmap-note">베타는 시장위험, 듀레이션은 금리위험을 측정하므로 하나의 산식에 섞지 않습니다.</p>
    </section>
  `;

  const replaceNavText = (item, label) => {
    const textNodes = Array.from(item.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim(),
    );
    const target = textNodes.at(-1);
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
    const title = header.querySelector("h2");
    const description = header.querySelector("p");
    if (title && title.textContent.trim() !== "Phase 3 고급 가치평가") {
      title.textContent = "Phase 3 고급 가치평가";
    }
    if (
      description &&
      description.textContent.trim() !==
        "옵션·복합상품, 채권·파생상품과 M&A 거래 분석 기능을 준비하고 있습니다."
    ) {
      description.textContent =
        "옵션·복합상품, 채권·파생상품과 M&A 거래 분석 기능을 준비하고 있습니다.";
    }
  };

  const mountPhase3Hub = (source) => {
    source.classList.add("phase3-legacy-source");
    let host = source.previousElementSibling;
    const isNew = !host?.classList.contains("phase3-hub");
    if (isNew) {
      host = document.createElement("div");
      host.className = "phase3-hub";
      host.innerHTML = renderHub();
      source.before(host);
    }

    updateHeader(source);

    if (isNew) {
      const title = host.querySelector("#phase3-hub-title");
      try {
        title?.focus({ preventScroll: true });
      } catch {
        // The roadmap remains usable if programmatic focus is unsupported.
      }
    }
  };

  const updateAssetBetaLabels = (purePlay) => {
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

  const addBetaRiskRoadmap = () => {
    const purePlay = document.querySelector(".pure-play-container");
    if (!purePlay) return;

    updateAssetBetaLabels(purePlay);
    if (purePlay.querySelector(".beta-risk-roadmap")) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderBetaRoadmap().trim();
    const roadmap = wrapper.firstElementChild;
    const auditGuide = purePlay.querySelector(".audit-beta-guide");
    if (auditGuide) auditGuide.after(roadmap);
    else purePlay.prepend(roadmap);
  };

  let syncQueued = false;

  const syncPage = () => {
    syncQueued = false;
    updateNavigation();
    addBetaRiskRoadmap();

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
