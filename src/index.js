const BOOK_ASSET_PREFIX = "/assets/books/";
const FALLBACK_COVER = "/assets/books/cover-unavailable.svg";
const FALLBACK_ASSET = "/assets/asset-unavailable.svg";
const HEALTH_PATH = "/__site-health";
const IMAGE_ASSET = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
const WORKBOOK_DOWNLOAD_PATH = "/download/make-the-show-workbook";
const WORKBOOK_OBJECT_KEY = "make-the-show-workbook.pdf";
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; font-src 'self' https: data:; media-src 'self' https: blob:; frame-src https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self' https://seasoned-tech-newsletter.mike-663.workers.dev; frame-ancestors 'none'; upgrade-insecure-requests",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "x-frame-options": "DENY",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol === "http:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      url.protocol = "https:";
      return withSecurityHeaders(Response.redirect(url.toString(), 301));
    }
    if (url.pathname === HEALTH_PATH) {
      return withSecurityHeaders(await healthResponse(env));
    }
    if (url.pathname === "/newsletter" || url.pathname === "/newsletter/") {
      return withSecurityHeaders(Response.redirect(new URL("/#newsletter", url).toString(), 301));
    }
    if (url.pathname === WORKBOOK_DOWNLOAD_PATH) {
      return withSecurityHeaders(await workbookDownload(request, env));
    }

    const response = await env.ASSETS.fetch(request);
    if (IMAGE_ASSET.test(url.pathname) && url.pathname.startsWith("/assets/") && response.status === 404) {
      ctx.waitUntil(logFallback(url.pathname));
      const fallbackPath = url.pathname.startsWith(BOOK_ASSET_PREFIX) ? FALLBACK_COVER : FALLBACK_ASSET;
      const fallback = await env.ASSETS.fetch(new Request(new URL(fallbackPath, url), request));
      const headers = new Headers(fallback.headers);
      headers.set("x-tmh-fallback", fallbackPath);
      return withSecurityHeaders(new Response(fallback.body, { status: fallback.status, headers }));
    }
    return withSecurityHeaders(response);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runHealthCheck(env));
  },
};

function withSecurityHeaders(response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    secured.headers.set(name, value);
  }
  return secured;
}

async function healthResponse(env) {
  const report = await runHealthCheck(env);
  return Response.json(report, { headers: { "cache-control": "no-store" } });
}

async function runHealthCheck(env) {
  const checkedAt = new Date().toISOString();
  const index = await env.ASSETS.fetch("https://health.local/answers/");
  if (!index.ok) {
    const report = { event: "site_health", ok: false, checkedAt, reason: "answers_page_missing", status: index.status };
    console.error(JSON.stringify(report));
    return report;
  }

  const html = await index.text();
  const coverPaths = [...new Set([...html.matchAll(/\/assets\/books\/[^\"'\s<>]+/g)].map((match) => match[0]))]
    .filter((path) => path !== FALLBACK_COVER);
  const checks = await Promise.all(coverPaths.map(async (path) => {
    const response = await env.ASSETS.fetch(`https://health.local${path}`);
    return { path, status: response.status, ok: response.ok };
  }));
  const missing = checks.filter((check) => !check.ok).map((check) => check.path);
  const report = { event: "site_health", ok: missing.length === 0, checkedAt, coversChecked: checks.length, missing };
  (report.ok ? console.log : console.error)(JSON.stringify(report));
  return report;
}

// Free Make the Show workbook. The PDF lives in the private
// thatmikehamilton-downloads R2 bucket; /workbook/ collects the email first.
async function workbookDownload(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  if (!env.DOWNLOADS) {
    console.error(JSON.stringify({ event: "workbook_download", ok: false, reason: "downloads_binding_missing" }));
    return new Response("The workbook is temporarily unavailable.", { status: 503 });
  }
  const object = request.method === "HEAD"
    ? await env.DOWNLOADS.head(WORKBOOK_OBJECT_KEY)
    : await env.DOWNLOADS.get(WORKBOOK_OBJECT_KEY);
  if (!object) {
    console.error(JSON.stringify({ event: "workbook_download", ok: false, reason: "object_missing", key: WORKBOOK_OBJECT_KEY }));
    return new Response("The workbook is temporarily unavailable.", { status: 404 });
  }
  const headers = new Headers({
    "content-type": "application/pdf",
    "content-disposition": 'attachment; filename="Make-the-Show-Workbook.pdf"',
    "content-length": String(object.size),
    "cache-control": "public, max-age=3600",
    etag: object.httpEtag,
  });
  if (request.method === "GET") {
    console.log(JSON.stringify({ event: "workbook_download", ok: true }));
  }
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

async function logFallback(path) {
  console.error(JSON.stringify({ event: "book_cover_fallback", path, repairedAt: new Date().toISOString() }));
}
