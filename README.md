<div align="center">
  <img src="docs/assets/logo.png" width="120" alt="VideoRadar Logo" />
  <h1>VideoRadar (비디오레이더)</h1>
  <p><b>"유튜브 데이터의 바다에서 가치 있는 영상을 찾아내는 가장 정교한 레이더"</b></p>

  [![Version](https://img.shields.io/badge/version-1.0.0-00897b.svg)]()
  [![License](https://img.shields.io/badge/license-MIT-blue.svg)]()
  [![Platform](https://img.shields.io/badge/platform-Web-orange.svg)]()
</div>

<br />

## 🌟 개요 (Overview)
**VideoRadar**는 단순한 검색 도구를 넘어, 유튜브 생태계 내의 영상 데이터를 분석하여 **성과도(Performance)**와 **기여도(Contribution)**를 자동으로 산출해주는 지능형 리서치 대시보드입니다. 마케터, 크리에이터, 그리고 데이터 분석가들이 가장 효율적인 영상을 빠르게 발굴할 수 있도록 설계되었습니다.

<br />

## ✨ 핵심 기능 (Key Features)

### 📊 지능형 데이터 분석
- **성과 지표 산출**: 단순 조회수를 넘어 구독자 수 대비 조회수 비율을 계산하여 실제 '성과'가 좋은 영상을 선별합니다.
- **기여도 평가**: 영상이 채널 성장에 얼마나 기여했는지를 직관적인 등급(Great, Good, Normal, Bad, Worst)으로 표시합니다.

### 🔍 정교한 필터링 및 리서치
- **맞춤형 필터**: 쇼츠 포함 여부, 조회수 범위 설정 등을 통해 원하는 데이터만 정밀하게 타겟팅합니다.
- **실시간 결과 내 검색**: 수집된 수백 개의 결과 중 키워드나 채널명으로 즉시 재필터링이 가능합니다.

### 💾 스마트 히스토리 시스템
- **데이터 캐싱**: 검색했던 키워드는 DB에 안전하게 보관되어 API 사용량을 절약하고 빠른 로딩을 보장합니다.
- **강제 갱신 기능**: 최신 데이터가 필요할 땐 '다시 검색' 버튼 하나로 캐시를 우회하여 실시간 데이터를 수집합니다.

<br />

## 📸 서비스 미리보기 (Screenshots)

### 🖥️ 메인 분석 대시보드 (PC)
복잡한 데이터를 한눈에 파악할 수 있는 그리드 레이아웃과 실시간 통계 카드를 제공합니다.
![메인 대시보드](docs/screenshots/pc-main-dashboard.png)

### 📑 검색 히스토리 관리
과거의 리서치 기록을 체계적으로 관리하고 원할 때 언제든 다시 분석할 수 있습니다.
![검색 히스토리](docs/screenshots/pc-search-history.png)

### 📱 모바일 최적화 (Mobile First)
현장에서도 즉시 리서치가 가능하도록 완벽한 카드형 모바일 인터페이스를 지원합니다.
![모바일 검색 결과](docs/screenshots/mobile-search-result.png)

<br />

## 🛠 기술 스택 (Tech Stack)

### **Frontend**
- **Vanilla JavaScript**: 순수 자바스크립트를 통한 극한의 퍼포먼스 최적화
- **HTML5 / CSS3**: 현대적인 그래픽 요소와 부드러운 애니메이션 구현

### **Backend & Database**
- **Node.js & Express**: 확장성 있는 서버 아키텍처
- **Supabase (PostgreSQL)**: 실시간 데이터 동기화 및 안정적인 히스토리 관리

### **External API**
- **YouTube Data API v3**: 유튜브의 방대한 원천 데이터 활용

<br />

## 🚀 시작하기 (Getting Started)

### 환경 설정 (.env)
```env
YOUTUBE_API_KEY=당신의_API_키
SUPABASE_URL=당신의_수파베이스_URL
SUPABASE_KEY=당신의_수파베이스_키
PORT=3000
```

### 실행 방법
```bash
npm install
npm start
```

---
<div align="center">
  Copyright © 2026 VideoRadar Project. All rights reserved.
</div>
