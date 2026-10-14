import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const site = new URL(process.env.SITE_URL || "https://thatmikehamilton.com");
const sameSiteAsset = (value, base) => {
  try {
    const url = new URL(value, base);
    return url.origin === site.origin && url.pathname.startsWith("/assets/") ? url : null;
  } catch { return null; }
};

const get = async (url) => {
  const response = await fetch(url, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(45000) });
  return { response, text: response.headers.get("content-type")?.includes("text/") ? await response.text() : "" };
};

async function localHtmlPages(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const pages = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) pages.push(...await localHtmlPages(path));
    else if (entry.name.endsWith(".html")) pages.push(path);
  }
  return pages;
}

const sourcePages = (await localHtmlPages("public")).map((path) => {
  const relativePath = relative("public", path).split(sep).join("/");
  return new URL(relativePath === "index.html" ? "/" : `/${relativePath.replace(/index\.html$/, "")}`, site).href;
});

const sitemap = await get(new URL("/sitemap.xml", site));
if (!sitemap.response.ok) throw new Error(`Sitemap returned ${sitemap.response.status}`);
const pages = [...new Set([...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]))];
pages.push(...sourcePages);

const assets = new Set();
const issues = [];
for (const page of new Set(pages)) {
  const { response, text } = await get(page);
  if (!response.ok) { issues.push(`${page} returned ${response.status}`); continue; }
  for (const match of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    const asset = sameSiteAsset(match[1], page);
    if (asset) assets.add(asset.href);
  }
  for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const asset = sameSiteAsset(match[1], page);
    if (asset) assets.add(asset.href);
  }
}

for (const stylesheet of [...assets].filter(asset => asset.endsWith(".css"))) {
  const { response, text } = await get(stylesheet);
  if (!response.ok) { issues.push(`${stylesheet} returned ${response.status}`); continue; }
  for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const asset = sameSiteAsset(match[1], stylesheet);
    if (asset) assets.add(asset.href);
  }
}

for (const asset of assets) {
  const { response } = await get(asset);
  const fallback = response.headers.get("x-tmh-fallback");
  if (!response.ok || fallback) issues.push(`${asset} ${fallback ? `used fallback ${fallback}` : `returned ${response.status}`}`);
}

// Downloads that live outside /assets/ (served by the Worker from R2).
const downloads = ["/download/make-the-show-workbook"];
for (const path of downloads) {
  const url = new URL(path, site);
  const response = await fetch(url, { method: "HEAD", redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(45000) });
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !type.includes("application/pdf")) issues.push(`${url.href} returned ${response.status} ${type}`.trim());
}

console.log(JSON.stringify({ pagesChecked: new Set(pages).size, assetsChecked: assets.size, downloadsChecked: downloads.length, issues }, null, 2));
if (issues.length) process.exit(1);
