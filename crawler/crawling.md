# crawling

> Playwright로 임의의 웹페이지를 분석해 **크롤링 타당성**을 판정하고 권장 기술 스택을 제시하는 스킬.

- **버전**: 0.1.0
- **실행기**: `crawler/analyze.mjs` (Node + Playwright)
- **출력**: 인라인 마크다운 리포트 (파일 저장 안 함)
- **성격**: 타당성 분석 전용. 실제 대량/샘플 데이터 추출은 하지 않는다.

## 트리거

- 슬래시 명령: `/crawling [url]`
- 자연어: "이 페이지 크롤링 가능해?", "크롤링 타당성 봐줘", "이 사이트 어떻게 긁어야 해?"

## 입력

분석할 URL 1개. 없으면 사용자에게 요청한다.

## 워크플로우

1. **환경 가드**
   - `node -v` 확인. Node.js가 없으면 아래 메시지를 출력하고 **스킬을 종료**한다.
     > Node.js가 설치돼 있지 않습니다. `brew install node` 후 다시 실행해 주세요.
2. **의존성 확인**
   - `crawler/` 에 `node_modules/playwright` 가 없으면 안내: `cd crawler && npm install`.
   - chromium 미설치 신호(`CHROMIUM_NOT_INSTALLED`)가 나오면 안내: `cd crawler && npx playwright install chromium`.
3. **분석 실행**
   - `node <skill경로>/analyze.mjs "<url>"` 실행.
   - stderr 에 `PLAYWRIGHT_NOT_INSTALLED` / `CHROMIUM_NOT_INSTALLED` 가 있으면 위 2번 안내로 처리.
4. **JSON 파싱** → 아래 리포트 포맷으로 정리해 인라인 응답. **파일 저장하지 않는다.**

## analyze.mjs 출력 (판단 근거)

| 필드 | 의미 |
|------|------|
| `renderMode` | `SSR` / `CSR` / `hybrid` — raw HTML 본문 길이 vs 렌더 후 본문 길이 비교 |
| `raw` / `rendered` | JS 없이 받은 원본과 렌더 후 DOM 의 길이·태그·본문 텍스트 길이 |
| `framework` | next / nuxt / react-like / vue / angular 탐지 |
| `structure.repeatedPatterns` | 반복 리스트/카드 후보 selector + 개수 (크롤 타겟 후보) |
| `structure.pagination` | none / numbered / infinite |
| `dataApis` | JSON 응답 XHR/fetch 목록 (트래커 제외). url·method·status·bodySample |
| `hasDataApi` | 데이터 성격의 JSON API 존재 여부 |
| `antibot` | 403/429, Cloudflare 챌린지, captcha 신호 |
| `robots` | robots.txt Disallow 목록 |
| `errors` | 부분 실패 내역 (goto 타임아웃 등) |

## 리포트 포맷 (섹션 고정, 이 순서)

```
## 페이지 개요
- URL / 최종 URL / HTTP 상태 / title
- 렌더링 방식: {SSR|CSR|hybrid} + 한 줄 근거
- 프레임워크: {...}

## 페이지 구성 요소
- 주요 구조: 테이블 N / 리스트 N
- 반복 데이터 블록(크롤 타겟 후보): {selector} × {count}
- 페이지네이션: {none|numbered|infinite}

## 데이터 API 요청
| 엔드포인트 | method | status | content-type | 응답 요약 |
|---|---|---|---|---|
(dataApis 각 항목. bodySample 로 무슨 데이터인지 한 줄 요약. 없으면 "감지된 데이터 API 없음")

## 크롤링 가능성 판정
- 판정: {가능 | 조건부 가능 | 어려움}
- 난이도: {하 | 중 | 상}
- 근거: robots.txt / 안티봇 / 렌더링 방식 종합

## 권장 기술 스택
(아래 결정 규칙 적용, 근거와 함께 1~2개 제시)
```

## 권장 기술 결정 규칙

우선순위 순으로 적용한다.

1. **데이터 JSON API 존재 (`hasDataApi=true`)** → **API 직접 호출** (`axios`/`httpx`) 최우선.
   - `dataApis` 의 엔드포인트·method·파라미터를 근거로 예상 요청 형태를 제시.
   - 브라우저 없이 가장 빠르고 안정적.
2. **`renderMode=SSR`** (raw HTML 에 본문 존재) → **`axios` + `cheerio`** 또는 **Scrapy**.
   - JS 실행 불필요. `repeatedPatterns` selector 를 파싱 대상으로 제시.
3. **`renderMode=CSR`** (JS 렌더 필요) → **Playwright / Puppeteer** 헤드리스.
   - 단, 1번(데이터 API)이 있으면 API 직접 호출을 우선 권장.
4. **`antibot.blocked=true` (Cloudflare/captcha/403)** →
   - 우회를 시도하지 말고, **공식 API 확인 · rate-limit 준수 · robots/이용약관 확인**을 권고.
   - 기술적으로는 `playwright-stealth` 존재를 "합법·허용 범위 내" 단서와 함께만 언급.

## HARD RULES

1. **우회·차단회피를 부추기지 않는다.** captcha 풀이, IP 로테이션 회피 팁 등 금지.
2. **robots.txt·이용약관 준수 권고를 항상 포함**한다. Disallow 매칭 경로가 있으면 상단에 경고.
3. **rate-limit / 예의 있는 크롤링**(요청 간격, User-Agent 명시)을 권장에 포함.
4. **실제 데이터 대량 추출 금지.** 이 스킬은 "가능성 판단"까지만 한다.
5. **없는 API·구조를 창작하지 않는다.** `analyze.mjs` 가 실제로 관측한 것만 리포트한다.

## 설치

```bash
# 최초 1회: 의존성 설치
cd crawler && npm install && npx playwright install chromium

# Skill (자연어 트리거용)
ln -s $(pwd)/crawler/crawling.md ~/dev/.claude/skills/crawling.md

# Slash command (/crawling) — 별도 .claude/commands/crawling.md 필요 시 개별 관리
```

## 변경 이력

- v0.1.0 (2026-07-01): 초기 명세. Node Playwright 분석기 + SSR/CSR·데이터 API·안티봇·robots
  판정 후 권장 기술 제시. 인라인 리포트, 타당성 분석 전용.
