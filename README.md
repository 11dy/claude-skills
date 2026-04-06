# Claude Skills

프로젝트별 Claude Code 커스텀 스킬 모음.

## 구조

```
claude-skills/
├── README.md
└── project/
    └── pm-msa/
        └── java-spring-code-review.md
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

## 스킬 목록

| 프로젝트 | 스킬 | 설명 |
|----------|------|------|
| pm-msa | `java-spring-code-review` | Java 25 / Spring Boot 4.x 코드 리뷰 (프로젝트 고유 규칙 포함) |
