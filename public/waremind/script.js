/* =========================================================
   Smart Warehouse Operations & Order Fulfillment System — AI Warehouse Command Center
   Pure JavaScript state engine (no libraries required)
   ========================================================= */

const STAGES = ["Created", "Prioritized", "Allocated", "Picking", "Packing", "QC", "Dispatch"];

const state = {
  inventory: [
    { sku: "P001", name: "Laptop 14\"", zone: "A", available: 8, reorder: 15, capacity: 60 },
    { sku: "P002", name: "Wireless Mouse", zone: "A", available: 120, reorder: 40, capacity: 200 },
    { sku: "P003", name: "Mechanical Keyboard", zone: "B", available: 26, reorder: 30, capacity: 120 },
    { sku: "P004", name: "27\" Monitor", zone: "C", available: 44, reorder: 20, capacity: 90 },
    { sku: "P005", name: "USB-C Hub", zone: "B", available: 5, reorder: 25, capacity: 150 },
    { sku: "P006", name: "Office Chair", zone: "D", available: 62, reorder: 15, capacity: 80 },
  ],
  orders: [
    { id: "ORD-1024", sku: "P001", qty: 10, priority: "Critical", stage: "Prioritized", zone: "A", due: "Today 18:00" },
    { id: "ORD-1025", sku: "P005", qty: 6, priority: "High", stage: "Allocated", zone: "B", due: "Today 20:00" },
    { id: "ORD-1026", sku: "P003", qty: 12, priority: "High", stage: "Picking", zone: "B", due: "Tomorrow 09:00" },
    { id: "ORD-1027", sku: "P004", qty: 4, priority: "Medium", stage: "Packing", zone: "C", due: "Tomorrow 14:00" },
    { id: "ORD-1028", sku: "P002", qty: 30, priority: "Normal", stage: "QC", zone: "A", due: "Thu 11:00" },
    { id: "ORD-1029", sku: "P006", qty: 3, priority: "Medium", stage: "Created", zone: "D", due: "Thu 16:00" },
    { id: "ORD-1030", sku: "P002", qty: 15, priority: "Normal", stage: "Picking", zone: "A", due: "Fri 10:00" },
    { id: "ORD-1021", sku: "P004", qty: 2, priority: "High", stage: "Dispatch", zone: "C", due: "Delivered" },
  ],
  zones: [
    { id: "A", name: "ZONE A", pickers: 4, avgTime: 6.2, delay: 2 },
    { id: "B", name: "ZONE B", pickers: 3, avgTime: 11.8, delay: 18 },
    { id: "C", name: "ZONE C", pickers: 5, avgTime: 7.4, delay: 6 },
    { id: "D", name: "ZONE D", pickers: 2, avgTime: 5.1, delay: 0 },
  ],
  exceptions: [],
  feed: [],
  filter: null,
  activeZone: null,
};

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const clock = () =>
  new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

function log(text, kind = "") {
  state.feed.unshift({ t: clock(), text, kind });
  state.feed = state.feed.slice(0, 40);
  renderFeed();
}

function invBySku(sku) {
  return state.inventory.find((i) => i.sku === sku);
}

function healthOf(item) {
  if (item.available <= item.reorder * 0.4) return "crit";
  if (item.available < item.reorder) return "warn";
  return "ok";
}

function zoneHealth(zone) {
  const items = state.inventory.filter((i) => i.zone === zone.id);
  if (zone.delay >= 15 || items.some((i) => healthOf(i) === "crit")) return "crit";
  if (zone.delay >= 5 || items.some((i) => healthOf(i) === "warn")) return "warn";
  return "ok";
}

/* ---------- AI DECISION ENGINE ---------- */
function computeDecisions() {
  const decisions = [];

  // 1. Allocation shortfalls
  state.orders
    .filter((o) => ["Created", "Prioritized"].includes(o.stage))
    .forEach((o) => {
      const item = invBySku(o.sku);
      if (!item) return;
      if (item.available < o.qty) {
        const competing = state.orders.filter(
          (x) => x.sku === o.sku && x.id !== o.id && x.stage !== "Dispatch"
        ).length;
        decisions.push({
          id: "alloc-" + o.id,
          type: "CRITICAL ALLOCATION",
          level: "crit",
          title: o.id,
          rows: [
            ["Required", o.qty],
            ["Available", item.available],
            ["Recommended allocation", item.available],
          ],
          confidence: 94,
          action: "Approve partial allocation",
          onApprove: () => partialAllocate(o.id),
          explain: {
            bullets: [
              `Order priority: ${o.priority}`,
              `Delivery urgency: ${o.due}`,
              `Available inventory: ${item.available} units of ${item.sku}`,
              `Competing orders for same SKU: ${competing}`,
              `Stockout risk: ${healthOf(item) === "ok" ? "LOW" : "HIGH"}`,
            ],
            verdict: `${o.id} is a ${o.priority.toLowerCase()}-priority order due ${o.due}, but only ${item.available} of the ${o.qty} requested units of ${item.name} are on hand. Rather than blocking the whole order, the system recommends shipping ${item.available} units now and backordering the remaining ${o.qty - item.available}. This protects the delivery promise for the most urgent customer while keeping ${competing} competing order(s) unblocked.`,
          },
        });
      }
    });

  // 2. Low-stock risk
  state.inventory
    .filter((i) => i.available < i.reorder)
    .forEach((i) => {
      decisions.push({
        id: "stock-" + i.sku,
        type: "LOW STOCK RISK",
        level: "warn",
        title: `${i.name} SKU ${i.sku}`,
        rows: [
          ["Available", i.available],
          ["Reorder level", i.reorder],
          ["Stockout risk", healthOf(i) === "crit" ? "HIGH" : "MEDIUM"],
        ],
        confidence: 88,
        action: "Raise replenishment",
        onApprove: () => replenish(i.sku),
        explain: {
          bullets: [
            `Order priority: ${state.orders.filter((o) => o.sku === i.sku).length} open orders depend on this SKU`,
            `Delivery urgency: next commitment within 24h`,
            `Available inventory: ${i.available} units (reorder at ${i.reorder})`,
            `Competing orders: ${state.orders.filter((o) => o.sku === i.sku && o.stage !== "Dispatch").length}`,
            `Stockout risk: ${healthOf(i) === "crit" ? "HIGH" : "MEDIUM"}`,
          ],
          verdict: `Stock of ${i.name} has fallen below its reorder point. At the current outbound rate this SKU runs dry before the next inbound window, which would stall every order in Zone ${i.zone}. The system recommends raising a replenishment of ${i.reorder * 2 - i.available} units now.`,
        },
      });
    });

  // 3. Bottlenecks
  state.zones
    .filter((z) => z.delay >= 10)
    .forEach((z) => {
      decisions.push({
        id: "bn-" + z.id,
        type: "BOTTLENECK DETECTED",
        level: "warn",
        title: `Picking ${z.name}`,
        rows: [
          ["Delay", `+${z.delay}%`],
          ["Avg processing", `${z.avgTime} min`],
          ["Recommended action", "Optimize picking route"],
        ],
        confidence: 91,
        action: "Optimize picking route",
        onApprove: () => optimizeZone(z.id),
        explain: {
          bullets: [
            `Order priority: ${state.orders.filter((o) => o.zone === z.id).length} orders routed through ${z.name}`,
            `Delivery urgency: throughput loss compounds every hour`,
            `Available inventory: spread across ${state.inventory.filter((i) => i.zone === z.id).length} racks in this zone`,
            `Competing orders: pickers ${z.pickers} vs demand`,
            `Stockout risk: indirect — delayed picks look like stockouts downstream`,
          ],
          verdict: `${z.name} is processing picks ${z.delay}% slower than baseline with only ${z.pickers} pickers. The travel path between racks is the main cost. Re-sequencing picks into a single serpentine route should recover roughly ${Math.round(z.delay * 0.7)}% of the lost time without adding staff.`,
        },
      });
    });

  return decisions;
}

/* ---------- ACTIONS (state mutations) ---------- */
function partialAllocate(orderId) {
  const o = state.orders.find((x) => x.id === orderId);
  const item = invBySku(o.sku);
  const give = Math.min(item.available, o.qty);
  item.available -= give;
  o.allocated = give;
  o.stage = "Allocated";
  log(`AI allocated ${give}/${o.qty} units to ${o.id}`, "");
  renderAll();
}

function replenish(sku) {
  const i = invBySku(sku);
  i.available += i.reorder * 2 - i.available;
  log(`Replenishment received for ${sku} — stock restored to ${i.available}`, "good");
  renderAll();
}

function optimizeZone(zoneId) {
  const z = state.zones.find((x) => x.id === zoneId);
  z.delay = Math.max(0, z.delay - 12);
  z.avgTime = +(z.avgTime * 0.78).toFixed(1);
  log(`Optimized picking route in ZONE ${zoneId} — delay now +${z.delay}%`, "good");
  renderAll();
}

function advance(orderId) {
  const o = state.orders.find((x) => x.id === orderId);
  const idx = STAGES.indexOf(o.stage);
  if (idx < STAGES.length - 1) {
    o.stage = STAGES[idx + 1];
    if (o.stage === "Allocated" && !o.allocated) {
      const item = invBySku(o.sku);
      const give = Math.min(item.available, o.qty);
      item.available -= give;
      o.allocated = give;
    }
    if (o.stage === "Dispatch") log(`Order ${o.id} successfully dispatched`, "good");
    else log(`${o.id} moved to ${o.stage}`);
    renderAll();
  }
}

function reportDamage(sku) {
  const i = invBySku(sku);
  if (i.available > 0) i.available -= 1;
  state.exceptions.push({
    id: "EXC-" + (900 + state.exceptions.length + 1),
    title: `Damaged unit — ${i.name} (${sku})`,
    detail: `1 unit failed physical inspection in Zone ${i.zone}. Inventory decremented automatically.`,
    fix: `Replace from Zone ${i.zone} buffer stock and flag supplier batch`,
    sku,
  });
  log(`Damaged item detected for ${sku} — exception raised`, "alert");
  renderAll();
}

function resolveException(id) {
  const e = state.exceptions.find((x) => x.id === id);
  const i = invBySku(e.sku);
  i.available += 1;
  state.exceptions = state.exceptions.filter((x) => x.id !== id);
  log(`Exception ${id} resolved — replacement unit issued`, "good");
  renderAll();
}

/* ---------- RENDER ---------- */
function renderHero() {
  const active = state.orders.filter((o) => o.stage !== "Dispatch").length;
  $("hsOrders").textContent = active;
  $("hsSkus").textContent = state.inventory.length;
  $("hsRisk").textContent = state.inventory.filter((i) => i.available < i.reorder).length;
  const done = state.orders.filter((o) => o.stage === "Dispatch").length;
  $("hsThru").textContent = Math.round((done / state.orders.length) * 100) + "%";
}

function renderDecisions() {
  const list = $("decisionList");
  const decisions = computeDecisions();
  $("engineCount").textContent =
    decisions.length === 0
      ? "All clear — no action required"
      : `${decisions.length} decision${decisions.length > 1 ? "s" : ""} require attention`;

  list.innerHTML = "";
  if (!decisions.length) {
    list.innerHTML = '<p class="empty">The engine found no risks in the current operating window.</p>';
    return;
  }
  decisions.forEach((d) => {
    const el = document.createElement("article");
    el.className = "decision " + d.level;
    el.innerHTML = `
      <div class="decision-title">${d.type}</div>
      <h3>${d.title}</h3>
      <div class="kv">${d.rows.map(([k, v]) => `${k}: <b>${v}</b>`).join("")}</div>
      <div class="confidence"><i style="width:${d.confidence}%"></i></div>
      <div class="kv" style="margin-bottom:10px">Confidence: <b>${d.confidence}%</b></div>
      <div class="decision-actions">
        <button class="act primary" data-approve="${d.id}">${d.action}</button>
        <button class="act" data-explain="${d.id}">Explain Decision</button>
      </div>`;
    el.querySelector("[data-approve]").onclick = d.onApprove;
    el.querySelector("[data-explain]").onclick = () => openExplain(d);
    list.appendChild(el);
  });
}

function openExplain(d) {
  $("modalBody").innerHTML = `
    <ul>${d.explain.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>
    <div class="verdict">${d.explain.verdict}</div>`;
  $("modal").hidden = false;
}

function renderMap() {
  const map = $("map");
  map.innerHTML = "";
  state.zones.forEach((z) => {
    const h = zoneHealth(z);
    const items = state.inventory.filter((i) => i.zone === z.id);
    const fill = Math.min(12, Math.max(2, Math.round(items.reduce((s, i) => s + i.available, 0) / 15)));
    const btn = document.createElement("button");
    btn.className = "zone" + (state.activeZone === z.id ? " active" : "");
    btn.innerHTML = `
      <header><span>${z.name}</span><i class="dot ${h}"></i></header>
      <div class="racks">${Array.from({ length: 12 })
        .map((_, k) => `<i class="${k < fill ? "f" : ""} ${k === fill - 1 ? "a" : ""}"></i>`)
        .join("")}</div>
      <div class="meta">${items.length} SKUs · ${z.pickers} pickers · +${z.delay}% delay</div>`;
    btn.onclick = () => {
      state.activeZone = z.id;
      renderMap();
      renderZoneDetail();
    };
    map.appendChild(btn);
  });
}

function renderZoneDetail() {
  const box = $("zoneDetail");
  const z = state.zones.find((x) => x.id === state.activeZone);
  if (!z) {
    box.innerHTML = '<p class="muted">Select a zone to inspect live operations.</p>';
    return;
  }
  const items = state.inventory.filter((i) => i.zone === z.id);
  const orders = state.orders.filter((o) => o.zone === z.id && o.stage !== "Dispatch");
  const picking = orders.filter((o) => o.stage === "Picking").length;
  box.innerHTML = `
    <dl>
      <div><dt>INVENTORY</dt><dd>${items.reduce((s, i) => s + i.available, 0)} units / ${items.length} SKUs</dd></div>
      <div><dt>ACTIVE ORDERS</dt><dd>${orders.length}</dd></div>
      <div><dt>PICKING ACTIVITY</dt><dd>${picking} pick task(s) · ${z.pickers} pickers</dd></div>
      <div><dt>AVG PROCESSING TIME</dt><dd>${z.avgTime} min / order</dd></div>
      <div><dt>BOTTLENECKS</dt><dd>${z.delay >= 10 ? `Route delay +${z.delay}%` : z.delay > 0 ? `Minor congestion +${z.delay}%` : "None detected"}</dd></div>
      <div><dt>ZONE STATUS</dt><dd>${zoneHealth(z).toUpperCase()}</dd></div>
    </dl>`;
}

function renderRadar() {
  ["Critical", "High", "Medium", "Normal"].forEach((p) => {
    $("pc" + p).textContent = state.orders.filter(
      (o) => o.priority === p && o.stage !== "Dispatch"
    ).length;
  });
  const list = $("orderList");
  const rows = state.filter ? state.orders.filter((o) => o.priority === state.filter) : state.orders;
  list.innerHTML = rows
    .map(
      (o) => `<div class="order">
        <span><b>${o.id}</b> <small class="muted">${o.sku} ×${o.qty}</small></span>
        <span class="tag ${o.priority}">${o.priority}</span>
        <span class="muted small">${o.stage}</span>
        <button class="act" data-adv="${o.id}">Advance</button>
      </div>`
    )
    .join("");
  list.querySelectorAll("[data-adv]").forEach((b) => (b.onclick = () => advance(b.dataset.adv)));
}

function renderPipeline() {
  const wrap = $("pipeline");
  wrap.innerHTML = "";
  STAGES.forEach((s, idx) => {
    const n = state.orders.filter((o) => o.stage === s).length;
    const el = document.createElement("div");
    el.className = "stage" + (n >= 2 && s === "Picking" ? " hot" : "");
    el.innerHTML = `<b>${n}</b><span>${s.toUpperCase()}</span>`;
    wrap.appendChild(el);
    if (idx < STAGES.length - 1) {
      const a = document.createElement("div");
      a.className = "stage-arrow";
      a.textContent = "→";
      wrap.appendChild(a);
    }
  });
}

function renderInventory() {
  $("invList").innerHTML = state.inventory
    .map((i) => {
      const h = healthOf(i);
      const pct = Math.min(100, Math.round((i.available / i.capacity) * 100));
      return `<div class="inv">
        <div class="inv-top">
          <span><b>${i.name}</b> <small>${i.sku} · ZONE ${i.zone}</small></span>
          <small>${i.available} / reorder ${i.reorder}</small>
        </div>
        <div class="bar"><i class="${h}" style="width:${pct}%"></i></div>
        <div style="margin-top:8px"><button class="act danger" data-dmg="${i.sku}">Report damaged unit</button></div>
      </div>`;
    })
    .join("");
  $("invList")
    .querySelectorAll("[data-dmg]")
    .forEach((b) => (b.onclick = () => reportDamage(b.dataset.dmg)));
}

function renderBottlenecks() {
  $("bottlenecks").innerHTML = state.zones
    .map((z) => {
      const cls = z.delay >= 15 ? "high" : z.delay >= 5 ? "mid" : "";
      return `<div class="bn ${cls}">
        <header><span>Picking ${z.name}</span><span class="delay">+${z.delay}% delay</span></header>
        <p>${z.avgTime} min average processing · ${z.pickers} pickers assigned · ${
        z.delay >= 10 ? "Recommended action: optimize picking route" : "Operating within tolerance"
      }</p>
        ${z.delay > 0 ? `<button class="act" data-opt="${z.id}">Optimize picking route</button>` : ""}
      </div>`;
    })
    .join("");
  $("bottlenecks")
    .querySelectorAll("[data-opt]")
    .forEach((b) => (b.onclick = () => optimizeZone(b.dataset.opt)));
}

function renderActions() {
  const box = $("actions");
  const critInv = state.inventory.filter((i) => healthOf(i) === "crit");
  const items = [];
  state.exceptions.forEach((e) =>
    items.push(`<div class="action">
      <h4>${e.id} · ${e.title}</h4>
      <p>${e.detail}<br/><b>AI recommendation:</b> ${e.fix}</p>
      <button class="act" data-res="${e.id}">Apply recommendation</button>
    </div>`)
  );
  critInv.forEach((i) =>
    items.push(`<div class="action">
      <h4>Stockout imminent · ${i.sku}</h4>
      <p>${i.name} at ${i.available} units against a reorder level of ${i.reorder}.<br/><b>AI recommendation:</b> emergency replenishment.</p>
      <button class="act" data-rep="${i.sku}">Raise replenishment</button>
    </div>`)
  );
  box.innerHTML = items.length ? items.join("") : '<p class="empty">No critical actions outstanding.</p>';
  box.querySelectorAll("[data-res]").forEach((b) => (b.onclick = () => resolveException(b.dataset.res)));
  box.querySelectorAll("[data-rep]").forEach((b) => (b.onclick = () => replenish(b.dataset.rep)));
}

function renderFeed() {
  $("feed").innerHTML = state.feed
    .map((f) => `<li class="${f.kind}"><time>${f.t}</time><span>${f.text}</span></li>`)
    .join("");
}

function renderAll() {
  renderHero();
  renderDecisions();
  renderMap();
  renderZoneDetail();
  renderRadar();
  renderPipeline();
  renderInventory();
  renderBottlenecks();
  renderActions();
}

/* ---------- SIMULATION MODE ---------- */
const SIM = [
  { h: "New urgent order arrives", p: "ORD-1099 · 12 × Laptop 14\" (P001) flagged CRITICAL, due in 6 hours.", k: "" },
  { h: "Inventory check", p: "Live stock lookup across Zone A racks returns available units.", k: "" },
  { h: "Stock shortage detected", p: "Requested quantity exceeds on-hand stock — allocation cannot be completed in full.", k: "critstep" },
  { h: "AI compares competing orders", p: "Weighing priority, delivery deadline and customer SLA against other open orders on the same SKU.", k: "warnstep" },
  { h: "Stock allocated", p: "Partial allocation approved for the highest-urgency order; remainder backordered.", k: "" },
  { h: "Picking route generated", p: "Serpentine route across Zone A racks minimises travel distance for the picker.", k: "" },
  { h: "Damaged item occurs", p: "One unit fails physical inspection during picking — inventory decremented, exception raised.", k: "critstep" },
  { h: "AI recommends replacement", p: "Replacement pulled from Zone A buffer stock; supplier batch flagged for review.", k: "warnstep" },
  { h: "Order passes QC", p: "Quality check complete — packaging, count and labels verified.", k: "" },
  { h: "Order dispatched", p: "Carrier handoff confirmed, tracking issued to the customer.", k: "" },
  { h: "Inventory updates", p: "Stock levels, pipeline counts and analytics recalculated across the command center.", k: "" },
];

let simRunning = false;

function runSimulation() {
  if (simRunning) return;
  simRunning = true;
  $("simOverlay").hidden = false;
  $("simSteps").innerHTML = "";
  $("simBar").style.width = "0%";

  // inject the simulated order
  const order = { id: "ORD-1099", sku: "P001", qty: 12, priority: "Critical", stage: "Created", zone: "A", due: "Today +6h" };
  state.orders.push(order);
  renderAll();

  let i = 0;
  const tick = setInterval(() => {
    const s = SIM[i];
    const li = document.createElement("li");
    li.className = s.k;
    li.innerHTML = `<span class="n">${String(i + 1).padStart(2, "0")}</span>
      <div><h4>${s.h}</h4><p>${s.p}</p></div>`;
    $("simSteps").appendChild(li);
    $("simSteps").parentElement.scrollTop = $("simSteps").parentElement.scrollHeight;
    $("simBar").style.width = ((i + 1) / SIM.length) * 100 + "%";

    // real state effects
    if (i === 0) log("Urgent order ORD-1099 received (12 × P001)", "alert");
    if (i === 2) log("Stock shortage detected for ORD-1099", "alert");
    if (i === 4) { order.stage = "Prioritized"; partialAllocate("ORD-1099"); }
    if (i === 5) { order.stage = "Picking"; log("Picking route generated for ORD-1099"); renderAll(); }
    if (i === 6) reportDamage("P001");
    if (i === 7 && state.exceptions.length) resolveException(state.exceptions[state.exceptions.length - 1].id);
    if (i === 8) { order.stage = "QC"; log("ORD-1099 passed quality check", "good"); renderAll(); }
    if (i === 9) { order.stage = "Dispatch"; log("Order ORD-1099 successfully dispatched", "good"); renderAll(); }
    if (i === 10) { renderAll(); }

    i++;
    if (i >= SIM.length) {
      clearInterval(tick);
      simRunning = false;
    }
  }, 1400);
}

/* ---------- BOOT ---------- */
function boot() {
  ["Order ORD-1021 successfully dispatched", "Picking bottleneck detected in Zone B", "Low-stock risk detected for SKU P001", "AI allocated 7/10 units to ORD-1024"].forEach(
    (t, idx) => state.feed.push({ t: ["10:31 AM", "10:36 AM", "10:39 AM", "10:42 AM"][3 - idx], text: t, kind: idx === 3 ? "" : idx === 0 ? "good" : "alert" })
  );
  state.feed.reverse();
  renderAll();
  renderFeed();

  setInterval(() => {
    $("clock").textContent = new Date().toLocaleTimeString("en-GB");
  }, 1000);

  $("btnSim").onclick = runSimulation;
  $("simClose").onclick = () => ($("simOverlay").hidden = true);
  $("modalClose").onclick = () => ($("modal").hidden = true);
  $("modal").onclick = (e) => { if (e.target.id === "modal") $("modal").hidden = true; };

  document.querySelectorAll(".ring").forEach((r) => {
    r.onclick = () => {
      const p = r.dataset.priority;
      state.filter = state.filter === p ? null : p;
      document.querySelectorAll(".ring").forEach((x) => x.classList.remove("active"));
      if (state.filter) r.classList.add("active");
      renderRadar();
    };
  });

  // ambient telemetry
  setInterval(() => {
    const z = state.zones[Math.floor(Math.random() * state.zones.length)];
    const msgs = [
      `Throughput scan complete for ZONE ${z.id} — ${z.avgTime} min/order`,
      `Demand forecast refreshed across ${state.inventory.length} SKUs`,
      `Picker utilisation in ZONE ${z.id} at ${60 + Math.floor(Math.random() * 35)}%`,
    ];
    log(msgs[Math.floor(Math.random() * msgs.length)]);
  }, 15000);
}

document.addEventListener("DOMContentLoaded", boot);
console.log("Smart Warehouse Operations & Order Fulfillment System command center online");
