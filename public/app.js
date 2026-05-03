const grades = [
  { label: "Worst", tone: "worst" },
  { label: "Bad", tone: "bad" },
  { label: "Normal", tone: "normal" },
  { label: "Good", tone: "good" },
  { label: "Great", tone: "great" }
];

const demoVideos = [
  makeDemo("2024년 최고의 인테리어 침대 추천 Top 5", "쇼핑한다몽", 48588, 885, 5257, "2024-04-07", "Good", "Good", 20),
  makeDemo("좁은 방, 넓게 쓰는 법", "뭐사집", 4084318, 12600, 176, "2025-04-20", "Great", "Great", 10),
  makeDemo("전국 33개 체험관 공장직판 프리미엄 매트리스 브랜드리스", "브랜드리스", 22974844, 2830, 249, "2019-07-02", "Great", "Great", 120),
  makeDemo("[유부남] 신혼부부가 침대를 2개 두고 따로 자는 이유 #shorts", "유부남", 8138404, 290000, 734, "2023-07-21", "Good", "Good", 23),
  makeDemo("침실 호텔처럼 꾸며보자 #내돈내산 #침대쇼핑", "현지로운", 395499, 851, 96, "2024-10-02", "Good", "Good", 24),
  makeDemo("자취 필수템? 원터치 접이식 침대", "리뷰남자", 1881518, 23900, 307, "2025-01-31", "Good", "Great", 13),
  makeDemo("[Kali Marks] 갓성비 원목침대 모두 공개합니다", "Kali Marks", 689937, 6510, 148, "2023-05-22", "Normal", "Good", 744),
  makeDemo("어떤 침대에 누워보고 싶나요? PART 6 #asmr", "소리다락방", 1771667, 11700, 193, "2025-08-01", "Good", "Good", 31),
  makeDemo("옷장 벙커침대, 이거 하나로 정리가 끝나요.", "찐이US", 262276, 2130, 50, "2025-10-28", "Normal", "Normal", 16)
];

const state = {
  view: "search",
  videos: [],
  searchResults: [],
  originalResults: [], // 정렬 초기화를 위한 원본 백업
  saved: [],
  searches: [],
  savedVideoIds: new Set(),
  filters: {
    text: "",
    minViews: "",
    maxViews: "",
    contribution: new Set(),
    performance: new Set(),
    shortsOnly: false,
    excludeShorts: false
  },
  sort: { key: "views", direction: "desc" },
  isMobileMode: window.matchMedia("(max-width: 992px)").matches // 현재 모드 저장
};


const elements = {
  apiStatus: document.querySelector("#apiStatus"),
  navLinks: document.querySelectorAll("nav a[data-view]"),
  searchPanel: document.querySelector("#searchPanel"),
  filtersPanel: document.querySelector("#filtersPanel"),
  workspace: document.querySelector(".workspace"),
  pageTitle: document.querySelector("#pageTitle"),
  searchForm: document.querySelector("#searchForm"),
  queryInput: document.querySelector("#queryInput"),
  orderInput: document.querySelector("#orderInput"),
  maxInput: document.querySelector("#maxInput"),
  clearButton: document.querySelector("#clearButton"),
  exportButton: document.querySelector("#exportButton"),
  tableWrap: document.querySelector("#tableWrap"),
  head: document.querySelector("#resultsHead"),
  body: document.querySelector("#resultsBody"),
  resultHint: document.querySelector("#resultHint"),
  filteredCount: document.querySelector("#filteredCount"),
  innerSearch: document.querySelector("#innerSearch"),
  minViews: document.querySelector("#minViews"),
  maxViews: document.querySelector("#maxViews"),
  shortsOnly: document.querySelector("#shortsOnly"),
  excludeShorts: document.querySelector("#excludeShorts"),
  metricsSection: document.querySelector(".metrics"),
  resetSortButton: document.querySelector("#resetSortButton"),
  toggleFilters: document.querySelector("#toggleFilters"),
  filtersContent: document.querySelector("#filtersContent"),
  overlay: document.querySelector("#overlay"),
  loadingModal: document.querySelector("#loadingModal")
};

init();

async function init() {
  renderGradeFilters("contributionFilters", "contribution");
  renderGradeFilters("performanceFilters", "performance");
  bindEvents();

  // 초기 상태는 빈 결과로 시작 (데모 데이터 대신)
  render([], makeSummary([]));

  try {
    const health = await fetchJson("/api/health");
    const ready = health.hasApiKey && health.storage !== "missing-supabase";
    elements.apiStatus.textContent = ready ? "API 연결 준비됨" : health.hasApiKey ? "DB 설정 필요" : "API 키 필요";
    elements.apiStatus.className = `status ${ready ? "ready" : "missing"}`;
  } catch {
    elements.apiStatus.textContent = "서버 확인 실패";
    elements.apiStatus.className = "status missing";
  }

  // 히스토리 데이터를 먼저 가져옴
  await refreshHistory(false);
  
  // 마지막 검색어가 있다면 자동으로 검색 수행
  const lastView = location.hash.replace("#", "");
  if ((!lastView || lastView === "search") && state.searches.length > 0) {
    const lastQuery = state.searches[0].query;
    elements.queryInput.value = lastQuery;
    await search();
  } else {
    showView(lastView || "search");
  }
}

function bindEvents() {
  elements.navLinks.forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      const view = link.dataset.view;
      history.replaceState(null, "", `#${view}`);
      await showView(view);
    });
  });

  elements.searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await search();
  });



  elements.clearButton.addEventListener("click", resetFilters);

  // 필터 팝업 내 초기화 버튼
  const clearButton2 = document.querySelector("#clearButton2");
  if (clearButton2) clearButton2.addEventListener("click", resetFilters);

  // 다시검색 버튼
  const forceSearchButton = document.querySelector("#forceSearchButton");
  if (forceSearchButton) {
    forceSearchButton.addEventListener("click", () => search({ force: true }));
  }

  elements.exportButton.addEventListener("click", exportCsv);
  elements.innerSearch.addEventListener("input", () => updateFilter("text", elements.innerSearch.value));
  elements.minViews.addEventListener("input", () => updateFilter("minViews", elements.minViews.value));
  elements.maxViews.addEventListener("input", () => updateFilter("maxViews", elements.maxViews.value));
  elements.shortsOnly.addEventListener("change", () => updateFilter("shortsOnly", elements.shortsOnly.checked));
  elements.excludeShorts.addEventListener("change", () => updateFilter("excludeShorts", elements.excludeShorts.checked));
  
  // 모바일 필터 토글
  if (elements.mobileFilterButton) {
    elements.mobileFilterButton.addEventListener("click", () => {
      const isShow = elements.filtersPanel.classList.toggle("mobile-show");
      elements.overlay.classList.toggle("show", isShow);
    });
  }
  
  const closeFilters = () => {
    elements.filtersPanel.classList.remove("mobile-show");
    elements.overlay.classList.remove("show");
  };

  if (elements.toggleFilters) {
    elements.toggleFilters.addEventListener("click", closeFilters);
  }
  
  if (elements.overlay) {
    elements.overlay.addEventListener("click", closeFilters);
  }

  bindSortHeaders();

  // 창 크기 조절 시 모바일/PC 레이아웃 자동 전환
  window.addEventListener("resize", () => {
    const nowMobile = isMobile();
    if (state.isMobileMode !== nowMobile) {
      state.isMobileMode = nowMobile;
      // 현재 영상 데이터나 검색 결과가 있는 경우에만 다시 렌더링
      if (state.videos.length > 0 || state.searchResults.length > 0) {
        render();
      }
    }
  });
}


async function search({ force = false } = {}) {
  const query = elements.queryInput.value.trim();
  if (!query) return;

  if (elements.loadingModal) elements.loadingModal.classList.add("show");
  elements.resultHint.textContent = "데이터를 조회하고 있습니다...";
  elements.body.innerHTML = `<tr><td class="empty" colspan="10">검색 중...</td></tr>`;

  try {
    const params = new URLSearchParams({
      q: query,
      order: elements.orderInput.value,
      maxResults: elements.maxInput.value
    });
    if (force) params.set("force", "true");
    params.set("_t", Date.now()); // 매번 다른 URL로 인식하게 하여 브라우저 캐시 방지
    const payload = await fetchJson(`/api/search?${params}`);
    state.searchResults = payload.videos;
    state.originalResults = [...payload.videos]; // 원본 데이터 백업
    
    // 정렬 초기화 버튼 표시 (PC)
    const resetBtn = document.querySelector("#resetSortButton");
    if (resetBtn) resetBtn.style.display = "inline-flex";

    const sourceText = payload.source === "cache" ? "최근 분석된 결과" : payload.source === "shared-request" ? "요청 데이터 재사용" : "실시간 분석 결과";
    
    // 메인 타이틀에 검색어 강조 표시
    elements.pageTitle.innerHTML = `<span class="query-highlight">"${query}"</span> 검색 결과`;
    elements.resultHint.textContent = sourceText;
    render(state.searchResults, payload.summary);
  } catch (error) {
    elements.resultHint.textContent = error.message;
    elements.body.innerHTML = `<tr><td class="empty" colspan="10">${escapeHtml(error.message)}</td></tr>`;
  } finally {
    if (elements.loadingModal) elements.loadingModal.classList.remove("show");
  }
}

function resetFilters() {
  state.filters = {
    text: "",
    minViews: "",
    maxViews: "",
    contribution: new Set(),
    performance: new Set(),
    shortsOnly: false,
    excludeShorts: false
  };
  elements.innerSearch.value = "";
  elements.minViews.value = "";
  elements.maxViews.value = "";
  elements.shortsOnly.checked = false;
  elements.excludeShorts.checked = false;
  document.querySelectorAll(".grade-filter.active").forEach((button) => button.classList.remove("active"));
  render();
}

function render(videos = state.videos, summary = makeSummary(videos)) {
  state.videos = videos;
  setMetrics(summary);
  const filtered = getFilteredVideos();
  if (elements.filteredCount) {
    elements.filteredCount.textContent = `${filtered.length.toLocaleString("ko-KR")}개`;
  }

  if (!filtered.length) {
    elements.body.innerHTML = `<tr><td class="empty" colspan="10">조건에 맞는 영상이 없습니다.</td></tr>`;
    return;
  }

  elements.body.innerHTML = filtered.map(renderRow).join("");
  document.querySelectorAll(".save-check").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const videoId = checkbox.value;
      if (checkbox.checked) {
        // 저장 처리
        const video = state.videos.find((item) => item.videoId === videoId);
        if (video) {
          await fetchJson("/api/saved", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(video)
          });
          state.savedVideoIds.add(videoId);
          await refreshHistory(false);
        }
      } else {
        // 삭제 처리
        await fetchJson(`/api/saved?videoId=${encodeURIComponent(videoId)}`, {
          method: "DELETE"
        });
        state.savedVideoIds.delete(videoId);
        
        // 현재 뷰가 '수집한 영상'이면 즉시 목록 갱신
        if (state.view === "saved") {
          await showView("saved");
        } else {
          await refreshHistory(false);
        }
      }
    });
  });
}

function isMobile() {
  return window.matchMedia("(max-width: 992px)").matches;
}

function renderRow(video) {
  const checked = state.savedVideoIds.has(video.videoId) ? "checked" : "";

  if (isMobile()) {
    // ── 모바일: 풀사이즈 썸네일 + 오버레이 체크박스 ──
    return `
      <tr class="mobile-card-row">
        <td colspan="10" class="mobile-card-cell">
          <div class="mobile-card-inner">
            <div class="mobile-thumb-wrap">
              <img class="mobile-thumb" src="${escapeHtml(video.thumbnail)}" alt="" loading="lazy" />
              <label class="mobile-check-overlay" title="수집하기">
                <input class="save-check" type="checkbox" value="${escapeHtml(video.videoId)}" aria-label="영상 저장" ${checked} />
              </label>
            </div>
            <div class="mobile-card-body">
              <a class="mobile-card-title" href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">${escapeHtml(video.title)}</a>
              <span class="mobile-card-channel">${escapeHtml(video.channelTitle)}</span>
              <div class="mobile-card-stats">
                <span>조회 <strong>${formatNumber(video.views)}</strong></span>
                <span class="dot">•</span>
                <span>구독 <strong>${formatNumber(video.subscribers)}</strong></span>
                <span class="dot">•</span>
                <span>영상 <strong>${formatNumber(video.totalChannelVideos)}</strong></span>
                <span class="dot">•</span>
                <span>${formatDate(video.publishedAt)}</span>
              </div>
              <div class="mobile-card-grades">
                <span class="mobile-grade-item">
                  <span class="mobile-grade-label">기여도</span>
                  <span class="grade ${video.contribution.tone}">${video.contribution.label}</span>
                </span>
                <span class="mobile-grade-item">
                  <span class="mobile-grade-label">성과도</span>
                  <span class="grade ${video.performance.tone}">${video.performance.label}</span>
                </span>
                <span class="mobile-grade-item">
                  <span class="mobile-grade-label">노출</span>
                  <span class="grade ${video.exposure.tone}">${video.exposure.label}</span>
                </span>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  // ── PC: 기존 9열 테이블 행 ──
  return `
    <tr class="video-row">
      <td class="cell-check"><input class="save-check" type="checkbox" value="${escapeHtml(video.videoId)}" aria-label="영상 저장" ${checked} /></td>
      <td class="cell-thumb"><img class="thumb" src="${escapeHtml(video.thumbnail)}" alt="" loading="lazy" /></td>
      <td class="cell-info">
        <a class="video-title" href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">${escapeHtml(video.title)}</a>
        <span class="channel">${escapeHtml(video.channelTitle)}</span>
      </td>
      <td class="cell-views">${formatNumber(video.views)}</td>
      <td class="cell-subs">${formatNumber(video.subscribers)}</td>
      <td class="cell-contribution"><span class="grade ${video.contribution.tone}">${video.contribution.label}</span></td>
      <td class="cell-performance"><span class="grade ${video.performance.tone}">${video.performance.label}</span></td>
      <td class="cell-exposure"><span class="grade ${video.exposure.tone}">${video.exposure.label}</span></td>
      <td class="cell-channel-vids">${formatNumber(video.totalChannelVideos)}</td>
      <td class="cell-date">${formatDate(video.publishedAt)}</td>
    </tr>
  `;
}


async function showView(view) {
  state.view = ["search", "saved", "history"].includes(view) ? view : "search";
  elements.navLinks.forEach((link) => link.classList.toggle("active", link.dataset.view === state.view));
  elements.searchPanel.hidden = state.view !== "search";
  elements.filtersPanel.hidden = state.view === "history";
  elements.exportButton.hidden = state.view === "history";
  if (elements.mobileFilterButton) {
    elements.mobileFilterButton.hidden = state.view === "history";
  }
  if (elements.metricsSection) {
    elements.metricsSection.hidden = state.view === "history";
  }
  
  // 뷰 전환 시 열려있던 필터 모달 닫기
  elements.filtersPanel.classList.remove("mobile-show");
  if (elements.overlay) elements.overlay.classList.remove("show");
  
  // 뷰 클래스 업데이트
  elements.workspace.classList.remove("is-search", "is-saved", "is-history");
  elements.workspace.classList.add(`is-${state.view}`);
  
  elements.tableWrap.classList.toggle("history-table-wrap", state.view === "history");

  if (state.view === "search") {
    setVideoTableHead();
    const currentQuery = elements.queryInput.value.trim();
    elements.pageTitle.innerHTML = currentQuery ? `<span class="query-highlight">"${currentQuery}"</span> 검색 결과` : "영상 찾기";
    elements.resultHint.textContent ||= "YouTube API 키를 연결한 뒤 키워드를 검색하세요.";
    render(state.searchResults, makeSummary(state.searchResults));
    return;
  }

  await refreshHistory(true);

  if (state.view === "saved") {
    setVideoTableHead();
    elements.pageTitle.textContent = "수집한 영상";
    elements.resultHint.textContent = `저장한 영상 ${state.saved.length.toLocaleString("ko-KR")}개입니다.`;
    render(state.saved, makeSummary(state.saved));
    return;
  }

  elements.pageTitle.textContent = "검색 히스토리";
  elements.resultHint.textContent = `최근 검색 기록 ${state.searches.length.toLocaleString("ko-KR")}개입니다.`;
  renderSearchHistory();
}

async function refreshHistory(showErrors) {
  try {
    const payload = await fetchJson("/api/history");
    state.saved = payload.saved || [];
    
    // 중복 제거: 같은 검색어(query) 중 가장 최신 것만 유지
    const rawSearches = payload.searches || [];
    const uniqueMap = new Map();
    rawSearches.forEach(item => {
      if (!uniqueMap.has(item.query)) {
        uniqueMap.set(item.query, item);
      }
    });
    state.searches = Array.from(uniqueMap.values());
    
    state.savedVideoIds = new Set(state.saved.map((video) => video.videoId));
  } catch (error) {
    if (showErrors) {
      elements.resultHint.textContent = error.message;
      elements.body.innerHTML = `<tr><td class="empty" colspan="10">${escapeHtml(error.message)}</td></tr>`;
    }
  }
}

function renderSearchHistory() {
  setMetrics({
    count: state.searches.length,
    totalViews: state.searches.reduce((sum, item) => sum + Number(item.summary?.totalViews || 0), 0),
    averageViews: state.searches.length
      ? Math.round(state.searches.reduce((sum, item) => sum + Number(item.summary?.averageViews || 0), 0) / state.searches.length)
      : 0,
    medianViews: state.searches.length
      ? Math.round(state.searches.reduce((sum, item) => sum + Number(item.summary?.medianViews || 0), 0) / state.searches.length)
      : 0,
    shorts: state.searches.reduce((sum, item) => sum + Number(item.summary?.shorts || 0), 0),
    gradeCounts: {
      contribution: { Worst: 0, Bad: 0, Normal: 0, Good: 0, Great: 0 },
      performance: { Worst: 0, Bad: 0, Normal: 0, Good: 0, Great: 0 }
    }
  });
  if (elements.filteredCount) {
    elements.filteredCount.textContent = `${state.searches.length.toLocaleString("ko-KR")}개`;
  }
  setHistoryTableHead();

  if (!state.searches.length) {
    elements.body.innerHTML = `<tr><td class="empty" colspan="10">검색 히스토리가 없습니다.</td></tr>`;
    return;
  }

  elements.body.innerHTML = state.searches
    .map(
      (item) => {
        const date = new Date(item.searchedAt);
        const shortDate = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        
        return `
          <tr class="history-row">
            <td>
              <div class="history-cell-main">
                <button class="history-query" type="button" data-query="${escapeHtml(item.query)}">${escapeHtml(item.query)}</button>
                <div class="history-meta-mobile">
                  <span class="history-badge ${escapeHtml(item.source || "youtube")}">${escapeHtml(item.source || "youtube")}</span>
                  <span class="history-time-mobile">${shortDate}</span>
                </div>
              </div>
            </td>
            <td class="desktop-only"><span class="history-badge ${escapeHtml(item.source || "youtube")}">${escapeHtml(item.source || "youtube")}</span></td>
            <td><span class="mobile-label">총 조회: </span>${formatCompact(item.summary?.totalViews || 0)}</td>
            <td><span class="mobile-label">평균: </span>${formatCompact(item.summary?.averageViews || 0)}</td>
            <td class="desktop-only">${formatNumber(item.count || 0)}</td>
          </tr>
        `;
      }
    )
    .join("");

  document.querySelectorAll(".history-query").forEach((button) => {
    button.addEventListener("click", async () => {
      elements.queryInput.value = button.dataset.query;
      history.replaceState(null, "", "#search");
      await showView("search");
      await search();
    });
  });
}

function setVideoTableHead() {
  elements.head.innerHTML = `
    <tr>
      <th>선택</th>
      <th>썸네일</th>
      <th data-sort="title">제목</th>
      <th data-sort="views">조회수</th>
      <th data-sort="subscribers">구독자</th>
      <th data-sort="contribution">기여도</th>
      <th data-sort="performance">성과도</th>
      <th data-sort="exposure">노출 확률</th>
      <th data-sort="totalChannelVideos">총 영상 수</th>
      <th data-sort="publishedAt">게시일</th>
    </tr>
  `;
  bindSortHeaders();
}

function setHistoryTableHead() {
  elements.head.innerHTML = `
    <tr>
      <th>검색어</th>
      <th class="desktop-only">출처</th>
      <th>총 조회수</th>
      <th>평균 조회수</th>
      <th class="desktop-only">결과 수</th>
    </tr>
  `;
}

function bindSortHeaders() {
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      state.sort = {
        key,
        direction: state.sort.key === key && state.sort.direction === "desc" ? "asc" : "desc"
      };
      render();
    });
  });
}

function renderGradeFilters(targetId, key) {
  const target = document.querySelector(`#${targetId}`);
  target.innerHTML = grades
    .map((grade) => `<button type="button" class="grade-filter ${grade.tone}" data-key="${key}" data-grade="${grade.label}">${grade.label}<small>0</small></button>`)
    .join("");

  target.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const set = state.filters[key];
      if (set.has(button.dataset.grade)) {
        set.delete(button.dataset.grade);
        button.classList.remove("active");
      } else {
        set.add(button.dataset.grade);
        button.classList.add("active");
      }
      render();
    });
  });
}

function updateFilter(key, value) {
  state.filters[key] = value;
  if (key === "shortsOnly" && value) {
    state.filters.excludeShorts = false;
    elements.excludeShorts.checked = false;
  }
  if (key === "excludeShorts" && value) {
    state.filters.shortsOnly = false;
    elements.shortsOnly.checked = false;
  }
  render();
}

function getFilteredVideos() {
  const text = state.filters.text.toLowerCase().trim();
  const minViews = Number(state.filters.minViews || 0);
  const maxViews = Number(state.filters.maxViews || Number.MAX_SAFE_INTEGER);

  return [...state.videos]
    .filter((video) => !text || `${video.title} ${video.channelTitle}`.toLowerCase().includes(text))
    .filter((video) => video.views >= minViews && video.views <= maxViews)
    .filter((video) => !state.filters.contribution.size || state.filters.contribution.has(video.contribution.label))
    .filter((video) => !state.filters.performance.size || state.filters.performance.has(video.performance.label))
    .filter((video) => !state.filters.shortsOnly || video.isShort)
    .filter((video) => !state.filters.excludeShorts || !video.isShort)
    .sort(compareVideos);
}

function compareVideos(a, b) {
  const direction = state.sort.direction === "desc" ? -1 : 1;
  const key = state.sort.key;
  const left = typeof a[key] === "object" ? a[key].label : a[key];
  const right = typeof b[key] === "object" ? b[key].label : b[key];
  if (left > right) return direction;
  if (left < right) return -direction;
  return 0;
}

function setMetrics(summary) {
  document.querySelector("#metricCount").textContent = formatNumber(summary.count);
  document.querySelector("#metricViews").textContent = formatCompact(summary.totalViews);
  document.querySelector("#metricAverage").textContent = formatCompact(summary.averageViews);
  document.querySelector("#metricMedian").textContent = formatCompact(summary.medianViews);
  document.querySelector("#metricShorts").textContent = formatNumber(summary.shorts);

  for (const group of ["contribution", "performance"]) {
    document.querySelectorAll(`[data-key="${group}"]`).forEach((button) => {
      button.querySelector("small").textContent = summary.gradeCounts[group][button.dataset.grade] || 0;
    });
  }
}

function exportCsv() {
  const rows = getFilteredVideos();
  const header = ["title", "channel", "views", "subscribers", "contribution", "performance", "exposure", "publishedAt", "url"];
  const csv = [
    header.join(","),
    ...rows.map((video) =>
      [
        video.title,
        video.channelTitle,
        video.views,
        video.subscribers,
        video.contribution.label,
        video.performance.label,
        video.exposure.label,
        video.publishedAt,
        video.url
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    )
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `youtube-research-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

function makeDemo(title, channelTitle, views, subscribers, totalChannelVideos, date, contribution, performance, seconds) {
  return {
    videoId: crypto.randomUUID(),
    title,
    channelTitle,
    thumbnail: `https://i.ytimg.com/vi/${["dQw4w9WgXcQ", "aqz-KE-bpKQ", "ysz5S6PUM-U"][Math.floor(Math.random() * 3)]}/mqdefault.jpg`,
    publishedAt: date,
    views,
    likes: Math.round(views * 0.018),
    comments: Math.round(views * 0.001),
    subscribers,
    totalChannelVideos,
    durationSeconds: seconds,
    isShort: seconds <= 60,
    viewsPerDay: Math.round(views / 180),
    engagementRate: 1.9,
    subscriberViewRatio: subscribers ? views / subscribers : views,
    contribution: gradeObject(contribution),
    performance: gradeObject(performance),
    exposure: gradeObject(performance),
    opportunityScore: 75,
    url: "https://www.youtube.com"
  };
}

function makeSummary(videos) {
  const sortedViews = videos.map((video) => video.views).sort((a, b) => a - b);
  const emptyCounts = { Worst: 0, Bad: 0, Normal: 0, Good: 0, Great: 0 };
  return {
    count: videos.length,
    totalViews: videos.reduce((sum, video) => sum + video.views, 0),
    averageViews: videos.length ? Math.round(videos.reduce((sum, video) => sum + video.views, 0) / videos.length) : 0,
    medianViews: sortedViews.length ? sortedViews[Math.floor(sortedViews.length / 2)] : 0,
    shorts: videos.filter((video) => video.isShort).length,
    gradeCounts: {
      contribution: videos.reduce((acc, video) => ({ ...acc, [video.contribution.label]: acc[video.contribution.label] + 1 }), { ...emptyCounts }),
      performance: videos.reduce((acc, video) => ({ ...acc, [video.performance.label]: acc[video.performance.label] + 1 }), { ...emptyCounts })
    }
  };
}

function gradeObject(label) {
  return grades.find((grade) => grade.label === label) || grades[2];
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function formatCompact(value) {
  return Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatFullDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

// 정렬 초기화 이벤트
document.querySelector("#resetSortButton")?.addEventListener("click", () => {
  if (state.originalResults.length > 0) {
    state.searchResults = [...state.originalResults];
    render(state.searchResults, makeSummary(state.searchResults));
  }
});
