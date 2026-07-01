#!/usr/bin/env node
// crawling 스킬용 Playwright 분석기.
// 사용법: node analyze.mjs <url>
// 출력: stdout 에 단일 JSON. 크롤링 "타당성" 판단에 필요한 raw 신호만 수집한다.
//       최종 해석/권장 기술은 스킬(Claude)이 이 JSON 을 읽어 정리한다.
//
// 설계 원칙
// - 실제 대량/샘플 데이터 추출은 하지 않는다(타당성 분석 전용).
// - 예외는 throw 하지 않고 errors[] 에 담아 부분 결과라도 JSON 으로 내보낸다.
// - 안티봇 우회는 하지 않는다. 차단 신호는 "관찰"만 하고 그대로 보고한다.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const NAV_TIMEOUT = 25_000;
const SETTLE_MS = 2_500; // 지연 XHR 대비 추가 대기
const BODY_SAMPLE_LIMIT = 2_048; // 응답 본문 절단 길이

// 데이터 API 후보에서 제외할 애널리틱스/텔레메트리 호스트 (크롤 대상 데이터가 아님)
const TRACKER_HOSTS = [
  "google-analytics.com", "googletagmanager.com", "doubleclick.net",
  "google.com/ads", "googleadservices.com", "facebook.com", "facebook.net",
  "connect.facebook", "segment.io", "segment.com", "mixpanel.com",
  "hotjar.com", "sentry.io", "sentry-cdn", "m.stripe.com", "stripe.com/6",
  "amplitude.com", "clarity.ms", "datadoghq", "newrelic.com", "nr-data.net",
  "bat.bing.com", "analytics.tiktok", "snap.licdn", "ads-twitter",
];
function isTracker(u) {
  return TRACKER_HOSTS.some((h) => u.includes(h));
}

const result = {
  url: null,
  finalUrl: null,
  status: null,
  raw: { htmlLength: 0, textLength: 0, tagCounts: {} },
  rendered: { htmlLength: 0, textLength: 0, title: "", meta: "" },
  renderMode: "unknown",
  framework: [],
  structure: { tables: 0, lists: 0, repeatedPatterns: [], pagination: "none" },
  dataApis: [],
  antibot: { blocked: false, signals: [] },
  robots: { found: false, disallow: [], note: null },
  errors: [],
};

function emitAndExit(code = 0) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(code);
}

// --- CLI 인자 ---
const url = process.argv[2];
if (!url) {
  process.stderr.write("usage: node analyze.mjs <url>\n");
  process.exit(1);
}
try {
  // 유효성 검사 + 정규화
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("http/https URL 만 지원");
  result.url = u.href;
} catch (e) {
  process.stderr.write(`invalid url: ${e.message}\n`);
  process.exit(1);
}

// --- Playwright 로드 (미설치 시 안내 후 종료) ---
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    process.stderr.write(
      "PLAYWRIGHT_NOT_INSTALLED: playwright 모듈을 찾을 수 없습니다.\n" +
        "설치: npm i -D playwright && npx playwright install chromium\n"
    );
    process.exit(3);
  }
}

// --- 1) Preflight: JS 없이 raw HTML + robots.txt ---
function textFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tagCounts(html) {
  const tags = ["div", "span", "a", "p", "li", "tr", "img", "article", "section"];
  const counts = {};
  for (const t of tags) {
    const m = html.match(new RegExp(`<${t}[\\s>]`, "gi"));
    counts[t] = m ? m.length : 0;
  }
  return counts;
}

try {
  const res = await fetch(result.url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
  });
  result.status = res.status;
  const html = await res.text();
  result.raw.htmlLength = html.length;
  result.raw.textLength = textFromHtml(html).length;
  result.raw.tagCounts = tagCounts(html);
  if (res.status === 403 || res.status === 429) {
    result.antibot.blocked = true;
    result.antibot.signals.push(`preflight HTTP ${res.status}`);
  }
  if (/cf-browser-verification|challenge-platform|__cf_chl/i.test(html)) {
    result.antibot.blocked = true;
    result.antibot.signals.push("Cloudflare challenge marker (preflight)");
  }
} catch (e) {
  result.errors.push(`preflight fetch 실패: ${e.message}`);
}

try {
  const origin = new URL(result.url).origin;
  const r = await fetch(origin + "/robots.txt", { headers: { "User-Agent": UA } });
  if (r.ok) {
    result.robots.found = true;
    const txt = await r.text();
    // 매우 단순 파싱: Disallow 라인만 수집 (User-agent 그룹 구분 없이 관찰용)
    const disallow = [];
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*Disallow:\s*(\S+)/i);
      if (m) disallow.push(m[1]);
    }
    result.robots.disallow = [...new Set(disallow)].slice(0, 50);
  }
} catch (e) {
  result.robots.note = `robots.txt 확인 실패: ${e.message}`;
}

// --- 2) Playwright: 네트워크 캡처 + 렌더 ---
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (e) {
  if (/Executable doesn't exist|install/i.test(e.message)) {
    process.stderr.write(
      "CHROMIUM_NOT_INSTALLED: chromium 브라우저가 없습니다.\n" +
        "설치: npx playwright install chromium\n"
    );
    result.errors.push("chromium 미설치");
    emitAndExit(3);
  }
  result.errors.push(`browser launch 실패: ${e.message}`);
  emitAndExit(0);
}

try {
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  // 요청/응답 매칭용 임시 저장소
  const pending = new Map(); // request -> {url, method, resourceType, postData}
  const apis = [];

  page.on("request", (req) => {
    const rt = req.resourceType();
    if (rt === "xhr" || rt === "fetch") {
      let postData = null;
      try {
        postData = req.postData();
      } catch {
        /* noop */
      }
      pending.set(req, {
        url: req.url(),
        method: req.method(),
        resourceType: rt,
        postData: postData ? postData.slice(0, 512) : null,
      });
    }
  });

  page.on("response", async (res) => {
    const req = res.request();
    const meta = pending.get(req);
    const ct = (res.headers()["content-type"] || "").toLowerCase();
    const isJson = ct.includes("json");
    // XHR/fetch 이거나 JSON 응답인 것만 데이터 API 후보로
    if (!meta && !isJson) return;
    if (isTracker(res.url())) return; // 애널리틱스/텔레메트리 제외
    if (apis.length >= 40) return; // 폭주 방지

    let bodySample = null;
    let size = null;
    if (isJson) {
      try {
        const buf = await res.body();
        size = buf.length;
        bodySample = buf.toString("utf8").slice(0, BODY_SAMPLE_LIMIT);
      } catch {
        /* streaming/redirect 등은 본문 확보 실패 가능 */
      }
    }
    apis.push({
      url: (meta?.url || res.url()).slice(0, 500),
      method: meta?.method || req.method(),
      status: res.status(),
      resourceType: meta?.resourceType || req.resourceType(),
      contentType: ct,
      isJson,
      size,
      postData: meta?.postData || null,
      bodySample,
    });
    pending.delete(req);
  });

  // 응답 상태로 안티봇 관찰
  let mainStatus = null;
  page.on("response", (res) => {
    if (mainStatus === null && res.url() === result.url) mainStatus = res.status();
  });

  let navOk = true;
  try {
    const resp = await page.goto(result.url, {
      waitUntil: "networkidle",
      timeout: NAV_TIMEOUT,
    });
    if (resp) {
      result.finalUrl = resp.url();
      if (result.status === null) result.status = resp.status();
    }
  } catch (e) {
    navOk = false;
    result.errors.push(`networkidle 대기 실패, domcontentloaded 로 재시도: ${e.message}`);
    try {
      const resp = await page.goto(result.url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT,
      });
      if (resp) {
        result.finalUrl = resp.url();
        if (result.status === null) result.status = resp.status();
      }
      navOk = true;
    } catch (e2) {
      result.errors.push(`goto 최종 실패: ${e2.message}`);
    }
  }

  if (navOk) {
    await page.waitForTimeout(SETTLE_MS);

    // --- 3) 렌더 후 추출 ---
    const extracted = await page.evaluate(() => {
      const txt = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const html = document.documentElement.outerHTML;

      // 프레임워크 탐지
      const fw = [];
      if (document.getElementById("__NEXT_DATA__") || window.__NEXT_DATA__) fw.push("next");
      if (window.__NUXT__ || document.getElementById("__nuxt")) fw.push("nuxt");
      if (document.querySelector("[data-reactroot],#root,#__next")) fw.push("react-like");
      if (document.querySelector("[ng-version]")) fw.push("angular");
      if (window.__VUE__ || document.querySelector("[data-v-app],#app[data-server-rendered]"))
        fw.push("vue");

      // 반복 리스트 패턴 탐지: 동일 태그+클래스 자식이 많은 컨테이너
      const patterns = [];
      const containers = document.querySelectorAll("ul,ol,tbody,div,section");
      const seen = new Set();
      for (const c of containers) {
        const kids = Array.from(c.children);
        if (kids.length < 5) continue;
        const sig = {};
        for (const k of kids) {
          const key = k.tagName + "." + (k.className || "").toString().trim().split(/\s+/)[0];
          sig[key] = (sig[key] || 0) + 1;
        }
        const [topKey, topCount] = Object.entries(sig).sort((a, b) => b[1] - a[1])[0] || [];
        if (topCount >= 5) {
          const sel =
            (c.tagName.toLowerCase() +
              (c.id ? "#" + c.id : c.className ? "." + String(c.className).trim().split(/\s+/)[0] : "")) +
            " > " +
            topKey.toLowerCase();
          if (!seen.has(sel)) {
            seen.add(sel);
            patterns.push({ selector: sel, count: topCount });
          }
        }
      }
      patterns.sort((a, b) => b.count - a.count);

      // 페이지네이션 신호
      let pagination = "none";
      if (document.querySelector('a[rel="next"], .pagination, .pager, nav[aria-label*="agination"]'))
        pagination = "numbered";
      if (/load more|더보기|무한|infinite/i.test(html) || html.includes("IntersectionObserver"))
        pagination = pagination === "numbered" ? "numbered+infinite" : "infinite";

      return {
        htmlLength: html.length,
        textLength: txt.length,
        title: document.title || "",
        meta: document.querySelector('meta[name="description"]')?.content || "",
        framework: fw,
        tables: document.querySelectorAll("table").length,
        lists: document.querySelectorAll("ul,ol").length,
        patterns: patterns.slice(0, 8),
        pagination,
        bodyHtmlSnippet: html.slice(0, 400),
      };
    });

    result.rendered.htmlLength = extracted.htmlLength;
    result.rendered.textLength = extracted.textLength;
    result.rendered.title = extracted.title;
    result.rendered.meta = extracted.meta;
    result.framework = extracted.framework;
    result.structure.tables = extracted.tables;
    result.structure.lists = extracted.lists;
    result.structure.repeatedPatterns = extracted.patterns;
    result.structure.pagination = extracted.pagination;

    // 안티봇: 렌더 HTML 마커
    if (/cf-browser-verification|challenge-platform|__cf_chl|hcaptcha|recaptcha/i.test(
        extracted.bodyHtmlSnippet + extracted.title)) {
      result.antibot.blocked = true;
      result.antibot.signals.push("challenge/captcha marker (rendered)");
    }
    if (mainStatus && (mainStatus === 403 || mainStatus === 429)) {
      result.antibot.blocked = true;
      result.antibot.signals.push(`main response HTTP ${mainStatus}`);
    }
  }

  result.dataApis = apis;

  // --- renderMode 판정 ---
  const rawT = result.raw.textLength;
  const rendT = result.rendered.textLength;
  const hasJsonApi = apis.some((a) => a.isJson && a.status < 400);
  result.antibot.blocked = result.antibot.blocked || false;

  if (rendT === 0 && rawT === 0) {
    result.renderMode = "unknown";
  } else if (rawT >= rendT * 0.6 && rawT > 200) {
    result.renderMode = "SSR"; // raw HTML 에 본문 대부분 존재
  } else if (rawT < 200 || rawT < rendT * 0.3) {
    result.renderMode = "CSR"; // 렌더/XHR 후 본문 채워짐
  } else {
    result.renderMode = "hybrid";
  }
  result.hasDataApi = hasJsonApi;

  await context.close();
} catch (e) {
  result.errors.push(`분석 중 예외: ${e.message}`);
} finally {
  if (browser) await browser.close().catch(() => {});
}

emitAndExit(0);
