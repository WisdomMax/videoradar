const activeSearches = new Map();
let lastYoutubeRequestAt = 0;

export async function health(env) {
  const config = makeConfig(env);
  let quota = null;
  let storageError = null;

  if (config.hasSupabase) {
    try {
      quota = await readUsage(config);
    } catch (error) {
      storageError = error.message;
    }
  }

  return {
    ok: !storageError,
    hasApiKey: Boolean(config.youtubeApiKey),
    cacheTtlHours: Math.round(config.cacheTtlMs / 60 / 60 / 1000),
    youtubeMinIntervalMs: config.youtubeMinIntervalMs,
    youtubeDailyQuotaLimit: config.youtubeDailyQuotaLimit,
    hasSupabaseUrl: Boolean(config.supabaseUrl),
    hasSupabaseApiKey: Boolean(config.supabaseApiKey),
    supabaseSchema: config.supabaseSchema,
    storage: config.hasSupabase ? (storageError ? "error" : "supabase") : "missing-supabase",
    storageError,
    quota
  };
}

export async function history(env) {
  const config = makeConfig(env);
  assertSupabase(config);
  const [searches, saved] = await Promise.all([readSupabaseSearchHistory(config), readSupabaseSavedVideos(config)]);
  return { searches, saved };
}

export async function saveVideo(env, video) {
  const config = makeConfig(env);
  assertSupabase(config);
  const savedAt = new Date().toISOString();
  await supabaseRequest(config, "saved_videos?on_conflict=video_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: {
      video_id: video.videoId,
      title: video.title,
      channel_title: video.channelTitle,
      payload: { ...video, savedAt },
      saved_at: savedAt
    }
  });
  return { ok: true, saved: await readSupabaseSavedVideos(config) };
}

export async function searchVideos(env, url) {
  const config = makeConfig(env);
  assertSupabase(config);

  const query = (url.searchParams.get("q") || "").trim();
  const maxResults = clamp(Number(url.searchParams.get("maxResults") || 100), 1, 500);
  const order = url.searchParams.get("order") || "relevance";
  const publishedAfter = url.searchParams.get("publishedAfter") || "";
  const publishedBefore = url.searchParams.get("publishedBefore") || "";
  const cacheKey = makeCacheKey({ query, maxResults, order, publishedAfter, publishedBefore });

  if (!query) throw httpError(400, "검색어를 입력해 주세요.");
  if (!config.youtubeApiKey) throw httpError(400, "YOUTUBE_API_KEY가 설정되어 있지 않습니다.");

  const cached = await getCachedSearch(config, cacheKey);
  if (cached) {
    await appendHistory(config, { ...cached, source: "cache" });
    return { ...cached, source: "cache" };
  }

  if (activeSearches.has(cacheKey)) {
    const payload = await activeSearches.get(cacheKey);
    return { ...payload, source: "shared-request" };
  }

  const request = fetchAndCacheSearch(config, { query, maxResults, order, publishedAfter, publishedBefore, cacheKey });
  activeSearches.set(cacheKey, request);
  try {
    return await request;
  } finally {
    activeSearches.delete(cacheKey);
  }
}

async function fetchAndCacheSearch(config, { query, maxResults, order, publishedAfter, publishedBefore, cacheKey }) {
  const searchItems = await fetchSearchItems(config, { query, maxResults, order, publishedAfter, publishedBefore });
  const videoIds = searchItems.map((item) => item.id.videoId).filter(Boolean);
  if (!videoIds.length) {
    const emptyPayload = makePayload(config, query, [], "youtube");
    await setCachedSearch(config, cacheKey, emptyPayload);
    await appendHistory(config, emptyPayload);
    return emptyPayload;
  }

  // 비디오 정보와 채널 정보를 병렬로 가져오기 위해 준비
  // 검색 결과에서 바로 채널 ID들을 추출할 수 있음
  const channelIds = [...new Set(searchItems.map((item) => item.snippet.channelId).filter(Boolean))];

  const [videosItems, channelsItems] = await Promise.all([
    fetchVideosByIds(config, videoIds),
    fetchChannelsByIds(config, channelIds)
  ]);

  const channelMap = new Map(channelsItems.map((channel) => [channel.id, channel]));
  const enriched = videosItems.map((video) => normalizeVideo(video, channelMap.get(video.snippet.channelId)));
  const withScores = scoreVideos(enriched);
  const payload = makePayload(config, query, withScores, "youtube");

  await Promise.all([
    setCachedSearch(config, cacheKey, payload),
    appendHistory(config, payload)
  ]);
  return payload;
}

async function fetchSearchItems(config, { query, maxResults, order, publishedAfter, publishedBefore }) {
  const items = [];
  let pageToken = "";

  while (items.length < maxResults) {
    const searchParams = new URLSearchParams({
      key: config.youtubeApiKey,
      part: "snippet",
      type: "video",
      q: query,
      maxResults: String(Math.min(50, maxResults - items.length)),
      order,
      safeSearch: "none",
      videoEmbeddable: "true"
    });

    if (publishedAfter) searchParams.set("publishedAfter", `${publishedAfter}T00:00:00Z`);
    if (publishedBefore) searchParams.set("publishedBefore", `${publishedBefore}T23:59:59Z`);
    if (pageToken) searchParams.set("pageToken", pageToken);

    const search = await youtubeFetch(config, `https://www.googleapis.com/youtube/v3/search?${searchParams}`, 100);
    items.push(...search.items);
    pageToken = search.nextPageToken || "";
    if (!pageToken || !search.items.length) break;
  }

  return items;
}

async function fetchVideosByIds(config, videoIds) {
  const chunks = chunk(videoIds, 50);
  const results = await Promise.all(
    chunks.map((ids) => {
      const videosParams = new URLSearchParams({
        key: config.youtubeApiKey,
        part: "snippet,statistics,contentDetails",
        id: ids.join(",")
      });
      return youtubeFetch(config, `https://www.googleapis.com/youtube/v3/videos?${videosParams}`, 1);
    })
  );
  return results.flatMap((r) => r.items);
}

async function fetchChannelsByIds(config, channelIds) {
  const chunks = chunk(channelIds, 50);
  const results = await Promise.all(
    chunks.map((ids) => {
      const channelParams = new URLSearchParams({
        key: config.youtubeApiKey,
        part: "snippet,statistics",
        id: ids.join(",")
      });
      return youtubeFetch(config, `https://www.googleapis.com/youtube/v3/channels?${channelParams}`, 1);
    })
  );
  return results.flatMap((r) => r.items);
}

function normalizeVideo(video, channel) {
  const stats = video.statistics || {};
  const channelStats = channel?.statistics || {};
  const publishedAt = video.snippet.publishedAt;
  const views = Number(stats.viewCount || 0);
  const likes = Number(stats.likeCount || 0);
  const comments = Number(stats.commentCount || 0);
  const subscribers = Number(channelStats.subscriberCount || 0);
  const ageDays = Math.max(1, Math.ceil((Date.now() - new Date(publishedAt).getTime()) / 86400000));
  const durationSeconds = parseDuration(video.contentDetails?.duration || "PT0S");

  return {
    videoId: video.id,
    title: video.snippet.title,
    description: video.snippet.description,
    channelId: video.snippet.channelId,
    channelTitle: video.snippet.channelTitle,
    channelThumbnail: channel?.snippet?.thumbnails?.default?.url || "",
    thumbnail: video.snippet.thumbnails?.medium?.url || video.snippet.thumbnails?.default?.url || "",
    publishedAt,
    views,
    likes,
    comments,
    subscribers,
    totalChannelVideos: Number(channelStats.videoCount || 0),
    durationSeconds,
    isShort: durationSeconds > 0 && durationSeconds <= 60,
    viewsPerDay: Math.round(views / ageDays),
    engagementRate: views ? Number((((likes + comments) / views) * 100).toFixed(2)) : 0,
    subscriberViewRatio: subscribers ? Number((views / subscribers).toFixed(2)) : views,
    url: `https://www.youtube.com/watch?v=${video.id}`
  };
}

function scoreVideos(videos) {
  const views = videos.map((video) => video.views);
  const ratios = videos.map((video) => video.subscriberViewRatio);
  const perDay = videos.map((video) => video.viewsPerDay);

  return videos.map((video) => {
    const contribution = grade(percentile(video.subscriberViewRatio, ratios));
    const performance = grade((percentile(video.views, views) + percentile(video.viewsPerDay, perDay)) / 2);
    const exposure = grade(percentile(video.viewsPerDay, perDay));
    const opportunityScore = Math.round(
      Math.min(100, video.subscriberViewRatio * 12 + video.engagementRate * 2 + percentile(video.viewsPerDay, perDay) * 60)
    );

    return { ...video, contribution, performance, exposure, opportunityScore };
  });
}

function makeSummary(videos) {
  const sum = (field) => videos.reduce((total, video) => total + video[field], 0);
  const avg = (field) => (videos.length ? Math.round(sum(field) / videos.length) : 0);
  const sortedViews = videos.map((video) => video.views).sort((a, b) => a - b);
  const medianViews = sortedViews.length ? sortedViews[Math.floor(sortedViews.length / 2)] : 0;
  const gradeCounts = videos.reduce(
    (acc, video) => {
      acc.contribution[video.contribution.label] += 1;
      acc.performance[video.performance.label] += 1;
      return acc;
    },
    {
      contribution: { Worst: 0, Bad: 0, Normal: 0, Good: 0, Great: 0 },
      performance: { Worst: 0, Bad: 0, Normal: 0, Good: 0, Great: 0 }
    }
  );

  return {
    count: videos.length,
    totalViews: sum("views"),
    averageViews: avg("views"),
    medianViews,
    totalLikes: sum("likes"),
    averageSubscribers: avg("subscribers"),
    shorts: videos.filter((video) => video.isShort).length,
    gradeCounts
  };
}

async function youtubeFetch(config, url, quotaCost) {
  await reserveQuota(config, quotaCost);
  await waitForYoutubeSlot(config.youtubeMinIntervalMs);

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || "YouTube API 요청에 실패했습니다.";
    throw new Error(message);
  }
  return data;
}

async function waitForYoutubeSlot(minIntervalMs) {
  const elapsed = Date.now() - lastYoutubeRequestAt;
  const waitMs = Math.max(0, minIntervalMs - elapsed);
  if (waitMs) await sleep(waitMs);
  lastYoutubeRequestAt = Date.now();
}

async function getCachedSearch(config, cacheKey) {
  const params = new URLSearchParams({
    select: "payload,cached_at",
    cache_key: `eq.${cacheKey}`,
    limit: "1"
  });
  const rows = await supabaseRequest(config, `search_cache?${params}`);
  const hit = rows[0];
  if (!hit) return null;
  if (Date.now() - new Date(hit.cached_at).getTime() > config.cacheTtlMs) return null;
  return hit.payload;
}

async function setCachedSearch(config, cacheKey, payload) {
  await supabaseRequest(config, "search_cache?on_conflict=cache_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: {
      cache_key: cacheKey,
      query: payload.query,
      payload,
      cached_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + config.cacheTtlMs).toISOString()
    }
  });
}

async function appendHistory(config, payload) {
  await supabaseRequest(config, "search_history", {
    method: "POST",
    body: {
      query: payload.query,
      searched_at: payload.searchedAt,
      result_count: payload.videos.length,
      source: payload.source || "youtube",
      summary: payload.summary
    }
  });
}

async function readSupabaseSearchHistory(config) {
  const params = new URLSearchParams({
    select: "query,searched_at,result_count,source,summary",
    order: "searched_at.desc",
    limit: "100"
  });
  const rows = await supabaseRequest(config, `search_history?${params}`);
  return rows.map((row) => ({
    query: row.query,
    searchedAt: row.searched_at,
    count: row.result_count,
    source: row.source,
    summary: row.summary
  }));
}

async function readSupabaseSavedVideos(config) {
  const params = new URLSearchParams({
    select: "payload",
    order: "saved_at.desc",
    limit: "500"
  });
  const rows = await supabaseRequest(config, `saved_videos?${params}`);
  return rows.map((row) => row.payload);
}

async function reserveQuota(config, cost) {
  const usage = await readUsage(config);
  if (usage.used + cost > config.youtubeDailyQuotaLimit) {
    throw new Error(
      `오늘 설정한 YouTube API 사용량 한도(${config.youtubeDailyQuotaLimit} units)에 도달했습니다.`
    );
  }
  await writeUsage(config, { ...usage, used: usage.used + cost, updatedAt: new Date().toISOString() });
}

async function readUsage(config) {
  const today = getPacificDateKey();
  const params = new URLSearchParams({
    select: "quota_date,used_units,updated_at",
    quota_date: `eq.${today}`,
    limit: "1"
  });
  const rows = await supabaseRequest(config, `youtube_quota_usage?${params}`);
  const row = rows[0];
  if (!row) return { date: today, used: 0, limit: config.youtubeDailyQuotaLimit };
  return {
    date: row.quota_date,
    used: Number(row.used_units || 0),
    limit: config.youtubeDailyQuotaLimit,
    updatedAt: row.updated_at
  };
}

async function writeUsage(config, usage) {
  await supabaseRequest(config, "youtube_quota_usage?on_conflict=quota_date", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: {
      quota_date: usage.date,
      used_units: usage.used,
      updated_at: usage.updatedAt
    }
  });
}

async function supabaseRequest(config, pathname, options = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${pathname}`, {
    method: options.method || "GET",
    headers: {
      apikey: config.supabaseApiKey,
      Authorization: `Bearer ${config.supabaseApiKey}`,
      "Content-Type": "application/json",
      "Accept-Profile": config.supabaseSchema,
      "Content-Profile": config.supabaseSchema,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const detail = await response.text();
    throw httpError(response.status, `Supabase 요청 실패: ${detail}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function makeConfig(env) {
  const rawSchema = env.SUPABASE_SCHEMA || "public";
  const supabaseSchema = /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawSchema) && !rawSchema.startsWith("sb_") ? rawSchema : "public";
  const supabaseUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const supabaseApiKey = env.SUPABASE_API_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "";

  return {
    youtubeApiKey: env.YOUTUBE_API_KEY || "",
    supabaseUrl,
    supabaseApiKey,
    supabaseSchema,
    hasSupabase: Boolean(supabaseUrl && supabaseApiKey),
    cacheTtlMs: Number(env.SEARCH_CACHE_TTL_HOURS || 24) * 60 * 60 * 1000,
    youtubeMinIntervalMs: Number(env.YOUTUBE_MIN_INTERVAL_MS || 0),
    youtubeDailyQuotaLimit: Number(env.YOUTUBE_DAILY_QUOTA_LIMIT || 9000)
  };
}

function assertSupabase(config) {
  if (config.hasSupabase) return;
  if (!config.supabaseUrl && !config.supabaseApiKey) {
    throw httpError(500, "SUPABASE_URL과 SUPABASE_API_KEY가 Cloudflare 변수에 설정되어 있지 않습니다.");
  }
  if (!config.supabaseUrl) throw httpError(500, "SUPABASE_URL이 Cloudflare 변수에 설정되어 있지 않습니다.");
  throw httpError(500, "SUPABASE_API_KEY가 Cloudflare 변수에 설정되어 있지 않습니다.");
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

export function jsonError(error) {
  const status = error.status || 500;
  // 에러 메시지를 더 구체적으로 표시 (특히 Supabase 관련)
  const message = error.expose ? error.message : (status === 500 ? `서버 내부 오류: ${error.message}` : error.message);
  console.error("[Server Error]", error);
  return json({ error: message }, status);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function percentile(value, values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const lower = sorted.filter((item) => item <= value).length;
  return lower / sorted.length;
}

function grade(score) {
  if (score >= 0.9) return { label: "Great", tone: "great" };
  if (score >= 0.62) return { label: "Good", tone: "good" };
  if (score >= 0.38) return { label: "Normal", tone: "normal" };
  if (score >= 0.16) return { label: "Bad", tone: "bad" };
  return { label: "Worst", tone: "worst" };
}

function parseDuration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, hours = 0, minutes = 0, seconds = 0] = match.map((part) => Number(part || 0));
  return hours * 3600 + minutes * 60 + seconds;
}

function makeCacheKey(parts) {
  return [
    normalizeCachePart(parts.query),
    parts.order,
    parts.maxResults,
    parts.publishedAfter || "",
    parts.publishedBefore || ""
  ].join("::");
}

function normalizeCachePart(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function makePayload(config, query, videos, source) {
  return {
    query,
    videos,
    summary: makeSummary(videos),
    searchedAt: new Date().toISOString(),
    source,
    cacheTtlHours: Math.round(config.cacheTtlMs / 60 / 60 / 1000)
  };
}

function getPacificDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
