# crawler 스킬 설계 문서

`/crawling [url]` — 웹페이지 하나를 Playwright로 관찰해 **크롤링 타당성**을 판정하고
상황에 맞는 **권장 기술 스택**을 제시하는 Claude Code 스킬.

## 배경

크롤러를 작성하기 전에는 매번 손으로 조사한다: 이 페이지가 SSR인지 CSR인지, 데이터를
내려주는 API가 따로 있는지, 안티봇이 걸려 있는지, robots.txt는 뭐라 하는지, 그래서
무슨 도구로 짜야 하는지. 이 반복 조사를 자동화해 한 번의 리포트로 정리하는 것이 목표.

**타당성 분석 전용**이다. 실제 대량/샘플 데이터 추출은 하지 않는다. 안티봇 우회도 하지
않으며, 차단 신호는 관찰만 하고 그대로 보고한다.

## 구성

```
crawler/
├── crawling.md      # 스킬 명세 (트리거·워크플로우·리포트 포맷·권장 규칙)
├── analyze.mjs      # Playwright 분석기 (node analyze.mjs <url> → stdout JSON)
├── package.json     # playwright 로컬 의존성
└── README.md        # (이 문서) 설계 개요
```

역할 분리: **`analyze.mjs`는 raw 신호만 관측**하고, **최종 해석·판정·권장은 스킬(Claude)이
`crawling.md` 규칙에 따라** 수행한다.

## analyze.mjs 동작

1. **Preflight (JS 없이)**: `fetch()`로 원본 HTML 확보 → 상태코드, HTML/본문 텍스트 길이,
   태그 카운트. `/robots.txt` 조회 → Disallow 목록.
2. **Playwright (chromium headless)**: 현실적 UA로 접속.
   - 네트워크 캡처: `resourceType`이 xhr/fetch거나 응답이 JSON인 것만. 애널리틱스/텔레메트리
     호스트(GA, GTM, Stripe metrics, Sentry 등)는 제외.
   - `networkidle` 대기 → 실패 시 `domcontentloaded` fallback → 지연 XHR 대비 추가 대기.
3. **렌더 후 추출**: 본문 텍스트 길이, title/meta, 프레임워크 탐지, 반복 리스트/카드 패턴
   selector, 페이지네이션 방식.
4. **판정 힌트 계산**:
   - `renderMode`: 원본 본문 길이 vs 렌더 후 본문 길이 비교 → `SSR` / `CSR` / `hybrid`.
   - `hasDataApi`: 정상 JSON API 존재 여부.
   - `antibot`: 403/429, Cloudflare 챌린지, captcha 마커.

예외는 던지지 않고 `errors[]`에 담아 부분 결과라도 JSON으로 출력한다.

### 출력 JSON 스키마 (개략)

```json
{
  "url": "...", "finalUrl": "...", "status": 200,
  "raw": { "htmlLength": 0, "textLength": 0, "tagCounts": {} },
  "rendered": { "htmlLength": 0, "textLength": 0, "title": "", "meta": "" },
  "renderMode": "SSR|CSR|hybrid",
  "framework": ["next"],
  "structure": { "tables": 0, "lists": 0,
                 "repeatedPatterns": [{ "selector": "", "count": 0 }],
                 "pagination": "none|numbered|infinite" },
  "dataApis": [{ "url": "", "method": "GET", "status": 200,
                 "contentType": "application/json", "isJson": true,
                 "size": 0, "postData": "", "bodySample": "" }],
  "antibot": { "blocked": false, "signals": [] },
  "robots": { "found": true, "disallow": ["..."] },
  "errors": [],
  "hasDataApi": false
}
```

## 권장 기술 결정 규칙 (스킬이 적용)

| 조건 | 권장 |
|------|------|
| 데이터 JSON API 존재 | **API 직접 호출** (`axios`/`httpx`) — 가장 빠르고 안정 |
| SSR/SSG (원본 HTML에 본문) | **`axios` + `cheerio`** 또는 **Scrapy** — JS 불필요 |
| CSR (JS 렌더 필요) | **Playwright / Puppeteer** 헤드리스 |
| 안티봇 감지 (Cloudflare/captcha/403) | 우회 대신 **공식 API·rate-limit·robots 준수** 권고 |

## 판정 신뢰도 / 한계

- 단일 페이지 1회 관측 기반. 로그인 뒤 화면, A/B 분기, 지역별 응답은 반영 못 할 수 있다.
- `renderMode` 는 텍스트 길이 휴리스틱이라 경계 케이스는 `hybrid` 로 떨어질 수 있다.
- 데이터 API가 사용자 인터랙션(스크롤/클릭) 후에만 호출되면 이번 관측에서 누락될 수 있다.

## 보안·컴플라이언스 원칙

- 안티봇 **우회·차단회피를 돕지 않는다.** captcha 풀이·IP 로테이션 팁 등은 다루지 않는다.
- robots.txt·이용약관 준수, rate-limit, User-Agent 명시 등 **예의 있는 크롤링**을 항상 권고.
- Disallow 매칭 경로가 있으면 리포트 상단에 경고.

## 최초 설치

```bash
cd crawler
npm install
npx playwright install chromium
```

## 검증 결과 (초기)

| 대상 | 기대 | 결과 |
|------|------|------|
| `news.ycombinator.com` | SSR, 데이터 API 없음, cheerio 계열 | ✅ SSR / `tbody > tr` ×31 / robots 파싱 |
| `quotes.toscrape.com/js/` | CSR, 반복 패턴 탐지 | ✅ CSR / `div.quote` ×10 |
| `reqres.in` | 데이터 API 탐지 + 트래커 필터 | ✅ 트래커 제거 후 실 JSON API만 노출 |
