const INTERVAL = 60;
const HISTORY_KEY = "7lm-status-history-v1";
const HISTORY_LEN = 90;

const el = {
  badge: document.getElementById("headerBadge"),
  banner: document.getElementById("banner"),
  title: document.getElementById("bannerTitle"),
  sub: document.getElementById("bannerSub"),
  meta: document.getElementById("bannerMeta"),
  uptime: document.getElementById("uptimePct"),
  groups: document.getElementById("groups"),
  refresh: document.getElementById("refreshBtn"),
};

let nextIn = INTERVAL;
let timer = null;
let countdown = null;

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveHistory(map) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(map));
}

function pushHistory(checks) {
  const hist = loadHistory();
  for (const c of checks) {
    const arr = Array.isArray(hist[c.id]) ? hist[c.id] : [];
    arr.push(c.ok ? "ok" : "bad");
    hist[c.id] = arr.slice(-HISTORY_LEN);
  }
  // overall sample
  const allOk = checks.every((c) => c.ok);
  const anyOk = checks.some((c) => c.ok);
  const overall = Array.isArray(hist.__overall) ? hist.__overall : [];
  overall.push(allOk ? "ok" : anyOk ? "warn" : "bad");
  hist.__overall = overall.slice(-HISTORY_LEN);
  saveHistory(hist);
  return hist;
}

function uptimeOf(arr = []) {
  if (!arr.length) return null;
  const ok = arr.filter((x) => x === "ok").length;
  return ((ok / arr.length) * 100).toFixed(2);
}

function barsHtml(arr = []) {
  const padded = [...Array(Math.max(0, HISTORY_LEN - arr.length)).fill("empty"), ...arr];
  return `<div class="bars" title="آخر ${HISTORY_LEN} فحص">${padded
    .map((s) => `<span class="${s === "empty" ? "" : s}"></span>`)
    .join("")}</div>`;
}

function stateLabel(state) {
  if (state === "operational") return "Operational";
  if (state === "degraded") return "Degraded";
  if (state === "major_outage") return "Major outage";
  return "Checking";
}

function stateAr(state) {
  if (state === "operational") return "كل الأنظمة تعمل";
  if (state === "degraded") return "بعض الخدمات متأثرة";
  if (state === "major_outage") return "عطل كبير";
  return "جاري الفحص…";
}

function statusUrl() {
  // Same-origin Express mount uses /api/status; standalone Vercel uses /api/check
  if (/\/status\/?$/.test(location.pathname) || location.pathname.includes("/status/")) {
    return `${location.origin}/api/status`;
  }
  return "/api/check";
}

async function fetchStatus() {
  el.badge.className = "pill checking";
  el.badge.textContent = "Checking";
  el.banner.className = "banner checking";
  el.title.textContent = "جاري الفحص…";

  const res = await fetch(statusUrl(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`status http ${res.status}`);
  return res.json();
}

function render(data) {
  const hist = pushHistory(data.checks || []);
  const state = data.state || "checking";
  el.badge.className = `pill ${state}`;
  el.badge.textContent = stateLabel(state);
  el.banner.className = `banner ${state}`;
  el.title.textContent = stateAr(state);
  el.sub.textContent =
    state === "operational"
      ? "كل خدمات 7LM تستجيب بشكل طبيعي."
      : state === "degraded"
        ? "خدمة أو أكثر فيها بطء أو فشل جزئي."
        : "عدة خدمات غير متاحة حاليًا.";

  const overallUptime = uptimeOf(hist.__overall);
  el.uptime.textContent = overallUptime ? `${overallUptime}%` : "—";

  const checked = new Date(data.checkedAt || Date.now());
  el.meta.textContent = `Last check: ${checked.toLocaleString()} · next check in ${INTERVAL}s`;

  const byId = Object.fromEntries((data.checks || []).map((c) => [c.id, c]));
  const meta = data.meta || {};

  el.groups.innerHTML = (data.groups || [])
    .map((g) => {
      const cards = g.services
        .map((id) => {
          const c = byId[id];
          if (!c) return "";
          const m = meta[id] || { name: id, desc: c.url };
          const cls = c.ok ? "ok" : "bad";
          const label = c.ok ? "Operational" : "Down";
          const up = uptimeOf(hist[id]);
          return `
            <article class="card">
              <div class="card-top">
                <div>
                  <h4>${m.name}</h4>
                  <p class="desc">${m.desc || ""}</p>
                </div>
                <div class="state ${cls}">${label}</div>
              </div>
              <div class="meta-row">${up ? `${up}% uptime` : "—"} · ${c.ms}ms · ${c.detail}</div>
              ${barsHtml(hist[id] || [])}
            </article>`;
        })
        .join("");
      return `<div class="group"><h3>${g.title}</h3>${cards}</div>`;
    })
    .join("");
}

async function tick(manual = false) {
  try {
    if (manual) el.refresh.disabled = true;
    const data = await fetchStatus();
    render(data);
    nextIn = data.intervalSec || INTERVAL;
  } catch (err) {
    el.badge.className = "pill major_outage";
    el.badge.textContent = "Error";
    el.banner.className = "banner major_outage";
    el.title.textContent = "تعذّر جلب الحالة";
    el.sub.textContent = err.message;
    el.meta.textContent = "شغّل الـ API محليًا: npm start ثم افتح /status/";
  } finally {
    el.refresh.disabled = false;
  }
}

function startCountdown() {
  if (countdown) clearInterval(countdown);
  countdown = setInterval(() => {
    nextIn -= 1;
    if (nextIn <= 0) {
      nextIn = INTERVAL;
      tick();
    } else if (el.meta.textContent.includes("next check")) {
      el.meta.textContent = el.meta.textContent.replace(/next check in \d+s/, `next check in ${nextIn}s`);
    }
  }, 1000);
}

// Extra links when mounted under Express /status/
if (location.pathname.includes("/status")) {
  const nav = document.getElementById("nav");
  if (nav) {
    nav.insertAdjacentHTML(
      "beforeend",
      `<a href="/docs/">Docs</a><a href="/">API</a>`
    );
  }
}

el.refresh.addEventListener("click", () => tick(true));
tick();
startCountdown();
if (timer) clearInterval(timer);
timer = setInterval(() => tick(), INTERVAL * 1000);
