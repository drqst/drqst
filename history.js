const api = typeof browser !== "undefined" ? browser : chrome;

const TRANSITIONS = {
  link: "Followed a link",
  typed: "Typed in the address bar",
  auto_bookmark: "Opened from a bookmark",
  auto_subframe: "Auto-loaded subframe",
  manual_subframe: "Manual subframe",
  generated: "Generated from a search",
  auto_toplevel: "Opened as a new tab or window",
  form_submit: "Form submit",
  reload: "Reload",
  keyword: "Keyword search",
  keyword_generated: "Keyword-generated URL",
};

const SEARCH_CAP = 10000;
const DB_NAME = "chromium-history-archive";
const STORE = "handles";
const HANDLE_KEY = "history-dir";

const els = {
  q: document.getElementById("q"),
  from: document.getElementById("from"),
  to: document.getElementById("to"),
  sort: document.getElementById("sort"),
  groupDomain: document.getElementById("group-domain"),
  list: document.getElementById("list"),
  listStatus: document.getElementById("list-status"),
  stats: document.getElementById("stats"),
  detail: document.getElementById("detail"),
  saveHint: document.getElementById("save-hint"),
  includeVisits: document.getElementById("include-visits"),
  filteredOnly: document.getElementById("filtered-only"),
  chooseFolder: document.getElementById("choose-folder"),
  saveJson: document.getElementById("save-json"),
  downloadJson: document.getElementById("download-json"),
  saveStatus: document.getElementById("save-status"),
};

let allItems = [];
let visibleItems = [];
let selectedUrl = null;
let folderHandle = null;
let searchTimer = 0;

function suggestedDirLabel() {
  const win = navigator.userAgent.includes("Windows");
  return win ? "%USERPROFILE%\\.chromium\\history" : "~/.chromium/history";
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function colorFor(seed) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 38% 32%)`;
}

function iso(ms) {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

function localStamp(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(handle) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function historySearch(query) {
  return api.history.search(query);
}

async function fetchRange(text, startTime, endTime) {
  const page = await historySearch({
    text,
    startTime,
    endTime,
    maxResults: SEARCH_CAP,
  });
  if (page.length < SEARCH_CAP || endTime - startTime < 60_000) {
    return page;
  }
  const mid = Math.floor((startTime + endTime) / 2);
  const [left, right] = await Promise.all([
    fetchRange(text, startTime, mid),
    fetchRange(text, mid, endTime),
  ]);
  const seen = new Set();
  const merged = [];
  for (const item of [...left, ...right]) {
    const key = item.id ?? item.url;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

async function loadHistory() {
  els.listStatus.textContent = "Reading browser history…";
  const text = els.q.value.trim();
  const fromVal = els.from.value ? new Date(`${els.from.value}T00:00:00`).getTime() : 0;
  const toVal = els.to.value
    ? new Date(`${els.to.value}T23:59:59.999`).getTime()
    : Date.now();
  allItems = await fetchRange(text, fromVal, toVal);
  applyView();
}

function applyView() {
  const key = els.sort.value;
  visibleItems = [...allItems].sort((a, b) => {
    if (key === "title" || key === "url") {
      return String(a[key] || "").localeCompare(String(b[key] || ""), undefined, {
        sensitivity: "base",
      });
    }
    return (b[key] || 0) - (a[key] || 0);
  });
  renderStats();
  renderList();
  els.listStatus.textContent = `${visibleItems.length.toLocaleString()} pages`;
}

function renderStats() {
  const domains = new Map();
  let visits = 0;
  for (const item of allItems) {
    visits += item.visitCount || 0;
    const host = domainOf(item.url);
    domains.set(host, (domains.get(host) || 0) + (item.visitCount || 0));
  }
  const top = [...domains.entries()].sort((a, b) => b[1] - a[1])[0];
  els.stats.innerHTML = `
    <span><strong>${allItems.length.toLocaleString()}</strong> unique URLs</span>
    <span><strong>${visits.toLocaleString()}</strong> recorded visits</span>
    <span><strong>${domains.size.toLocaleString()}</strong> domains</span>
    <span>Top: <strong>${top ? top[0] : "—"}</strong></span>
  `;
}

function renderList() {
  const frag = document.createDocumentFragment();
  const grouped = els.groupDomain.checked;
  let lastDomain = null;
  const limit = Math.min(visibleItems.length, 2000);

  visibleItems.slice(0, limit).forEach((item) => {
    const host = domainOf(item.url);
    if (grouped && host !== lastDomain) {
      const label = document.createElement("div");
      label.className = "group-label";
      label.textContent = host;
      frag.appendChild(label);
      lastDomain = host;
    }
    const row = document.createElement("div");
    row.className = "row";
    row.role = "listitem";
    row.tabIndex = 0;
    row.dataset.url = item.url;
    row.setAttribute("aria-selected", String(item.url === selectedUrl));
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.background = colorFor(host);
    avatar.textContent = (host[0] || "?").toUpperCase();
    const body = document.createElement("div");
    body.innerHTML = `<div class="title"></div><div class="url"></div>`;
    body.querySelector(".title").textContent = item.title || host;
    body.querySelector(".url").textContent = item.url;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<div>${item.visitCount || 0} visits</div><div>${localStamp(item.lastVisitTime)}</div>`;
    row.append(avatar, body, meta);
    row.addEventListener("click", () => selectItem(item));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectItem(item);
      }
    });
    frag.appendChild(row);
  });

  els.list.replaceChildren(frag);
  if (visibleItems.length > limit) {
    els.listStatus.textContent = `Showing ${limit.toLocaleString()} of ${visibleItems.length.toLocaleString()} pages. Narrow the search to see the rest.`;
  }
}

async function selectItem(item) {
  selectedUrl = item.url;
  for (const row of els.list.querySelectorAll(".row")) {
    row.setAttribute("aria-selected", String(row.dataset.url === item.url));
  }
  els.detail.innerHTML = `<p class="empty">Loading visits…</p>`;
  let visits = [];
  try {
    visits = await api.history.getVisits({ url: item.url });
  } catch (error) {
    els.detail.innerHTML = `<p class="empty">Could not load visits: ${error.message}</p>`;
    return;
  }
  visits = [...visits].sort((a, b) => (b.visitTime || 0) - (a.visitTime || 0));
  const host = domainOf(item.url);
  els.detail.innerHTML = `
    <h2></h2>
    <a class="url-link" target="_blank" rel="noopener"></a>
    <dl class="kv">
      <dt>Domain</dt><dd class="d-host"></dd>
      <dt>Visit count</dt><dd>${item.visitCount ?? visits.length}</dd>
      <dt>Typed count</dt><dd>${item.typedCount ?? "—"}</dd>
      <dt>Last visit</dt><dd>${localStamp(item.lastVisitTime)}</dd>
      <dt>History id</dt><dd>${item.id ?? "—"}</dd>
    </dl>
    <h3>Visits <span class="chip">${visits.length}</span></h3>
    <ol class="visits"></ol>
  `;
  els.detail.querySelector("h2").textContent = item.title || host;
  const link = els.detail.querySelector(".url-link");
  link.href = item.url;
  link.textContent = item.url;
  els.detail.querySelector(".d-host").textContent = host;
  const list = els.detail.querySelector(".visits");
  for (const visit of visits.slice(0, 500)) {
    const li = document.createElement("li");
    const how = TRANSITIONS[visit.transition] || visit.transition || "Unknown";
    li.innerHTML = `<div><strong></strong></div><div class="url"></div>`;
    li.querySelector("strong").textContent = localStamp(visit.visitTime);
    li.querySelector(".url").textContent = `${how} · visit ${visit.visitId}${visit.referringVisitId ? ` · from ${visit.referringVisitId}` : ""}`;
    list.appendChild(li);
  }
}

async function collectVisits(items, onProgress) {
  const out = new Map();
  const batch = 12;
  for (let i = 0; i < items.length; i += batch) {
    const slice = items.slice(i, i + batch);
    const results = await Promise.all(
      slice.map(async (item) => {
        try {
          const visits = await api.history.getVisits({ url: item.url });
          return [item.url, visits];
        } catch {
          return [item.url, []];
        }
      })
    );
    for (const [url, visits] of results) out.set(url, visits);
    if (onProgress) onProgress(Math.min(items.length, i + batch), items.length);
  }
  return out;
}

function serializeEntry(item, visits) {
  const visitRows = (visits || []).map((visit) => ({
    visitId: visit.visitId ?? null,
    referringVisitId: visit.referringVisitId ?? null,
    visitTime: visit.visitTime ?? null,
    visitTimeISO: iso(visit.visitTime),
    transition: visit.transition || null,
    transitionLabel: TRANSITIONS[visit.transition] || visit.transition || null,
    isLocal: visit.isLocal ?? null,
  }));
  return {
    id: item.id ?? null,
    url: item.url,
    title: item.title || "",
    domain: domainOf(item.url),
    visitCount: item.visitCount ?? visitRows.length,
    typedCount: item.typedCount ?? null,
    lastVisitTime: item.lastVisitTime ?? null,
    lastVisitTimeISO: iso(item.lastVisitTime),
    visits: visitRows,
  };
}

async function buildArchive(items, includeVisits) {
  let visitMap = new Map();
  if (includeVisits) {
    visitMap = await collectVisits(items, (done, total) => {
      els.saveStatus.textContent = `Collecting visits ${done.toLocaleString()} / ${total.toLocaleString()}…`;
    });
  }
  const entries = items.map((item) => serializeEntry(item, includeVisits ? visitMap.get(item.url) : []));
  const domains = new Map();
  let visitTotal = 0;
  for (const entry of entries) {
    visitTotal += entry.visitCount || 0;
    domains.set(entry.domain, (domains.get(entry.domain) || 0) + (entry.visitCount || 0));
  }
  return {
    format: "chromium-history-archive",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    source: "Chromium History Archive extension",
    filters: {
      query: els.q.value.trim(),
      from: els.from.value || null,
      to: els.to.value || null,
      filteredOnly: els.filteredOnly.checked,
      includeVisits,
    },
    stats: {
      uniqueUrls: entries.length,
      recordedVisits: visitTotal,
      uniqueDomains: domains.size,
    },
    entries,
  };
}

function prettyJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function defaultFileName() {
  return `history-${fileStamp()}.json`;
}

async function ensureFolderAccess(handle) {
  if (!handle) return false;
  if (typeof handle.queryPermission === "function") {
    const state = await handle.queryPermission({ mode: "readwrite" });
    if (state === "granted") return true;
    const next = await handle.requestPermission({ mode: "readwrite" });
    return next === "granted";
  }
  return true;
}

async function chooseFolder() {
  if (!window.showDirectoryPicker) {
    els.saveStatus.textContent = `This browser cannot pin a folder. Use Download instead, and save into ${suggestedDirLabel()}.`;
    return;
  }
  try {
    folderHandle = await window.showDirectoryPicker({
      id: "chromium-history",
      mode: "readwrite",
      startIn: "documents",
    });
    await saveHandle(folderHandle);
    els.saveHint.textContent = `JSON will be written to the folder you chose (use ${suggestedDirLabel()}).`;
    els.saveStatus.textContent = `Folder ready: ${folderHandle.name}`;
  } catch (error) {
    if (error.name !== "AbortError") {
      els.saveStatus.textContent = `Could not choose folder: ${error.message}`;
    }
  }
}

async function writeToFolder(jsonText, fileName) {
  const granted = await ensureFolderAccess(folderHandle);
  if (!granted) throw new Error("Folder permission was not granted.");
  const file = await folderHandle.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(jsonText);
  await writable.close();
  const latest = await folderHandle.getFileHandle("history-latest.json", { create: true });
  const latestOut = await latest.createWritable();
  await latestOut.write(jsonText);
  await latestOut.close();
}

async function downloadJson(jsonText, fileName) {
  const blob = new Blob([jsonText], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    if (api.downloads?.download) {
      await api.downloads.download({
        url,
        filename: `chromium/history/${fileName}`,
        saveAs: true,
        conflictAction: "uniquify",
      });
      els.saveStatus.textContent = `Choose ${suggestedDirLabel()} in the save dialog.`;
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      els.saveStatus.textContent = `Downloaded ${fileName}. Move it to ${suggestedDirLabel()} if needed.`;
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportArchive({ forceDownload }) {
  const items = els.filteredOnly.checked ? visibleItems : allItems;
  if (!items.length) {
    els.saveStatus.textContent = "Nothing to export.";
    return;
  }
  els.saveJson.disabled = true;
  els.downloadJson.disabled = true;
  try {
    const archive = await buildArchive(items, els.includeVisits.checked);
    const jsonText = prettyJson(archive);
    const fileName = defaultFileName();
    if (!forceDownload && folderHandle) {
      await writeToFolder(jsonText, fileName);
      els.saveStatus.textContent = `Wrote ${fileName} and history-latest.json to “${folderHandle.name}”.`;
      return;
    }
    if (!forceDownload && window.showDirectoryPicker && !folderHandle) {
      await chooseFolder();
      if (folderHandle) {
        await writeToFolder(jsonText, fileName);
        els.saveStatus.textContent = `Wrote ${fileName} and history-latest.json to “${folderHandle.name}”.`;
        return;
      }
    }
    await downloadJson(jsonText, fileName);
  } catch (error) {
    els.saveStatus.textContent = `Save failed: ${error.message}`;
  } finally {
    els.saveJson.disabled = false;
    els.downloadJson.disabled = false;
  }
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadHistory, 180);
}

async function restoreFolder() {
  folderHandle = await loadHandle();
  if (folderHandle) {
    els.saveHint.textContent = `Pinned folder: ${folderHandle.name} — ideally ${suggestedDirLabel()}`;
  } else {
    els.saveHint.textContent = `Optional JSON export to ${suggestedDirLabel()}`;
  }
}

els.q.addEventListener("input", scheduleSearch);
els.from.addEventListener("change", loadHistory);
els.to.addEventListener("change", loadHistory);
els.sort.addEventListener("change", applyView);
els.groupDomain.addEventListener("change", () => {
  if (els.groupDomain.checked) {
    visibleItems = [...allItems].sort((a, b) => {
      const byHost = domainOf(a.url).localeCompare(domainOf(b.url));
      if (byHost) return byHost;
      return (b.lastVisitTime || 0) - (a.lastVisitTime || 0);
    });
    renderList();
  } else {
    applyView();
  }
});
els.chooseFolder.addEventListener("click", chooseFolder);
els.saveJson.addEventListener("click", () => exportArchive({ forceDownload: false }));
els.downloadJson.addEventListener("click", () => exportArchive({ forceDownload: true }));

restoreFolder().then(loadHistory);
