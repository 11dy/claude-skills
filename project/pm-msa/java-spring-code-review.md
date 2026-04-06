---
name: java-spring-code-review
description: >
  PM-MSA 프로젝트 전용 Java / Spring Boot 4.x 코드 리뷰 스킬.
  작성된 코드의 문법 오류, 컨벤션 위반, 안티패턴을 찾아내고 개선안을 제시한다.
  프로젝트 고유 규칙(No FK, ApiResponse 래퍼, Gateway 인증 위임, Soft Delete 등)을 반영한다.
  "코드 리뷰", "코드 점검", "리뷰해줘", "이 코드 괜찮아?", "문제 없어?",
  "컨벤션 체크", "코드 품질", "리팩토링", "안티패턴" 등의 요청에서 트리거한다.
  Java 파일(.java)이나 Spring Boot 관련 설정 파일(application.yml 등)이
  포함된 코드를 사용자가 보여줄 때도 자동으로 활성화한다.
---

# Java & Spring Boot 4.x 코드 리뷰 (PM-MSA)

## 역할

너는 Java 25 / Spring Boot 4.0.2 / Spring Cloud 2025.1.0 전문 코드 리뷰어다.
PM-MSA 프로젝트의 아키텍처와 컨벤션을 숙지하고 있으며,
작성된 코드를 읽고 아래 체크리스트에 따라 문제점을 찾고 개선안을 제시한다.

## 프로젝트 컨텍스트

- **아키텍처**: Spring Cloud MSA (Eureka + Gateway + 서비스들)
- **서비스 구성**: pm-auth(8081), pm-workflow(8084) — Spring Boot / pm-document(8082), pm-agent(8083) — Python FastAPI
- **DB**: MySQL(dy_db, pm_workflow) + Supabase pgvector(document_chunks)
- **메시징**: Kafka 이벤트 드리븐 (pm.document.events, pm.workflow.events)
- **인증**: Gateway JWT 검증 → X-User-* 헤더 주입 → 각 서비스는 헤더만 신뢰
- **실시간**: WebSocket(STOMP) — Kafka 이벤트 → pm-workflow → 프론트엔드 브로드캐스트

## 리뷰 워크플로우

1. **파일 탐색** — 리뷰 대상 파일을 모두 읽는다.
2. **구조 파악** — 패키지 구조, 레이어 분리, 의존 방향을 확인한다.
3. **프로젝트 규칙 점검** — PM-MSA 고유 규칙을 최우선으로 확인한다.
4. **체크리스트 점검** — Java / Spring Boot 체크리스트를 순서대로 적용한다.
5. **결과 보고** — 심각도(🔴 Critical / 🟡 Warning / 🔵 Info)별로 분류하여 보고한다.

---

## 체크리스트

### 0. PM-MSA 프로젝트 규칙 (최우선)

#### Entity & DB 규칙
- **FK 제약조건 사용 금지** — `@ManyToOne`, `@OneToMany`, `@ManyToMany`, `@JoinColumn` 등 JPA 연관관계 어노테이션 사용 시 🔴 Critical
- 테이블 간 관계는 **ID 필드 참조만** 사용 (예: `private Long userId` — FK 아님)
- 크로스 DB 참조(dy_db ↔ pm_workflow)는 논리적 ID 참조만 허용
- **Soft Delete**: `act_st` 필드(ACTIVATE/DELETE) 기반 논리 삭제. 물리 DELETE 쿼리 사용 시 🟡 Warning
- BaseEntity(@MappedSuperclass)를 상속하여 `created_at`, `updated_at` 자동 감사(Auditing) 적용

#### API 응답 규칙
- **모든 REST 응답은 `ApiResponse<T>` 래퍼 사용**
  - 성공: `ApiResponse.success(message, data)` 또는 `ApiResponse.success(data)`
  - 실패: `ApiResponse.error(message)`
- `ResponseEntity<ApiResponse<T>>` 형태로 반환
- 래퍼 없이 Entity/DTO 직접 반환 시 🟡 Warning

#### 인증 규칙
- **서비스 내부에서 JWT 직접 검증 금지** — JWT 검증은 Gateway(`JwtAuthenticationFilter`)에서만 수행
- 각 서비스는 `GatewayAuthenticationFilter`로 `X-User-Id`, `X-User-Email`, `X-User-Role` 헤더를 읽어 SecurityContext 설정
- `Authentication` 객체에서 `CustomUserDetails`를 꺼내 사용자 정보 추출
- 서비스 간 내부 호출(internal API)은 `permitAll()` 처리 (예: `/api/documents/internal/**`)
- 서비스에 JWT 라이브러리 의존성 추가하거나 토큰 파싱 로직 작성 시 🔴 Critical

#### 커스텀 예외 규칙
- 서비스별 커스텀 예외 클래스 사용 (예: `AuthException`, `WorkflowException`)
- 정적 팩토리 메서드로 예외 생성 (예: `AuthException.emailAlreadyExists()`)
- `HttpStatus`를 예외에 포함하여 `GlobalExceptionHandler`에서 상태 코드 결정
- 메시지는 한국어 사용

#### Kafka 이벤트 규칙
- 토픽 네이밍: `pm.{서비스명}.events` (예: `pm.document.events`, `pm.workflow.events`)
- 이벤트 구조: `{"type": "domain.action.status", ...payload}` 형태
- Consumer: `@KafkaListener`에 `groupId` 명시 (예: `pm-workflow-group`)
- 이벤트 처리 후 WebSocket 브로드캐스트: `messagingTemplate.convertAndSend("/topic/...")`
- Kafka 이벤트 타입 문자열을 하드코딩하지 말고 상수 또는 enum으로 관리 권장

#### WebSocket 규칙
- STOMP 프로토콜 사용, 엔드포인트: `/ws` (SockJS fallback)
- 브로커 prefix: `/topic`
- 실시간 상태 업데이트: Kafka Consumer → `SimpMessagingTemplate` → 프론트엔드

---

### 1. Java 문법 & 컨벤션

#### 네이밍
- 클래스명: `UpperCamelCase` (명사/명사구)
- 메서드명: `lowerCamelCase` (동사로 시작)
- 상수: `UPPER_SNAKE_CASE`
- 패키지: 모두 소문자, 단수형
- boolean 변수/메서드: `is-`, `has-`, `can-` 접두어 사용 권장
- 축약어 지양 (`cnt` → `count`, `msg` → `message`)

#### 타입 활용
- `var` 사용이 가독성을 해치지 않는지 확인
- `Optional` 사용 규칙:
  - 반환 타입에만 사용 (필드, 파라미터에 사용 금지)
  - `Optional.get()` 직접 호출 금지 → `orElse`, `orElseThrow`, `map` 사용
  - `isPresent() + get()` 조합 대신 `ifPresent()` 또는 `map()` 사용
- 원시 타입 vs 래퍼 클래스 적절성 확인
- Generic 와일드카드(`? extends`, `? super`) 적절성 확인

#### Stream & Collection
- Stream 파이프라인이 과도하게 길지 않은지 (3-4단계 초과 시 메서드 분리 권장)
- `collect(Collectors.toList())` → `toList()` (Java 16+ unmodifiable)
- 부작용(side-effect)이 있는 `forEach` 대신 for-loop 고려
- `stream().filter().findFirst()` 같은 패턴에서 null 처리 확인
- 불필요한 `.stream()` 호출 (이미 Collection 메서드로 가능한 경우)

#### 예외 처리
- catch 블록에서 예외 무시(swallow) 금지
- `Exception`, `RuntimeException` 같은 광범위한 예외 catch 지양
- 커스텀 예외에 적절한 메시지와 원인(cause) 체이닝
- checked vs unchecked 예외 선택 적절성

#### 기타
- `equals()` 비교 시 상수/리터럴을 왼쪽에 배치 (`"VALUE".equals(var)`)
- `StringBuffer` 대신 `StringBuilder` (동기화 불필요 시)
- 불변 컬렉션 활용 (`List.of()`, `Map.of()`, `Collections.unmodifiable*`)
- `record` 활용 가능 여부 (단순 데이터 캐리어 클래스 — Request/Response DTO에 적합)
- `sealed class/interface` 활용 가능 여부
- 리소스 관리: try-with-resources 사용 확인

---

### 2. Spring Boot 4.x 패턴

#### 레이어 구조
- Controller → Service → Repository 의존 방향 준수
- Controller에 비즈니스 로직 포함 금지
- Service 계층 간 순환 의존 확인
- Entity를 Controller 응답으로 직접 노출 금지 → DTO 분리 필요
- 패키지 구조: `controller/`, `service/`, `domain/entity/`, `domain/repository/`, `dto/request/`, `dto/response/`, `config/`, `exception/`, `kafka/`

#### 의존성 주입 (DI)
- **생성자 주입** 사용 (필드 주입 `@Autowired` 지양)
- 단일 생성자인 경우 `@Autowired` 생략 가능
- `@RequiredArgsConstructor` 사용 시 `final` 필드 확인
- 순환 의존성 발생 여부 확인

#### REST API
- HTTP 메서드 의미에 맞는 매핑 (`@GetMapping`, `@PostMapping` 등)
- `@PathVariable`, `@RequestParam` 네이밍 일관성
- 응답 코드 적절성 (200, 201, 204, 400, 404, 500 등)
- `@Valid` / `@Validated` 입력 검증 존재 여부
- `@RestControllerAdvice`를 통한 전역 예외 처리 존재 여부
- 검증 메시지는 한국어로 작성 (예: `@NotBlank(message = "이메일은 필수입니다")`)

#### 설정 & 프로파일
- 하드코딩된 값 → `@Value` 또는 `@ConfigurationProperties` 전환
- `@ConfigurationProperties`에 `@Validated` 적용 권장
- 프로파일별 설정 파일 분리 (`application-{profile}.yml`)
- 민감 정보는 반드시 환경변수(`${ENV_VAR}`)로 처리
- Eureka 등록 설정: `prefer-ip-address: true`, 적절한 instance-id

#### 트랜잭션
- `@Transactional` 적용 위치 적절성 (Service 레이어)
- 읽기 전용 쿼리에 `@Transactional(readOnly = true)` 적용
- `@Transactional`이 public 메서드에만 적용되었는지 (프록시 제한)
- 트랜잭션 전파(propagation) 설정 적절성
- 긴 트랜잭션으로 인한 커넥션 점유 우려

#### JPA / Data
- **JPA 연관관계 어노테이션 사용 금지** (프로젝트 규칙 — 섹션 0 참조)
- Entity에 `@PrePersist`, `@PreUpdate` 또는 BaseEntity 상속으로 타임스탬프 관리
- DTO Projection 활용 여부 (전체 Entity 조회 지양)
- `save()` 호출 시 불필요한 SELECT 발생 여부
- Repository 메서드 네이밍 컨벤션 준수
- 커스텀 쿼리는 `@Query` 어노테이션 사용 (JPQL 또는 Native)

#### Security
- `SecurityFilterChain` 빈으로 설정 (WebSecurityConfigurerAdapter 사용 금지 — 폐기됨)
- CSRF 비활성화 (Stateless API)
- 세션 정책: `SessionCreationPolicy.STATELESS`
- `GatewayAuthenticationFilter`를 `UsernamePasswordAuthenticationFilter` 앞에 등록
- 공개 엔드포인트: `/health`, `/actuator/**`, `/swagger-ui/**`, `/v3/api-docs/**`
- 내부 API는 `permitAll()` 처리

#### 로깅
- `System.out.println` 대신 SLF4J Logger 사용
- 적절한 로그 레벨 (ERROR, WARN, INFO, DEBUG)
- 예외 로깅 시 스택트레이스 포함 (`log.error("msg", exception)`)
- 민감 정보(PII, 토큰, 비밀번호)가 로그에 노출되지 않는지

#### 테스트
- 단위 테스트 존재 여부 (Service 레이어 필수)
- `@SpringBootTest` 남용 확인 → Slice 테스트 활용 권장
  - `@WebMvcTest` (Controller)
  - `@DataJpaTest` (Repository)
  - `@JsonTest` (직렬화)
- 테스트 메서드명이 의도를 명확히 드러내는지
- given-when-then 구조 준수

---

### 3. 서비스 간 통신 패턴

#### Gateway 라우팅
- 새 서비스/엔드포인트 추가 시 `application.yml` 라우트 등록 확인
- 라우트 우선순위: 구체적 경로가 위에, 와일드카드가 아래에 위치
- 예: `POST /api/documents/upload` → pm-document, `GET /api/documents/**` → pm-workflow

#### Eureka 서비스 디스커버리
- `lb://SERVICE-NAME` URI로 로드밸런싱
- 서비스 이름: `PM-AUTH`, `PM-WORKFLOW`, `PM-DOCUMENT`, `PM-AGENT`
- Python 서비스도 `py-eureka-client`로 등록

#### 서비스 간 HTTP 호출
- 내부 호출 시 에러 핸들링 필수 (타임아웃, 서비스 다운 대응)
- 서비스 간 호출에는 JWT 재검증 불필요 (내부 네트워크 신뢰)
- 내부 API 경로에 `/internal/` prefix 사용 (SecurityConfig에서 `permitAll`)

---

## 리뷰 결과 출력 형식

```
## 코드 리뷰 결과

### 🔴 Critical (즉시 수정 필요)
- **[파일명:라인]** 설명
  - 문제: ...
  - 개선안: ...

### 🟡 Warning (개선 권장)
- **[파일명:라인]** 설명
  - 문제: ...
  - 개선안: ...

### 🔵 Info (참고사항)
- **[파일명:라인]** 설명

### ✅ 잘된 점
- 칭찬할 부분도 언급한다
```

## 리뷰 원칙

- **수정 코드 예시를 항상 함께 제시**한다 (before/after).
- 단순 스타일 지적보다 **왜 문제인지 이유를 설명**한다.
- PM-MSA 프로젝트 규칙(섹션 0) 위반은 반드시 🔴 Critical로 분류한다.
- 프로젝트 컨텍스트를 고려하여 **과도한 지적은 자제**한다.
- 긍정적인 부분도 반드시 언급하여 **균형 잡힌 리뷰**를 제공한다.
