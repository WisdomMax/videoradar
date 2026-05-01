# YouTube Research Dashboard

키워드로 YouTube 영상을 검색하고 조회수, 구독자, 기여도, 성과도, 노출 확률, Shorts 여부를 비교하는 개인용 리서치 대시보드입니다.

## 실행

1. Google Cloud Console에서 YouTube Data API v3 키를 발급합니다.
2. `.env.example`을 복사해 `.env`를 만들고 `YOUTUBE_API_KEY`를 입력합니다.
3. 서버를 실행합니다.

```bash
npm run dev
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다.

## 구현 범위

- YouTube Data API `search`, `videos`, `channels` 호출
- 같은 검색 조건 24시간 캐시
- YouTube API 요청 간 최소 간격 제한
- 일일 quota 예산 제한
- 동일 검색 동시 요청 합치기
- 검색 결과 테이블
- 조회수, 구독자, 총 영상 수, 게시일, Shorts 여부 표시
- 기여도: 조회수 대비 구독자 규모 기반 상대 점수
- 성과도: 조회수와 일평균 조회수 기반 상대 점수
- 노출 확률: 일평균 조회수 기반 상대 점수
- 결과 내 검색, 조회수 범위, 등급, Shorts 필터
- CSV 내보내기
- 저장한 영상과 검색 히스토리 저장
- Supabase 설정이 있으면 Supabase 저장, 없으면 로컬 JSON 저장

## Supabase 연결

Supabase 프로젝트를 만든 뒤 SQL Editor에서 [supabase/schema.sql](./supabase/schema.sql)을 실행합니다.

`.env`에 아래 값을 채웁니다.

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_API_KEY=your_secret_api_key_here
SUPABASE_SCHEMA=public
```

`SUPABASE_API_KEY`에는 Supabase의 Secret key를 넣는 것을 권장합니다. 이 값은 서버에서만 사용합니다. 브라우저 코드에는 절대 넣지 않습니다.

Publishable key를 쓰려면 RLS 정책을 직접 열어야 합니다. 이 앱은 개인 서버가 DB 캐시를 쓰는 구조라 Secret key를 `.env`에 두는 방식이 더 단순합니다.

Supabase 설정값이 비어 있으면 앱은 자동으로 `data/*.json` 로컬 저장을 사용합니다.

## Cloudflare Pages 배포

Cloudflare Pages에서는 Node 서버인 `server.js`가 실행되지 않고 `functions/api/*`의 Pages Functions가 API를 처리합니다.

권장 설정:

```text
Framework preset: None
Build command: 비워두기
Build output directory: public
Root directory: /
```

Cloudflare 변수:

```bash
YOUTUBE_API_KEY=...
SUPABASE_URL=...
SUPABASE_API_KEY=...
SUPABASE_SCHEMA=public
SEARCH_CACHE_TTL_HOURS=24
YOUTUBE_MIN_INTERVAL_MS=1500
YOUTUBE_DAILY_QUOTA_LIMIT=9000
```

`HOST`와 `PORT`는 로컬 Node 서버용이라 Cloudflare Pages에서는 필요하지 않습니다.

## API 비용과 제한

YouTube Data API는 무료 할당량이 있지만 무제한은 아닙니다. 기본 할당량은 일 단위 quota로 관리되며, 이 앱의 검색 1회는 보통 `search.list` 1회와 `videos.list`, `channels.list` 각 1회를 사용합니다.

현재 기본 보호 설정:

```bash
SEARCH_CACHE_TTL_HOURS=24
YOUTUBE_MIN_INTERVAL_MS=1500
YOUTUBE_DAILY_QUOTA_LIMIT=9000
```

`search.list`는 quota 비용이 큰 편이라 같은 키워드와 정렬 조건은 캐시에서 재사용하는 방식이 중요합니다. Supabase를 연결하면 `search_cache` 테이블을 우선 사용합니다.
