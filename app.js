(() => {
"use strict";

const STORAGE_KEY = "little_wins_v1";

// Single source of truth for release notes: the update popup and the version
// history in the footer both read from this list. Newest version first.
const VERSIONS = [
  {
    version: "beta-3",
    label: "Beta 3",
    date: "20. nov. 2026",
    lead: "Små justeringer til hverdagen:",
    changes: [
      "Gennemførte opgaver bliver liggende på deres plads, indtil du logger dem",
      "Stryg kræver nu en klar vandret bevægelse — skrå scroll sletter ikke ved et uheld",
      "Toggles er gule ligesom resten af designet",
      "Gentagelses-label viser igen tal — hold musen hen over det for fuld tekst",
      "Historikken viser kun uger, der er påbegyndt",
      "»Installér« nederst på siden åbner nu en installationsdialog, der passer til din browser",
      "Underopgaver: klik på en opgave for at folde den ud — point deles i lige andele"
    ]
  },
  {
    version: "beta-2",
    label: "Beta 2",
    date: "19. nov. 2026",
    lead: "Little Wins er blevet opdateret — her er hvad der er nyt:",
    changes: [
      "Historikken viser nu tre måneder ad gangen",
      "Stryg til venstre for at slette, til højre for at redigere",
      "Point sættes én gang ved oprettelse — opgaven giver altid det beløb",
      "Mønt-lyd med fem variationer — flere point giver flere lag"
    ]
  },
  {
    version: "beta-1",
    label: "Beta 1",
    date: "11. nov. 2026",
    lead: "Den første version af Little Wins:",
    changes: [
      "Opgaver med point, gentagelse og daglig historik",
      "Indstillinger, lyd, tema og JSON-backup"
    ]
  }
];
const CURRENT_VERSION = VERSIONS[0];
const APP_VERSION = CURRENT_VERSION.version;
const VERSION_LABEL = CURRENT_VERSION.label;
const WINDOW_MONTHS = 3;
const DAY_NAMES = ["Man","Tir","Ons","Tor","Fre","Lør","Søn"];
const $ = id => document.getElementById(id);

// True when no saved data existed before this load (used by the update notice).
let isFreshInstall = false;

const format = n => Math.round(n).toLocaleString("da-DK");

function localDate(date = new Date()) {
  return date.getFullYear() + "-" +
    String(date.getMonth()+1).padStart(2,"0") + "-" +
    String(date.getDate()).padStart(2,"0");
}
function dateFromKey(key) {
  const [y,m,d] = key.split("-").map(Number);
  return new Date(y,m-1,d,12);
}
function addDays(date,n) {
  const d = new Date(date);
  d.setDate(d.getDate()+n);
  return d;
}
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate()+4-day);
  const year = d.getUTCFullYear();
  const start = new Date(Date.UTC(year,0,1));
  const week = Math.ceil((((d-start)/86400000)+1)/7);
  return {year,week};
}
function weekKey(date) {
  const w = isoWeek(date);
  return `${w.year}-W${String(w.week).padStart(2,"0")}`;
}
function mondayOfWeek(date) {
  const d = new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);
  const day = (d.getDay()+6)%7;
  d.setDate(d.getDate()-day);
  return d;
}
function clamp(value,min,max) {
  return Math.max(min,Math.min(max,value));
}
function makeId() {
  return (crypto.randomUUID && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2));
}

const MAX_REPEAT_DAYS = 30;

// Saved-data schema. Bump DATA_VERSION whenever the shape of `state` changes
// and add a step to MIGRATIONS for the previous version. Keep old steps for at
// least three app versions: beta testers upgrade in place and must never lose
// a single task or history record.
const DATA_VERSION = 3;
const MIGRATIONS = {
  0: raw => {
    const tasks = (raw.tasks || []).map(t => {
      const value = t.repeatDays;
      const repeatDays = (typeof value === "number" && Number.isFinite(value))
        ? value : (t.recurring ? 1 : 0);
      const copy = { ...t, repeatDays: clamp(Math.round(repeatDays), 0, MAX_REPEAT_DAYS) };
      delete copy.recurring;
      return copy;
    });
    return {
      ...raw,
      tasks,
      sound: raw.sound === undefined ? true : raw.sound,
      theme: raw.theme || "light"
    };
  },
  // One point value per task, set at creation. `max` becomes `points`; open
  // records adopts the new value while completed history keeps what was earned.
  1: raw => {
    const tasks = raw.tasks.map(t => {
      const source = Number.isFinite(t.points) ? t.points : t.max;
      const copy = { ...t, points: Math.max(1000, Math.round(source || 1000)) };
      delete copy.max;
      return copy;
    });
    const pointsById = Object.fromEntries(tasks.map(t => [t.id, t.points]));
    const days = {};
    Object.entries(raw.days).forEach(([key, day]) => {
      const next = {};
      Object.entries(day).forEach(([id, record]) => {
        const points = pointsById[id];
        next[id] = points !== undefined && !record.done
          ? { ...record, value: points }
          : { ...record };
      });
      days[key] = next;
    });
    const { simpleMode, ...rest } = raw;
    return { ...rest, tasks, days };
  },
  // Subtasks live on the task; daily checkmarks live in each day record under
  // `subs`. Old tasks get an empty list, and no history record is touched.
  2: raw => ({
    ...raw,
    tasks: raw.tasks.map(t =>
      Array.isArray(t.subtasks) ? t : { ...t, subtasks: [] }
    )
  })
};

// Upgrade any saved state to the current schema. Nothing is ever discarded:
// if a step would leave us without tasks or days, the original data is kept.
function syncState(raw) {
  if (!raw || !Array.isArray(raw.tasks) || !raw.days || typeof raw.days !== "object") return null;
  let data = { ...raw };
  let version = Number.isFinite(raw.dataVersion) ? raw.dataVersion : 0;
  for (let i = 0; version < DATA_VERSION && i < 20; i++, version++) {
    const step = MIGRATIONS[version];
    if (!step) break; // unknown old shape – keep data as-is rather than lose it
    data = step(data);
  }
  if (!Array.isArray(data.tasks) || !data.days || typeof data.days !== "object") return null;
  data.dataVersion = DATA_VERSION;
  return data;
}

function load() {
  try {
    const synced = syncState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    if (synced) return synced;
  } catch(e) {}
  isFreshInstall = true;
  return {
    tasks:[], days:{}, sound:true, lastDate:null,
    theme:"light", dataVersion:DATA_VERSION, appVersion:APP_VERSION
  };
}

let state = load();
if(!state.theme) state.theme="light";
// Set briefly after a completion so the card can pop once when it is re-rendered.
let justCompletedId = null;
// View-only: whether logged tasks from today are shown at the bottom of the list.
let showLogged = false;
// View-only: which task cards are folded out to show their subtasks.
const expandedTasks = new Set();
// A swipe must not also count as a tap that folds the card out.
let swipeJustHappened = false;
let currentDate = localDate();
// History shows a three-month window; 0 = the most recent one.
let historyOffset = 0;
let soundContext = null;
// Touch vs. desktop: (hover: none) matches tablets/phones. Stable across renders
// so swipe-to-delete is attached on first load, not only after a touch event.
let isInTouchMode = !!(window.matchMedia && window.matchMedia("(hover: none)").matches);

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme() {
  const theme = state.theme || "light";
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#121212" : "#f7f6f2");
}

// React to system preference changes when in system mode
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((state.theme || "light") === "system") applyTheme();
  });
}

function save() {
  state.lastDate = localDate();
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
}

function dateKeyAfter(key, days) {
  return localDate(addDays(dateFromKey(key), days));
}

// Most recent completion on or before a day (ISO keys sort chronologically).
function lastCompletionOnOrBefore(task, dateKey) {
  let last = null;
  for (const key of Object.keys(state.days)) {
    if (key > dateKey) continue;
    const record = state.days[key] && state.days[key][task.id];
    if (record && record.done && (!last || key > last)) last = key;
  }
  return last;
}

// A task completed today stays on the list until the user logs it. Once logged
// (or on a later day), repeatDays decides when it comes back: 0 = never.
function taskActiveOn(task, dateKey) {
  const last = lastCompletionOnOrBefore(task, dateKey);
  if (!last) return true;
  if (last === dateKey) {
    const record = state.days[dateKey] && state.days[dateKey][task.id];
    return !(record && record.archived);
  }
  const interval = task.repeatDays || 0;
  if (interval === 0) return false;
  return dateKey >= dateKeyAfter(last, interval);
}

function isDoneToday(task) {
  const record = state.days[currentDate] && state.days[currentDate][task.id];
  return !!(record && record.done);
}

function isLoggedToday(task) {
  const record = state.days[currentDate] && state.days[currentDate][task.id];
  return !!(record && record.done && record.archived);
}

// A task's total is fixed when it is created. Subtasks split it into equal
// shares; the parent is always a share too and takes the rounding remainder.
function freshValue(task) {
  return task.points;
}
function subtaskList(task) {
  return Array.isArray(task.subtasks) ? task.subtasks : [];
}
function subtaskShare(task) {
  return Math.floor(task.points / (subtaskList(task).length + 1));
}
function allSubtasksDone(task, record) {
  const subs = subtaskList(task);
  return subs.length > 0 && subs.every(s => record.subs && record.subs[s.id]);
}
function recordPoints(task, record) {
  const subs = subtaskList(task);
  if (!subs.length) return record.done ? record.value : 0;
  const share = subtaskShare(task);
  let total = subs.reduce((sum, s) =>
    sum + (record.subs && record.subs[s.id] ? share : 0), 0);
  if (record.done) total += task.points - share * subs.length;
  return total;
}

function ensureToday() {
  const today = localDate();
  if (today !== currentDate) currentDate = today;

  if (!state.days[today]) state.days[today] = {};

  state.tasks.forEach(task => {
    if (!taskActiveOn(task, today)) return;
    if (!state.days[today][task.id]) {
      state.days[today][task.id] = {
        value: freshValue(task),
        done:false
      };
    }
  });
  save();
}

function entry(task,date=currentDate) {
  if (!state.days[date]) state.days[date] = {};
  if (!state.days[date][task.id]) {
    state.days[date][task.id] = {
      value: freshValue(task),
      done:false
    };
  }
  return state.days[date][task.id];
}

function dayTotal(date=currentDate) {
  const records = state.days[date] || {};
  const byId = new Map(state.tasks.map(t => [t.id, t]));
  return Object.entries(records).reduce((sum,[id,r]) => {
    const task = byId.get(id);
    return sum + (task ? recordPoints(task, r) : (r.done ? r.value : 0));
  }, 0);
}

function allTimeTotal() {
  return Object.values(state.days).reduce((sum,day) =>
    sum + Object.values(day).reduce((s,r)=>s+(r.done?r.value:0),0),0);
}

/* Audio: the coin clip is fetched and decoded once at startup, so the first
   completion never waits on the network. The five variants are made from
   pitch and layered repeats of this one sample. */
const SOUND_FILES = {
  coin: "sfx/super-mario-world-coin.mp3"
};
const soundBank = {}; // name -> decoded AudioBuffer

function getAudioContext() {
  if (!soundContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    soundContext = new Ctor();
  }
  if (soundContext.state === "suspended") soundContext.resume();
  return soundContext;
}

function preloadSounds() {
  const ctx = getAudioContext();
  if (!ctx) return;
  Object.entries(SOUND_FILES).forEach(([name, url]) => {
    fetch(url)
      .then(res => res.arrayBuffer())
      .then(data => ctx.decodeAudioData(data))
      .then(buffer => { soundBank[name] = buffer; })
      .catch(() => {});
  });
}

function playSample(name, { rate = 1, delay = 0, volume = 1 } = {}) {
  if (!state.sound) return;
  const ctx = getAudioContext();
  const buffer = soundBank[name];
  if (!ctx || !buffer) return;
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(ctx.currentTime + delay);
  } catch(e) {}
}

// Five intensity levels derived from the same coin count that drives the
// particle burst: bigger awards get a higher pitch and more staggered layers.
function playCoinSound(points) {
  const coins = coinCount(points);
  if (coins <= 13) {
    playSample("coin", { rate: .92, volume: .9 });
  } else if (coins <= 18) {
    playSample("coin");
  } else if (coins <= 24) {
    playSample("coin", { rate: 1.12, volume: .95 });
  } else if (coins <= 30) {
    playSample("coin", { rate: 1.06 });
    playSample("coin", { rate: 1.2, delay: .16, volume: .8 });
  } else {
    playSample("coin", { rate: 1.04 });
    playSample("coin", { rate: 1.2, delay: .14, volume: .85 });
    playSample("coin", { rate: 1.36, delay: .3, volume: .7 });
  }
}

// More points means more coins – capped so large awards stay tasteful.
function coinCount(points) {
  const magnitude=Math.max(0,Math.log10(Math.max(1000,points)/1000));
  return Math.round(clamp(10+magnitude*8,10,36));
}

function animateCoins(card, points) {
  const anchor=$("coin-anchor");
  const from=card.getBoundingClientRect();
  const to=anchor.getBoundingClientRect();
  const endX=to.left+to.width/2;
  const endY=to.top+to.height/2;

  // Sound starts with the burst; clips are ~0.7-0.9s, matching the flight.
  playCoinSound(points);

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    anchor.classList.add("coin-bounce");
    setTimeout(()=>anchor.classList.remove("coin-bounce"),450);
    return;
  }

  // Scatter launch points across the whole task card, not a single button.
  const count=coinCount(points);
  for(let i=0;i<count;i++) {
    const coin=document.createElement("div");
    coin.className="coin-particle";
    const size=16+Math.random()*10;
    coin.style.width=size+"px";
    coin.style.height=size+"px";
    coin.innerHTML='<img src="happy-coin.png" alt="">';
    const startX=from.left+from.width*(.06+Math.random()*.88);
    const startY=from.top+from.height*(.12+Math.random()*.76);
    coin.style.left=(startX-size/2)+"px";
    coin.style.top=(startY-size/2)+"px";
    const dx=endX-startX+(Math.random()-.5)*70;
    const dy=endY-startY+(Math.random()-.5)*60;
    coin.style.setProperty("--dx",dx+"px");
    coin.style.setProperty("--dy",dy+"px");
    coin.style.animation=`coin-arrive ${.6+Math.random()*.45}s cubic-bezier(.2,.8,.3,1) ${Math.random()*.35}s forwards`;
    document.body.appendChild(coin);
    setTimeout(()=>coin.remove(),1600);
  }

  setTimeout(()=>{
    anchor.classList.add("coin-bounce");
    setTimeout(()=>anchor.classList.remove("coin-bounce"),450);
  },900);
}

let totalFrame=null;

// Count the header total up (or down) smoothly instead of jumping to the value.
function animateTotal(from,to) {
  const el=$("total-points");
  if(totalFrame!==null) { cancelAnimationFrame(totalFrame); totalFrame=null; }
  if(matchMedia("(prefers-reduced-motion: reduce)").matches || from===to) {
    el.textContent=format(to);
    return;
  }
  const duration=700;
  const start=performance.now();
  const step=now=>{
    const t=clamp((now-start)/duration,0,1);
    const eased=1-Math.pow(1-t,3);
    el.textContent=format(Math.round(from+(to-from)*eased));
    if(t<1) totalFrame=requestAnimationFrame(step);
    else { totalFrame=null; el.textContent=format(to); }
  };
  totalFrame=requestAnimationFrame(step);
}

function renderHeader(animateFrom=null) {
  $("today-label").textContent=new Intl.DateTimeFormat("da-DK",{
    weekday:"long",day:"numeric",month:"short"
  }).format(new Date());
  const total=dayTotal();
  if(animateFrom!==null && animateFrom!==total) animateTotal(animateFrom,total);
  else {
    if(totalFrame!==null) { cancelAnimationFrame(totalFrame); totalFrame=null; }
    $("total-points").textContent=format(total);
  }
  // footer date removed per request
}

/* Today's task list */
// Natural Danish ordinals for the hover text. Past 10 the numeric form
// ("hver 11. dag") is the idiomatic spelling, so it is used as the fallback.
const REPEAT_ORDINAL = [
  "", "første", "anden", "tredje", "fjerde", "femte",
  "sjette", "syvende", "ottende", "niende", "tiende"
];

// One source of truth for the full wording — hover text, accessible name and
// the form's value display all read the same natural phrase.
function repeatTitle(days) {
  if (!days) return "Gentager ikke";
  if (days === 1) return "Gentager hver dag";
  const ordinal = REPEAT_ORDINAL[days];
  return ordinal
    ? "Gentager hver " + ordinal + " dag"
    : "Gentager hver " + days + ". dag";
}

// The card badge stays compact; the full wording lives in title/aria-label.
function repeatBadge(days) {
  return days === 1 ? "↻" : "↻ " + days;
}

function buildCardHead(task, right) {
  const head = document.createElement("div");
  head.className = "card-head";

  const left = document.createElement("div");
  left.className = "task-title-wrap";
  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = task.title;
  left.append(title);

  const subs = subtaskList(task);
  if (subs.length) {
    const count = document.createElement("span");
    count.className = "subtask-count";
    count.textContent = "☰ " + subs.length;
    count.title = subs.length + " underopgaver";
    const chevron = document.createElement("span");
    chevron.className = "subtask-chevron" + (expandedTasks.has(task.id) ? " open" : "");
    chevron.textContent = "›";
    left.classList.add("expandable");
    left.append(count, chevron);
    left.addEventListener("click", () => {
      if (swipeJustHappened) return;
      if (expandedTasks.has(task.id)) expandedTasks.delete(task.id);
      else expandedTasks.add(task.id);
      renderTasks();
    });
  }

  const days = task.repeatDays || 0;
  if (days) {
    const badge = document.createElement("span");
    badge.className = "recurring-badge";
    badge.textContent = repeatBadge(days);
    badge.title = repeatTitle(days);
    badge.setAttribute("aria-label", repeatTitle(days));
    left.append(badge);
  }

  head.append(left, right);
  return head;
}

function buildCardActions(task) {
  const actions = document.createElement("div");
  actions.className = "task-actions";
  // On touch devices these are replaced by swipe-right (edit) / swipe-left (delete).
  if (isInTouchMode) return actions;

  const edit = document.createElement("button");
  edit.className = "edit-button";
  edit.type = "button";
  edit.textContent = "Rediger";
  edit.addEventListener("click", () => openModal("edit", task));

  const del = document.createElement("button");
  del.className = "delete-button";
  del.type = "button";
  del.textContent = "Slet opgave";
  del.style.display = isInTouchMode ? "none" : "block";
  del.addEventListener("click", () => {
    if (!confirm('Slet "' + task.title + '"? Opgaven kommer ikke med på fremtidige dage.')) return;
    state.tasks = state.tasks.filter(t => t.id !== task.id);
    // Historical daily records are deliberately preserved.
    save();
    renderTasks();
  });

  actions.append(edit, del);
  return actions;
}

function toggleDone(task, record, card) {
  const before=dayTotal();
  if (record.done) {
    record.done = false;
    record.archived = false;
  } else {
    // The parent is the last share and cannot be taken before its subtasks.
    const subs = subtaskList(task);
    if (subs.length && !allSubtasksDone(task, record)) return;
    record.done = true;
    record.archived = false;
    record.value = task.points;
    justCompletedId = task.id;
    animateCoins(card, task.points - subtaskShare(task) * subs.length);
  }
  save();
  renderTasks(before);
}

function toggleSubtask(task, record, subId, card) {
  const before=dayTotal();
  if (!record.subs) record.subs = {};
  if (record.subs[subId]) {
    delete record.subs[subId];
    // An open subtask means the parent cannot be completed any more.
    if (record.done) {
      record.done = false;
      record.archived = false;
    }
  } else {
    record.subs[subId] = true;
    animateCoins(card, subtaskShare(task));
  }
  save();
  renderTasks(before);
}

function buildCardRight(task, record, card) {
  const right = document.createElement("div");
  right.className = "task-right";
  const value = document.createElement("span");
  value.className = "task-value num";
  value.textContent = format(recordPoints(task, record));
  const done = document.createElement("button");
  done.className = "done-button";
  done.type = "button";
  const pending = subtaskList(task).length > 0 && !record.done && !allSubtasksDone(task, record);
  done.disabled = pending;
  const label = pending ? "Kryds alle underopgaver af først"
    : (record.done ? "Fortryd gennemførelse" : "Markér som gennemført");
  done.title = label;
  done.setAttribute("aria-label", label);
  done.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="3.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.5 5 5L19.5 6"/></svg>';
  done.addEventListener("click", () => toggleDone(task, record, card));
  right.append(value, done);
  return right;
}

function buildTaskCard(task) {
  const record = entry(task);
  const card = document.createElement("article");
  card.className = "task" + (record.done ? " completed" : "") +
    (task.id === justCompletedId ? " just-completed" : "");

  // Revealed by horizontal swipes on touch devices: pencil on the left, bin on the right.
  const swipeBg = document.createElement("div");
  swipeBg.className = "swipe-bg";
  const editAction = document.createElement("div");
  editAction.className = "swipe-action edit";
  editAction.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m15 5 4 4M4 20l4.5-1 10-10a2.8 2.8 0 0 0-4-4l-10 10L4 20Z"/></svg>';
  const deleteAction = document.createElement("div");
  deleteAction.className = "swipe-action delete";
  deleteAction.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg>';
  swipeBg.append(editAction, deleteAction);

  const content = document.createElement("div");
  content.className = "task-content";
  content.append(buildCardHead(task, buildCardRight(task, record, card)));
  content.append(buildCardActions(task));
  if (subtaskList(task).length && expandedTasks.has(task.id)) {
    const list = document.createElement("div");
    list.className = "subtask-list";
    subtaskList(task).forEach(sub => {
      const checked = !!(record.subs && record.subs[sub.id]);
      const row = document.createElement("div");
      row.className = "subtask-row" + (checked ? " checked" : "");
      const check = document.createElement("button");
      check.type = "button";
      check.className = "subtask-check";
      check.title = checked ? "Fortryd afkrydsning" : "Kryds underopgave af";
      check.setAttribute("aria-label", check.title + ": " + sub.title);
      check.textContent = checked ? "✓" : "";
      check.addEventListener("click", e => {
        e.stopPropagation();
        toggleSubtask(task, record, sub.id, card);
      });
      const label = document.createElement("span");
      label.className = "subtask-title";
      label.textContent = sub.title;
      const share = document.createElement("span");
      share.className = "subtask-share num";
      share.textContent = "+" + format(subtaskShare(task));
      row.append(check, label, share);
      list.append(row);
    });
    content.append(list);
  }
  card.append(swipeBg, content);

  if (isInTouchMode) attachSwipe(content, editAction, deleteAction, task);
  return card;
}

function renderTasks(animateFrom=null) {
  ensureToday();
  renderHeader(animateFrom);

  const list = $("task-list");
  list.replaceChildren();

  const visible = state.tasks.filter(task => taskActiveOn(task, currentDate));
  const pendingCount = visible.filter(isDoneToday).length;
  const loggedCount = state.tasks.filter(isLoggedToday).length;
  const logged = showLogged ? state.tasks.filter(isLoggedToday) : [];

  const logButton = $("log-completed");
  logButton.hidden = pendingCount === 0;
  logButton.textContent = pendingCount > 1
    ? "Log " + pendingCount + " gennemførte"
    : "Log gennemført";

  const loggedButton = $("show-logged");
  loggedButton.hidden = loggedCount === 0;
  loggedButton.textContent = showLogged
    ? "Skjul loggede opgaver"
    : "Vis loggede opgaver (" + loggedCount + ")";

  if (!visible.length && !logged.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const title = document.createElement("strong");
    const text = document.createElement("p");
    if (!state.tasks.length) {
      title.textContent = "Ingen opgaver endnu";
      text.textContent = "Tryk på + knappen øverst for at oprette din første opgave.";
    } else {
      title.textContent = "Alt er gennemført";
      text.textContent = "Alle dine opgaver er gennemført. Godt gået!";
    }
    empty.append(title, text);
    list.append(empty);
    return;
  }

  // Completed cards keep their original place until logging archives them.
  visible.forEach(task => list.append(buildTaskCard(task)));

  if (logged.length) {
    const heading = document.createElement("div");
    heading.className = "completed-heading";
    heading.textContent = "Loggedet i dag";
    list.append(heading);
    logged.forEach(task => list.append(buildTaskCard(task)));
  }

  if (justCompletedId !== null) {
    const id = justCompletedId;
    setTimeout(() => { if (justCompletedId === id) justCompletedId = null; }, 1200);
  }
}

// A diagonal scroll must never delete or edit a task. A drag only counts as a
// swipe when it is clearly horizontal before the finger is lifted.
const SWIPE_SLOP = 8;      // Dead zone before an axis is chosen.
const SWIPE_COMMIT = 24;   // Distance that locks the gesture as horizontal.
const SWIPE_TRIGGER = 70;  // Distance needed to actually fire an action.
const SWIPE_RATIO = 2;     // Horizontal movement must be at least twice the vertical.

/* Touch gestures: swipe left reveals the bin, swipe right reveals the pencil. */
function attachSwipe(content, editAction, deleteAction, task) {
  let startX = null, startY = null, lastX = 0, lastY = 0;
  let axis = null, committed = false;

  content.addEventListener("touchstart", e => {
    startX = lastX = e.touches[0].clientX;
    startY = lastY = e.touches[0].clientY;
    axis = null; committed = false;
    content.style.transition = "none";
  }, { passive: true });

  content.addEventListener("touchmove", e => {
    if (startX === null) return;
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    const dx = x - startX, dy = y - startY;
    lastX = x; lastY = y;

    if (!committed) {
      if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
      if (Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO) {
        axis = "x";
        if (Math.abs(dx) >= SWIPE_COMMIT) committed = true;
      } else {
        axis = "y";
        // Treated as a scroll — never leave a half-open card behind.
        content.style.transform = "translateX(0)";
        editAction.style.opacity = "0";
        deleteAction.style.opacity = "0";
        return;
      }
    }

    if (axis !== "x") return;
    const offset = clamp(dx, -110, 110);
    content.style.transform = `translateX(${offset}px)`;
    const progress = String(Math.min(1, Math.abs(offset) / 60));
    deleteAction.style.opacity = offset < 0 ? progress : "0";
    editAction.style.opacity = offset > 0 ? progress : "0";
  }, { passive: true });

  function finish(e) {
    if (startX === null) return;
    const touch = e.changedTouches && e.changedTouches[0];
    const dx = (touch ? touch.clientX : lastX) - startX;
    const dy = (touch ? touch.clientY : lastY) - startY;
    const valid = committed && Math.abs(dx) >= SWIPE_TRIGGER &&
      Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO;
    startX = null; startY = null; axis = null; committed = false;
    content.style.transition = "transform .2s ease";

    if (valid) {
      swipeJustHappened = true;
      setTimeout(() => { swipeJustHappened = false; }, 350);
    }
    if (valid && dx < 0) {
      content.style.transform = "translateX(-110%)";
      deleteAction.style.opacity = "1";
      setTimeout(() => {
        state.tasks = state.tasks.filter(t => t.id !== task.id);
        save();
        renderTasks();
      }, 200);
    } else if (valid && dx > 0) {
      content.style.transform = "translateX(0)";
      editAction.style.opacity = "0";
      setTimeout(() => openModal("edit", task), 120);
    } else {
      content.style.transform = "translateX(0)";
      editAction.style.opacity = "0";
      deleteAction.style.opacity = "0";
    }
  }

  content.addEventListener("touchend", finish);
  content.addEventListener("touchcancel", finish);
}

/* Weekly history */
function weekScores(date) {
  const monday=mondayOfWeek(date);
  const scores=[];
  for(let i=0;i<7;i++) {
    const key=localDate(addDays(monday,i));
    scores.push({
      date:key,
      label:DAY_NAMES[i],
      score:dayTotal(key)
    });
  }
  return scores;
}

function makeSparkline(scores, width) {
  const height=82,pad=9;
  const max=Math.max(1,...scores.map(s=>s.score));
  const points=scores.map((s,i)=>({
    x:pad+i*((width-pad*2)/6),
    y:height-pad-(s.score/max)*(height-pad*2)
  }));

  let path="";
  points.forEach((p,i)=>{
    if(i===0) path+=`M ${p.x} ${p.y} `;
    else {
      const prev=points[i-1];
      const mid=(prev.x+p.x)/2;
      path+=`C ${mid} ${prev.y}, ${mid} ${p.y}, ${p.x} ${p.y} `;
    }
  });

  const dots=points.map(p=>
    `<circle class="chart-dot" cx="${p.x}" cy="${p.y}" r="4"/>`
  ).join("");

  // The viewBox matches the rendered pixel size, so dots stay perfectly round
  // even on narrow screens.
  return `<svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daglige point: ${scores.map(s=>s.label+" "+format(s.score)).join(", ")}">
    <path class="chart-line" d="${path}"/>${dots}
  </svg>`;
}

// The first week is the week the user started – never show weeks before that.
function firstWeekKey() {
  const keys=Object.keys(state.days).sort();
  return keys.length ? weekKey(dateFromKey(keys[0])) : weekKey(new Date());
}

function firstDataDate() {
  const keys=Object.keys(state.days).sort();
  return keys.length ? dateFromKey(keys[0]) : new Date();
}

function monthIndex(date) {
  return date.getFullYear()*12+date.getMonth();
}
function monthStart(date) {
  return new Date(date.getFullYear(),date.getMonth(),1,12);
}
function addMonths(date,count) {
  return new Date(date.getFullYear(),date.getMonth()+count,1,12);
}
function endOfMonth(date) {
  return new Date(date.getFullYear(),date.getMonth()+1,0,12);
}

// Offset 0 covers this month and the two before it. Each step moves the whole
// three-month window back; the oldest data decides how far back you can go.
function periodRange(offset=historyOffset) {
  const end=addMonths(monthStart(new Date()),-offset*WINDOW_MONTHS);
  // The current window stops today: weeks that have not begun yet are not
  // history, and the started week is the one shown as selected.
  const lastDay=offset===0 ? new Date() : endOfMonth(end);
  return { start:addMonths(end,-(WINDOW_MONTHS-1)), end, lastDay };
}

function maxHistoryOffset() {
  const nowIdx=monthIndex(new Date());
  const firstIdx=monthIndex(firstDataDate());
  return Math.max(0,Math.ceil((nowIdx-(WINDOW_MONTHS-1)-firstIdx)/WINDOW_MONTHS));
}

function periodLabel(start,end) {
  const fmt=new Intl.DateTimeFormat("da-DK",{month:"short"});
  const first=fmt.format(start).replace(".","");
  const last=fmt.format(end).replace(".","");
  return start.getFullYear()===end.getFullYear()
    ? first+" – "+last+" "+end.getFullYear()
    : first+" "+start.getFullYear()+" – "+last+" "+end.getFullYear();
}

function renderHistory() {
  const list=$("week-list");
  list.replaceChildren();

  const max=maxHistoryOffset();
  historyOffset=clamp(historyOffset,0,max);
  const {start,end,lastDay}=periodRange();
  $("history-range").textContent=periodLabel(start,end);
  $("history-prev").disabled=historyOffset>=max;
  $("history-next").disabled=historyOffset<=0;

  const startWeek=firstWeekKey();
  // Match the SVG pixel size to its viewBox so dots stay round on any width.
  const chartWidth=Math.max(200,(list.clientWidth||320)-36);

  const endMonday=mondayOfWeek(lastDay);
  const startMonday=mondayOfWeek(start);
  let index=0;
  for(let date=endMonday;date>=startMonday;date=addDays(date,-7)) {
    if(weekKey(date)<startWeek) continue;
    const scores=weekScores(date);
    const total=scores.reduce((sum,s)=>sum+s.score,0);

    const card=document.createElement("article");
    card.className="week-card"+(index===0?" selected":"");
    index++;

    const head=document.createElement("div");
    head.className="week-head";
    const id=document.createElement("div");
    id.className="week-id";
    id.textContent="W"+String(isoWeek(date).week).padStart(2,"0");
    const sum=document.createElement("div");
    sum.className="week-total num";
    sum.textContent=format(total);
    head.append(id,sum);

    card.append(head);
    card.insertAdjacentHTML("beforeend",makeSparkline(scores,chartWidth));

    const labels=document.createElement("div");
    labels.className="chart-labels";
    DAY_NAMES.forEach((name,i)=>{
      const span=document.createElement("span");
      span.textContent=name;
      span.title=format(scores[i].score)+" point";
      labels.append(span);
    });
    card.append(labels);

    if(total===0) {
      const note=document.createElement("div");
      note.className="week-empty";
      note.textContent="Ingen optjente point denne uge";
      card.append(note);
    }
    list.append(card);
  }
}

function changePeriod(amount) {
  const next=clamp(historyOffset+amount,0,maxHistoryOffset());
  if(next===historyOffset) return;
  historyOffset=next;
  renderHistory();
}

// Re-measure the charts when the window changes size.
let historyResizeTimer=null;
window.addEventListener("resize",()=>{
  if($("history-view").hidden) return;
  clearTimeout(historyResizeTimer);
  historyResizeTimer=setTimeout(renderHistory,120);
});

/* Navigation */
function showView(view) {
  $("today-view").hidden=view!=="today";
  $("history-view").hidden=view!=="history";
  document.querySelectorAll(".tab").forEach(tab=>{
    tab.classList.toggle("active",tab.dataset.view===view);
  });
  $("add-button").hidden=view!=="today";
  if(view==="history") {
    historyOffset=0;
    renderHistory();
  }
}

document.querySelectorAll(".tab").forEach(tab=>{
  tab.addEventListener("click",()=>showView(tab.dataset.view));
});
$("history-prev").addEventListener("click",()=>changePeriod(1));
$("history-next").addEventListener("click",()=>changePeriod(-1));
// Logging is an explicit action: completed cards stay in place until this is tapped.
$("log-completed").addEventListener("click",()=>{
  const day=state.days[currentDate] || {};
  state.tasks.forEach(task=>{
    const record=day[task.id];
    if(record && record.done) record.archived=true;
  });
  save();
  renderTasks();
});

// Logged tasks stay out of the way until the user asks to see them again.
$("show-logged").addEventListener("click",()=>{
  showLogged=!showLogged;
  renderTasks();
});

$("update-ok").addEventListener("click",()=>{
  $("update-overlay").classList.add("hidden");
});
$("changelog-button").addEventListener("click",()=>openModal("changelog"));

/* Modal system (reused for create, edit and settings) */
let currentModal = null;
let editingTask = null;
let createPoints = 1000;
let createRepeatDays = 0;
let createSubtasks = [];
let submitting = false;

const MODAL_TITLES = {
  create: "Opret ny opgave",
  edit: "Rediger opgave",
  settings: "Indstillinger",
  changelog: "Versionshistorik"
};

function openModal(type, task = null) {
  currentModal = type;
  editingTask = (type === "edit") ? task : null;
  createSubtasks = editingTask ? subtaskList(editingTask).map(s => ({ ...s })) : [];
  $("modal-title").textContent = MODAL_TITLES[type] || "";
  const body = $("modal-body");
  body.replaceChildren();
  if (type === "create" || type === "edit") renderTaskForm(body, task);
  else if (type === "changelog") renderChangelog(body);
  else renderSettingsForm(body);
  $("overlay").classList.remove("hidden");
  // focus first input if any
  const firstInput = body.querySelector("input,button");
  if (firstInput) firstInput.focus();
}

function closeModal() {
  $("overlay").classList.add("hidden");
  $("modal-body").replaceChildren();
  currentModal = null;
  editingTask = null;
}

$("add-button").addEventListener("click", () => openModal("create"));
// The web component owns the install dialog; manual flags keep it closed until
// this button is tapped, and its own translations cover the browser versions.
$("install-button").addEventListener("click", () => $("pwa-install").showDialog());
$("settings-button").addEventListener("click", () => openModal("settings"));
$("close-modal").addEventListener("click", closeModal);
$("overlay").addEventListener("click", e => {
  if (e.target === $("overlay")) closeModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeModal();
    $("update-overlay").classList.add("hidden");
  }
  if (e.key === "Enter" && (currentModal === "create" || currentModal === "edit")) {
    e.preventDefault();
    submitTask();
  }
});

/* Shared task form – used for both create and edit */
function renderTaskForm(body, task = null) {
  const MIN = 1000;
  const MAX = 1000000;

  const nameField = document.createElement("div");
  nameField.className = "field";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Opgavens navn";
  const nameInput = document.createElement("input");
  nameInput.id = "task-name";
  nameInput.maxLength = 60;
  nameInput.placeholder = "F.eks. Gåtur, Ryd op...";
  nameInput.required = true;
  nameInput.value = task ? task.title : "";
  nameField.append(nameLabel, nameInput);

  // One reusable slider control, used for both the points and the repeat interval.
  createPoints = task ? clamp(task.points, MIN, MAX) : MIN;
  const pointsControl = makeRangeControl({
    min: MIN,
    max: MAX,
    value: createPoints,
    ariaLabel: "Point for opgaven",
    formatTooltip: v => format(v),
    onChange: v => { createPoints = v; }
  });
  const pointsField = document.createElement("div");
  pointsField.className = "field";
  const pointsLabel = document.createElement("label");
  pointsLabel.textContent = "Point";
  const pointsHint = document.createElement("div");
  pointsHint.className = "hint";
  pointsHint.textContent = "Pointene fordeles på hovedopgaven og eventuelle underopgaver.";
  pointsField.append(pointsLabel, pointsControl.area, pointsControl.valueDisplay, pointsHint);

  createRepeatDays = task ? (task.repeatDays || 0) : 0;
  const repeatControl = makeRangeControl({
    min: 0,
    max: MAX_REPEAT_DAYS,
    value: createRepeatDays,
    ariaLabel: "Gentagelse",
    formatTooltip: v => String(v),
    formatValue: repeatTitle,
    onChange: v => { createRepeatDays = v; }
  });
  const repeatField = document.createElement("div");
  repeatField.className = "field";
  const repeatLabel = document.createElement("label");
  repeatLabel.textContent = "Gentagelse";
  const repeatHint = document.createElement("div");
  repeatHint.className = "hint";
  repeatHint.textContent = "0 gentager ikke. Vælg antal dage for at få opgaven tilbage efter gennemførelse.";
  repeatField.append(repeatLabel, repeatControl.area, repeatControl.valueDisplay, repeatHint);

  // Subtasks are edited here, on the parent task. On the card they can only be
  // folded out and checked; sorting and deleting stays in this one place.
  const subField = document.createElement("div");
  subField.className = "field";
  const subLabel = document.createElement("label");
  subLabel.textContent = "Underopgaver";
  const addRow = document.createElement("div");
  addRow.className = "subtask-add-row";
  const subInput = document.createElement("input");
  subInput.id = "subtask-name";
  subInput.maxLength = 60;
  subInput.placeholder = "Ny underopgave";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "data-button";
  addBtn.textContent = "Tilføj";
  addRow.append(subInput, addBtn);
  const subList = document.createElement("div");
  subList.className = "subtask-editor-list";
  const subHint = document.createElement("div");
  subHint.className = "hint";
  subHint.textContent = "Hver underopgave og hovedopgaven får lige stor andel af pointene. Træk i håndtaget for at ændre rækkefølgen, og brug × for at slette.";
  subField.append(subLabel, addRow, subList, subHint);

  function paintSubtasks() {
    subList.replaceChildren();
    createSubtasks.forEach(sub => {
      const row = document.createElement("div");
      row.className = "subtask-editor-row";
      row.dataset.id = sub.id;
      const handle = document.createElement("span");
      handle.className = "subtask-drag";
      handle.textContent = "⠿";
      handle.title = "Træk for at ændre rækkefølgen";
      const name = document.createElement("span");
      name.className = "subtask-editor-title";
      name.textContent = sub.title;
      const share = document.createElement("span");
      share.className = "subtask-share num";
      share.textContent = Math.round(100 / (createSubtasks.length + 1)) + "%";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "subtask-delete";
      del.textContent = "×";
      del.title = "Slet underopgave";
      del.setAttribute("aria-label", "Slet underopgave: " + sub.title);
      del.addEventListener("click", () => {
        createSubtasks = createSubtasks.filter(s => s.id !== sub.id);
        paintSubtasks();
      });
      row.append(handle, name, share, del);
      subList.append(row);
    });
  }

  function addSubtask() {
    const title = subInput.value.trim();
    if (!title) return;
    createSubtasks.push({ id: makeId(), title });
    subInput.value = "";
    paintSubtasks();
    subInput.focus();
  }
  addBtn.addEventListener("click", addSubtask);
  subInput.addEventListener("keydown", e => {
    // Enter belongs to this field; the form's global Enter must not submit.
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); addSubtask(); }
  });

  // Pointer events cover both mouse and touch; the handle alone owns the drag
  // so the modal can still scroll normally everywhere else.
  let dragging = null;
  subList.addEventListener("pointerdown", e => {
    const handle = e.target.closest(".subtask-drag");
    if (!handle) return;
    const row = handle.closest(".subtask-editor-row");
    dragging = { row, id: row.dataset.id };
    row.classList.add("dragging");
    // Synthetic pointer events have no active pointer to capture.
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  subList.addEventListener("pointermove", e => {
    if (!dragging) return;
    const target = [...subList.querySelectorAll(".subtask-editor-row:not(.dragging)")]
      .find(row => {
        const box = row.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2;
      });
    if (!target) return;
    const from = createSubtasks.findIndex(s => s.id === dragging.id);
    const to = createSubtasks.findIndex(s => s.id === target.dataset.id);
    if (from < 0 || to < 0 || from === to) return;
    const [item] = createSubtasks.splice(from, 1);
    createSubtasks.splice(to, 0, item);
    subList.insertBefore(dragging.row, target);
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging.row.classList.remove("dragging");
    dragging = null;
  };
  subList.addEventListener("pointerup", endDrag);
  subList.addEventListener("pointercancel", endDrag);
  paintSubtasks();

  const error = document.createElement("div");
  error.className = "error";
  error.id = "form-error";

  const saveBtn = document.createElement("button");
  saveBtn.className = "save-button";
  saveBtn.type = "button";
  saveBtn.textContent = task ? "Gem ændringer" : "Gem opgave";
  saveBtn.addEventListener("click", submitTask);

  body.append(nameField, pointsField, repeatField, subField, error, saveBtn);
}

function submitTask() {
  if (submitting) return;
  submitting = true;
  try {
    const title = $("task-name").value.trim();
    const points = createPoints;
    const repeatDays = clamp(Math.round(createRepeatDays), 0, MAX_REPEAT_DAYS);
    if (!title) {
      $("form-error").textContent = "Skriv et navn til opgaven.";
      return;
    }
    if (!Number.isSafeInteger(points) || points < 1000) {
      $("form-error").textContent = "Point skal være mindst 1.000.";
      return;
    }

    let task;
    if (editingTask) {
      // Edit in place so history records keep pointing at the same task id.
      task = state.tasks.find(t => t.id === editingTask.id);
      if (!task) {
        $("form-error").textContent = "Opgaven kunne ikke findes.";
        return;
      }
      task.title = title;
      task.points = points;
      task.repeatDays = repeatDays;
      // Open tasks adopt the new value; completed history keeps what was earned.
      Object.values(state.days).forEach(day => {
        const record = day[task.id];
        if (record && !record.done) record.value = points;
      });
    } else {
      task = { id: makeId(), title, points, repeatDays, subtasks: [] };
      state.tasks.push(task);
    }
    task.subtasks = createSubtasks.map(s => ({ ...s }));
    // A deleted subtask must not keep awarding points from today's record.
    const todayRecord = state.days[currentDate] && state.days[currentDate][task.id];
    if (todayRecord && todayRecord.subs) {
      const ids = new Set(task.subtasks.map(s => s.id));
      Object.keys(todayRecord.subs).forEach(id => {
        if (!ids.has(id)) delete todayRecord.subs[id];
      });
    }
    ensureToday();
    entry(task);
    save();
    closeModal();
    renderTasks();
  } catch (e) {
    $("form-error").textContent = "Fejl: " + (e && e.message ? e.message : e);
  } finally {
    submitting = false;
  }
}

/* Generic slider control reused by the task form (points + repeat interval). */
function makeRangeControl({ min, max, value, ariaLabel, formatTooltip, formatValue, onChange }) {
  const label = formatValue || formatTooltip || (v => String(v));
  const area = document.createElement("div");
  area.className = "slider-area";
  const slider = document.createElement("div");
  slider.className = "slider create-slider";
  slider.setAttribute("role", "slider");
  slider.setAttribute("tabindex", "0");
  slider.setAttribute("aria-label", ariaLabel);
  slider.setAttribute("aria-valuemin", String(min));
  slider.setAttribute("aria-valuemax", String(max));
  const track = document.createElement("div");
  track.className = "track";
  const fill = document.createElement("div");
  fill.className = "fill";
  track.append(fill);
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip num";
  slider.append(track, thumb, tooltip);
  area.append(slider);
  const valueDisplay = document.createElement("div");
  valueDisplay.className = "range-value";

  let current = clamp(value, min, max);
  function paint() {
    const percent = ((current - min) / (max - min)) * 100;
    fill.style.width = percent + "%";
    thumb.style.left = percent + "%";
    tooltip.style.left = percent + "%";
    tooltip.textContent = formatTooltip(current);
    valueDisplay.textContent = label(current);
    slider.setAttribute("aria-valuenow", String(current));
  }
  function setFromClientX(clientX) {
    const rect = slider.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const next = Math.round(min + (max - min) * ratio);
    if (next !== current) {
      current = next;
      onChange(current);
      paint();
    }
  }
  let dragging = false;
  slider.addEventListener("pointerdown", e => {
    dragging = true;
    slider.classList.add("dragging");
    slider.setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  });
  slider.addEventListener("pointermove", e => { if (dragging) setFromClientX(e.clientX); });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    slider.classList.remove("dragging");
  }
  slider.addEventListener("pointerup", endDrag);
  slider.addEventListener("pointercancel", endDrag);
  slider.addEventListener("lostpointercapture", endDrag);
  slider.addEventListener("keydown", e => {
    const step = Math.max(1, Math.round((max - min) / 100));
    let next = current;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next += step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next -= step;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    else return;
    e.preventDefault();
    current = clamp(next, min, max);
    onChange(current);
    paint();
  });
  paint();
  return { area, valueDisplay };
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "little-wins-backup.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || !Array.isArray(parsed.tasks) || !parsed.days) {
        alert("Ugyldig backup-fil.");
        return;
      }
      const synced = syncState(parsed);
      if (!synced) {
        alert("Ugyldig backup-fil.");
        return;
      }
      state = synced;
      state.appVersion = APP_VERSION;
      save();
      applyTheme();
      renderTasks();
      closeModal();
    } catch (err) {
      alert("Kunne ikke læse filen: " + (err && err.message ? err.message : err));
    }
  };
  reader.readAsText(file);
}

function renderSettingsForm(body) {
  // Theme selector
  const themeField = document.createElement("div");
  themeField.className = "field";
  const themeLabel = document.createElement("label");
  themeLabel.textContent = "Tema";
  const themeRow = document.createElement("div");
  themeRow.className = "theme-row";
  ["system", "light", "dark"].forEach(t => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-button" + ((state.theme || "light") === t ? " active" : "");
    btn.textContent = t === "system" ? "System" : t === "light" ? "Lys" : "Mørk";
    btn.addEventListener("click", () => {
      state.theme = t;
      save();
      applyTheme();
      themeRow.querySelectorAll(".theme-button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
    themeRow.append(btn);
  });
  themeField.append(themeLabel, themeRow);

  // Sound toggle
  const soundField = document.createElement("div");
  soundField.className = "field";
  const soundLabel = document.createElement("label");
  soundLabel.textContent = "Lyd";
  const toggleRow = document.createElement("div");
  toggleRow.className = "toggle-row";
  const toggleLabel = document.createElement("span");
  toggleLabel.className = "toggle-label";
  toggleLabel.textContent = state.sound ? "Til" : "Fra";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "toggle" + (state.sound ? " on" : "");
  toggle.addEventListener("click", () => {
    state.sound = !state.sound;
    save();
    toggle.classList.toggle("on", state.sound);
    toggleLabel.textContent = state.sound ? "Til" : "Fra";
  });
  toggleRow.append(toggleLabel, toggle);
  soundField.append(soundLabel, toggleRow);

  // Data backup
  const dataField = document.createElement("div");
  dataField.className = "field";
  const dataLabel = document.createElement("label");
  dataLabel.textContent = "Data";
  const dataRow = document.createElement("div");
  dataRow.className = "data-row";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "data-button";
  exportBtn.textContent = "Eksportér JSON";
  exportBtn.addEventListener("click", exportData);
  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "data-button";
  importBtn.textContent = "Importér JSON";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/json";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });
  importBtn.addEventListener("click", () => fileInput.click());
  dataRow.append(exportBtn, importBtn, fileInput);
  dataField.append(dataLabel, dataRow);

  // Save settings button
  const saveBtn = document.createElement("button");
  saveBtn.className = "save-button";
  saveBtn.type = "button";
  saveBtn.textContent = "Gem indstillinger";
  saveBtn.addEventListener("click", closeModal);

  const versionLine = document.createElement("div");
  versionLine.className = "version-line";
  versionLine.textContent = "Little Wins · " + VERSION_LABEL;

  body.append(themeField, soundField, dataField, versionLine, saveBtn);
}

// Both the "what's new" popup and the footer history read from VERSIONS.
function renderUpdateNotice() {
  $("update-badge").textContent = "NY VERSION";
  $("update-title").textContent = "Opdateret til " + CURRENT_VERSION.label;
  $("update-lead").textContent = CURRENT_VERSION.lead;
  const list = $("update-list");
  list.replaceChildren();
  CURRENT_VERSION.changes.forEach(change => {
    const li = document.createElement("li");
    li.textContent = change;
    list.append(li);
  });
}

function renderChangelog(body) {
  const intro = document.createElement("p");
  intro.className = "changelog-intro";
  intro.textContent = "Her ser du, hvad der er nyt i hver version. Dine opgaver og din historik bevares automatisk ved opdatering.";
  body.append(intro);

  VERSIONS.forEach((release, index) => {
    const entry = document.createElement("section");
    entry.className = "changelog-entry" + (index === 0 ? " current" : "");

    const head = document.createElement("div");
    head.className = "changelog-head";
    const name = document.createElement("strong");
    name.textContent = release.label;
    const meta = document.createElement("span");
    meta.textContent = (index === 0 ? "Aktuel · " : "") + release.date;
    head.append(name, meta);

    const list = document.createElement("ul");
    list.className = "changelog-list";
    release.changes.forEach(change => {
      const li = document.createElement("li");
      li.textContent = change;
      list.append(li);
    });

    entry.append(head, list);
    body.append(entry);
  });
}

/* Day rollover */
function checkDate() {
  const today=localDate();
  if(today!==currentDate) {
    currentDate=today;
    ensureToday();
    renderTasks();
    if(!$("history-view").hidden) renderHistory();
  }
}

document.addEventListener("visibilitychange",()=>{
  if(!document.hidden) checkDate();
});
window.addEventListener("focus",checkDate);
setInterval(checkDate,60000);

// Show the "what's new" notice once, only when an existing install moves to a
// new app version. Fresh installs are silent – there was nothing to update from.
function handleVersionOnLoad() {
  if (isFreshInstall || state.appVersion === APP_VERSION) {
    state.appVersion = APP_VERSION;
    return;
  }
  state.appVersion = APP_VERSION;
  $("update-overlay").classList.remove("hidden");
}

/* Initialisation */
applyTheme();
preloadSounds();
renderUpdateNotice();
handleVersionOnLoad();
ensureToday();
renderTasks();

/* Register service worker for offline support */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
})();
