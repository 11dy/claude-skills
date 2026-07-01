# Claude Skills

프로젝트별 Claude Code 커스텀 스킬 모음.

## 구조

```
claude-skills/
├── README.md
├── project/
│   └── pm-msa/
│       └── java-spring-code-review.md
├── blog/
│   └── blog-draft.md
└── crawler/
    ├── crawling.md
    └── analyze.mjs
```

## 사용법

### 프로젝트에 적용

스킬 파일을 대상 프로젝트의 `.claude/skills/` 디렉토리에 복사(또는 심볼릭 링크)한다.

```bash
# 복사
cp project/pm-msa/java-spring-code-review.md /path/to/pm-msa/.claude/skills/

# 또는 심볼릭 링크
ln -s $(pwd)/project/pm-msa/java-spring-code-review.md /path/to/pm-msa/.claude/skills/
```

### 트리거

- 자동: Java 파일이나 Spring Boot 설정 파일을 다룰 때 자동 활성화
- 수동: "코드 리뷰해줘", "이 코드 괜찮아?" 등의 요청

### crawler 스킬 최초 설정

`crawling` 스킬은 Playwright 실행이 필요하므로 최초 1회 의존성 설치가 필요하다.

```bash
cd crawler
npm install
npx playwright install chromium
```

사용: `/crawling [url]` 또는 "이 페이지 크롤링 가능해?" 등의 자연어. 자세한 내용은
[`crawler/README.md`](crawler/README.md) 참고.

## 스킬 목록

| 프로젝트 | 스킬 | 설명 |
|----------|------|------|
| pm-msa | `java-spring-code-review` | Java 25 / Spring Boot 4.x 코드 리뷰 (프로젝트 고유 규칙 포함) |
| blog | `blog-draft` | 현재 세션의 작업 내용을 11dy.tistory.com 톤 블로그 초안으로 정리해 `~/dev/log_for_blog/`에 저장 (`/blog` 또는 자연어 트리거) |
| crawler | `crawling` | URL의 크롤링 타당성 분석 — Playwright로 렌더링 방식·데이터 API·안티봇·robots 판정 후 권장 기술 제시 (`/crawling [url]`) |
