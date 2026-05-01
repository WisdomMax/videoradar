create table if not exists public.search_cache (
  cache_key text primary key,
  query text not null,
  payload jsonb not null,
  cached_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists search_cache_expires_at_idx
  on public.search_cache (expires_at);

create index if not exists search_cache_query_idx
  on public.search_cache (query);

create table if not exists public.search_history (
  id bigserial primary key,
  query text not null,
  searched_at timestamptz not null default now(),
  result_count integer not null default 0,
  source text not null default 'youtube',
  summary jsonb not null default '{}'::jsonb
);

create index if not exists search_history_searched_at_idx
  on public.search_history (searched_at desc);

create index if not exists search_history_query_idx
  on public.search_history (query);

create table if not exists public.saved_videos (
  video_id text primary key,
  title text not null,
  channel_title text,
  payload jsonb not null,
  saved_at timestamptz not null default now()
);

create index if not exists saved_videos_saved_at_idx
  on public.saved_videos (saved_at desc);

create table if not exists public.youtube_quota_usage (
  quota_date text primary key,
  used_units integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.search_cache enable row level security;
alter table public.search_history enable row level security;
alter table public.saved_videos enable row level security;
alter table public.youtube_quota_usage enable row level security;
