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
  searchResults: demoVideos,
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
  sort: { key: "views", direction: "desc" }
};

const elements = {
  apiStatus: document.querySelector("#apiStatus"),
  navLinks: document.querySelectorAll("nav a[data-view]"),
  searchPanel: document.querySelector("#searchPanel"),
  filtersPanel: document.querySelector("#filtersPanel"),
  pageTitle: document.querySelector("#pageTitle"),
  searchForm: document.querySelector("#searchForm"),
  queryInput: document.querySelector("#queryInput"),
  orderInput: document.querySelector("#orderInput"),
  maxInput: document.querySelector("#maxInput"),
  demoButton: document.querySelector("#demoButton"),
  clearButton: document.querySelector("#clearButton"),
  exportButton: document.querySelector("#exportButton"),
  body: document.querySelector("#resultsBody"),
  resultHint: document.querySelector("#resultHint"),
  filteredCount: document.querySelector("#filteredCount"),
  innerSearch: document.querySelector("#innerSearch"),
  minViews: document.querySelector("#minViews"),
  maxViews: document.querySelector("#maxViews"),
  shortsOnly: document.querySelector("#shortsOnly"),
  excludeShorts: document.querySelector("#excludeShorts")
};

init();

async function init() {
  renderGradeFilters("contributionFilters", "contribution");
  renderGradeFilters("performanceFilters", "performance");
  bindEvents();
  render(state.searchResults, makeSummary(state.searchResults));

  try {
    const health = await fetchJson("/api/health");
    const ready = health.hasApiKey && health.storage !== "missing-supabase";
    elements.apiStatus.textContent = ready ? "API 연결 준비됨" : health.hasApiKey ? "DB 설정 필요" : "API 키 필요";
    elements.apiStatus.className = `status ${ready ? "ready" : "missing"}`;
  } catch {
    elements.apiStatus.textContent = "서버 확인 실패";
    elements.apiStatus.className = "status missing";
  }

  await refreshHistory(false);
  showView(location.hash.replace("#", "") || "search");
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

  elements.demoButton.addEventListener("click", () => {
    state.searchResults = demoVideos;
    elements.resultHint.textContent = "데모 데이터입니다. API 키 연결 후 실제 YouTube 결과로 대체됩니다.";
    render(state.searchResults, makeSummary(state.searchResults));
  });

  elements.clearButton.addEventListener("click", () => {
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
  });

  elements.exportButton.addEventListener("click", exportCsv);
  elements.innerSearch.addEventListener("input", () => updateFilter("text", elements.innerSearch.value));
  elements.minViews.addEventListener("input", () => updateFilter("minViews", elements.minViews.value));
  elements.maxViews.addEventListener("input", () => updateFilter("maxViews", elements.maxViews.value));
  elements.shortsOnly.addEventListener("change", () => updateFilter("shortsOnly", elements.shortsOnly.checked));
  elements.excludeShorts.addEventListener("change", () => updateFilter("excludeShorts", elements.excludeShorts.checked));

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

async function search() {
  const query = elements.queryInput.value.trim();
  if (!query) return;

  elements.resultHint.textContent = "YouTube API에서 데이터를 가져오는 중입니다.";
  elements.body.innerHTML = `<tr><td class="empty" colspan="10">검색 중...</td></tr>`;

  try {
    const params = new URLSearchParams({
      q: query,
      order: elements.orderInput.value,
      maxResults: elements.maxInput.value
    });
    const payload = await fetchJson(`/api/search?${params}`);
    state.searchResults = payload.videos;
    const sourceText = payload.source === "cache" ? "캐시 결과" : payload.source === "shared-request" ? "진행 중인 요청 재사용" : "YouTube API 결과";
    elements.resultHint.textContent = `"${query}" 검색 결과입니다. ${sourceText}이며 캐시 유지 시간은 ${payload.cacheTtlHours || 24}시간입니다.`;
    render(state.searchResults, payload.summary);
  } catch (error) {
    elements.resultHint.textContent = error.message;
    elements.body.innerHTML = `<tr><td class="empty" colspan="10">${escapeHtml(error.message)}</td></tr>`;
  }
}

function render(videos = state.videos, summary = makeSummary(videos)) {
  state.videos = videos;
  setMetrics(summary);
  const filtered = getFilteredVideos();
  elements.filteredCount.textContent = `${filtered.length.toLocaleString("ko-KR")}개`;

  if (!filtered.length) {
    elements.body.innerHTML = `<tr><td class="empty" colspan="10">조건에 맞는 영상이 없습니다.</td></tr>`;
    return;
  }

  elements.body.innerHTML = filtered.map(renderRow).join("");
  document.querySelectorAll(".save-check").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const video = state.videos.find((item) => item.videoId === checkbox.value);
      if (video && checkbox.checked) {
        await fetchJson("/api/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(video)
        });
        state.savedVideoIds.add(video.videoId);
        await refreshHistory(false);
      }
    });
  });
}

function renderRow(video) {
  const checked = state.savedVideoIds.has(video.videoId) ? "checked" : "";
  return `
    <tr>
      <td><input class="save-check" type="checkbox" value="${escapeHtml(video.videoId)}" aria-label="영상 저장" ${checked} /></td>
      <td><img class="thumb" src="${escapeHtml(video.thumbnail)}" alt="" loading="lazy" /></td>
      <td>
        <a class="video-title" href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">${escapeHtml(video.title)}</a>
        <span class="channel">${escapeHtml(video.channelTitle)}</span>
      </td>
      <td>${formatNumber(video.views)}</td>
      <td>${formatNumber(video.subscribers)}</td>
      <td><span class="grade ${video.contribution.tone}">${video.contribution.label}</span></td>
      <td><span class="grade ${video.performance.tone}">${video.performance.label}</span></td>
      <td><span class="grade ${video.exposure.tone}">${video.exposure.label}</span></td>
      <td>${formatNumber(video.totalChannelVideos)}</td>
      <td>${formatDate(video.publishedAt)}</td>
    </tr>
  `;
}

async function showView(view) {
  state.view = ["search", "saved", "history"].includes(view) ? view : "search";
  elements.navLinks.forEach((link) => link.classList.toggle("active", link.dataset.view === state.view));
  elements.searchPanel.hidden = state.view !== "search";
  elements.filtersPanel.hidden = state.view === "history";
  elements.exportButton.hidden = state.view === "history";

  if (state.view === "search") {
    elements.pageTitle.textContent = "영상 찾기";
    elements.resultHint.textContent ||= "YouTube API 키를 연결한 뒤 키워드를 검색하세요.";
    render(state.searchResults, makeSummary(state.searchResults));
    return;
  }

  await refreshHistory(true);

  if (state.view === "saved") {
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
    state.searches = payload.searches || [];
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
  elements.filteredCount.textContent = `${state.searches.length.toLocaleString("ko-KR")}개`;

  if (!state.searches.length) {
    elements.body.innerHTML = `<tr><td class="empty" colspan="10">검색 히스토리가 없습니다.</td></tr>`;
    return;
  }

  elements.body.innerHTML = state.searches
    .map(
      (item) => `
        <tr>
          <td>-</td>
          <td><span class="history-badge ${escapeHtml(item.source || "youtube")}">${escapeHtml(item.source || "youtube")}</span></td>
          <td>
            <button class="history-query" type="button" data-query="${escapeHtml(item.query)}">${escapeHtml(item.query)}</button>
            <span class="channel">${formatFullDate(item.searchedAt)}</span>
          </td>
          <td>${formatCompact(item.summary?.totalViews || 0)}</td>
          <td>${formatCompact(item.summary?.averageSubscribers || 0)}</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>${formatNumber(item.count || 0)}</td>
          <td>${formatDate(item.searchedAt)}</td>
        </tr>
      `
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
