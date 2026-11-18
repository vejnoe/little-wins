(() => {
"use strict";

const STORAGE_KEY = "little_wins_v1";
const DAY_NAMES = ["Man","Tir","Ons","Tor","Fre","Lør","Søn"];
const $ = id => document.getElementById(id);

const coinSVG = size => `
<svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none">
<circle cx="18" cy="18" r="16" fill="#FBBF24" stroke="#111" stroke-width="2.5"/>
<ellipse cx="18" cy="18" rx="10" ry="12" fill="#F59E0B" stroke="#111" stroke-width="1.5"/>
<rect x="15.5" y="10" width="5" height="16" rx="2.5" fill="#FEF08A"/>
</svg>`;

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
function weekLabel(date) {
  const w = isoWeek(date);
  return `Uge ${w.week} · ${w.year}`;
}
function minPoints(task) {
  return (task && task.min) ? task.min : 0;
}
function clamp(value,min,max) {
  return Math.max(min,Math.min(max,value));
}

const MAX_REPEAT_DAYS = 30;

// Normalise on load so old backups keep working. The old boolean `recurring`
// becomes repeatDays: 1 = "gentag hver dag", 0 = "gentager ikke".
function normaliseTasks(tasks) {
  tasks.forEach(t => {
    let days = t.repeatDays;
    if (typeof days !== "number" || !Number.isFinite(days)) days = t.recurring ? 1 : 0;
    t.repeatDays = clamp(Math.round(days), 0, MAX_REPEAT_DAYS);
    delete t.recurring;
  });
  return tasks;
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.tasks) && saved.days) {
      saved.tasks = normaliseTasks(saved.tasks);
      saved.simpleMode = !!saved.simpleMode;
      return saved;
    }
  } catch(e) {}
  return {tasks:[],days:{},sound:true,lastDate:null,theme:"light",simpleMode:false};
}

let state = load();
if(!state.theme) state.theme="light";
// View-only toggle for the "Vis gennemførte" button – not persisted.
let showCompleted = false;
let currentDate = localDate();
let selectedWeek = weekKey(new Date());
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

// repeatDays = 0: one-off – disappears for good after completion.
// repeatDays = n>0: hidden after completion, active again n days later.
function taskActiveOn(task, dateKey) {
  const last = lastCompletionOnOrBefore(task, dateKey);
  if (!last) return true;
  const interval = task.repeatDays || 0;
  if (interval === 0) return false;
  return dateKey >= dateKeyAfter(last, interval);
}

function isCompletedOn(task, dateKey) {
  const record = state.days[dateKey] && state.days[dateKey][task.id];
  return !!(record && record.done);
}

// In simple mode a task always awards its full amount, so fresh records start there.
function freshValue(task) {
  return state.simpleMode ? task.max : minPoints(task);
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
  return Object.values(records).reduce((sum,r) =>
    sum + (r.done ? r.value : 0),0);
}

function allTimeTotal() {
  return Object.values(state.days).reduce((sum,day) =>
    sum + Object.values(day).reduce((s,r)=>s+(r.done?r.value:0),0),0);
}

function playTone(frequency=900,duration=.12) {
  if (!state.sound) return;
  try {
    soundContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (soundContext.state==="suspended") soundContext.resume();
    const osc=soundContext.createOscillator();
    const gain=soundContext.createGain();
    osc.type="sine";
    osc.frequency.setValueAtTime(frequency,soundContext.currentTime);
    gain.gain.setValueAtTime(.08,soundContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,soundContext.currentTime+duration);
    osc.connect(gain);
    gain.connect(soundContext.destination);
    osc.start();
    osc.stop(soundContext.currentTime+duration);
  } catch(e) {}
}

function animateCoins(source) {
  const anchor=$("coin-anchor");
  const from=source.getBoundingClientRect();
  const to=anchor.getBoundingClientRect();
  const startX=from.left+from.width/2;
  const startY=from.top+from.height/2;
  const endX=to.left+to.width/2;
  const endY=to.top+to.height/2;

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    anchor.classList.add("coin-bounce");
    setTimeout(()=>anchor.classList.remove("coin-bounce"),450);
    return;
  }

  for(let i=0;i<12;i++) {
    const coin=document.createElement("div");
    coin.className="coin-particle";
    coin.innerHTML=coinSVG(20);
    coin.style.left=(startX-10+(Math.random()-.5)*30)+"px";
    coin.style.top=(startY-10+(Math.random()-.5)*20)+"px";
    const dx=endX-startX+(Math.random()-.5)*45;
    const dy=endY-startY+(Math.random()-.5)*35;
    coin.style.setProperty("--dx",dx+"px");
    coin.style.setProperty("--dy",dy+"px");
    coin.style.animation=`coin-arrive ${.55+Math.random()*.35}s cubic-bezier(.2,.8,.3,1) ${i*.035}s forwards`;
    document.body.appendChild(coin);
    setTimeout(()=>coin.remove(),1300);
  }

  setTimeout(()=>{
    anchor.classList.add("coin-bounce");
    setTimeout(()=>anchor.classList.remove("coin-bounce"),450);
    playTone(1318,.2);
  },850);
}

function renderHeader() {
  $("total-points").textContent=format(dayTotal());
  $("today-label").textContent=new Intl.DateTimeFormat("da-DK",{
    weekday:"long",day:"numeric",month:"short"
  }).format(new Date());
  // footer date removed per request
}

/* Today's task list */
function repeatLabel(days) {
  if (!days) return "";
  return days === 1 ? "↻" : "↻ " + days;
}

function repeatTitle(days) {
  if (!days) return "";
  return days === 1 ? "Gentag hver dag" : "Gentag hver " + days + ". dag";
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

  const days = task.repeatDays || 0;
  if (days) {
    const badge = document.createElement("span");
    badge.className = "recurring-badge";
    badge.textContent = repeatLabel(days);
    const label = repeatTitle(days);
    badge.title = label;
    badge.setAttribute("aria-label", label);
    left.append(badge);
  }

  head.append(left, right);
  return head;
}

function buildCardActions(task) {
  const actions = document.createElement("div");
  actions.className = "task-actions";

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

function toggleDone(task, record, source) {
  if (record.done) {
    record.done = false;
  } else {
    record.done = true;
    // Simple mode always awards the full amount; standard mode keeps a manual value.
    if (state.simpleMode || record.value === 0) record.value = task.max;
    animateCoins(source);
  }
  save();
  renderTasks();
}

function buildCardRight(task, record) {
  const right = document.createElement("div");
  right.className = "task-right";
  const value = document.createElement("span");
  value.className = "task-value num";
  value.textContent = format(state.simpleMode ? task.max : record.value);
  const done = document.createElement("button");
  done.className = "done-button";
  done.type = "button";
  done.setAttribute("aria-label", record.done ? "Fortryd gennemførelse" : "Markér som gennemført");
  done.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="3.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.5 5 5L19.5 6"/></svg>';
  done.addEventListener("click", () => toggleDone(task, record, done));
  right.append(value, done);
  return right;
}

function buildTaskCard(task) {
  const record = entry(task);
  const card = document.createElement("article");
  card.className = "task" + (record.done ? " completed" : "") + (state.simpleMode ? " simple" : "");

  card.append(buildCardHead(task, buildCardRight(task, record)));

  let slider = null, fill = null, thumb = null, tooltip = null;
  if (!state.simpleMode) {
    const percent = clamp(
      ((record.value - minPoints(task)) / (task.max - minPoints(task))) * 100, 0, 100
    );
    const area = document.createElement("div");
    area.className = "slider-area";
    slider = document.createElement("div");
    slider.className = "slider" + (record.done ? " locked" : "");
    slider.setAttribute("role", "slider");
    slider.setAttribute("tabindex", record.done ? "-1" : "0");
    slider.setAttribute("aria-label", "Potentielle point for " + task.title);
    slider.setAttribute("aria-valuemin", minPoints(task));
    slider.setAttribute("aria-valuemax", task.max);
    slider.setAttribute("aria-valuenow", record.value);
    const track = document.createElement("div");
    track.className = "track";
    fill = document.createElement("div");
    fill.className = "fill";
    fill.style.width = percent + "%";
    track.append(fill);
    thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.style.left = percent + "%";
    tooltip = document.createElement("div");
    tooltip.className = "tooltip num";
    tooltip.textContent = format(record.value);
    tooltip.style.left = percent + "%";
    slider.append(track, thumb, tooltip);
    area.append(slider);
    card.append(area);
  }

  card.append(buildCardActions(task));
  if (isInTouchMode) attachSwipeDelete(card, task);
  if (slider && !record.done) {
    attachSlider(slider, task, record, fill, thumb, tooltip, card.querySelector(".task-value"));
  }
  return card;
}

function renderTasks() {
  ensureToday();
  renderHeader();

  const list = $("task-list");
  list.replaceChildren();

  $("completed-toggle").textContent = showCompleted ? "Skjul gennemførte" : "Vis gennemførte";
  $("completed-toggle").setAttribute("aria-pressed", String(showCompleted));

  const active = state.tasks.filter(task => taskActiveOn(task, currentDate));
  const completed = showCompleted
    ? state.tasks.filter(task => isCompletedOn(task, currentDate))
    : [];

  if (!active.length && !completed.length) {
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

  active.forEach(task => list.append(buildTaskCard(task)));

  if (completed.length) {
    const heading = document.createElement("div");
    heading.className = "completed-heading";
    heading.textContent = "Gennemført i dag";
    list.append(heading);
    completed.forEach(task => list.append(buildTaskCard(task)));
  }
}

function attachSlider(slider,task,record,fill,thumb,tooltip,valueEl) {
  let dragging=false;
  let lastTick=record.value;

  function update(clientX) {
    const rect=slider.getBoundingClientRect();
    const ratio=clamp((clientX-rect.left)/rect.width,0,1);
    const next=Math.round(minPoints(task)+(task.max-minPoints(task))*ratio);
    const percent=ratio*100;

    record.value=next;
    fill.style.width=percent+"%";
    thumb.style.left=percent+"%";
    tooltip.style.left=percent+"%";
    tooltip.textContent=format(next);
    valueEl.textContent=format(next);
    slider.setAttribute("aria-valuenow",next);

    if(Math.abs(next-lastTick)>=Math.max(1,task.max/30)) {
      playTone(480,.025);
      lastTick=next;
    }
    renderHeader();
  }

  slider.addEventListener("pointerdown",e=>{
    if(record.done) return;
    dragging=true;
    slider.classList.add("dragging");
    slider.setPointerCapture(e.pointerId);
    update(e.clientX);
  });

  slider.addEventListener("pointermove",e=>{
    if(dragging) update(e.clientX);
  });

  function endDrag() {
    if(!dragging) return;
    dragging=false;
    slider.classList.remove("dragging");
    save();
  }
  slider.addEventListener("pointerup",endDrag);
  slider.addEventListener("pointercancel",endDrag);
  slider.addEventListener("lostpointercapture",endDrag);

  slider.addEventListener("keydown",e=>{
    let next=record.value;
    const step=Math.max(1,Math.round((task.max-minPoints(task))/100));
    if(e.key==="ArrowRight"||e.key==="ArrowUp") next+=step;
    else if(e.key==="ArrowLeft"||e.key==="ArrowDown") next-=step;
    else if(e.key==="Home") next=minPoints(task);
    else if(e.key==="End") next=task.max;
    else return;
    e.preventDefault();
    const rect=slider.getBoundingClientRect();
    const ratio=(clamp(next,minPoints(task),task.max)-minPoints(task))/(task.max-minPoints(task));
    update(rect.left+ratio*rect.width);
    save();
  });
}

/* Swipe-to-delete for touch users – iOS-style slide-left to delete */
function attachSwipeDelete(card,task) {
  const slider = card.querySelector(".slider");
  let startX=null;
  let currentDx=0;

  card.addEventListener("touchstart",e=>{
    if(!isInTouchMode) return;
    // Don't hijack touches that start on the slider (value adjustment)
    if (slider && slider.contains(e.target)) { startX=null; return; }
    startX=e.touches[0].clientX;
    currentDx=0;
    card.style.transition="none";
  });

  card.addEventListener("touchmove",e=>{
    if(startX===null) return;
    const dx=e.touches[0].clientX-startX;
    if (dx > 0) { // only allow left swipe
      currentDx=0;
      card.style.transform="translateX(0)";
      return;
    }
    currentDx = Math.max(dx, -90);
    card.style.transform=`translateX(${currentDx}px)`;
    // reveal delete affordance via background color
    const progress = Math.min(1, Math.abs(currentDx)/90);
    card.style.backgroundColor = progress > 0.6 ? "#fee2e2" : "";
  });

  function endSwipe(e) {
    if(startX===null) return;
    const dx = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX - startX : currentDx;
    startX=null;
    card.style.transition="transform .2s ease, background-color .2s";
    if (dx < -60) {
      // slide out then delete
      card.style.transform="translateX(-100%)";
      card.style.opacity="0";
      setTimeout(() => {
        state.tasks=state.tasks.filter(t=>t.id!==task.id);
        save();
        renderTasks();
      }, 200);
    } else {
      card.style.transform="translateX(0)";
      card.style.backgroundColor="";
      card.style.opacity="";
    }
  }

  card.addEventListener("touchend",endSwipe);
  card.addEventListener("touchcancel",endSwipe);
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

function makeSparkline(scores) {
  const width=560,height=82,pad=7;
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

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Daglige point: ${scores.map(s=>s.label+" "+format(s.score)).join(", ")}">
    <path class="chart-line" d="${path}"/>${dots}
  </svg>`;
}

// The first week is the week the user started – never show weeks before that.
function firstWeekKey() {
  const keys=Object.keys(state.days).sort();
  return keys.length ? weekKey(dateFromKey(keys[0])) : weekKey(new Date());
}

function renderHistory() {
  const list=$("week-list");
  list.replaceChildren();

  const currentKey=weekKey(new Date());
  const startWeek=firstWeekKey();
  if(selectedWeek<startWeek) selectedWeek=startWeek;
  if(selectedWeek>currentKey) selectedWeek=currentKey;

  const selectedDate=weekStartFromKey(selectedWeek);
  $("week-current").textContent=weekLabel(selectedDate);

  $("week-next").disabled=selectedWeek>=currentKey;
  $("week-prev").disabled=selectedWeek<=startWeek;

  // Show every week from the start week up to the selected week.
  // Empty weeks in between are kept; weeks before the user started are not.
  const startMonday=weekStartFromKey(startWeek);
  let index=0;
  for(let date=selectedDate;date>=startMonday;date=addDays(date,-7)) {
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
    card.insertAdjacentHTML("beforeend",makeSparkline(scores));

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

function weekStartFromKey(key) {
  const match=key.match(/^(\d{4})-W(\d{2})$/);
  const year=Number(match[1]),week=Number(match[2]);
  const jan4=new Date(year,0,4,12);
  const monday=mondayOfWeek(jan4);
  return addDays(monday,(week-1)*7);
}

function changeWeek(amount) {
  const next=addDays(weekStartFromKey(selectedWeek),amount*7);
  const nextKey=weekKey(next);
  const startWeek=firstWeekKey();
  if(nextKey<startWeek || nextKey>weekKey(new Date())) return;
  selectedWeek=nextKey;
  renderHistory();
}

/* Navigation */
function showView(view) {
  $("today-view").hidden=view!=="today";
  $("history-view").hidden=view!=="history";
  document.querySelectorAll(".tab").forEach(tab=>{
    tab.classList.toggle("active",tab.dataset.view===view);
  });
  $("add-button").hidden=view!=="today";
  if(view==="history") {
    selectedWeek=weekKey(new Date());
    renderHistory();
  }
}

document.querySelectorAll(".tab").forEach(tab=>{
  tab.addEventListener("click",()=>showView(tab.dataset.view));
});
$("week-prev").addEventListener("click",()=>changeWeek(-1));
$("week-next").addEventListener("click",()=>changeWeek(1));
$("completed-toggle").addEventListener("click",()=>{
  showCompleted=!showCompleted;
  renderTasks();
});

/* Modal system (reused for create, edit and settings) */
let currentModal = null;
let editingTask = null;
let createMax = 1000;
let createRepeatDays = 0;
let submitting = false;

const MODAL_TITLES = {
  create: "Opret ny opgave",
  edit: "Rediger opgave",
  settings: "Indstillinger"
};

function openModal(type, task = null) {
  currentModal = type;
  editingTask = (type === "edit") ? task : null;
  $("modal-title").textContent = MODAL_TITLES[type] || "";
  const body = $("modal-body");
  body.replaceChildren();
  if (type === "create" || type === "edit") renderTaskForm(body, task);
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
$("settings-button").addEventListener("click", () => openModal("settings"));
$("close-modal").addEventListener("click", closeModal);
$("overlay").addEventListener("click", e => {
  if (e.target === $("overlay")) closeModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
  if (e.key === "Enter" && (currentModal === "create" || currentModal === "edit")) {
    e.preventDefault();
    submitTask();
  }
});

/* Shared task form – used for both create and edit */
function repeatValueLabel(days) {
  if (!days) return "Gentager ikke";
  return days === 1 ? "Hver dag" : "Hver " + days + ". dag";
}

/* Shared task form – used for both create and edit */
function renderTaskForm(body, task = null) {
  const simple = state.simpleMode;
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
  createMax = task ? clamp(task.max, MIN, MAX) : MIN;
  const pointsControl = makeRangeControl({
    min: MIN,
    max: MAX,
    value: createMax,
    ariaLabel: simple ? "Point for opgaven" : "Maksimale point",
    formatTooltip: v => format(v),
    onChange: v => { createMax = v; }
  });
  const pointsField = document.createElement("div");
  pointsField.className = "field";
  const pointsLabel = document.createElement("label");
  pointsLabel.textContent = simple ? "Point" : "Maksimale point";
  const pointsHint = document.createElement("div");
  pointsHint.className = "hint";
  pointsHint.textContent = simple
    ? "Opgaven giver altid dette beløb, når du sætter kryds."
    : "Træk skyderen for at vælge maksimal point.";
  pointsField.append(pointsLabel, pointsControl.area, pointsControl.valueDisplay, pointsHint);

  createRepeatDays = task ? (task.repeatDays || 0) : 0;
  const repeatControl = makeRangeControl({
    min: 0,
    max: MAX_REPEAT_DAYS,
    value: createRepeatDays,
    ariaLabel: "Gentagelse",
    formatTooltip: v => String(v),
    formatValue: repeatValueLabel,
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

  const error = document.createElement("div");
  error.className = "error";
  error.id = "form-error";

  const saveBtn = document.createElement("button");
  saveBtn.className = "save-button";
  saveBtn.type = "button";
  saveBtn.textContent = task ? "Gem ændringer" : "Gem opgave";
  saveBtn.addEventListener("click", submitTask);

  body.append(nameField, pointsField, repeatField, error, saveBtn);
}

function submitTask() {
  if (submitting) return;
  submitting = true;
  try {
    const title = $("task-name").value.trim();
    const max = createMax;
    const repeatDays = clamp(Math.round(createRepeatDays), 0, MAX_REPEAT_DAYS);
    if (!title) {
      $("form-error").textContent = "Skriv et navn til opgaven.";
      return;
    }
    if (!Number.isSafeInteger(max) || max < 1000) {
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
      task.max = max;
      task.repeatDays = repeatDays;
      // Keep old daily values within the new range.
      Object.values(state.days).forEach(day => {
        const record = day[task.id];
        if (record) record.value = clamp(record.value, minPoints(task), task.max);
      });
    } else {
      const id = (crypto.randomUUID && typeof crypto.randomUUID === "function")
        ? crypto.randomUUID()
        : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      task = { id, title, max, repeatDays };
      state.tasks.push(task);
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
      state = parsed;
      state.tasks = normaliseTasks(state.tasks);
      state.simpleMode = !!state.simpleMode;
      if (!state.theme) state.theme = "light";
      if (state.sound === undefined) state.sound = true;
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

  // Simple mode: one global setting that reinterprets "max point" as a fixed
  // award and replaces the daily slider with a single checkmark.
  const modeField = document.createElement("div");
  modeField.className = "field";
  const modeLabel = document.createElement("label");
  modeLabel.textContent = "Visning";
  const modeRow = document.createElement("div");
  modeRow.className = "toggle-row";
  const modeText = document.createElement("span");
  modeText.className = "toggle-label";
  const MODE_LABELS = {
    standard: "Vurdering med skyder",
    simple: "Kun kryds (fuldt beløb)"
  };
  modeText.textContent = state.simpleMode ? MODE_LABELS.simple : MODE_LABELS.standard;
  const modeToggle = document.createElement("button");
  modeToggle.type = "button";
  modeToggle.className = "toggle" + (state.simpleMode ? " on" : "");
  modeToggle.setAttribute("aria-label", "Skift visning");
  modeToggle.addEventListener("click", () => {
    state.simpleMode = !state.simpleMode;
    save();
    modeToggle.classList.toggle("on", state.simpleMode);
    modeText.textContent = state.simpleMode ? MODE_LABELS.simple : MODE_LABELS.standard;
    renderTasks();
  });
  modeRow.append(modeText, modeToggle);
  modeField.append(modeLabel, modeRow);

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

  body.append(themeField, soundField, modeField, dataField, saveBtn);
}

/* Sound toggle moved to settings modal */

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

/* Initialisation */
applyTheme();
ensureToday();
renderTasks();

/* Register service worker for offline support */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
})();
