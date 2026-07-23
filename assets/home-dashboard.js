(() => {
  "use strict";

  const DCF_STORAGE_KEY = "value-scanner-guided-dcf-v1";
  const DCF_SNAPSHOT_KEY = "value-scanner-dcf-snapshots-v1";
  const HOME_ONBOARDING_KEY = "value-scanner-home-onboarding-v1";
  const DCF_TOTAL_STEPS = 15;
  const ONBOARDING_TOTAL_STEPS = 4;

  let homeVisible = true;
  let legacyOnboardingAllowed = false;
  let previousActiveNav = null;
  let syncQueued = false;
  let onboardingAutoChecked = false;
  let onboardingLastFocus = null;
  let onboardingBackgroundState = [];
  let onboardingState = {
    step: 0,
    goal: null,
    waccReady: null,
    advancedFocus: null,
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const safeJson = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };

  const formatSavedDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Seoul",
    }).format(date);
  };

  const formatNumber = (value) =>
    new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Number(value) || 0);

  const readDashboardState = () => {
    const draft = safeJson(DCF_STORAGE_KEY, null);
    const rawSnapshots = safeJson(DCF_SNAPSHOT_KEY, []);
    const snapshots = Array.isArray(rawSnapshots)
      ? rawSnapshots.filter((snapshot) => snapshot && typeof snapshot === "object")
      : [];
    const rawStep = Number(draft?.step);
    const step = Number.isFinite(rawStep)
      ? Math.min(Math.max(Math.trunc(rawStep), 0), DCF_TOTAL_STEPS)
      : 0;
    const hasDraft = Boolean(draft && typeof draft === "object");
    const isResult = hasDraft && step === DCF_TOTAL_STEPS;
    const progress = hasDraft
      ? Math.round((step / DCF_TOTAL_STEPS) * 100)
      : 0;
    const latestSnapshot = snapshots[snapshots.length - 1] || null;
    const rawEnterpriseValue = Number(latestSnapshot?.result?.enterpriseValue);
    const rawWacc = Number(draft?.wacc);
    const rawRevenue = Number(draft?.revenue);

    return {
      hasDraft,
      step,
      isResult,
      progress,
      snapshotCount: snapshots.length,
      latestVersion: Number(latestSnapshot?.version) || null,
      latestSavedAt: formatSavedDate(latestSnapshot?.savedAt),
      latestEnterpriseValue: Number.isFinite(rawEnterpriseValue) ? rawEnterpriseValue : null,
      wacc: hasDraft && Number.isFinite(rawWacc) ? rawWacc : null,
      revenue: hasDraft && Number.isFinite(rawRevenue) ? rawRevenue : null,
    };
  };

  const renderLegacyDashboard = () => {
    const activity = readDashboardState();
    const dcfActionLabel = activity.isResult
      ? "DCF 결과 보기"
      : activity.hasDraft
        ? "DCF 이어서 하기"
        : "DCF 분석 시작";
    const dcfStatus = activity.isResult && activity.snapshotCount
      ? "DCF 분석 완료"
      : activity.isResult
        ? "결과 확인 단계"
      : activity.hasDraft
        ? `${activity.step} / ${DCF_TOTAL_STEPS} 단계 완료`
        : "아직 시작 전";
    const latestSnapshotParts = activity.snapshotCount
      ? [
          `최근 버전 ${activity.latestVersion}`,
          activity.latestEnterpriseValue !== null
            ? `기업가치 ${formatNumber(activity.latestEnterpriseValue)}억원`
            : "",
          activity.latestSavedAt,
        ].filter(Boolean)
      : [];
    const snapshotDescription = activity.snapshotCount
      ? latestSnapshotParts.join(" · ")
      : "계산을 완료하면 버전별로 보관돼요";

    return `
      <div class="home-dashboard-inner">
        <section class="home-hero" aria-labelledby="home-dashboard-title">
          <div class="home-hero-copy">
            <span class="home-kicker">VALUE SCANNER</span>
            <h2 id="home-dashboard-title" tabindex="-1">기업가치 평가, 어디서 시작할지부터 안내해요</h2>
            <p>
              베타와 WACC부터 DCF, 고급 금융상품과 M&amp;A까지 복잡한 가치평가를
              이해하기 쉬운 질문과 검토 순서로 진행하는 도구입니다.
            </p>
            <div class="home-hero-actions">
              <button type="button" class="primary" data-home-go="wacc">처음부터 WACC 계산</button>
              <button type="button" class="secondary" data-home-go="dcf">${escapeHtml(dcfActionLabel)}</button>
              <button type="button" class="tertiary" data-home-onboarding-action="open">사용 가이드</button>
            </div>
            <small>처음이라면 베타·WACC를 먼저 계산한 뒤 DCF로 이어가는 것을 권장해요.</small>
          </div>
          <div class="home-hero-flow" aria-label="추천 가치평가 순서">
            <div class="home-flow-row active">
              <span>1</span>
              <div><strong>위험 측정</strong><small>비교기업 베타와 자본구조</small></div>
              <b>β</b>
            </div>
            <div class="home-flow-row">
              <span>2</span>
              <div><strong>할인율 계산</strong><small>자기자본비용과 WACC</small></div>
              <b>WACC</b>
            </div>
            <div class="home-flow-row">
              <span>3</span>
              <div><strong>기업가치 산정</strong><small>FCFF와 영구가치 민감도</small></div>
              <b>DCF</b>
            </div>
          </div>
        </section>

        <section class="home-section" aria-labelledby="home-actions-title">
          <header class="home-section-header">
            <div>
              <span>빠른 시작</span>
              <h3 id="home-actions-title">지금 무엇을 하고 싶나요?</h3>
            </div>
            <p>목적을 고르면 필요한 화면으로 바로 이동합니다.</p>
          </header>
          <div class="home-action-grid">
            <button type="button" class="home-action-card" data-home-go="wacc">
              <span class="home-action-code purple" aria-hidden="true">β</span>
              <span class="home-action-status available">추천 · 사용 가능</span>
              <strong>처음부터 분석할래요</strong>
              <small>비교기업 베타를 정하고 WACC를 계산한 뒤 DCF로 이어가요.</small>
              <b>베타·WACC부터 시작 →</b>
            </button>
            <button type="button" class="home-action-card" data-home-go="dcf">
              <span class="home-action-code green" aria-hidden="true">DCF</span>
              <span class="home-action-status available">사용 가능</span>
              <strong>WACC는 이미 있어요</strong>
              <small>현재 매출부터 한 질문씩 답하고 기업가치와 민감도를 확인해요.</small>
              <b>${escapeHtml(dcfActionLabel)} →</b>
            </button>
            <button type="button" class="home-action-card" data-home-go="phase3">
              <span class="home-action-code amber" aria-hidden="true">P3</span>
              <span class="home-action-status available">6개 사용 가능</span>
              <strong>고급 가치평가가 필요해요</strong>
              <small>옵션·전환사채·채권·포트폴리오·스왑을 계산하고 M&amp;A 준비상태를 확인해요.</small>
              <b>고급기능 시작 →</b>
            </button>
          </div>
        </section>

        <div class="home-lower-grid">
          <section class="home-section home-activity" aria-labelledby="home-activity-title">
            <header class="home-section-header compact">
              <div>
                <span>내 분석 현황</span>
                <h3 id="home-activity-title">이 브라우저에 저장된 작업</h3>
              </div>
            </header>
            <div class="home-activity-grid">
              <article>
                <div class="home-activity-topline">
                  <span>DCF 진행 상태</span>
                  <strong>${escapeHtml(dcfStatus)}</strong>
                </div>
                <div class="home-progress-track" aria-label="DCF 진행률 ${activity.progress}%">
                  <span style="width:${activity.progress}%"></span>
                </div>
                <button type="button" data-home-go="dcf">${escapeHtml(dcfActionLabel)}</button>
              </article>
              <article>
                <div class="home-activity-topline">
                  <span>저장된 DCF 결과</span>
                  <strong>${activity.snapshotCount}개</strong>
                </div>
                <p>${escapeHtml(snapshotDescription)}</p>
                <small>최대 최근 20개 버전을 기기에 보관합니다.</small>
              </article>
            </div>
          </section>

          <section class="home-section home-next-steps" aria-labelledby="home-next-title">
            <header class="home-section-header compact">
              <div>
                <span>추천 분석 흐름</span>
                <h3 id="home-next-title">결과를 더 탄탄하게 만드는 순서</h3>
              </div>
            </header>
            <ol>
              <li><span>1</span><div><strong>베타·WACC</strong><small>시장위험과 할인율 근거 정리</small></div></li>
              <li><span>2</span><div><strong>DCF</strong><small>사업계획과 FCFF 연결 검토</small></div></li>
              <li class="planned"><span>3</span><div><strong>멀티플 교차검증</strong><small>Phase 2 구현 예정</small></div></li>
              <li><span>4</span><div><strong>고급 가치평가</strong><small>옵션·복합상품·금리위험 6개 계산기 사용 가능</small></div></li>
            </ol>
          </section>
        </div>

        <aside class="home-trust-note">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>숫자만 계산하지 않고 근거까지 남겨요</strong>
            <p>평가기준일, 가정의 출처, 중간 FCFF와 민감도 결과를 함께 검토하도록 구성했습니다.</p>
          </div>
        </aside>

        <div class="home-onboarding-layer" data-home-onboarding-layer hidden></div>
      </div>
    `;
  };

  const renderDashboard = () => {
    const activity = readDashboardState();
    const dcfActionLabel = activity.isResult
      ? "DCF 결과 보기"
      : activity.hasDraft
        ? "DCF 이어서 하기"
        : "DCF 분석 시작";
    const recentLabel = activity.latestSavedAt || "아직 저장된 결과가 없어요";
    const nextTitle = activity.hasDraft
      ? "진행 중인 DCF부터 이어갈까요?"
      : "어떤 가치를 계산하려고 하나요?";
    const nextDescription = activity.hasDraft
      ? `저장된 ${activity.step}단계부터 이어서 진행할 수 있어요. 다른 분석이 필요하면 새 경로를 선택하세요.`
      : "목적을 하나 고르면 필요한 계산을 가장 알맞은 순서로 안내해 드려요.";

    return `
      <div class="home-dashboard-inner talkdata-home">
        <aside class="talkdata-sidebar" aria-label="Value Scanner 빠른 메뉴">
          <div class="talkdata-workspace-card">
            <span aria-hidden="true">VS</span>
            <div><strong>Valuation Workspace</strong><small>브라우저에 자동 저장</small></div>
          </div>

          <button type="button" class="talkdata-new-analysis" data-home-onboarding-action="open">
            <span aria-hidden="true">＋</span> 새 분석 경로
          </button>

          <div class="talkdata-divider" aria-hidden="true"></div>

          <div class="talkdata-sidebar-brand">
            <span class="aurelius-brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
            <div><strong>Value Scanner</strong><small>기업가치 분석 시스템</small></div>
          </div>

          <nav class="talkdata-menu" aria-label="분석 메뉴">
            <button type="button" class="active" aria-current="page"><span aria-hidden="true">●</span> 분석 개요</button>
            <button type="button" data-home-go="wacc"><span aria-hidden="true">β</span> WACC 계산하기</button>
            <button type="button" data-home-go="dcf"><span aria-hidden="true">◆</span> DCF 분석</button>
            <button type="button" data-home-go="multiples"><span aria-hidden="true">≋</span> 멀티플</button>
            <button type="button" data-home-go="phase3"><span aria-hidden="true">□</span> 고급 가치평가</button>
          </nav>

          <div class="talkdata-side-status">
            <span><i aria-hidden="true"></i> 로컬 저장 정상</span>
            <small>${escapeHtml(recentLabel)}</small>
          </div>
        </aside>

        <main class="talkdata-main">
          <section class="talkdata-intro" aria-labelledby="home-dashboard-title">
            <header>
              <h2 id="home-dashboard-title" tabindex="-1">Value Scanner</h2>
              <p>데이터와 대화하듯 기업가치를 분석하세요</p>
              <small>한 번에 한 가지 질문만 답하면 다음 계산으로 이어집니다</small>
            </header>

            <div class="talkdata-command talkdata-next-step" role="group" aria-labelledby="home-next-title">
              <span class="talkdata-command-icon" aria-hidden="true">⌕</span>
              <div>
                <strong id="home-next-title">${escapeHtml(nextTitle)}</strong>
                <small>${escapeHtml(nextDescription)}</small>
              </div>
              <button type="button" ${activity.hasDraft ? 'data-home-go="dcf"' : 'data-home-onboarding-action="open"'}>
                ${activity.hasDraft ? escapeHtml(dcfActionLabel) : "분석 경로 찾기"} <span aria-hidden="true">→</span>
              </button>
            </div>

            ${activity.hasDraft ? `
              <button type="button" class="talkdata-secondary-path" data-home-onboarding-action="open">
                다른 분석 경로 선택
              </button>
            ` : ""}
          </section>
        </main>

        <div class="home-onboarding-layer" data-home-onboarding-layer hidden></div>
      </div>
    `;
  };

  const onboardingGoalLabels = {
    full: "기업가치 평가",
    wacc: "WACC 계산하기",
    dcf: "DCF를 바로 진행",
    advanced: "고급 금융상품·M&A 분석",
  };

  const advancedFocusLabels = {
    options: "옵션 가치평가",
    convertible: "전환사채·몬테카를로",
    bond: "채권·듀레이션·볼록성",
    swap: "이자율스왑",
    merger: "합병·주식교환",
    portfolio: "자산베타·포트폴리오 금리위험",
  };

  const onboardingChoice = ({ field, value, code, title, description }) => `
    <button
      type="button"
      class="home-onboarding-choice ${onboardingState[field] === value ? "selected" : ""}"
      data-home-onboarding-choice="${escapeHtml(field)}"
      data-home-onboarding-value="${escapeHtml(value)}"
      aria-pressed="${onboardingState[field] === value}"
    >
      <span aria-hidden="true">${escapeHtml(code)}</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </div>
      <b aria-hidden="true">${onboardingState[field] === value ? "✓" : ""}</b>
    </button>
  `;

  const onboardingRecommendation = () => {
    if (onboardingState.goal === "advanced") {
      const focus = advancedFocusLabels[onboardingState.advancedFocus] || "고급 가치평가";
      const optionsAvailable = onboardingState.advancedFocus === "options";
      const convertibleAvailable = onboardingState.advancedFocus === "convertible";
      const bondAvailable = onboardingState.advancedFocus === "bond";
      const portfolioAvailable = onboardingState.advancedFocus === "portfolio";
      const swapAvailable = onboardingState.advancedFocus === "swap";
      const preparation = {
        options: ["기초자산 가격과 행사가격", "만기와 변동성", "무위험수익률과 배당수익률"],
        convertible: ["액면·쿠폰·만기", "전환가액과 주가·변동성", "콜·풋·리픽싱 조건", "신용스프레드"],
        bond: ["액면·쿠폰·만기와 지급주기", "평가기준일 수익률곡선", "금리 충격 시나리오"],
        swap: ["명목금액·고정금리", "변동금리 지표와 리셋 조건", "지급일정·할인 및 포워드 커브"],
        merger: ["양사의 독립 기업가치", "발행주식수와 합병대가 구조", "예상 시너지·실현비용", "거래조건과 평가기준일"],
        portfolio: ["보유자산별 시장가치와 베타", "현금흐름 시점과 수익률", "목표 듀레이션", "금리변동 시나리오"],
      }[onboardingState.advancedFocus] || ["계약조건", "시장 가정", "평가기준일 자료"];
      return {
        destination: "phase3",
        eyebrow: focus,
        title: optionsAvailable
          ? "블랙–숄즈 계산기부터 시작해 보세요"
          : convertibleAvailable
            ? "전환사채 계산기와 몬테카를로를 사용할 수 있어요"
            : bondAvailable
              ? "채권 가격과 YTM·금리위험을 계산해 보세요"
              : portfolioAvailable
                ? "시장베타와 금리위험 장부를 따로 점검해 보세요"
                : swapAvailable
                  ? "이자율스왑의 두 레그와 순가치를 계산해 보세요"
            : "Phase 3 로드맵에서 구현 순서를 확인해 보세요",
        description: optionsAvailable
          ? "유럽형 콜·풋의 이론가, Greeks와 민감도를 한 질문씩 계산할 수 있어요."
          : convertibleAvailable
            ? "일반채권과 전환권을 나눈 전환사채 기준가, 그리고 옵션 경로 시뮬레이션을 단계별로 계산할 수 있어요."
            : bondAvailable
              ? "Clean·Dirty 가격, YTM 역산, 듀레이션·볼록성·DV01과 금리충격을 한 질문씩 계산할 수 있어요."
              : portfolioAvailable
                ? "시장가치 가중 베타와 포트폴리오 듀레이션·DV01을 두 장부로 나눠 계산할 수 있어요."
                : swapAvailable
                  ? "고정·변동 레그 현재가치, 공정고정금리, DV01과 평행 금리 시나리오를 계산할 수 있어요."
            : "필요한 모형과 입력자료를 확인한 뒤 기능별 구현 순서에 맞춰 준비할 수 있어요.",
        route: optionsAvailable
          ? ["고급 가치평가", "블랙–숄즈", "단계별 계산"]
          : convertibleAvailable
            ? ["고급 가치평가", "전환사채", "채권·전환권 분리"]
            : bondAvailable
              ? ["고급 가치평가", "채권 가격·금리위험", "단계별 계산"]
              : portfolioAvailable
                ? ["고급 가치평가", "포트폴리오 위험", "시장·금리 장부 분리"]
                : swapAvailable
                  ? ["고급 가치평가", "이자율스왑", "레그·순가치 분석"]
            : ["고급 가치평가", focus, "구현 예정 확인"],
        preparation,
        action: optionsAvailable
          ? "블랙–숄즈 계산기로 이동"
          : convertibleAvailable
            ? "전환사채 계산기로 이동"
            : bondAvailable
              ? "채권 계산기로 이동"
              : portfolioAvailable
                ? "포트폴리오 위험 계산기로 이동"
                : swapAvailable
                  ? "이자율스왑 계산기로 이동"
            : "Phase 3 로드맵 보기",
        note: optionsAvailable
          ? "현재 블랙–숄즈, 몬테카를로와 전환사채 계산기를 사용할 수 있으며 다른 고급 기능은 순차 구현됩니다."
          : convertibleAvailable
            ? "전환사채와 몬테카를로 계산기를 지금 사용할 수 있습니다. 복잡한 콜·풋·미래 리픽싱은 전환사채 단순모형 범위에서 제외됩니다."
            : bondAvailable
              ? "정규 고정금리·무이표 채권을 지원합니다. 콜·풋·변동금리·비정규 쿠폰은 별도 모형이 필요합니다."
              : portfolioAvailable
                ? "시장위험과 금리위험은 서로 다른 장부와 충격을 사용하므로 결과를 합산하지 않습니다."
                : swapAvailable
                  ? "신규 또는 변동금리 리셋 직후의 표준 단일통화 스왑을 단일 곡선으로 평가합니다."
                  : "옵션·전환사채·채권·포트폴리오 위험·스왑 계산기는 현재 사용 가능하며 M&A 기능을 준비하고 있습니다.",
      };
    }

    if (onboardingState.goal === "wacc") {
      return {
        destination: "wacc",
        eyebrow: onboardingGoalLabels.wacc,
        title: "베타에서 WACC까지 근거를 정리하세요",
        description: "비교기업의 시장위험을 대상 회사의 자본구조에 맞게 조정해 검토 가능한 할인율을 계산해요.",
        route: ["비교기업 베타", "자산베타·재레버링", "자기자본비용·WACC"],
        preparation: ["비교기업 후보와 선정 이유", "베타 출처·기준일·측정조건", "시장가치 기준 부채·자기자본", "법인세율과 세전 차입원가", "무위험수익률과 시장위험프리미엄"],
        action: "WACC 계산 시작",
        note: "계산값과 함께 비교기업, 기준일과 가정 근거를 메모해 두면 외부 검토에 유용해요.",
      };
    }

    if (onboardingState.waccReady === "yes") {
      const activity = readDashboardState();
      return {
        destination: "dcf",
        eyebrow: onboardingGoalLabels[onboardingState.goal] || "DCF 분석",
        title: "질문형 DCF에서 바로 시작하세요",
        description: "현재 매출부터 한 질문씩 입력하고 FCFF, 영구가치와 민감도를 차례로 검토해요.",
        route: ["WACC 확인", "15단계 DCF", "가정 검토·버전 저장"],
        preparation: ["WACC 값·기준일·산출 근거", "현재 매출액과 성장률", "영업이익률과 법인세율", "감가상각비·CAPEX·운전자본", "영구성장률 근거"],
        action: activity.isResult
          ? "저장한 DCF 결과 보기"
          : activity.hasDraft
            ? "저장한 DCF 이어서 하기"
            : "DCF 질문형 분석 시작",
        note: activity.isResult
          ? "완료한 DCF 결과와 저장 버전을 엽니다. 다른 회사를 평가하려면 아래에서 새 DCF를 시작하세요."
          : activity.hasDraft
            ? "진행 중인 DCF 입력값과 단계에서 이어집니다. 다른 회사를 평가하려면 아래에서 새 DCF를 시작하세요."
            : "입력값과 진행 단계는 이 브라우저에 자동 저장됩니다.",
      };
    }

    return {
      destination: "wacc",
      eyebrow: onboardingGoalLabels[onboardingState.goal] || "처음부터 분석",
      title: "베타·WACC부터 차근차근 시작하세요",
      description: "업종 또는 비교기업으로 시장위험을 정리하고, 목표 자본구조에 맞는 할인율을 먼저 계산해요.",
      route: ["회사·업종 선택", "자산 베타·재레버링", "WACC → DCF"],
      preparation: ["평가 대상 업종 또는 비교기업", "베타 출처·기준일·측정조건", "시장가치 기준 부채·자기자본", "법인세율과 세전 차입원가", "무위험수익률과 시장위험프리미엄"],
      action: "회사·업종 설정 시작",
      note: "다음 화면에서 회사와 업종을 선택하고 베타·WACC 계산을 시작할 수 있어요.",
    };
  };

  const renderOnboardingStep = () => {
    switch (onboardingState.step) {
      case 0:
        return `
          <div class="home-onboarding-welcome-mark" aria-hidden="true">VS</div>
          <span class="home-onboarding-eyebrow">처음 오셨나요?</span>
          <h3 id="home-onboarding-title" tabindex="-1">Value Scanner 사용 순서를 맞춰드릴게요</h3>
          <p class="home-onboarding-description" id="home-onboarding-description">
            복잡한 메뉴를 먼저 공부할 필요 없이, 현재 목적과 준비된 자료를 고르면 가장 알맞은 시작 화면을 안내합니다.
          </p>
          <div class="home-onboarding-benefits">
            <div><span>1</span><strong>목적 선택</strong><small>무엇을 평가할지 정해요</small></div>
            <div><span>2</span><strong>준비 확인</strong><small>WACC과 자료 상태를 확인해요</small></div>
            <div><span>3</span><strong>바로 시작</strong><small>맞춤 화면으로 이동해요</small></div>
          </div>
        `;
      case 1:
        return `
          <span class="home-onboarding-eyebrow">분석 목적</span>
          <h3 id="home-onboarding-title" tabindex="-1">지금 어떤 분석이 필요한가요?</h3>
          <p class="home-onboarding-description" id="home-onboarding-description">가장 가까운 항목 하나를 선택해 주세요. 나중에 언제든 다른 기능으로 이동할 수 있어요.</p>
          <div class="home-onboarding-choice-list" role="group" aria-labelledby="home-onboarding-title">
            ${onboardingChoice({
              field: "goal",
              value: "full",
              code: "01",
              title: "회사가 얼마인지 알고 싶어요",
              description: "준비 상태를 확인해 WACC 또는 DCF부터 기업가치를 평가합니다.",
            })}
            ${onboardingChoice({
              field: "goal",
              value: "wacc",
              code: "02",
              title: "할인율·WACC가 필요해요",
              description: "베타와 자본구조 근거를 정리해 검토 가능한 할인율을 계산합니다.",
            })}
            ${onboardingChoice({
              field: "goal",
              value: "dcf",
              code: "03",
              title: "DCF 분석을 진행하고 싶어요",
              description: "할인율 준비 상태를 확인한 뒤 질문형 DCF로 이동합니다.",
            })}
            ${onboardingChoice({
              field: "goal",
              value: "advanced",
              code: "04",
              title: "금융상품이나 M&A를 평가하고 싶어요",
              description: "옵션·복합상품·금리위험 계산기를 사용하거나 M&A 기능 계획을 확인합니다.",
            })}
          </div>
        `;
      case 2:
        if (onboardingState.goal === "advanced") {
          return `
            <span class="home-onboarding-eyebrow">고급 분석 분야</span>
            <h3 id="home-onboarding-title" tabindex="-1">어떤 분야를 준비하고 있나요?</h3>
            <p class="home-onboarding-description" id="home-onboarding-description">선택한 분야에 맞춰 앞으로 준비할 계약조건과 시장자료를 알려드릴게요.</p>
            <div class="home-onboarding-choice-list" role="group" aria-labelledby="home-onboarding-title">
              ${onboardingChoice({
                field: "advancedFocus",
                value: "options",
                code: "BS",
                title: "옵션 가치평가",
                description: "블랙–숄즈 옵션 프라이싱 모델",
              })}
              ${onboardingChoice({
                field: "advancedFocus",
                value: "convertible",
                code: "CB",
                title: "전환사채·몬테카를로",
                description: "전환사채 분리모형과 몬테카를로 모두 사용 가능",
              })}
              ${onboardingChoice({
                field: "advancedFocus",
                value: "bond",
                code: "D+C",
                title: "채권 가격·금리위험",
                description: "Clean·Dirty 가격, YTM 역산과 듀레이션·볼록성 사용 가능",
              })}
              ${onboardingChoice({
                field: "advancedFocus",
                value: "swap",
                code: "IRS",
                title: "스왑계약",
                description: "고정·변동 레그, 공정고정금리와 DV01 사용 가능",
              })}
              ${onboardingChoice({
                field: "advancedFocus",
                value: "merger",
                code: "M&A",
                title: "합병·주식교환",
                description: "시너지, 교환비율과 합병대가 공정가치",
              })}
              ${onboardingChoice({
                field: "advancedFocus",
                value: "portfolio",
                code: "β+D",
                title: "자산베타·포트폴리오 조정",
                description: "시장가치 가중 베타와 듀레이션·DV01 장부 사용 가능",
              })}
            </div>
          `;
        }
        if (onboardingState.goal === "wacc") {
          return `
            <span class="home-onboarding-eyebrow">베타 자료 준비</span>
            <h3 id="home-onboarding-title" tabindex="-1">베타·WACC 자료가 어느 정도 준비됐나요?</h3>
            <p class="home-onboarding-description" id="home-onboarding-description">준비 수준과 관계없이 WACC 계산 화면으로 안내하고 필요한 근거를 함께 보여드려요.</p>
            <div class="home-onboarding-choice-list" role="group" aria-labelledby="home-onboarding-title">
              ${onboardingChoice({
                field: "waccReady",
                value: "yes",
                code: "✓",
                title: "비교기업과 베타 자료가 있어요",
                description: "산출 근거를 확인하며 바로 WACC를 계산합니다.",
              })}
              ${onboardingChoice({
                field: "waccReady",
                value: "no",
                code: "½",
                title: "비교기업만 정해두었어요",
                description: "베타 출처와 자본구조 자료부터 채워갑니다.",
              })}
              ${onboardingChoice({
                field: "waccReady",
                value: "unsure",
                code: "?",
                title: "아직 준비된 자료가 없어요",
                description: "필요한 자료 목록을 확인한 뒤 아는 값부터 시작합니다.",
              })}
            </div>
          `;
        }
        return `
          <span class="home-onboarding-eyebrow">할인율 준비</span>
          <h3 id="home-onboarding-title" tabindex="-1">사용할 WACC를 이미 가지고 있나요?</h3>
          <p class="home-onboarding-description" id="home-onboarding-description">확실하지 않다면 먼저 WACC를 계산하는 경로가 안전합니다.</p>
          <div class="home-onboarding-choice-list" role="group" aria-labelledby="home-onboarding-title">
            ${onboardingChoice({
              field: "waccReady",
              value: "yes",
              code: "✓",
              title: "네, 검토된 WACC가 있어요",
              description: "질문형 DCF에서 바로 기업가치 분석을 시작합니다.",
            })}
            ${onboardingChoice({
              field: "waccReady",
              value: "no",
              code: "β",
              title: "아니요, 아직 계산하지 않았어요",
              description: "비교기업 베타와 자본구조부터 차근차근 계산합니다.",
            })}
            ${onboardingChoice({
              field: "waccReady",
              value: "unsure",
              code: "?",
              title: "잘 모르겠어요",
              description: "추천 경로와 준비자료를 확인한 뒤 WACC 화면으로 이동합니다.",
            })}
          </div>
        `;
      case 3: {
        const recommendation = onboardingRecommendation();
        return `
          <span class="home-onboarding-eyebrow">${escapeHtml(recommendation.eyebrow)}</span>
          <h3 id="home-onboarding-title" tabindex="-1">${escapeHtml(recommendation.title)}</h3>
          <p class="home-onboarding-description" id="home-onboarding-description">${escapeHtml(recommendation.description)}</p>
          <div class="home-onboarding-route" aria-label="추천 진행 경로">
            ${recommendation.route
              .map(
                (item, index) => `
                  <div><span>${index + 1}</span><strong>${escapeHtml(item)}</strong></div>
                  ${index < recommendation.route.length - 1 ? '<b aria-hidden="true">→</b>' : ""}
                `,
              )
              .join("")}
          </div>
          <div class="home-onboarding-preparation">
            <strong>미리 준비하면 좋은 자료</strong>
            <ul>${recommendation.preparation.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </div>
          <p class="home-onboarding-note">${escapeHtml(recommendation.note)}</p>
        `;
      }
      default:
        return "";
    }
  };

  const onboardingCanContinue = () => {
    if (onboardingState.step === 1) return Boolean(onboardingState.goal);
    if (onboardingState.step === 2) {
      return onboardingState.goal === "advanced"
        ? Boolean(onboardingState.advancedFocus)
        : Boolean(onboardingState.waccReady);
    }
    return true;
  };

  const renderOnboarding = ({ focusHeading = true } = {}) => {
    const layer = document.querySelector("[data-home-onboarding-layer]");
    if (!layer || layer.hidden) return;
    const finalStep = onboardingState.step === ONBOARDING_TOTAL_STEPS - 1;
    const recommendation = finalStep ? onboardingRecommendation() : null;
    const offersNewDcf = finalStep
      && recommendation.destination === "dcf"
      && readDashboardState().hasDraft;
    const progress = ((onboardingState.step + 1) / ONBOARDING_TOTAL_STEPS) * 100;
    layer.innerHTML = `
      <div class="home-onboarding-backdrop" data-home-onboarding-action="close" aria-hidden="true"></div>
      <section
        class="home-onboarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-onboarding-title"
        aria-describedby="home-onboarding-description"
      >
        <header class="home-onboarding-header">
          <div class="home-onboarding-progress-copy">
            <span id="home-onboarding-progress-text">${onboardingState.step + 1} / ${ONBOARDING_TOTAL_STEPS}</span>
            <strong>${["환영", "목적 선택", "준비 확인", "추천 경로"][onboardingState.step]}</strong>
          </div>
          <button type="button" data-home-onboarding-action="close" aria-label="온보딩 닫기">×</button>
          <div
            class="home-onboarding-progress-track"
            role="progressbar"
            aria-labelledby="home-onboarding-progress-text"
            aria-valuemin="1"
            aria-valuemax="${ONBOARDING_TOTAL_STEPS}"
            aria-valuenow="${onboardingState.step + 1}"
            aria-valuetext="${onboardingState.step + 1} / ${ONBOARDING_TOTAL_STEPS} 단계"
          >
            <span style="width:${progress}%"></span>
          </div>
        </header>
        <div class="home-onboarding-body">${renderOnboardingStep()}</div>
        <footer class="home-onboarding-footer">
          <button type="button" class="text" data-home-onboarding-action="skip">건너뛰기</button>
          <div>
            ${
              onboardingState.step > 0
                ? '<button type="button" class="secondary" data-home-onboarding-action="previous">이전</button>'
                : ""
            }
            ${
              offersNewDcf
                ? '<button type="button" class="secondary home-onboarding-new-dcf" data-home-onboarding-action="new-dcf">새 DCF 시작</button>'
                : ""
            }
            <button
              type="button"
              class="primary"
              data-home-onboarding-action="${finalStep ? "finish" : "next"}"
              ${onboardingCanContinue() ? "" : "disabled"}
            >
              ${finalStep ? escapeHtml(recommendation.action) : "다음"}
            </button>
          </div>
        </footer>
      </section>
    `;

    if (focusHeading) {
      try {
        layer.querySelector("#home-onboarding-title")?.focus({ preventScroll: true });
      } catch {
        // Focus management is an enhancement, not a requirement for navigation.
      }
    }
  };

  const saveOnboardingRecord = (status) => {
    try {
      localStorage.setItem(
        HOME_ONBOARDING_KEY,
        JSON.stringify({
          status,
          goal: onboardingState.goal,
          waccReady: onboardingState.waccReady,
          advancedFocus: onboardingState.advancedFocus,
          completedAt: new Date().toISOString(),
        }),
      );
    } catch {
      // The guide remains usable if browser storage is unavailable.
    }
  };

  const setOnboardingBackgroundInert = (shouldDisable) => {
    if (!shouldDisable) {
      onboardingBackgroundState.forEach(({ element, inert, hadInert, ariaHidden }) => {
        if (!element.isConnected) return;
        if (hadInert) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      onboardingBackgroundState = [];
      return;
    }

    if (onboardingBackgroundState.length) return;
    const elements = Array.from(
      document.querySelectorAll(
        ".sidebar, .home-dashboard-inner > :not(.home-onboarding-layer)",
      ),
    );
    onboardingBackgroundState = elements.map((element) => ({
      element,
      inert: Boolean(element.inert),
      hadInert: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    elements.forEach((element) => {
      element.inert = true;
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });
  };

  const openOnboarding = () => {
    const layer = document.querySelector("[data-home-onboarding-layer]");
    if (!layer || !homeVisible || !layer.hidden) return;
    const saved = safeJson(HOME_ONBOARDING_KEY, null);
    onboardingState = {
      step: 0,
      goal: saved?.goal || null,
      waccReady: saved?.waccReady || null,
      advancedFocus: saved?.advancedFocus || null,
    };
    onboardingLastFocus = document.activeElement;
    layer.hidden = false;
    setOnboardingBackgroundInert(true);
    document.body.classList.add("home-onboarding-open");
    renderOnboarding();
  };

  const closeOnboarding = ({ restoreFocus = true } = {}) => {
    const layer = document.querySelector("[data-home-onboarding-layer]");
    if (layer) {
      layer.hidden = true;
      layer.innerHTML = "";
    }
    setOnboardingBackgroundInert(false);
    document.body.classList.remove("home-onboarding-open");
    if (restoreFocus && onboardingLastFocus?.isConnected) {
      try {
        onboardingLastFocus.focus({ preventScroll: true });
      } catch {
        // The dashboard remains usable if focus restoration is unsupported.
      }
    }
    onboardingLastFocus = null;
  };

  const handleOnboardingChoice = (button) => {
    const field = button.dataset.homeOnboardingChoice;
    const value = button.dataset.homeOnboardingValue;
    if (!field || !value || !(field in onboardingState)) return;
    onboardingState[field] = value;
    if (field === "goal") {
      onboardingState.waccReady = null;
      onboardingState.advancedFocus = null;
    }
    renderOnboarding({ focusHeading: false });
    const selected = document.querySelector(
      `[data-home-onboarding-choice="${field}"][data-home-onboarding-value="${value}"]`,
    );
    try {
      selected?.focus({ preventScroll: true });
    } catch {
      // Selection remains visible without programmatic focus.
    }
  };

  const handleOnboardingAction = (action) => {
    switch (action) {
      case "open":
        openOnboarding();
        break;
      case "close":
        closeOnboarding();
        break;
      case "skip":
        saveOnboardingRecord("skipped");
        closeOnboarding();
        break;
      case "previous":
        onboardingState.step = Math.max(0, onboardingState.step - 1);
        renderOnboarding();
        break;
      case "next":
        if (!onboardingCanContinue()) break;
        onboardingState.step = Math.min(
          ONBOARDING_TOTAL_STEPS - 1,
          onboardingState.step + 1,
        );
        renderOnboarding();
        break;
      case "new-dcf":
        if (!confirm("현재 DCF 입력값을 정리하고 새 분석을 시작할까요? 저장된 결과 버전은 유지됩니다.")) break;
        saveOnboardingRecord("completed");
        if (globalThis.ValueScannerGuidedDcf?.startNew) {
          globalThis.ValueScannerGuidedDcf.startNew();
        } else {
          try {
            localStorage.removeItem(DCF_STORAGE_KEY);
          } catch {
            // Navigation still works when browser storage is unavailable.
          }
        }
        closeOnboarding({ restoreFocus: false });
        navigateTo("dcf", { allowLegacyOnboarding: false });
        break;
      case "finish": {
        const recommendation = onboardingRecommendation();
        saveOnboardingRecord("completed");
        closeOnboarding({ restoreFocus: false });
        navigateTo(recommendation.destination, { allowLegacyOnboarding: false });
        break;
      }
      default:
        break;
    }
  };

  const handleOnboardingKeydown = (event) => {
    const layer = document.querySelector("[data-home-onboarding-layer]");
    if (!layer || layer.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeOnboarding();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      layer.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const heading = layer.querySelector("#home-onboarding-title");
    if (event.shiftKey && (document.activeElement === first || document.activeElement === heading)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const maybeOpenOnboarding = () => {
    if (onboardingAutoChecked || !homeVisible) return;
    onboardingAutoChecked = true;
    const record = safeJson(HOME_ONBOARDING_KEY, null);
    if (record?.status === "completed" || record?.status === "skipped") return;
    setTimeout(() => {
      if (homeVisible) openOnboarding();
    }, 0);
  };

  const ensureHomeNavigation = () => {
    const nav = document.querySelector(".sidebar-nav");
    if (!nav) return null;

    let section = nav.querySelector(".home-nav-section");
    if (!section) {
      section = document.createElement("div");
      section.className = "nav-section home-nav-section";
      section.innerHTML = `
        <div class="nav-section-title">시작</div>
        <button
          type="button"
          class="nav-item home-nav-item"
          data-short-label="홈"
          aria-label="홈 대시보드"
        >
          <span class="home-nav-icon" aria-hidden="true"></span>
          <span class="home-nav-label">홈</span>
        </button>
      `;
      nav.prepend(section);
    }

    if (!nav.dataset.homeNavigationReady) {
      nav.dataset.homeNavigationReady = "true";
      nav.addEventListener("click", (event) => {
        const item = event.target.closest(".nav-item");
        if (!item || !nav.contains(item)) return;
        if (item.classList.contains("home-nav-item")) {
          event.preventDefault();
          showDashboard({ focus: true });
        } else {
          const allowOnboarding = false;
          legacyOnboardingAllowed = allowOnboarding;
          if (homeVisible) hideDashboard({ allowOnboarding });
          else syncSupportingUi(false, allowOnboarding);
        }
      });
    }

    return section.querySelector(".home-nav-item");
  };

  const ensureDashboardHost = () => {
    const main = document.querySelector(".main-content");
    if (!main) return null;
    let host = main.querySelector(":scope > .home-dashboard");
    if (!host) {
      host = document.createElement("div");
      host.className = "home-dashboard";
      host.hidden = true;
      host.addEventListener("click", (event) => {
        const choice = event.target.closest("[data-home-onboarding-choice]");
        if (choice && host.contains(choice)) {
          handleOnboardingChoice(choice);
          return;
        }

        const onboardingAction = event.target.closest("[data-home-onboarding-action]");
        if (onboardingAction && host.contains(onboardingAction)) {
          handleOnboardingAction(onboardingAction.dataset.homeOnboardingAction);
          return;
        }

        const button = event.target.closest("[data-home-go]");
        if (!button || !host.contains(button)) return;
        navigateTo(button.dataset.homeGo, { allowLegacyOnboarding: false });
      });
      host.addEventListener("keydown", handleOnboardingKeydown);
      main.prepend(host);
    }
    return host;
  };

  const suppressOriginalNavigation = (homeItem) => {
    const nav = homeItem?.closest(".sidebar-nav");
    if (!nav) return;
    const activeItems = nav.querySelectorAll(".nav-item.active:not(.home-nav-item)");
    activeItems.forEach((item) => {
      previousActiveNav = item;
      item.classList.remove("active");
      item.removeAttribute("aria-current");
    });
    homeItem.classList.add("active");
    homeItem.setAttribute("aria-current", "page");
  };

  const restoreOriginalNavigation = (homeItem) => {
    homeItem?.classList.remove("active");
    homeItem?.removeAttribute("aria-current");
    if (previousActiveNav?.isConnected) {
      previousActiveNav.classList.add("active");
      previousActiveNav.setAttribute("aria-current", "page");
    }
    previousActiveNav = null;
  };

  const syncSupportingUi = () => {
    const suppressLegacyHelp = true;
    document.querySelectorAll(".onboarding-overlay").forEach((overlay) => {
      overlay.classList.toggle("home-onboarding-suppressed", suppressLegacyHelp);
    });
    document.querySelectorAll(".help-button").forEach((button) => {
      button.classList.toggle("home-help-suppressed", suppressLegacyHelp);
    });
  };

  const showDashboard = ({ focus = false } = {}) => {
    homeVisible = true;
    const homeItem = ensureHomeNavigation();
    const host = ensureDashboardHost();
    const main = host?.closest(".main-content");
    if (!homeItem || !host || !main) return;

    closeOnboarding({ restoreFocus: false });
    host.innerHTML = renderDashboard();
    host.hidden = false;
    main.classList.add("home-dashboard-active");
    main.closest(".app")?.classList.add("home-dashboard-mode");
    suppressOriginalNavigation(homeItem);
    syncSupportingUi(true);
    main.scrollTop = 0;

    if (focus) {
      const title = host.querySelector("#home-dashboard-title");
      try {
        title?.focus({ preventScroll: true });
      } catch {
        // The dashboard remains usable when programmatic focus is unsupported.
      }
    }

    maybeOpenOnboarding();
  };

  const hideDashboard = ({ allowOnboarding = legacyOnboardingAllowed } = {}) => {
    closeOnboarding({ restoreFocus: false });
    homeVisible = false;
    legacyOnboardingAllowed = allowOnboarding;
    const homeItem = document.querySelector(".home-nav-item");
    const host = document.querySelector(".home-dashboard");
    const main = host?.closest(".main-content");
    restoreOriginalNavigation(homeItem);
    if (main) main.classList.remove("home-dashboard-active");
    main?.closest(".app")?.classList.remove("home-dashboard-mode");
    if (host) host.hidden = true;
    syncSupportingUi(false, allowOnboarding);
  };

  const findNavigationTarget = (destination) => {
    const items = Array.from(document.querySelectorAll(".sidebar-nav .nav-item:not(.home-nav-item)"));
    const matches = {
      wacc: (label) => label.includes("WACC"),
      dcf: (label) => label.includes("DCF"),
      multiples: (label) => label.includes("멀티플"),
      phase3: (label) =>
        label.includes("고급 가치평가") ||
        label.includes("주식선택권") ||
        label.includes("BOPM"),
    };
    const matcher = matches[destination];
    return matcher ? items.find((item) => matcher(item.textContent.trim())) || null : null;
  };

  const focusDestinationHeading = (destination) => {
    const preferredSelectors = {
      dcf: ["#guided-question-title", "#guided-result-title"],
      phase3: ["#phase3-hub-title"],
      wacc: [
        ".main-content > :not(.home-dashboard) .page-header h1",
        ".main-content > :not(.home-dashboard) .main-header h2",
      ],
    };
    const selectors = [
      ...(preferredSelectors[destination] || []),
      ".main-content > :not(.home-dashboard) h1",
      ".main-content > :not(.home-dashboard) h2",
      ".main-content > :not(.home-dashboard) h3",
    ];
    let attempts = 0;
    const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0));

    const tryFocus = () => {
      const heading = selectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .find((element) => {
          if (!element.isConnected || element.closest("[hidden]")) return false;
          const style = globalThis.getComputedStyle?.(element);
          return !style || (style.display !== "none" && style.visibility !== "hidden");
        });
      if (heading) {
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        try {
          heading.focus({ preventScroll: true });
        } catch {
          // The destination remains usable if programmatic focus is unsupported.
        }
        return;
      }
      attempts += 1;
      if (attempts < 12) schedule(tryFocus);
    };

    schedule(tryFocus);
  };

  const navigateTo = (
    destination,
    { allowLegacyOnboarding = false } = {},
  ) => {
    const target = findNavigationTarget(destination);
    if (!target) return;
    hideDashboard({ allowOnboarding: allowLegacyOnboarding });
    target.click();
    focusDestinationHeading(destination);
  };

  const syncPage = () => {
    syncQueued = false;
    const homeItem = ensureHomeNavigation();
    const host = ensureDashboardHost();
    if (!homeItem || !host) return;

    if (homeVisible) {
      const main = host.closest(".main-content");
      if (!host.firstElementChild) {
        try {
          host.innerHTML = renderDashboard();
        } catch (error) {
          homeVisible = false;
          host.hidden = true;
          main?.classList.remove("home-dashboard-active");
          main?.closest(".app")?.classList.remove("home-dashboard-mode");
          restoreOriginalNavigation(homeItem);
          syncSupportingUi(false, legacyOnboardingAllowed);
          console.error("홈 화면을 불러오지 못해 기본 화면으로 돌아갑니다.", error);
          return;
        }
      }
      host.hidden = false;
      main?.classList.add("home-dashboard-active");
      main?.closest(".app")?.classList.add("home-dashboard-mode");
      suppressOriginalNavigation(homeItem);
      syncSupportingUi(true);
      maybeOpenOnboarding();
    } else {
      syncSupportingUi(false, legacyOnboardingAllowed);
    }
  };

  const scheduleSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(syncPage);
  };

  globalThis.ValueScannerHome = Object.freeze({
    show: () => showDashboard({ focus: true }),
    hide: hideDashboard,
    startGuide: openOnboarding,
    refresh: () => {
      closeOnboarding({ restoreFocus: false });
      const host = document.querySelector(".home-dashboard");
      if (host) {
        host.innerHTML = renderDashboard();
        if (homeVisible) maybeOpenOnboarding();
      }
    },
  });

  syncPage();

  const root = document.getElementById("root");
  if (root) {
    new MutationObserver(scheduleSync).observe(root, {
      childList: true,
      subtree: true,
    });
  }
})();
