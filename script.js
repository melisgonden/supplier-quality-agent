const DEFECTS = [
  "colour",
  "cutting",
  "blur",
  "damage",
  "delay",
  "wrong_quantity",
  "paper",
  "other",
];
const OWNERS = {
  supplier: "Supplier",
  customer_file: "Customer file",
  carrier: "Carrier",
  unclear: "Unclear",
};
const CAPA_REPEAT = 3; // same defect at the same supplier this many times -> CAPA
const WATCH_RATE = 0.25; // % of a supplier's orders with a supplier-caused complaint -> Watch

/* =====================================================================
   RULE-BASED BASELINE
   Keyword matching + order facts. Works without AI and is used to check
   the AI (if they disagree a lot, something is wrong).
   ===================================================================== */
const KEYWORDS = {
  colour: [
    "colour",
    "color",
    "blue",
    "purple",
    "green",
    "red",
    "dull",
    "cast",
    "kleur",
    "paars",
    "farb",
    "lila",
    "grün",
    "couleur",
    "vert",
    "terne",
    "fluo",
    "neon",
    "pink",
    "renk",
    "soluk",
    "koyu",
  ],
  cutting: [
    "cut",
    "crooked",
    "trim",
    "off-centre",
    "white edge",
    "scheef",
    "gesneden",
    "schief",
    "coupé",
    "travers",
    "kesim",
    "yamuk",
    "eğri",
    "beyaz kenar",
  ],
  blur: [
    "blurry",
    "pixel",
    "wazig",
    "borroso",
    "unscharf",
    "flou",
    "not readable",
    "niet te lezen",
    "bulanık",
    "pikselli",
    "okunmuyor",
  ],
  damage: [
    "crushed",
    "creased",
    "wet",
    "damaged",
    "écrasé",
    "mouillé",
    "abîmé",
    "nat",
    "gekreukt",
    "beschädigt",
    "ezik",
    "ezilmiş",
    "ıslak",
    "yırtık",
    "hasarlı",
    "buruşuk",
  ],
  delay: [
    "late",
    "retard",
    "delay",
    "te laat",
    "verspät",
    "retraso",
    "geç geldi",
    "gecikme",
    "gecikti",
  ],
  wrong_quantity: [
    "instead of",
    "en lugar de",
    "missing",
    "faltan",
    "in plaats van",
    "statt",
    "eksik",
    "yerine",
  ],
  paper: [
    "thin",
    "400 g",
    "paper",
    "papier",
    "dun",
    "papel",
    "kağıt",
    "kâğıt",
    "çok ince",
  ],
};
// A keyword must start a word: "red" matches "too red" but not "ordered".
const hasWord = (text, k) =>
  new RegExp(
    "(^|[^\\p{L}])" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "u",
  ).test(text);
function ruleClassify(c) {
  const t = c.text.toLowerCase();
  const o = ORDERS[c.order];
  let defect = "other";
  for (const d of Object.keys(KEYWORDS))
    if (KEYWORDS[d].some((k) => hasWord(t, k))) {
      defect = d;
      break;
    }
  let owner = "unclear";
  if (defect === "damage" || defect === "delay") owner = "carrier";
  else if (defect === "blur")
    owner = o.file.dpi < 200 ? "customer_file" : "supplier";
  else if (defect === "cutting")
    owner = o.file.bleed ? "supplier" : "customer_file";
  else if (defect === "colour")
    owner = o.file.vividRGB ? "customer_file" : "supplier";
  else if (defect === "wrong_quantity" || defect === "paper")
    owner = "supplier";
  return {
    defect,
    owner,
    confidence: owner === "unclear" ? 0.3 : 0.6,
    evidence: "Keyword match + order data",
    by: "rules",
  };
}

/* =====================================================================
   STATE: results per complaint + human overrides
   ===================================================================== */
const results = {}; // id -> { defect, owner, confidence, evidence, by }
const overrides = {}; // id -> owner chosen by a person
let complaints = COMPLAINTS.slice();
complaints.forEach((c) => (results[c.id] = ruleClassify(c)));
const ownerOf = (c) => overrides[c.id] || results[c.id].owner;
const today = new Date("2026-11-10");

/* =====================================================================
   HISTORY: saved in the browser (localStorage), so a person's decisions
   and new complaints are still there after a reload.
   In production this would be a database.
   ===================================================================== */
const STORE = "sqa-history-v1";
const capaState = {}; // CAPA key -> { status, assignee, priority, due, log: [{ at, text }] }
function saveHistory() {
  try {
    const added = complaints.filter((c) => !COMPLAINTS.includes(c));
    const addedResults = {};
    added.forEach((c) => (addedResults[c.id] = results[c.id]));
    localStorage.setItem(
      STORE,
      JSON.stringify({ overrides, added, addedResults, capaState }),
    );
  } catch {}
}
function loadHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(STORE) || "null");
    if (!h) return;
    Object.assign(overrides, h.overrides || {});
    Object.assign(capaState, h.capaState || {});
    (h.added || []).forEach((c) => {
      if (!ORDERS[c.order] || complaints.some((x) => x.id === c.id)) return;
      complaints.push(c);
      results[c.id] = (h.addedResults || {})[c.id] || ruleClassify(c);
    });
  } catch {}
}
loadHistory();

/* =====================================================================
   PERIOD: last 7 days, last 30 days, one month, or all history
   ===================================================================== */
let period = "30";
const daysAgo = (c) => (today - new Date(c.date)) / 86400000;
const monthName = (ym) =>
  new Date(ym + "-01").toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
  });
function inPeriod(c) {
  if (period === "all") return true;
  if (period === "7" || period === "30") return daysAgo(c) <= Number(period);
  return c.date.startsWith(period);
}
function periodDays() {
  if (period === "7" || period === "30") return Number(period);
  if (period === "all")
    return Math.max(30, Math.max(...complaints.map(daysAgo)));
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function periodLabel() {
  if (period === "7") return "last 7 days";
  if (period === "30") return "last 30 days";
  if (period === "all") return "all history";
  return monthName(period);
}
function fillPeriods() {
  const months = [...new Set(complaints.map((c) => c.date.slice(0, 7)))]
    .sort()
    .reverse();
  const opts = [
    ["7", "Last 7 days"],
    ["30", "Last 30 days"],
    ...months.map((m) => [m, monthName(m)]),
    ["all", "All history"],
  ];
  $("period").innerHTML = opts
    .map(
      ([v, l]) =>
        `<option value="${v}" ${v === period ? "selected" : ""}>${l}</option>`,
    )
    .join("");
}

/* =====================================================================
   CALCULATIONS (code, not AI)
   ===================================================================== */
function costByOwner() {
  const m = { supplier: 0, customer_file: 0, carrier: 0, unclear: 0 };
  complaints
    .filter(inPeriod)
    .forEach((c) => (m[ownerOf(c)] += ORDERS[c.order].cost));
  return m;
}
function scorecard() {
  return Object.entries(SUPPLIERS).map(([sid, s]) => {
    const mine = complaints.filter(
      (c) => inPeriod(c) && ORDERS[c.order].supplier === sid,
    );
    const own = mine.filter((c) => ownerOf(c) === "supplier");
    const byDefect = {};
    own.forEach((c) => {
      const d = results[c.id].defect;
      (byDefect[d] = byDefect[d] || []).push(c);
    });
    const top = Object.entries(byDefect).sort(
      (a, b) => b[1].length - a[1].length,
    )[0];
    const ordersInPeriod = (s.monthlyOrders * periodDays()) / 30;
    const rate = (own.length / ordersInPeriod) * 100;
    const capaDefects = Object.entries(byDefect).filter(
      ([, list]) => list.length >= CAPA_REPEAT,
    );
    const status = capaDefects.length
      ? "capa"
      : rate > WATCH_RATE
        ? "watch"
        : "ok";
    const cost = own.reduce((a, c) => a + ORDERS[c.order].cost, 0);
    const otherCost = mine
      .filter((c) => ownerOf(c) !== "supplier")
      .reduce((a, c) => a + ORDERS[c.order].cost, 0);
    return {
      sid,
      s,
      all: mine.length,
      own: own.length,
      rate,
      top,
      status,
      capaDefects,
      cost,
      otherCost,
      byDefect,
    };
  });
}

/* =====================================================================
   RENDERING
   ===================================================================== */
const $ = (id) => document.getElementById(id);
const esc = (t) =>
  String(t ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const eur = (n) => "€" + Math.round(n).toLocaleString("en-GB");
const ownerColour = {
  supplier: "var(--c-supplier)",
  customer_file: "var(--c-customer)",
  carrier: "var(--c-carrier)",
  unclear: "var(--c-unclear)",
};

function renderAll() {
  $("periodNote").textContent = "Showing: " + periodLabel();
  document
    .querySelectorAll(".plabel")
    .forEach((e) => (e.textContent = periodLabel()));
  renderOverview();
  renderComplaints();
  renderScorecard();
  renderCapa();
  saveHistory();
}

function renderOverview() {
  const m = costByOwner(),
    total = Object.values(m).reduce((a, b) => a + b, 0);
  const sc = scorecard();
  const openCapa = capaItems().filter((x) => x.st.status !== "closed").length;
  $("kpis").innerHTML = [
    [complaints.filter(inPeriod).length, "Complaints, " + periodLabel()],
    [eur(total), "Reprint & refund cost"],
    [eur(m.supplier + m.carrier), "Recoverable from suppliers & carriers"],
    [openCapa, "Open CAPAs"],
  ]
    .map(
      ([v, l]) =>
        `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`,
    )
    .join("");

  $("ownerBars").innerHTML = Object.keys(OWNERS)
    .map(
      (k) => `
    <div class="bar"><span>${OWNERS[k]}</span>
      <div class="track"><span style="width:${total ? (m[k] / total) * 100 : 0}%;background:${ownerColour[k]}"></span></div>
      <span>${eur(m[k])}</span></div>`,
    )
    .join("");

  const max = Math.max(...sc.map((r) => r.cost + r.otherCost), 1);
  $("supplierBars").innerHTML = sc
    .sort((a, b) => b.cost + b.otherCost - (a.cost + a.otherCost))
    .map((r) => {
      const parts = { supplier: 0, customer_file: 0, carrier: 0, unclear: 0 };
      complaints
        .filter((c) => inPeriod(c) && ORDERS[c.order].supplier === r.sid)
        .forEach((c) => (parts[ownerOf(c)] += ORDERS[c.order].cost));
      return `<div class="bar"><span>${esc(r.s.name)}</span><div class="track">${Object.keys(
        parts,
      )
        .map(
          (k) =>
            `<span style="width:${(parts[k] / max) * 100}%;background:${ownerColour[k]}"></span>`,
        )
        .join("")}</div><span>${eur(r.cost + r.otherCost)}</span></div>`;
    })
    .join("");

  // Routing: for each CAPA defect, suggest the supplier with fewest supplier-caused complaints for that product.
  const alerts = [];
  sc.filter((r) => r.status === "capa").forEach((r) =>
    r.capaDefects.forEach(([defect, list]) => {
      const products = [...new Set(list.map((c) => ORDERS[c.order].product))];
      products.forEach((p) => {
        const n = list.filter((c) => ORDERS[c.order].product === p).length;
        const alt = sc
          .filter(
            (x) =>
              x.sid !== r.sid &&
              x.s.products.includes(p) &&
              x.status !== "capa",
          )
          .sort((a, b) => a.rate - b.rate)[0];
        if (alt)
          alerts.push(`<div class="item"><strong>${esc(p)}:</strong> ${esc(r.s.name)} has a repeated ${defect} problem (${n} of ${list.length} complaints on this product).
        Suggest routing new ${esc(p)} orders to <strong>${esc(alt.s.name)}</strong> (${alt.rate.toFixed(2)} % defect rate) until the CAPA is closed.
        <div class="meta">Needs approval by a person.</div></div>`);
      });
    }),
  );
  $("routing").innerHTML =
    alerts.join("") || '<p class="note">No routing changes suggested.</p>';
}

const searchText = (c) => {
  const o = ORDERS[c.order];
  return [
    c.id,
    c.order,
    c.date,
    c.lang,
    c.text,
    o.product,
    SUPPLIERS[o.supplier].name,
    CARRIERS[o.carrier],
    results[c.id].defect,
    OWNERS[ownerOf(c)],
  ]
    .join(" ")
    .toLowerCase();
};
function renderComplaints() {
  const f = $("filterOwner").value;
  const q = $("search").value.trim().toLowerCase();
  const list = complaints.filter(
    (c) =>
      inPeriod(c) &&
      (!f || ownerOf(c) === f) &&
      (!q || searchText(c).includes(q)),
  );
  $("complaintCount").textContent =
    list.length +
    " complaint" +
    (list.length === 1 ? "" : "s") +
    " · " +
    periodLabel();
  $("complaintList").innerHTML = list
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((c) => {
      const r = results[c.id],
        o = ORDERS[c.order],
        own = ownerOf(c);
      return `<div class="item">
        <div class="meta">${c.id} · ${c.date} · ${c.lang} · ${c.order} · ${esc(o.product)} · ${esc(SUPPLIERS[o.supplier].name)} · ${esc(CARRIERS[o.carrier])} · ${eur(o.cost)}</div>
        <div class="quote">“${esc(c.text)}”</div>
        <span class="pill">${esc(r.defect.replace("_", " "))}</span><span class="pill own-${own}">${OWNERS[own]}</span>
        <span class="meta">${Math.round(r.confidence * 100)} % · ${r.by === "ai" ? "AI" : "rules"}${overrides[c.id] ? " · confirmed by person" : ""}</span>
        <div class="meta" style="margin-top:2px">${esc(r.evidence)}</div>
        <div class="row" style="margin-top:6px"><label class="meta">Owner:
          <select data-id="${c.id}" class="ov">${Object.keys(OWNERS)
            .map(
              (k) =>
                `<option value="${k}" ${k === own ? "selected" : ""}>${OWNERS[k]}</option>`,
            )
            .join("")}</select></label></div>
      </div>`;
    })
    .join("");
  document.querySelectorAll(".ov").forEach((s) =>
    s.addEventListener("change", (e) => {
      overrides[e.target.dataset.id] = e.target.value;
      renderAll();
    }),
  );
}

function renderScorecard() {
  const sc = scorecard().sort((a, b) => b.rate - a.rate);
  const label = { ok: "OK", watch: "Watch", capa: "CAPA" };
  $("scoreTable").innerHTML =
    `<tr><th>Supplier</th><th>Orders / month</th><th>Complaints (own / all)</th><th>Defect rate</th><th>Top defect</th><th>Own cost</th><th>Status</th></tr>` +
    sc
      .map(
        (
          r,
        ) => `<tr><td>${esc(r.s.name)} <span class="meta">${r.s.country}</span></td><td>${r.s.monthlyOrders.toLocaleString("en-GB")}</td>
      <td>${r.own} / ${r.all}</td><td>${r.rate.toFixed(2)} %</td><td>${r.top ? esc(r.top[0].replace("_", " ")) + " (" + r.top[1].length + ")" : "–"}</td>
      <td>${eur(r.cost)}</td><td><span class="pill st-${r.status}">${label[r.status]}</span></td></tr>`,
      )
      .join("");
}

const letters = {};
const PEOPLE = [
  "Unassigned",
  "Melis (Quality)",
  "Sara (Quality lead)",
  "Tom (Supplier manager)",
];
const STATUSES = {
  open: "Open",
  progress: "In progress",
  waiting: "Waiting for supplier",
  closed: "Closed",
};
const PRIORITIES = ["High", "Medium", "Low"];
const isoDate = (d) => d.toISOString().slice(0, 10);
const stamp = () =>
  new Date().toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

// Every CAPA in the period, plus any CAPA that already has a history.
function capaItems() {
  const items = {};
  scorecard().forEach((r) =>
    r.capaDefects.forEach(([defect, list]) => {
      items[r.sid + "-" + defect] = { sid: r.sid, s: r.s, defect, list };
    }),
  );
  Object.keys(capaState).forEach((key) => {
    if (items[key]) return;
    const [sid, defect] = key.split("-");
    if (!SUPPLIERS[sid]) return;
    const list = complaints.filter(
      (c) =>
        ORDERS[c.order].supplier === sid &&
        ownerOf(c) === "supplier" &&
        results[c.id].defect === defect,
    );
    items[key] = { sid, s: SUPPLIERS[sid], defect, list };
  });
  return Object.entries(items).map(([key, it]) => {
    const cost = it.list.reduce((a, c) => a + ORDERS[c.order].cost, 0);
    if (!capaState[key]) {
      const due = new Date(today);
      due.setDate(due.getDate() + 7); // 5 working days
      capaState[key] = {
        status: "open",
        assignee: "Unassigned",
        priority: it.list.length >= 5 || cost >= 300 ? "High" : "Medium",
        due: isoDate(due),
        log: [
          {
            at: stamp(),
            text:
              "Opened by the agent: " +
              it.list.length +
              " repeated " +
              it.defect.replace("_", " ") +
              " complaints",
          },
        ],
      };
    }
    return { key, ...it, cost, st: capaState[key] };
  });
}

function updateCapa(key, field, value) {
  const st = capaState[key];
  if (st[field] === value) return;
  const label = field === "status" ? STATUSES[value] : value;
  st[field] = value;
  st.log.push({
    at: stamp(),
    text: field[0].toUpperCase() + field.slice(1) + " → " + label,
  });
  renderAll();
}

function renderCapa() {
  const items = capaItems();
  const sel = (key, field, options, current) =>
    `<select class="capa-field" data-key="${key}" data-field="${field}">${options
      .map(
        ([v, l]) =>
          `<option value="${v}" ${v === current ? "selected" : ""}>${l}</option>`,
      )
      .join("")}</select>`;
  $("capaBoard").innerHTML = Object.entries(STATUSES)
    .map(([status, title]) => {
      const cards = items.filter((x) => x.st.status === status);
      return `<div class="col">
        <div class="col-head">${title} <span class="meta">${cards.length}</span></div>
        ${
          cards
            .map((x) => {
              const overdue =
                x.st.status !== "closed" && x.st.due < isoDate(today);
              return `<div class="capa-card prio-${x.st.priority.toLowerCase()}">
              <strong>${esc(x.s.name)} · ${esc(x.defect.replace("_", " "))}</strong>
              <div class="meta">${x.list.length} complaints · ${eur(x.cost)} · orders ${x.list.map((c) => c.order).join(", ")}</div>
              <div class="meta ${overdue ? "overdue" : ""}">Due ${x.st.due}${overdue ? " · overdue" : ""}</div>
              <label class="meta">Status ${sel(x.key, "status", Object.entries(STATUSES), x.st.status)}</label>
              <label class="meta">Owner ${sel(
                x.key,
                "assignee",
                PEOPLE.map((p) => [p, p]),
                x.st.assignee,
              )}</label>
              <label class="meta">Priority ${sel(
                x.key,
                "priority",
                PRIORITIES.map((p) => [p, p]),
                x.st.priority,
              )}</label>
              <button class="btn ghost draft" data-key="${x.key}">Draft CAPA request</button>
              <span class="meta" id="st-${x.key}"></span>
              <details><summary class="meta">History (${x.st.log.length})</summary>
                ${x.st.log.map((l) => `<div class="meta">${esc(l.at)} – ${esc(l.text)}</div>`).join("")}
              </details>
            </div>`;
            })
            .join("") || '<p class="note">–</p>'
        }
      </div>`;
    })
    .join("");
  $("capaLetters").innerHTML = items
    .filter((x) => letters[x.key])
    .map(
      (x) =>
        `<div class="item"><strong>${esc(x.s.name)} · ${esc(x.defect.replace("_", " "))}</strong><div class="letter">${esc(letters[x.key])}</div></div>`,
    )
    .join("");
  document
    .querySelectorAll(".capa-field")
    .forEach((e) =>
      e.addEventListener("change", () =>
        updateCapa(e.dataset.key, e.dataset.field, e.value),
      ),
    );
  document
    .querySelectorAll(".draft")
    .forEach((b) =>
      b.addEventListener("click", () => draftCapa(b.dataset.key)),
    );
}

/* =====================================================================
   AI LAYER
   Uses the built-in AI when opened inside claude.ai; anywhere else
   (e.g. GitHub Pages) it calls the Anthropic API with the viewer's key.
   ===================================================================== */
let builtIn = null;
// ai(prompt) returns { text }. Inside claude.ai it uses the built-in capability;
// elsewhere (e.g. GitHub Pages) it calls the Anthropic API with the viewer's own key.
let ai = null;
(async () => {
  for (let i = 0; i < 30 && !(window.claude && window.claude.use); i++)
    await new Promise((r) => setTimeout(r, 100));
  try {
    if (window.claude && window.claude.use)
      builtIn = await window.claude.use("sample");
  } catch {
    builtIn = null;
  }
  if (builtIn) {
    ai = builtIn;
    return;
  }
  $("keyBox").classList.remove("hidden");
  ai = async (prompt) => {
    const key = $("apiKey").value.trim();
    if (!key) throw new Error("Enter an Anthropic API key first");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) throw new Error("API error " + r.status);
    const d = await r.json();
    return { text: d.content.map((c) => c.text || "").join("") };
  };
})();

const parseJson = (t) => {
  const a = t.search(/[\[{]/),
    b = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  return JSON.parse(t.slice(a, b + 1));
};

/* =====================================================================
   MASKING: nothing that identifies a company or a person goes to the AI.
   Suppliers and carriers are sent as codes (S4, C2); e-mail addresses,
   phone numbers, postcodes and IBANs in the complaint text are replaced.
   Real names are put back only after the answer comes back.
   ===================================================================== */
function maskText(t) {
  return String(t)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[EMAIL]")
    .replace(/\b[A-Z]{2}\d{2}\s?[A-Z]{4}(\s?\d{2,4}){2,5}\b/g, "[IBAN]")
    .replace(/(\+|00)?\d[\d\s-]{7,}\d/g, "[PHONE]")
    .replace(/\b\d{4}\s?[A-Z]{2}\b/g, "[POSTCODE]");
}
function caseFor(c) {
  const o = ORDERS[c.order];
  return {
    id: c.id,
    text: maskText(c.text),
    product: o.product,
    supplier: o.supplier,
    carrier: o.carrier,
    upload_file_check: {
      dpi: o.file.dpi,
      has_bleed: o.file.bleed,
      very_bright_rgb_colours: o.file.vividRGB,
    },
  };
}

const CLASSIFY_RULES = `You are a quality specialist at an online print marketplace. Printing is done by partner printers (suppliers) and shipping by carriers.
For each complaint decide:
- "defect": one of ${JSON.stringify(DEFECTS)}
- "owner": who caused it: "supplier" (printing/finishing/packing error), "customer_file" (the customer's own file caused it), "carrier" (damage or delay in transit) or "unclear" (not enough information)
- "confidence": 0 to 1
- "evidence": one short sentence explaining the decision
Use the upload file check as evidence: low dpi (< 200) makes blur the customer's file; no bleed makes a white edge the customer's file;
very bright RGB colours make dull neon colours the customer's file. If the file check was fine, the same defect points to the supplier.
Vague complaints with no concrete defect are "unclear". Complaints may be in any language.`;

$("runAI").addEventListener("click", async () => {
  if (!ai) return;
  const btn = $("runAI");
  btn.disabled = true;
  $("aiStatus").innerHTML =
    '<span class="spinner"></span>The agent is reading ' +
    complaints.length +
    " complaints…";
  try {
    const prompt = `${CLASSIFY_RULES}\n\nComplaints:\n${JSON.stringify(complaints.map(caseFor), null, 1)}\n\nReply with ONLY a JSON array of objects {"id","defect","owner","confidence","evidence"}, one per complaint.`;
    const res = await ai(prompt, { modelTier: "default" });
    const list = parseJson(res.text);
    let agree = 0,
      n = 0;
    list.forEach((r) => {
      if (!results[r.id]) return;
      const base = ruleClassify(complaints.find((c) => c.id === r.id));
      n++;
      if (base.owner === r.owner) agree++;
      results[r.id] = {
        defect: DEFECTS.includes(r.defect) ? r.defect : "other",
        owner: OWNERS[r.owner] ? r.owner : "unclear",
        confidence: Number(r.confidence) || 0.5,
        evidence: r.evidence || "",
        by: "ai",
      };
    });
    $("engineNote").textContent =
      "Showing AI results (rules kept as a cross-check).";
    $("aiStatus").textContent =
      `Done. AI and rules agree on the owner for ${agree} of ${n} complaints. Disagreements are where a person should look first.`;
    renderAll();
  } catch (e) {
    $("aiStatus").textContent =
      "AI analysis failed (" +
      ((e && (e.code || e.message)) || "unknown") +
      "). Rule-based results are still shown.";
  } finally {
    btn.disabled = false;
  }
});

async function draftCapa(key) {
  const [sid, defect] = key.split("-");
  const s = SUPPLIERS[sid];
  let list = complaints.filter(
    (c) =>
      inPeriod(c) &&
      ORDERS[c.order].supplier === sid &&
      ownerOf(c) === "supplier" &&
      results[c.id].defect === defect,
  );
  if (!list.length)
    list = complaints.filter(
      (c) =>
        ORDERS[c.order].supplier === sid &&
        ownerOf(c) === "supplier" &&
        results[c.id].defect === defect,
    );
  const st = $("st-" + key);
  const logDraft = (by) =>
    capaState[key] &&
    capaState[key].log.push({
      at: stamp(),
      text: "CAPA letter drafted (" + by + ")",
    });
  // The AI only sees masked text and the code "{{SUPPLIER}}"; the real name is filled in here.
  const maskedEvidence = list
    .map(
      (c) =>
        `- ${c.order} (${ORDERS[c.order].product}, ${c.date}): "${maskText(c.text)}"`,
    )
    .join("\n");
  const evidence = list
    .map(
      (c) =>
        `- ${c.order} (${ORDERS[c.order].product}, ${c.date}): "${c.text}"`,
    )
    .join("\n");
  const fallback = `Subject: Corrective action request – repeated ${defect} defects\n\nDear ${s.name} team,\n\nIn the period ${periodLabel()} we received ${list.length} customer complaints about ${defect} on orders produced by you. The customer files passed our upload checks, so we consider this a production issue.\n\n${evidence}\n\nPlease send us within 5 working days:\n1. The root cause of these defects\n2. The immediate containment action\n3. The corrective and preventive actions, with dates\n\nWe will review the defect rate for 30 days after your actions.\n\nKind regards,\nQuality team`;
  if (!ai) {
    letters[key] = fallback;
    logDraft("template");
    renderAll();
    return;
  }
  st.innerHTML = '<span class="spinner"></span>Drafting…';
  try {
    const prompt = `Write a short, professional corrective action request (CAPA) from a print marketplace's quality team to a partner printer. Address it as "{{SUPPLIER}}" (country ${s.country}); never invent a name.
Repeated defect: ${defect}. Supplier-caused complaints (${periodLabel()}; customer files passed the upload check):
${maskedEvidence}
Include: a subject line, the facts and evidence (summarise the complaints in English), a request for root cause, containment, corrective and preventive actions with dates within 5 working days, and that the defect rate will be reviewed for 30 days. Firm but respectful; keep the partnership. Plain text, under 220 words.`;
    const res = await ai(prompt, { modelTier: "default" });
    letters[key] = res.text.trim().split("{{SUPPLIER}}").join(s.name);
    logDraft("AI");
  } catch {
    letters[key] = fallback;
    logDraft("template");
  }
  renderAll();
}

/* ---- Live demo: add a complaint ---- */
$("newOrder").innerHTML = Object.entries(ORDERS)
  .map(
    ([id, o]) =>
      `<option value="${id}">${id} · ${o.product} · ${SUPPLIERS[o.supplier].name} · file ${o.file.dpi} dpi${o.file.bleed ? "" : ", no bleed"}</option>`,
  )
  .join("");
$("addBtn").addEventListener("click", async () => {
  const text = $("newText").value.trim();
  if (!text) return;
  const c = {
    id: "T-" + (900 + complaints.length),
    order: $("newOrder").value,
    date: "2026-11-10",
    lang: "?",
    text,
  };
  const out = $("addOut");
  $("addBtn").disabled = true;
  let r = ruleClassify(c);
  if (ai) {
    out.innerHTML = '<span class="spinner"></span>Analysing…';
    try {
      const res = await ai(
        `${CLASSIFY_RULES}\n\nComplaint:\n${JSON.stringify(caseFor(c))}\n\nReply with ONLY a JSON object {"defect","owner","confidence","evidence"}.`,
        { modelTier: "default" },
      );
      const j = parseJson(res.text);
      r = {
        defect: DEFECTS.includes(j.defect) ? j.defect : "other",
        owner: OWNERS[j.owner] ? j.owner : "unclear",
        confidence: Number(j.confidence) || 0.5,
        evidence: j.evidence || "",
        by: "ai",
      };
    } catch {}
  }
  complaints.push(c);
  results[c.id] = r;
  out.innerHTML = `<span class="pill">${esc(r.defect.replace("_", " "))}</span><span class="pill own-${r.owner}">${OWNERS[r.owner]}</span>
    <span class="meta">${Math.round(r.confidence * 100)} % · ${r.by === "ai" ? "AI" : "rules"}</span><div class="meta">${esc(r.evidence)}</div>
    <div class="meta">Added to the list; scorecard and CAPA are updated.</div>`;
  $("newText").value = "";
  $("addBtn").disabled = false;
  fillPeriods();
  renderAll();
});

/* ---- Tabs ---- */
document.querySelectorAll("#tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document
      .querySelectorAll("#tabs button")
      .forEach((x) => x.classList.toggle("on", x === b));
    document
      .querySelectorAll("main > section")
      .forEach((s) =>
        s.classList.toggle("hidden", s.id !== "v-" + b.dataset.t),
      );
  }),
);
$("filterOwner").addEventListener("change", renderComplaints);
$("search").addEventListener("input", renderComplaints);
$("period").addEventListener("change", (e) => {
  period = e.target.value;
  renderAll();
});

/* =====================================================================
   EXPORT TO EXCEL (CSV). Semicolon-separated with a UTF-8 marker, so Excel
   opens it directly and keeps characters like ü, é and ş.
   ===================================================================== */
function downloadCsv(name, rows) {
  const cell = (v) => {
    const t = String(v ?? "");
    return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const csv = "\uFEFF" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
const fileTag = () =>
  period === "7" || period === "30" ? "last-" + period + "-days" : period;
$("exportComplaints").addEventListener("click", () => {
  const rows = [
    [
      "Ticket",
      "Date",
      "Language",
      "Order",
      "Product",
      "Supplier",
      "Carrier",
      "Complaint",
      "Defect",
      "Owner",
      "Decided by",
      "Confidence %",
      "Cost EUR",
    ],
  ];
  complaints
    .filter(inPeriod)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((c) => {
      const o = ORDERS[c.order],
        r = results[c.id];
      rows.push([
        c.id,
        c.date,
        c.lang,
        c.order,
        o.product,
        SUPPLIERS[o.supplier].name,
        CARRIERS[o.carrier],
        c.text,
        r.defect.replace("_", " "),
        OWNERS[ownerOf(c)],
        overrides[c.id] ? "person" : r.by === "ai" ? "AI" : "rules",
        Math.round(r.confidence * 100),
        o.cost,
      ]);
    });
  downloadCsv("complaints_" + fileTag() + ".csv", rows);
});
$("exportScorecard").addEventListener("click", () => {
  const label = { ok: "OK", watch: "Watch", capa: "CAPA" };
  const rows = [
    [
      "Supplier",
      "Country",
      "Orders per month",
      "Complaints (all)",
      "Complaints (supplier-caused)",
      "Defect rate %",
      "Top defect",
      "Supplier-caused cost EUR",
      "Status",
    ],
  ];
  scorecard()
    .sort((a, b) => b.rate - a.rate)
    .forEach((r) =>
      rows.push([
        r.s.name,
        r.s.country,
        r.s.monthlyOrders,
        r.all,
        r.own,
        r.rate.toFixed(2),
        r.top ? r.top[0].replace("_", " ") : "",
        r.cost,
        label[r.status],
      ]),
    );
  downloadCsv("supplier-scorecard_" + fileTag() + ".csv", rows);
});
$("resetDemo").addEventListener("click", () => {
  try {
    localStorage.removeItem(STORE);
  } catch {}
  location.reload();
});

$("exportCapa").addEventListener("click", () => {
  const rows = [
    [
      "Supplier",
      "Defect",
      "Complaints",
      "Cost EUR",
      "Status",
      "Owner",
      "Priority",
      "Due",
      "History",
    ],
  ];
  capaItems().forEach((x) =>
    rows.push([
      x.s.name,
      x.defect.replace("_", " "),
      x.list.length,
      x.cost,
      STATUSES[x.st.status],
      x.st.assignee,
      x.st.priority,
      x.st.due,
      x.st.log.map((l) => l.at + " " + l.text).join(" | "),
    ]),
  );
  downloadCsv("capa-board.csv", rows);
});

// Show, on the How it works tab, exactly what the AI receives for one complaint.
(() => {
  const c = complaints.find((x) => /@/.test(x.text)) || complaints[0];
  const o = ORDERS[c.order];
  $("maskBefore").textContent =
    `${c.text}\nSupplier: ${SUPPLIERS[o.supplier].name} · Carrier: ${CARRIERS[o.carrier]}`;
  $("maskAfter").textContent = JSON.stringify(caseFor(c), null, 1);
})();

fillPeriods();
renderAll();
