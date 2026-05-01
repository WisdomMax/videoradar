import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const historyPath = path.join(dataDir, "search-history.json");
const cachePath = path.join(dataDir, "search-cache.json");
const usagePath = path.join(dataDir, "youtube-usage.json");

loadDotEnv(path.join(__dirname, ".env"));

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const youtubeApiKey = process.env.YOUTUBE_API_KEY || "";
const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const supabaseApiKey = process.env.SUPABASE_API_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const rawSupabaseSchema = process.env.SUPABASE_SCHEMA || "public";
const supabaseSchema =
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawSupabaseSchema) && !rawSupabaseSchema.startsWith("sb_") ? rawSupabaseSchema : "public";
const hasSupabase = Boolean(supabaseUrl && supabaseApiKey);
const cacheTtlMs = Number(process.env.SEARCH_CACHE_TTL_HOURS || 168) * 60 * 60 * 1000;
const youtubeMinIntervalMs = Number(process.env.YOUTUBE_MIN_INTERVAL_MS || 1500);
const youtubeDailyQuotaLimit = Number(process.env.YOUTUBE_DAILY_QUOTA_LIMIT || 9000);
let lastYoutubeRequestAt = 0;
const activeSearches = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        hasApiKey: Boolean(youtubeApiKey),
        cacheTtlHours: Math.round(cacheTtlMs / 60 / 60 / 1000),
        youtubeMinIntervalMs,
        youtubeDailyQuotaLimit,
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseApiKey: Boolean(supabaseApiKey),
        supabaseSchema,
        storage: hasSupabase ? "supabase" : "local-json",
        quota: await readUsage()
      });
    }

    if (url.pathname === "/api/search") {
      return handleSearch(url, res);
    }

    if (url.pathname === "/api/history") {
      return sendJson(res, 200, await readHistory());
    }

    if (url.pathname === "/api/saved") {
      if (req.method === "POST") return handleSave(req, res);
      if (req.method === "DELETE") return handleDeleteSaved(url, res);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "서버 처리 중 오류가 발생했습니다." });
  }
});

server.listen(port, host, () => {
  console.log(`YouTube research dashboard running at http://${host}:${port}`);
});

async function handleSearch(url, res) {
  const force = url.searchParams.get("force") === "true";
  const query = (url.searchParams.get("q") || "").trim();
  const maxResults = clamp(Number(url.searchParams.get("maxResults") || 300), 1, 500);
  const order = url.searchParams.get("order") || "relevance";
  const publishedAfter = url.searchParams.get("publishedAfter") || "";
  const publishedBefore = url.searchParams.get("publishedBefore") || "";
  const cacheKey = makeCacheKey({ query, maxResults, order, publishedAfter, publishedBefore });

  if (!query) return sendJson(res, 400, { error: "검색어를 입력해 주세요." });

  if (!force) {
    const cached = await getCachedSearch(cacheKey);
    if (cached) {
      await appendHistory({ ...cached, source: "cache" });
      return sendJson(res, 200, { ...cached, source: "cache" });
    }

    if (activeSearches.has(cacheKey)) {
      const payload = await activeSearches.get(cacheKey);
      return sendJson(res, 200, { ...payload, source: "shared-request" });
    }
  }

  console.log(`[Server] YouTube API 호출 시작: "${query}" (Force: ${force})`);
  const searchPromise = fetchAndCacheSearch({
    query,
    maxResults,
    order,
    publishedAfter,
    publishedBefore,
    cacheKey
  });

  activeSearches.set(cacheKey, searchPromise);
  try {
    const payload = await searchPromise;
    sendJson(res, 200, payload);
  } finally {
    activeSearches.delete(cacheKey);
  }
}

async function fetchAndCacheSearch({ query, maxResults, order, publishedAfter, publishedBefore, cacheKey }) {
  const searchItems = await fetchSearchItems({ query, maxResults, order, publishedAfter, publishedBefore });
  const rawVideoIds = searchItems.map((item) => item.id.videoId).filter(Boolean);
  const videoIds = [...new Set(rawVideoIds)]; // YouTube API 중복 결과 제거
  if (!videoIds.length) {
    const emptyPayload = makePayload(query, [], "youtube");
    await setCachedSearch(cacheKey, emptyPayload);
    await appendHistory(emptyPayload);
    return emptyPayload;
  }

  const videos = { items: await fetchVideosByIds(videoIds) };
  const channelIds = [...new Set(videos.items.map((item) => item.snippet.channelId).filter(Boolean))];
  const channels = { items: await fetchChannelsByIds(channelIds) };

  const channelMap = new Map(channels.items.map((channel) => [channel.id, channel]));
  const enriched = videos.items.map((video) => normalizeVideo(video, channelMap.get(video.snippet.channelId)));
  const withScores = scoreVideos(enriched);
  const payload = makePayload(query, withScores, "youtube");

  await setCachedSearch(cacheKey, payload);
  await appendHistory(payload);
  return payload;
}

async function fetchSearchItems({ query, maxResults, order, publishedAfter, publishedBefore }) {
  const items = [];
  let pageToken = "";

  while (items.length < maxResults) {
    const searchParams = new URLSearchParams({
      key: youtubeApiKey,
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

    const search = await youtubeFetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`, 100);
    items.push(...search.items);
    pageToken = search.nextPageToken || "";
    if (!pageToken || !search.items.length) break;
  }

  return items;
}

async function fetchVideosByIds(videoIds) {
  const items = [];
  for (const ids of chunk(videoIds, 50)) {
    const videosParams = new URLSearchParams({
      key: youtubeApiKey,
      part: "snippet,statistics,contentDetails",
      id: ids.join(",")
    });
    const videos = await youtubeFetch(`https://www.googleapis.com/youtube/v3/videos?${videosParams}`, 1);
    items.push(...videos.items);
  }
  return items;
}

async function fetchChannelsByIds(channelIds) {
  const items = [];
  for (const ids of chunk(channelIds, 50)) {
    const channelParams = new URLSearchParams({
      key: youtubeApiKey,
      part: "snippet,statistics",
      id: ids.join(",")
    });
    const channels = await youtubeFetch(`https://www.googleapis.com/youtube/v3/channels?${channelParams}`, 1);
    items.push(...channels.items);
  }
  return items;
}

async function handleSave(req, res) {
  const body = await readJsonBody(req);
  const next = await saveVideo(body);
  sendJson(res, 200, { ok: true, saved: next });
}

async function handleDeleteSaved(url, res) {
  const videoId = url.searchParams.get("videoId");
  if (!videoId) return sendJson(res, 400, { error: "videoId가 필요합니다." });
  const next = await deleteVideo(videoId);
  sendJson(res, 200, { ok: true, saved: next });
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

async function youtubeFetch(url, quotaCost) {
  await reserveQuota(quotaCost);
  await waitForYoutubeSlot();

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || "YouTube API 요청에 실패했습니다.";
    throw new Error(message);
  }
  return data;
}

async function waitForYoutubeSlot() {
  const elapsed = Date.now() - lastYoutubeRequestAt;
  const waitMs = Math.max(0, youtubeMinIntervalMs - elapsed);
  if (waitMs) await sleep(waitMs);
  lastYoutubeRequestAt = Date.now();
}

async function serveStatic(rawPath, res) {
  const safePath = rawPath === "/" ? "/index.html" : decodeURIComponent(rawPath);
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) return sendText(res, 403, "Forbidden");

  try {
    const file = await readFile(filePath);
    const type = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(file);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function readHistory() {
  if (hasSupabase) {
    const [searches, saved] = await Promise.all([readSupabaseSearchHistory(), readSupabaseSavedVideos()]);
    return { searches, saved };
  }
  if (!existsSync(historyPath)) return { searches: [], saved: [] };
  return JSON.parse(await readFile(historyPath, "utf8"));
}

async function appendHistory(payload) {
  if (hasSupabase) {
    // 1. 기존에 같은 키워드가 있다면 삭제 (중복 방지)
    try {
      await supabaseRequest(`search_history?query=eq.${encodeURIComponent(payload.query)}`, {
        method: "DELETE"
      });
    } catch (e) {
      console.error("기존 히스토리 삭제 중 오류(무시 가능):", e.message);
    }

    // 2. 새로운 기록 추가
    await supabaseRequest("search_history", {
      method: "POST",
      body: {
        query: payload.query,
        searched_at: payload.searchedAt,
        result_count: payload.videos.length,
        source: payload.source || "youtube",
        summary: payload.summary
      }
    });
    return;
  }

  // Local JSON: 기존 같은 키워드 기록이 있다면 제거 후 맨 앞에 추가 (중복 방지)
  const history = await readHistory();
  const filteredSearches = (history.searches || []).filter(
    (s) => s.query.trim().toLowerCase() !== payload.query.trim().toLowerCase()
  );

  const nextSearches = [
    {
      query: payload.query,
      searchedAt: payload.searchedAt,
      count: payload.videos.length,
      summary: payload.summary,
      source: payload.source || "youtube"
    },
    ...filteredSearches
  ].slice(0, 100);

  await writeJson(historyPath, { ...history, searches: nextSearches });
}

async function getCachedSearch(cacheKey) {
  if (hasSupabase) {
    const params = new URLSearchParams({
      select: "payload,cached_at",
      cache_key: `eq.${cacheKey}`,
      limit: "1"
    });
    const rows = await supabaseRequest(`search_cache?${params}`);
    const hit = rows[0];
    if (!hit) return null;
    if (Date.now() - new Date(hit.cached_at).getTime() > cacheTtlMs) return null;
    return hit.payload;
  }

  const cache = await readCache();
  const hit = cache[cacheKey];
  if (!hit) return null;
  if (Date.now() - new Date(hit.cachedAt).getTime() > cacheTtlMs) return null;
  return hit.payload;
}

async function setCachedSearch(cacheKey, payload) {
  if (hasSupabase) {
    await supabaseRequest("search_cache?on_conflict=cache_key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: {
        cache_key: cacheKey,
        query: payload.query,
        payload,
        cached_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + cacheTtlMs).toISOString()
      }
    });
    return;
  }

  const cache = await readCache();
  cache[cacheKey] = {
    cachedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + cacheTtlMs).toISOString(),
    payload
  };
  await writeJson(cachePath, pruneCache(cache));
}

async function readCache() {
  if (!existsSync(cachePath)) return {};
  return JSON.parse(await readFile(cachePath, "utf8"));
}

function pruneCache(cache) {
  const entries = Object.entries(cache)
    .filter(([, item]) => Date.now() - new Date(item.cachedAt).getTime() <= cacheTtlMs)
    .sort((a, b) => new Date(b[1].cachedAt).getTime() - new Date(a[1].cachedAt).getTime())
    .slice(0, 300);
  return Object.fromEntries(entries);
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

function makePayload(query, videos, source) {
  return {
    query,
    videos,
    summary: makeSummary(videos),
    searchedAt: new Date().toISOString(),
    source,
    cacheTtlHours: Math.round(cacheTtlMs / 60 / 60 / 1000)
  };
}

async function reserveQuota(cost) {
  const usage = await readUsage();
  if (usage.used + cost > youtubeDailyQuotaLimit) {
    throw new Error(
      `오늘 설정한 YouTube API 사용량 한도(${youtubeDailyQuotaLimit} units)에 도달했습니다. 내일 다시 시도하거나 YOUTUBE_DAILY_QUOTA_LIMIT 값을 조정하세요.`
    );
  }
  const next = { ...usage, used: usage.used + cost, updatedAt: new Date().toISOString() };
  await writeUsage(next);
}

async function readUsage() {
  const today = getPacificDateKey();
  if (hasSupabase) {
    const params = new URLSearchParams({
      select: "quota_date,used_units,updated_at",
      quota_date: `eq.${today}`,
      limit: "1"
    });
    const rows = await supabaseRequest(`youtube_quota_usage?${params}`);
    const row = rows[0];
    if (!row) return { date: today, used: 0, limit: youtubeDailyQuotaLimit };
    return {
      date: row.quota_date,
      used: Number(row.used_units || 0),
      limit: youtubeDailyQuotaLimit,
      updatedAt: row.updated_at
    };
  }

  if (!existsSync(usagePath)) return { date: today, used: 0, limit: youtubeDailyQuotaLimit };
  const usage = JSON.parse(await readFile(usagePath, "utf8"));
  if (usage.date !== today) return { date: today, used: 0, limit: youtubeDailyQuotaLimit };
  return { ...usage, limit: youtubeDailyQuotaLimit };
}

async function writeUsage(usage) {
  if (hasSupabase) {
    await supabaseRequest("youtube_quota_usage?on_conflict=quota_date", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: {
        quota_date: usage.date,
        used_units: usage.used,
        updated_at: usage.updatedAt
      }
    });
    return;
  }

  await writeJson(usagePath, usage);
}

async function saveVideo(video) {
  const savedAt = new Date().toISOString();
  if (hasSupabase) {
    await supabaseRequest("saved_videos?on_conflict=video_id", {
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
    return readSupabaseSavedVideos();
  }

  const history = await readHistory();
  const saved = history.saved || [];
  const exists = saved.some((item) => item.videoId === video.videoId);
  const next = exists ? saved : [{ ...video, savedAt }, ...saved].slice(0, 500);
  await writeJson(historyPath, { ...history, saved: next });
  return next;
}

async function deleteVideo(videoId) {
  if (hasSupabase) {
    await supabaseRequest(`saved_videos?video_id=eq.${encodeURIComponent(videoId)}`, {
      method: "DELETE"
    });
    return readSupabaseSavedVideos();
  }

  const history = await readHistory();
  const saved = (history.saved || []).filter((v) => v.videoId !== videoId);
  await writeJson(historyPath, { ...history, saved });
  return saved;
}

async function readSupabaseSearchHistory() {
  const params = new URLSearchParams({
    select: "query,searched_at,result_count,source,summary",
    order: "searched_at.desc",
    limit: "100"
  });
  const rows = await supabaseRequest(`search_history?${params}`);
  return rows.map((row) => ({
    query: row.query,
    searchedAt: row.searched_at,
    count: row.result_count,
    source: row.source,
    summary: row.summary
  }));
}

async function readSupabaseSavedVideos() {
  const params = new URLSearchParams({
    select: "payload",
    order: "saved_at.desc",
    limit: "500"
  });
  const rows = await supabaseRequest(`saved_videos?${params}`);
  return rows.map((row) => row.payload);
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    method: options.method || "GET",
    headers: {
      apikey: supabaseApiKey,
      Authorization: `Bearer ${supabaseApiKey}`,
      "Content-Type": "application/json",
      "Accept-Profile": supabaseSchema,
      "Content-Profile": supabaseSchema,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase 요청 실패: ${response.status} ${detail}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function getPacificDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
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

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const env = readFileSync(filePath, "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
