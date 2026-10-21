(function () {
  "use strict";
  const CFG = window.SITE_CONFIG || {};
  const URG = { 1: "Urgent", 2: "Today", 3: "When free" };
  const ROLE_LABEL = { dryliner: "Dryliner", manager: "Manager", labourer: "Labourer" };
  const MATERIALS = ["12.5mm Fireline", "15mm Fireline", "12.5mm Soundbloc", "15mm Soundbloc", "15mm Wallboard",
    "Resilient bar", "MF5", "MF6A", "OSB plywood",
    "Rockwool 100mm Flexi", "Rockwool 100mm RW45", "Rockwool 50mm Flexi", "Rockwool 30mm RW45"];
  const BOARD = ["sheets", "pallets"], METAL = ["lengths", "bundles"], WOOL = ["packs", "pallets"];
  const UNITS = { "Resilient bar": METAL, "MF5": METAL, "MF6A": METAL,
    "Rockwool 100mm Flexi": WOOL, "Rockwool 100mm RW45": WOOL, "Rockwool 50mm Flexi": WOOL, "Rockwool 30mm RW45": WOOL };
  const BLOCKS = [1, 3, 5, 6, 7, 8, 9, 13, 14, 15, 24], FLOORS = [1, 2, 3, 4, 5];

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem("sb-" + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem("sb-" + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem("sb-" + k); } catch (e) {} },
  };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  if (!CFG.url || CFG.url.indexOf("__") === 0) {
    document.querySelector(".wrap").appendChild(el("div", "banner", "This app isn't connected to its database yet. Fill in config.js."));
    return;
  }
  const sb = supabase.createClient(CFG.url, CFG.key);

  let me = store.get("me");           // {name, role, code}
  let orders = [], ready = false, tab = "board", busy = false;
  const seen = new Set(); let firstPaint = true;
  const armed = {};

  // ---------- time helpers ----------
  const pad = (n) => String(n).padStart(2, "0");
  const t = (v) => (v ? Date.parse(v) : null);
  const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? m + " min" : Math.floor(m / 60) + "h " + pad(m % 60) + "m"; };
  const isToday = (ms) => new Date(ms).toDateString() === new Date().toDateString();
  const dayLabel = (ms) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  // ---------- role links: ?join=labourer&code=4242 ----------
  const params = new URLSearchParams(location.search);
  let link = null;
  if (ROLE_LABEL[params.get("join")]) {
    link = { role: params.get("join"), code: params.get("code") || "" };
    store.set("link", link);                       // Android shares this with the installed app
  } else if (store.get("link")) link = store.get("link");

  // ---------- join ----------
  let jRole = link ? link.role : "dryliner";
  let quick = !!link;                              // name-only join from a role link
  function drawJoinRoles() {
    document.querySelectorAll("#jRoles button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.role === jRole)));
    $("jCodeLbl").textContent = jRole === "manager" ? "Manager code" : "Site code";
    const hasCode = quick && link && link.code && link.role === jRole;
    $("jRoleField").hidden = quick;
    $("jCodeField").hidden = !!hasCode;
    $("jAs").hidden = !quick;
    $("jAs").textContent = "Joining as " + ROLE_LABEL[jRole];
    if (hasCode) $("jCode").value = link.code;
    document.querySelector("#join .sub").textContent = hasCode ? "Type your name and tap Join."
      : quick ? "Type your name and the manager code." : "Enter your name and the code your manager gave you.";
  }
  document.querySelectorAll("#jRoles button").forEach((b) => b.addEventListener("click", () => { jRole = b.dataset.role; drawJoinRoles(); }));
  $("join").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("jName").value.trim(), code = $("jCode").value.trim();
    const msg = $("jMsg"); msg.classList.remove("err");
    if (!name) { msg.textContent = "Type your name."; msg.classList.add("err"); return; }
    if (!code) { msg.textContent = "Type the code."; msg.classList.add("err"); return; }
    $("jGo").disabled = true; msg.textContent = "Checking…";
    const { data, error } = await sb.rpc("check_code", { code });
    $("jGo").disabled = false;
    if (error) { msg.textContent = "Couldn't check the code. Check your signal and try again."; msg.classList.add("err"); return; }
    if (!data || (jRole === "manager" && data !== "manager")) {
      msg.textContent = jRole === "manager" ? "That isn't the manager code." : "That code isn't right. Ask your manager.";
      msg.classList.add("err"); return;
    }
    me = { name, role: jRole, code }; store.set("me", me); msg.textContent = "";
    start();
  });
  $("switchBtn").addEventListener("click", () => {
    jRole = me ? me.role : "dryliner"; quick = false;
    $("jName").value = me ? me.name : ""; $("jCode").value = "";
    $("main").hidden = true; $("meBox").hidden = true; $("join").hidden = false; drawJoinRoles();
  });

  // ---------- notifications ----------
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const pushOK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let swReg = null;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then((r) => { swReg = r; drawNotice(); }).catch(() => {});

  function b64ToBytes(s) {
    const p = "=".repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  }
  async function saveSub() {
    if (!swReg || !me) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublic) });
    const j = sub.toJSON();
    const { data, error } = await sb.rpc("save_sub", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_role: me.role, p_name: me.name, p_code: me.code });
    return !error && data === true;
  }
  function drawNotice() {
    const n = $("notice"), txt = $("noticeText"), btn = $("noticeBtn");
    if (!me) return;
    n.hidden = false; n.classList.remove("on"); btn.hidden = true;
    if (isIOS && !standalone) {
      txt.textContent = "To get alerts on your iPhone: tap the Share button, choose Add to Home Screen, then open Site Board from the new icon.";
      return;
    }
    if (!pushOK) { txt.textContent = "This phone can't receive alerts from Site Board. On iPhone, update to iOS 16.4 or newer."; return; }
    const perm = Notification.permission;
    if (perm === "denied") { txt.textContent = "Alerts are blocked. Turn them on in Settings → Notifications → Site Board."; return; }
    if (perm === "granted") {
      n.classList.add("on"); txt.textContent = alertText();
      saveSub().then((ok) => { if (!ok) txt.textContent = "Alerts are allowed but couldn't be registered. Close and reopen the app."; }).catch(() => {});
      return;
    }
    txt.textContent = "Turn on alerts so you hear about " + whatYouHear() + ".";
    btn.textContent = "Turn on alerts"; btn.hidden = false;
  }
  function whatYouHear() {
    return me.role === "manager" ? "new orders and deliveries" : me.role === "labourer" ? "approved deliveries" : "your orders being delivered";
  }
  function alertText() { return "Alerts on. You'll hear about " + whatYouHear() + ", even with your phone locked."; }
  $("noticeBtn").addEventListener("click", async () => {
    $("noticeBtn").disabled = true;
    try {
      const p = await Notification.requestPermission();
      if (p === "granted") {
        const ok = await saveSub();
        $("notice").classList.toggle("on", ok);
        $("noticeText").textContent = ok ? alertText() : "Couldn't register this phone for alerts. Check your signal and try again.";
        $("noticeBtn").hidden = ok;
      } else drawNotice();
    } catch (e) { $("noticeText").textContent = "Couldn't turn on alerts: " + (e && e.message ? e.message : "unknown error"); }
    $("noticeBtn").disabled = false;
  });

  // ---------- order form ----------
  let pick = MATERIALS[0], unit = "sheets";
  let block = store.get("block") || "", floor = store.get("floor") || "";
  function drawUnits() {
    const opts = UNITS[pick] || BOARD; if (opts.indexOf(unit) < 0) unit = opts[0];
    $("units").replaceChildren();
    opts.forEach((u) => { const b = el("button", null, u); b.type = "button"; b.setAttribute("aria-pressed", String(u === unit));
      b.addEventListener("click", () => { unit = u; drawUnits(); }); $("units").appendChild(b); });
    document.querySelectorAll("#chips .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.m === pick)));
  }
  MATERIALS.forEach((m) => { const b = el("button", "chip", m); b.type = "button"; b.dataset.m = m;
    b.addEventListener("click", () => { pick = m; drawUnits(); }); $("chips").appendChild(b); });
  $("addLine").addEventListener("click", () => {
    const n = Math.max(1, parseInt($("qty").value, 10) || 1);
    const u = n === 1 ? unit.replace(/s$/, "") : unit;
    const ta = $("what"); const cur = ta.value.trim();
    ta.value = (cur ? cur + "\n" : "") + pick + " – " + n + " " + u;
    $("qty").value = 1; $("formMsg").textContent = "";
  });
  function drawSeg(id, vals, cur, onPick) {
    const box = $(id); box.replaceChildren();
    vals.forEach((v) => { const b = el("button", null, String(v)); b.type = "button"; b.setAttribute("aria-pressed", String(String(v) === cur));
      b.addEventListener("click", () => onPick(String(v))); box.appendChild(b); });
  }
  function drawPlace() {
    drawSeg("blocks", BLOCKS, block, (v) => { block = v; store.set("block", v); drawPlace(); });
    drawSeg("floors", FLOORS, floor, (v) => { floor = v; store.set("floor", v); drawPlace(); });
  }
  drawUnits(); drawPlace();

  $("orderForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("formMsg"); msg.classList.remove("err");
    const what = $("what").value.trim(), detail = $("detail").value.trim();
    if (!what) { msg.textContent = "Write or add the materials you need."; msg.classList.add("err"); return; }
    if (!block) { msg.textContent = "Pick the block it's going to."; msg.classList.add("err"); return; }
    if (!floor) { msg.textContent = "Pick the floor it's going to."; msg.classList.add("err"); return; }
    $("send").disabled = true; msg.textContent = "Posting…";
    const { error } = await sb.from("orders").insert({ what, block, floor, detail: detail || null, by_name: me.name });
    $("send").disabled = false;
    if (error) { msg.textContent = "Couldn't post. Check your signal and try again."; msg.classList.add("err"); return; }
    $("what").value = ""; $("detail").value = "";
    msg.textContent = "Posted at " + hhmm(Date.now()) + ". Waiting for a manager.";
    load();
  });

  async function act(id, patch, btn) {
    if (btn) btn.disabled = true;
    const { error } = await sb.from("orders").update(patch).eq("id", id);
    if (error) { banner("Couldn't save that. Check your signal and try again."); if (btn) btn.disabled = false; return; }
    load();
  }
  function banner(text) { const b = $("banner"); b.textContent = text; b.hidden = false; setTimeout(() => { b.hidden = true; }, 6000); }

  // ---------- cards ----------
  function metaItem(label, val) { const s = el("span"); s.append(label + " "); s.appendChild(el("b", null, val)); return s; }
  const partialOpen = {}, drafts = {}, armedCancel = {};
  const isMine = (o) => (o.by_name || "").trim().toLowerCase() === (me.name || "").trim().toLowerCase();
  function twoTap(store_, id, label, confirmLabel, cls, onGo) {
    const b = el("button", cls, store_[id] ? confirmLabel : label); b.type = "button";
    if (store_[id]) b.classList.add("confirm");
    b.addEventListener("click", () => {
      if (!store_[id]) { store_[id] = setTimeout(() => { delete store_[id]; render(); }, 4000); render(); return; }
      clearTimeout(store_[id]); delete store_[id]; onGo(b);
    });
    return b;
  }
  function card(o, mode) {
    const created = t(o.created_at);
    const open = o.status === "approved" || o.status === "partial";
    const c = el("article", "card");
    if (o.status === "pending") c.classList.add("pending");
    else if (open) c.classList.add("u" + (o.urgency || 3));
    else if (o.status === "delivered") c.classList.add("done");
    else c.classList.add("closed");
    if (!firstPaint && !seen.has(o.id)) c.classList.add("fresh");

    const top = el("div", "top");
    top.appendChild(el("div", "what", o.what || ""));
    const pills = el("div", "pills");
    if (o.status === "pending") pills.appendChild(el("span", "pill p-pending", "Needs approval"));
    if (open) pills.appendChild(el("span", "pill p-u" + (o.urgency || 3), URG[o.urgency || 3]));
    if (o.status === "partial") pills.appendChild(el("span", "pill p-part", "Part delivered"));
    if (o.status === "delivered") pills.appendChild(el("span", "pill p-done", o.partial_note ? "Done (in parts)" : "Delivered"));
    if (o.status === "declined") pills.appendChild(el("span", "pill p-no", "Declined"));
    if (o.status === "cancelled") pills.appendChild(el("span", "pill p-no", "Cancelled"));
    top.appendChild(pills); c.appendChild(top);

    const meta = el("div", "meta");
    meta.appendChild(metaItem("To", "Block " + o.block + " · Floor " + o.floor + (o.detail ? " · " + o.detail : "")));
    meta.appendChild(metaItem("For", o.by_name || "Someone"));
    c.appendChild(meta);

    if (o.partial_note) {
      const pn = el("div", "partnote");
      pn.appendChild(el("b", null, o.status === "delivered" ? "Delivered in parts" : "Delivered so far"));
      pn.appendChild(el("div", null, o.partial_note));
      c.appendChild(pn);
    }

    const times = el("div", "times mono");
    times.appendChild(el("span", null, "Ordered " + (isToday(created) ? "" : dayLabel(created) + " ") + hhmm(created)));
    if (o.approved_at) times.appendChild(el("span", null, (o.status === "declined" ? "Declined " : "Accepted ") + hhmm(t(o.approved_at)) + (o.approved_by ? " by " + o.approved_by : "")));
    if (o.status === "delivered" && o.delivered_at) {
      times.appendChild(el("span", null, (o.partial_note ? "Finished " : "Delivered ") + hhmm(t(o.delivered_at)) + (o.delivered_by ? " by " + o.delivered_by : "")));
      times.appendChild(el("span", null, "Took " + dur(t(o.delivered_at) - created)));
    } else if (o.status === "cancelled" && o.cancelled_at) {
      times.appendChild(el("span", null, "Cancelled " + hhmm(t(o.cancelled_at)) + (o.cancelled_by ? " by " + o.cancelled_by : "")));
    } else if (o.status === "pending" || open) {
      times.appendChild(el("span", null, "Waiting " + dur(Date.now() - created)));
    }
    c.appendChild(times);

    const a = el("div", "actions");
    const now = () => new Date().toISOString();
    if (mode === "pending" && me.role === "manager") {
      [1, 2, 3].forEach((u) => { const b = el("button", "a-u" + u, "Accept · " + URG[u]); b.type = "button";
        b.addEventListener("click", () => act(o.id, { status: "approved", urgency: u, approved_at: now(), approved_by: me.name }, b)); a.appendChild(b); });
      const n = el("button", "a-no", "Decline"); n.type = "button";
      n.addEventListener("click", () => act(o.id, { status: "declined", approved_at: now(), approved_by: me.name }, n)); a.appendChild(n);
    }
    if (mode === "queue" && me.role === "manager") {
      [1, 2, 3].filter((u) => u !== o.urgency).forEach((u) => { const b = el("button", "a-no", "Change to " + URG[u]); b.type = "button";
        b.addEventListener("click", () => act(o.id, { urgency: u }, b)); a.appendChild(b); });
      if (o.status === "partial") {
        const b = el("button", "a-no", "Close – rest not needed"); b.type = "button";
        b.addEventListener("click", () => act(o.id, { status: "delivered", delivered_at: now(), delivered_by: me.name + " (closed)" }, b)); a.appendChild(b);
      }
    }
    if (mode === "queue" && me.role === "labourer" && !partialOpen[o.id]) {
      a.appendChild(twoTap(armed, o.id, o.status === "partial" ? "Rest delivered" : "Delivered all", "Tap again to confirm delivered", "a-done",
        (b) => act(o.id, { status: "delivered", delivered_at: now(), delivered_by: me.name }, b)));
      const pb = el("button", "a-part", "Part delivered"); pb.type = "button";
      pb.addEventListener("click", () => { partialOpen[o.id] = true; render(); setTimeout(() => { const ta = document.getElementById("pn-" + o.id); if (ta) ta.focus(); }, 30); });
      a.appendChild(pb);
    }
    // cancel: managers any open order, dryliners their own
    const canCancel = (o.status === "pending" || open) && (mode === "pending" || mode === "queue") &&
      (me.role === "manager" || (me.role === "dryliner" && isMine(o)));
    if (canCancel && !partialOpen[o.id]) {
      a.appendChild(twoTap(armedCancel, o.id, "Cancel order", "Tap again to cancel order", "a-cancel",
        (b) => act(o.id, { status: "cancelled", cancelled_at: now(), cancelled_by: me.name }, b)));
    }
    if (mode === "done" && o.status === "delivered" && (me.role === "manager" || me.role === "labourer")) {
      const b = el("button", "a-no", "Undo delivered"); b.type = "button";
      b.addEventListener("click", () => act(o.id, { status: o.partial_note ? "partial" : "approved", delivered_at: null, delivered_by: null }, b)); a.appendChild(b);
    }
    if (a.childNodes.length) c.appendChild(a);

    if (mode === "queue" && me.role === "labourer" && partialOpen[o.id]) {
      const f = el("div", "partform");
      const lb = el("label", null, "What did you bring?"); lb.htmlFor = "pn-" + o.id; f.appendChild(lb);
      const ta = el("textarea", "pnote"); ta.id = "pn-" + o.id; ta.value = drafts[o.id] || "";
      ta.placeholder = "e.g. 1 pallet 12.5mm Fireline. Other pallet not in stock";
      ta.addEventListener("input", () => { drafts[o.id] = ta.value; });
      ta.addEventListener("blur", () => { if (needRender) setTimeout(render, 150); });
      f.appendChild(ta);
      const row = el("div", "actions");
      const save = el("button", "a-done", "Save part delivery"); save.type = "button";
      save.addEventListener("click", () => {
        const txt = (drafts[o.id] || "").trim();
        if (!txt) { ta.focus(); ta.placeholder = "Write what you brought first"; return; }
        const line = hhmm(Date.now()) + " " + me.name + ": " + txt;
        delete partialOpen[o.id]; delete drafts[o.id];
        act(o.id, { status: "partial", partial_note: (o.partial_note ? o.partial_note + "\n" : "") + line, partial_at: now(), partial_by: me.name }, save);
      });
      const back = el("button", "a-no", "Back"); back.type = "button";
      back.addEventListener("click", () => { delete partialOpen[o.id]; render(); });
      row.appendChild(save); row.appendChild(back); f.appendChild(row);
      c.appendChild(f);
    }
    return c;
  }
  function fill(listId, items, mode, emptyText) {
    const L = $(listId); L.replaceChildren();
    if (!items.length) { L.appendChild(el("div", "empty", emptyText)); return; }
    items.forEach((o) => L.appendChild(card(o, mode)));
  }
  function drawStats(done) {
    const box = $("todayStats"); box.replaceChildren();
    const times = done.filter((o) => o.status === "delivered" && o.delivered_at).map((o) => t(o.delivered_at) - t(o.created_at));
    const avg = times.length ? times.reduce((x, y) => x + y, 0) / times.length : null;
    const slow = times.length ? Math.max.apply(null, times) : null;
    const byBlock = {}; done.forEach((o) => { byBlock[o.block] = (byBlock[o.block] || 0) + 1; });
    const topB = Object.keys(byBlock).sort((x, y) => byBlock[y] - byBlock[x])[0];
    [[String(done.length), "Deliveries"], [avg == null ? "–" : dur(avg), "Avg order to drop"],
     [slow == null ? "–" : dur(slow), "Slowest"], [topB ? "Block " + topB : "–", "Busiest block"]].forEach(([v, k]) => {
      const s = el("div", "stat"); s.appendChild(el("div", "v", v)); s.appendChild(el("div", "k", k)); box.appendChild(s);
    });
  }

  let needRender = false;
  function render() {
    if (!me) return;
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("pnote")) { needRender = true; return; }
    needRender = false;
    const pending = orders.filter((o) => o.status === "pending").sort((a, b) => t(a.created_at) - t(b.created_at));
    const queue = orders.filter((o) => o.status === "approved" || o.status === "partial").sort((a, b) => (a.urgency || 3) - (b.urgency || 3) || t(a.created_at) - t(b.created_at));
    const doneAt = (o) => o.status === "delivered" ? t(o.delivered_at) || t(o.created_at) : t(o.partial_at);
    const done = orders.filter((o) => (o.status === "delivered" || (o.status === "partial" && o.partial_at)) && isToday(doneAt(o))).sort((a, b) => doneAt(b) - doneAt(a));
    const old = orders.filter((o) => (o.status === "delivered" && !isToday(doneAt(o))) || o.status === "declined" || o.status === "cancelled")
      .sort((a, b) => t(b.created_at) - t(a.created_at)).slice(0, 60);

    const onBoard = tab === "board";
    $("orderForm").hidden = !onBoard || me.role === "labourer";
    $("secPending").hidden = !onBoard || me.role === "labourer";
    $("secQueue").hidden = !onBoard; $("secOld").hidden = !onBoard; $("secDone").hidden = onBoard;
    $("tabBoard").setAttribute("aria-selected", String(onBoard)); $("tabToday").setAttribute("aria-selected", String(!onBoard));
    $("cPending").textContent = pending.length; $("cQueue").textContent = queue.length;
    $("cDone").textContent = done.length; $("cDoneTab").textContent = done.length;
    $("todayDate").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

    const wait = ready ? null : "Loading orders…";
    fill("listPending", pending, "pending", wait || (me.role === "manager" ? "Nothing to approve. New orders land here first." : "No orders waiting. Post one above and a manager will accept it."));
    fill("listQueue", queue, "queue", wait || (me.role === "labourer" ? "Nothing to deliver right now. Accepted orders appear here, most urgent first." : "No accepted orders waiting for delivery."));
    fill("listDone", done, "done", wait || "Nothing delivered yet today.");
    fill("listOld", old, "old", "Nothing from earlier days.");
    drawStats(done);
    if (ready) { orders.forEach((o) => seen.add(o.id)); firstPaint = false; }
  }
  $("tabBoard").addEventListener("click", () => { tab = "board"; render(); });
  $("tabToday").addEventListener("click", () => { tab = "today"; render(); });

  // ---------- data ----------
  async function load() {
    if (busy) return; busy = true;
    const { data, error } = await sb.from("orders").select("*").order("created_at", { ascending: false }).limit(500);
    busy = false;
    if (error) { banner("Couldn't load orders. Check your signal."); return; }
    orders = data; ready = true; render();
  }
  let channel = null;
  function listen() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("orders-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
        if (p.eventType === "DELETE") orders = orders.filter((o) => o.id !== p.old.id);
        else { const i = orders.findIndex((o) => o.id === p.new.id); if (i >= 0) orders[i] = p.new; else orders.unshift(p.new); }
        render();
      })
      .subscribe();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && me) { load(); listen(); drawNotice(); } });
  setInterval(() => { if (me && !document.hidden) render(); }, 60000);

  function start() {
    $("join").hidden = true; $("main").hidden = false; $("meBox").hidden = false;
    $("meText").textContent = me.name + " · " + ROLE_LABEL[me.role];
    drawNotice(); render(); load(); listen();
  }
  // ---------- install screen (role link opened in the browser) ----------
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; if (!$("install").hidden) $("instBtn").hidden = false; });
  function showInstall() {
    $("install").hidden = false;
    const steps = isIOS
      ? ["Tap the <b>Share</b> button at the bottom of Safari (the square with an arrow).",
         "Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.",
         "Close Safari. Open <b>Site Board</b> from the new icon on your Home Screen."]
      : ["Tap the <b>⋮</b> menu at the top right of Chrome.",
         "Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.",
         "Open <b>Site Board</b> from the new icon on your phone."];
    const ua = navigator.userAgent;
    const otherBrowser = isIOS && /crios|fxios|edgios|gsa\//i.test(ua);
    $("instIntro").textContent = otherBrowser ? "Open this link in Safari first, then follow these steps."
      : "You only do this once.";
    if (isIOS) steps.unshift("Opened this from WhatsApp? Tap the <b>Safari</b> compass icon (or <b>⋯ → Open in Safari</b>) first.");
    const ol = $("instSteps"); ol.replaceChildren();
    steps.forEach((h) => { const li = document.createElement("li"); li.innerHTML = h; ol.appendChild(li); });
    $("instBtn").hidden = !deferredPrompt;
  }
  $("instBtn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch (e) {}
    deferredPrompt = null; $("instBtn").hidden = true;
    $("instIntro").textContent = "Done. Now open Site Board from the new icon on your phone.";
  });
  $("instSkip").addEventListener("click", () => { $("install").hidden = true; $("join").hidden = false; drawJoinRoles(); });

  if (me) start();
  else if (link && !standalone) showInstall();
  else { $("join").hidden = false; drawJoinRoles(); }
})();
