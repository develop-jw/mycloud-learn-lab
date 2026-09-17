/* ---- MyCloud Lab 공통 모듈: API · 아이콘 · UI 도우미 · 라우터 · 레이아웃 ---- */
// 다른 js 파일들은 모두 여기 있는 도우미를 가져다 씁니다.
// 화면 하나를 만드는 흐름은 항상 같아요:
//   1) API로 데이터 가져오기  2) HTML 문자열 만들기  3) #content에 넣기  4) 버튼에 동작 연결(wire)

/* ---- API 호출 ---- */
const api = {
  async req(method, url, body) {
    const opts = { method, headers: {} };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `요청 실패 (${r.status})`);
    return data;
  },
  get: (url) => api.req("GET", url),
  post: (url, body) => api.req("POST", url, body || {}),
  del: (url) => api.req("DELETE", url),
};

/* ---- 문자열/숫자 도우미 ---- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function timeAgo(iso) {
  if (!iso) return "";
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 45) return "방금 전";
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}분 전`;
  if (sec < 86400) return `${Math.round(sec / 3600)}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}
function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "-";
}
function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const byId = (id) => document.getElementById(id);
const val = (id) => (byId(id) ? byId(id).value.trim() : "");
const isChecked = (id) => !!(byId(id) && byId(id).checked);
const checkedValues = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

/* ==================================================================
   아이콘
   - public/aws-icons/<키>.svg 에 AWS 공식 아키텍처 아이콘이 있으면 그걸 쓰고
   - 없으면 직접 그린 선 아이콘을 카테고리 색 타일 위에 올려서 보여줍니다.
   ================================================================== */
const GLYPHS = {
  home: '<path d="M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z"/>',
  users: '<circle cx="9" cy="8.5" r="3"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M3.5 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5z"/><path d="M15.2 13.7c2.6-.3 4.6 1.2 5.3 4.3"/>',
  route53: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.4 2.3 2.4 13.7 0 16M12 4c-2.4 2.3-2.4 13.7 0 16"/><circle cx="17.5" cy="17.5" r="3" fill="currentColor" stroke="none" opacity=".35"/>',
  cloudfront: '<circle cx="12" cy="12" r="8"/><path d="M4.5 9.5h15M4.5 14.5h15M12 4c3 2.5 3 13.5 0 16M12 4c-3 2.5-3 13.5 0 16"/>',
  elb: '<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="12" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M8.4 12H15.8M8 10.8l7.9-4M8 13.2l7.9 4"/>',
  tg: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  vpc: '<path d="M7.5 18.5h10a3.5 3.5 0 0 0 .4-7 5.5 5.5 0 0 0-10.6-1.5A4.3 4.3 0 0 0 7.5 18.5z"/><rect x="9.5" y="12.5" width="5" height="4" rx=".8"/><path d="M10.5 12.5v-1a1.5 1.5 0 0 1 3 0v1"/>',
  subnet: '<rect x="4" y="5" width="16" height="14" rx="2.5" stroke-dasharray="3 2"/><path d="M8 12h8"/>',
  igw: '<circle cx="12" cy="12" r="8"/><path d="M12 6.5v11M9 9l3-3 3 3M9 15l3 3 3-3"/>',
  nat: '<rect x="4" y="6" width="16" height="12" rx="2.5"/><path d="M8 12h7M12.5 9l3 3-3 3"/>',
  eip: '<circle cx="12" cy="10" r="5.5"/><path d="M12 15.5V20M9 20h6"/><path d="M10 10h4"/>',
  sg: '<path d="M12 3.5 19 6v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  nacl: '<path d="M4 5h16l-6 7.5v5.5l-4 2v-7.5z"/>',
  route: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M8.2 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.8"/>',
  vpn: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2"/>',
  dx: '<path d="M9 3v5M15 3v5"/><rect x="6.5" y="8" width="11" height="6" rx="2"/><path d="M12 14v3.5a3 3 0 0 1-3 3H6"/>',
  ec2: '<rect x="6" y="6" width="12" height="12" rx="1.8"/><rect x="9.5" y="9.5" width="5" height="5" rx=".8"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/>',
  asg: '<rect x="8" y="8" width="8" height="8" rx="1.5"/><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/>',
  lt: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>',
  volume: '<ellipse cx="12" cy="6.5" rx="7" ry="2.5"/><path d="M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11"/><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  snapshot: '<rect x="3.5" y="7" width="17" height="12" rx="2"/><path d="M8.5 7l1.5-2.5h4L15.5 7"/><circle cx="12" cy="13" r="3.3"/>',
  s3: '<path d="M4.5 6.5c0-1.4 3.4-2.5 7.5-2.5s7.5 1.1 7.5 2.5L17.5 19c0 .9-2.5 1.6-5.5 1.6S6.5 19.9 6.5 19z"/><path d="M4.5 6.5c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
  efs: '<path d="M3.5 7.5h6l2 2h9v9.5h-17z"/><path d="M8 14.5h8M12 12v5"/>',
  rds: '<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/><path d="M5 10c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6M5 14c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>',
  cache: '<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/><path d="M13 9.5l-3 4.5h4l-3 4.5"/>',
  eks: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><circle cx="12" cy="9" r="1.8"/><circle cx="8.5" cy="14.5" r="1.8"/><circle cx="15.5" cy="14.5" r="1.8"/><path d="M12 10.8v1.4l-2.2 1.2M12 12.2l2.2 1.2"/>',
  pod: '<path d="M12 3.5 19.5 7.7v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M4.5 7.7 12 12l7.5-4.3M12 12v8.5"/>',
  ksvc: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="4.5" r="1.6"/><circle cx="12" cy="19.5" r="1.6"/><circle cx="4.5" cy="12" r="1.6"/><circle cx="19.5" cy="12" r="1.6"/><path d="M12 6.1V9M12 15v2.9M6.1 12H9M15 12h2.9"/>',
  ingress: '<path d="M3.5 12h6M9.5 12c3 0 3-5.5 6-5.5h3M9.5 12c3 0 3 5.5 6 5.5h3"/><path d="M16.5 4.5l2 2-2 2M16.5 15.5l2 2-2 2"/>',
  ecr: '<rect x="4" y="12.5" width="7" height="7" rx="1"/><rect x="13" y="12.5" width="7" height="7" rx="1"/><rect x="8.5" y="4.5" width="7" height="7" rx="1"/>',
  workload: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  iam: '<circle cx="9" cy="9.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5 1.3 0 2.5.4 3.4 1.1"/><circle cx="16.5" cy="15.5" r="2.3"/><path d="M18.2 17.2 21 20M19.5 18.5l1-1"/>',
  cloudwatch: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M6.5 14.5l3-3.5 3 2.5 4.5-5.5"/>',
  alarm: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  cost: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-1-1.5-1.5-2.8-1.5-1.6 0-2.8.8-2.8 2.1 0 3 5.8 1.5 5.8 4.5 0 1.3-1.2 2.2-3 2.2-1.4 0-2.5-.6-3-1.7M12 6v1.7M12 16.5v1.7"/>',
  guide: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z"/><path d="M5 20.5A2.5 2.5 0 0 1 7.5 18H19v3H7.5"/><path d="M9 7.5h6M9 11h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  check: '<path d="M5.5 12.5 10 17l8.5-9.5"/>',
  arrow: '<path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  cube: '<path d="M12 3.5 19.5 7.7v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M4.5 7.7 12 12l7.5-4.3M12 12v8.5"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1.8"/><rect x="9.5" y="9.5" width="5" height="5" rx=".8"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  memory: '<path d="M4 8h16v8H4z"/><path d="M7 8v8M10 8v8M13 8v8M16 8v8M6 16v3M18 16v3"/>',
  requests: '<circle cx="5.5" cy="17" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="18.5" cy="14" r="2"/><path d="M6.6 15.3 10.9 8.7M13.4 8.3l3.9 4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>',
};

// 아이콘 키 → 카테고리 (타일 색상)
const ICON_CATEGORY = {
  users: "neutral", home: "neutral", guide: "neutral", search: "neutral", workload: "container",
  route53: "network", cloudfront: "network", elb: "network", tg: "network", vpc: "network", subnet: "network",
  igw: "network", nat: "network", eip: "network", route: "network", vpn: "network", dx: "network",
  ec2: "compute", asg: "compute", lt: "compute",
  volume: "storage", snapshot: "storage", s3: "storage", efs: "storage",
  rds: "database", cache: "database",
  eks: "container", pod: "container", ksvc: "container", ingress: "container", ecr: "container",
  sg: "security", nacl: "security", iam: "security", shield: "security",
  cloudwatch: "ops", alarm: "ops", cost: "cost",
};

const OFFICIAL_ICONS = new Set(); // /api/aws-icons 가 알려준 공식 아이콘 키

function glyph(key, cls = "") {
  return `<svg class="glyph ${cls}" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[key] || GLYPHS.cube}</svg>`;
}

// 서비스 아이콘 타일. size: xs | sm | md | lg
function svc(key, size = "md") {
  if (OFFICIAL_ICONS.has(key)) {
    return `<span class="svc svc-${size} official"><img src="/aws-icons/${key}.svg" alt="" loading="lazy" /></span>`;
  }
  return `<span class="svc svc-${size} cat-${ICON_CATEGORY[key] || "neutral"}">${glyph(key)}</span>`;
}

/* ---- 상태 배지 ---- */
const STATE = {
  green: ["available", "running", "in-use", "attached", "active", "ACTIVE", "Running", "Ready", "Deployed", "healthy", "OK", "UP", "Completed", "Enabled", "Active"],
  orange: ["pending", "stopping", "shutting-down", "creating", "deleting", "modifying", "rebooting", "provisioning", "CREATING", "UPDATING", "DELETING", "ContainerCreating", "InProgress", "initial", "ordering", "Pending", "Terminating", "draining", "IN_PROGRESS", "Suspended"],
  red: ["terminated", "ImagePullBackOff", "unhealthy", "ALARM", "failed", "DOWN", "Inactive", "blackhole"],
  gray: ["stopped", "detached", "INSUFFICIENT_DATA", "unused", "Disabled", "deleted"],
};
const STATE_KO = {
  available: "사용 가능", running: "실행 중", "in-use": "사용 중", attached: "연결됨", active: "활성", pending: "대기 중",
  stopping: "중지 중", "shutting-down": "종료 중", creating: "생성 중", deleting: "삭제 중", modifying: "수정 중",
  rebooting: "재부팅 중", provisioning: "프로비저닝 중", terminated: "종료됨", stopped: "중지됨", detached: "분리됨",
  healthy: "정상", unhealthy: "비정상", initial: "확인 중", unused: "미사용", draining: "드레이닝", ordering: "주문 중",
  INSUFFICIENT_DATA: "데이터 부족", blackhole: "블랙홀",
};
function badge(state, label) {
  const tone = Object.keys(STATE).find((k) => STATE[k].includes(state)) || "gray";
  return `<span class="badge ${tone}"><i></i>${esc(label || STATE_KO[state] || state)}</span>`;
}
const tag = (text, tone = "gray") => `<span class="tag ${tone}">${esc(text)}</span>`;
const mono = (text) => `<code class="mono">${esc(text)}</code>`;

/* ==================================================================
   화면 조각 도우미
   ================================================================== */

// 페이지 머리말
function pageHead({ icon, title, desc, actions = "" }) {
  return `<div class="page-head">
    <div class="ph-title">${icon ? svc(icon, "lg") : ""}<div><h1>${esc(title)}</h1>${desc ? `<p>${desc}</p>` : ""}</div></div>
    <div class="ph-actions">${actions}</div>
  </div>`;
}

// 카드
function card(title, body, { actions = "", cls = "", sub = "" } = {}) {
  return `<section class="card ${cls}">
    ${title ? `<div class="card-head"><div><h2>${title}</h2>${sub ? `<p class="card-sub">${sub}</p>` : ""}</div><div class="card-actions">${actions}</div></div>` : ""}
    ${body}
  </section>`;
}

// 표: columns = [{ label, render(row) }], rows = []
function table(columns, rows, { empty = "항목이 없어요.", emptyAction = "", rowHref } = {}) {
  if (!rows.length) {
    return `<div class="empty"><div class="empty-icon">${glyph("cube")}</div><p>${empty}</p>${emptyAction}</div>`;
  }
  return `<div class="table-wrap"><table>
    <thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .map((r) => {
        const href = rowHref ? rowHref(r) : null;
        return `<tr ${href ? `class="link-row" data-href="${esc(href)}"` : ""}>${columns.map((c) => `<td>${c.render(r)}</td>`).join("")}</tr>`;
      })
      .join("")}</tbody>
  </table></div>`;
}

// 폼 요소
function field(label, control, hint = "", { full = false } = {}) {
  return `<label class="field ${full ? "full" : ""}"><span class="f-label">${label}</span>${control}${hint ? `<span class="f-hint">${hint}</span>` : ""}</label>`;
}
function input(id, { value = "", placeholder = "", type = "text", attrs = "" } = {}) {
  return `<input id="${id}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs} />`;
}
function textarea(id, { value = "", placeholder = "", rows = 5, mono: isMono = false } = {}) {
  return `<textarea id="${id}" rows="${rows}" class="${isMono ? "mono-input" : ""}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
}
function select(id, options, selected, attrs = "") {
  return `<select id="${id}" ${attrs}>${options
    .map((o) => (typeof o === "string" ? { value: o, label: o } : o))
    .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(selected) ? "selected" : ""} ${o.disabled ? "disabled" : ""}>${esc(o.label)}</option>`)
    .join("")}</select>`;
}
function checkbox(id, label, checked = false, hint = "") {
  return `<label class="check"><input type="checkbox" id="${id}" ${checked ? "checked" : ""} /><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ""}</span></label>`;
}
// 여러 개 고르는 체크박스 목록 (서브넷 선택 등)
function checkList(name, options, selected = []) {
  if (!options.length) return `<p class="muted small">선택할 항목이 없어요.</p>`;
  return `<div class="check-list">${options
    .map(
      (o) => `<label class="check-item"><input type="checkbox" name="${name}" value="${esc(o.value)}" ${selected.includes(o.value) ? "checked" : ""} />
      <span>${o.label}</span></label>`
    )
    .join("")}</div>`;
}
// 카드형 선택지 (AMI, 인스턴스 유형 등)
function choiceCards(name, options, selected) {
  return `<div class="choices" data-choice="${name}">${options
    .map(
      (o) => `<button type="button" class="choice ${o.value === selected ? "on" : ""}" data-value="${esc(o.value)}">
      ${o.icon ? svc(o.icon, "sm") : ""}<span><b>${esc(o.label)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ""}${o.badge ? tag(o.badge, "green") : ""}</span>
    </button>`
    )
    .join("")}</div>`;
}
function choiceValue(name) {
  const on = document.querySelector(`[data-choice="${name}"] .choice.on`);
  return on ? on.dataset.value : "";
}
function section(title, body, hint = "") {
  return `<section class="form-sec"><div class="fs-head"><h3>${title}</h3>${hint ? `<p>${hint}</p>` : ""}</div><div class="fs-body">${body}</div></section>`;
}
function formActions(cancelHref, submitLabel) {
  return `<div class="form-actions"><a class="btn" href="${cancelHref}">취소</a><button class="btn primary" id="submit">${submitLabel}</button></div>`;
}
function errorBox() {
  return `<div id="form-error" class="alert error" hidden></div>`;
}
function showErr(msg) {
  const el = byId("form-error");
  if (!el) return toast(msg, true);
  el.textContent = msg;
  el.hidden = false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}
function info(text, tone = "info") {
  return `<div class="alert ${tone}">${text}</div>`;
}
function tabsBar(items, active, hrefFn) {
  return `<div class="tabs">${items.map((t) => `<a class="${t.key === active ? "on" : ""}" href="${hrefFn(t.key)}">${t.label}${t.count !== undefined ? `<span>${t.count}</span>` : ""}</a>`).join("")}</div>`;
}
function kv(pairs) {
  return `<dl class="kv">${pairs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v ?? "-"}</dd></div>`).join("")}</dl>`;
}
function btn(label, act, id, { tone = "", disabled = false, extra = "" } = {}) {
  return `<button class="btn sm ${tone}" data-act="${act}" data-id="${esc(id)}" ${disabled ? "disabled" : ""} ${extra}>${label}</button>`;
}

/* ---- 토스트 / 모달 ---- */
let toastTimer;
function toast(msg, isError) {
  const el = byId("toast");
  el.textContent = msg;
  el.className = isError ? "error" : "";
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 4200 : 2600);
}

// 간단한 입력/확인 창. fields = [{ id, label, value, placeholder, type }]
function modal({ title, body = "", fields = [], okLabel = "확인", danger = false }) {
  return new Promise((resolve) => {
    const root = byId("modal-root");
    root.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      ${body ? `<div class="modal-body">${body}</div>` : ""}
      ${fields.map((f) => field(f.label, f.type === "textarea" ? textarea(f.id, f) : f.options ? select(f.id, f.options, f.value) : input(f.id, f), f.hint || "")).join("")}
      <div class="form-actions"><button class="btn" data-m="cancel">취소</button><button class="btn ${danger ? "danger-solid" : "primary"}" data-m="ok">${okLabel}</button></div>
    </div></div>`;
    const close = (result) => {
      root.innerHTML = "";
      resolve(result);
    };
    root.querySelector('[data-m="cancel"]').onclick = () => close(null);
    root.querySelector(".modal-bg").onclick = (e) => e.target.classList.contains("modal-bg") && close(null);
    root.querySelector('[data-m="ok"]').onclick = () => {
      const out = {};
      fields.forEach((f) => (out[f.id] = byId(f.id).value));
      close(out);
    };
    const first = root.querySelector("input, textarea, select, [data-m='ok']");
    if (first) first.focus();
  });
}
const confirmBox = (title, body, okLabel = "삭제") => modal({ title, body, okLabel, danger: true });

/* ---- 버튼 동작 연결 ---- */
// <button data-act="stop" data-id="i-123"> 같은 버튼을 한 번에 연결
function wire(handlers) {
  document.querySelectorAll("#content [data-act]").forEach((el) => {
    const fn = handlers[el.dataset.act];
    if (!fn) return;
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.disabled = true;
      try {
        await fn(el.dataset.id, el);
      } catch (err) {
        toast(err.message, true);
      } finally {
        el.disabled = false;
      }
    });
  });
  document.querySelectorAll("#content tr.link-row").forEach((tr) =>
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input, select")) return;
      location.hash = tr.dataset.href;
    })
  );
  document.querySelectorAll("#content [data-choice]").forEach((group) =>
    group.querySelectorAll(".choice").forEach((c) =>
      c.addEventListener("click", () => {
        group.querySelectorAll(".choice").forEach((x) => x.classList.remove("on"));
        c.classList.add("on");
        group.dispatchEvent(new CustomEvent("change", { detail: c.dataset.value }));
      })
    )
  );
}

// API 호출 → 성공 알림 → 화면 새로고침
async function act(promise, msg, { reload = true } = {}) {
  const res = await promise;
  if (msg) toast(res && res.note ? `${msg} · ${res.note}` : msg);
  if (reload) App.refresh();
  return res;
}

// 제출 버튼 연결
function onSubmit(fn) {
  const b = byId("submit");
  if (!b) return;
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await fn();
    } catch (e) {
      showErr(e.message);
    } finally {
      b.disabled = false;
    }
  });
}

/* ==================================================================
   좌측 메뉴 정의
   ================================================================== */
const NAV = [
  { key: "home", label: "개요", glyph: "home", href: "#/" },
  {
    key: "vpc", label: "네트워크", glyph: "vpc", href: "#/vpc",
    sub: [
      ["vpcs", "VPC"], ["subnets", "서브넷"], ["routetables", "라우팅 테이블"], ["igw", "인터넷 게이트웨이"],
      ["nat", "NAT 게이트웨이"], ["eip", "탄력적 IP"], ["sg", "보안 그룹"], ["nacl", "네트워크 ACL"], ["hybrid", "VPN · Direct Connect"],
    ],
  },
  {
    key: "ec2", label: "컴퓨팅", glyph: "ec2", href: "#/ec2",
    sub: [["instances", "인스턴스"], ["launch", "인스턴스 시작"], ["templates", "시작 템플릿"], ["asg", "Auto Scaling 그룹"], ["volumes", "EBS 볼륨"], ["snapshots", "스냅샷 · AMI"]],
  },
  { key: "elb", label: "로드 밸런싱", glyph: "elb", href: "#/elb", sub: [["lbs", "로드 밸런서"], ["tgs", "대상 그룹"]] },
  { key: "eks", label: "EKS 클러스터", glyph: "eks", href: "#/eks", sub: [["clusters", "클러스터"], ["nodegroups", "노드 그룹"], ["ecr", "ECR 리포지토리"]] },
  { key: "workloads", label: "워크로드", glyph: "workload", href: "#/workloads", sub: [["deployments", "디플로이먼트"], ["pods", "파드"], ["services", "서비스"], ["ingresses", "인그레스"]] },
  { key: "storage", label: "스토리지", glyph: "s3", href: "#/storage", sub: [["s3", "S3 버킷"], ["efs", "EFS 파일 시스템"]] },
  { key: "db", label: "데이터베이스", glyph: "rds", href: "#/db", sub: [["rds", "RDS"], ["cache", "ElastiCache"]] },
  { key: "edge", label: "엣지 · DNS", glyph: "cloudfront", href: "#/edge", sub: [["cloudfront", "CloudFront"], ["route53", "Route 53"]] },
  { key: "iam", label: "보안 · IAM", glyph: "shield", href: "#/iam", sub: [["users", "사용자"], ["roles", "역할"], ["policies", "정책"], ["simulator", "정책 시뮬레이터"]] },
  { key: "monitoring", label: "모니터링", glyph: "cloudwatch", href: "#/monitoring", sub: [["metrics", "지표"], ["alarms", "경보"], ["logs", "로그 그룹"], ["health", "환경 점검"], ["activity", "활동 기록"]] },
  { key: "cost", label: "비용", glyph: "cost", href: "#/cost" },
];

/* ==================================================================
   라우터 + 앱 뼈대
   ================================================================== */
const App = {
  routes: {},
  timers: [],
  current: null,

  // 경로 등록: App.route("/vpc", (params) => ...)
  route(path, fn, meta = {}) {
    this.routes[path] = { fn, meta };
  },

  // 화면이 바뀌거나 새로고침할 때 정리할 타이머
  every(ms, fn) {
    this.timers.push(setInterval(fn, ms));
  },
  clearTimers() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  },

  // 상태가 바뀌는 중인 리소스가 있으면 잠시 뒤 자동 새로고침
  autoRefresh(needed, ms = 2500) {
    if (!needed) return;
    const hash = location.hash;
    this.timers.push(
      setTimeout(() => {
        if (location.hash === hash && !document.querySelector("#content input:focus, #content textarea:focus, #content select:focus, .modal")) this.refresh(true);
      }, ms)
    );
  },

  parse() {
    const raw = location.hash.slice(1) || "/";
    const [path, qs] = raw.split("?");
    return { path, params: new URLSearchParams(qs || "") };
  },

  async refresh(silent) {
    const { path, params } = this.parse();
    const r = this.routes[path];
    this.clearTimers();
    const content = byId("content");
    const y = window.scrollY;
    if (!silent) content.classList.add("loading");
    try {
      if (!r) {
        content.innerHTML = `<div class="empty big"><p>페이지를 찾을 수 없어요.</p><a class="btn" href="#/">개요로 돌아가기</a></div>`;
      } else {
        await r.fn(params);
      }
    } catch (e) {
      content.innerHTML = `<div class="alert error">오류: ${esc(e.message)}</div>`;
    } finally {
      content.classList.remove("loading");
      if (silent) window.scrollTo(0, y);
    }
  },

  async navigate() {
    const { path, params } = this.parse();
    const r = this.routes[path];
    this.renderChrome(path, params, r ? r.meta : {});
    window.scrollTo(0, 0);
    document.body.classList.remove("nav-open");
    byId("scrim").hidden = true;
    await this.refresh();
  },

  renderChrome(path, params, meta) {
    const section = meta.section || "home";
    const sub = meta.sub ? (typeof meta.sub === "function" ? meta.sub(params) : meta.sub) : null;
    byId("side-nav").innerHTML = NAV.map((n) => {
      const on = n.key === section;
      const subs =
        on && n.sub
          ? `<div class="side-sub">${n.sub
              .map(([k, label]) => `<a href="#${subHref(n.key, k)}" class="${k === sub ? "on" : ""}">${label}</a>`)
              .join("")}</div>`
          : "";
      return `<a class="side-item ${on ? "on" : ""}" href="${n.href}">${glyph(n.glyph)}<span>${n.label}</span></a>${subs}`;
    }).join("");

    const topKey = { home: "home", guide: "guide", search: "search", monitoring: "monitoring" }[section];
    document.querySelectorAll("#top-links a").forEach((a) => a.classList.toggle("on", a.dataset.top === topKey));

    const crumbs = meta.crumbs ? meta.crumbs(params) : [];
    byId("crumbs").innerHTML = ["AWS 실습", ...crumbs]
      .map((c, i, arr) => {
        const [label, href] = Array.isArray(c) ? c : [c, null];
        if (i === arr.length - 1) return `<span class="here">${esc(label)}</span>`;
        return href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`;
      })
      .join('<span class="sep">/</span>');
  },

  async loadIcons() {
    try {
      (await api.get("/api/aws-icons")).forEach((k) => OFFICIAL_ICONS.add(k));
    } catch (e) {
      /* 공식 아이콘 없음 → 자체 아이콘 사용 */
    }
  },

  // 알림 벨: 경보(ALARM) + 최근 활동
  async updateBell() {
    try {
      const [alarms, events] = await Promise.all([api.get("/api/alarms"), api.get("/api/events?limit=8")]);
      const firing = alarms.filter((a) => a.state === "ALARM");
      byId("bell-dot").hidden = !firing.length;
      byId("bell-panel").innerHTML = `
        <div class="dp-head"><b>알림</b><span>${firing.length ? `경보 ${firing.length}개 발생 중` : "발생 중인 경보 없음"}</span></div>
        ${firing.map((a) => `<a class="dp-row alarm" href="#/monitoring?tab=alarms">${glyph("alarm")}<span><b>${esc(a.name)}</b><small>${esc(a.stateReason)}</small></span></a>`).join("")}
        ${events.map((e) => { const t = eventInfo(e); return `<div class="dp-row">${glyph(t.icon)}<span>${t.text}<small>${timeAgo(e.t)}</small></span></div>`; }).join("") || `<p class="muted small pad">아직 활동이 없어요.</p>`}
        <a class="dp-foot" href="#/monitoring?tab=activity">전체 활동 보기</a>`;
    } catch (e) {
      /* 무시 */
    }
  },

  bindChrome() {
    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-dropdown]");
      document.querySelectorAll(".dropdown-panel").forEach((p) => {
        if (trigger && p.id === trigger.dataset.dropdown) p.hidden = !p.hidden;
        else if (!e.target.closest(".dropdown-panel")) p.hidden = true;
      });
      if (e.target.closest(".dropdown-panel a")) document.querySelectorAll(".dropdown-panel").forEach((p) => (p.hidden = true));
    });
    byId("top-search").addEventListener("submit", (e) => {
      e.preventDefault();
      location.hash = `#/search?q=${encodeURIComponent(val("search-input"))}`;
    });
    byId("menu-toggle").addEventListener("click", () => {
      const open = document.body.classList.toggle("nav-open");
      byId("scrim").hidden = !open;
    });
    byId("scrim").addEventListener("click", () => {
      document.body.classList.remove("nav-open");
      byId("scrim").hidden = true;
    });
    byId("reset-btn").addEventListener("click", async () => {
      const ok = await confirmBox("실습 환경 초기화", "<p>만든 모든 리소스와 업로드한 파일이 지워지고 처음 상태로 돌아가요. 되돌릴 수 없어요.</p>", "초기화");
      if (!ok) return;
      await api.post("/api/reset");
      toast("실습 환경을 초기화했어요.");
      location.hash = "#/";
      this.refresh();
    });
  },

  async start() {
    this.bindChrome();
    await this.loadIcons();
    window.addEventListener("hashchange", () => this.navigate());
    this.navigate();
    this.updateBell();
    setInterval(() => this.updateBell(), 6000);
  },
};

// 섹션 화면 공통 메타: 좌측 메뉴 강조 + 현재 위치(브레드크럼)
function sectionMeta(sectionKey, defaultTab) {
  const nav = NAV.find((n) => n.key === sectionKey);
  const tabOf = (p) => p.get("tab") || defaultTab;
  return {
    section: sectionKey,
    sub: tabOf,
    crumbs: (p) => {
      const tab = tabOf(p);
      const label = ((nav.sub || []).find(([k]) => k === tab) || [null, nav.label])[1];
      const parts = [[nav.label, nav.href]];
      if (p.get("new") || p.get("id") || p.get("bucket")) parts.push([label, `#/${sectionKey}?tab=${tab}`]);
      else parts.push(label);
      if (p.get("new")) parts.push("생성");
      else if (p.get("id")) parts.push(p.get("name") || p.get("id"));
      else if (p.get("bucket")) parts.push(p.get("bucket"));
      return parts;
    },
  };
}
const listHref = (section, tab) => `#/${section}?tab=${tab}`;
const newHref = (section, tab) => `#/${section}?tab=${tab}&new=1`;
const detailHref = (section, tab, id) => `#/${section}?tab=${tab}&id=${encodeURIComponent(id)}`;

// 좌측 하위 메뉴 링크 만들기
function subHref(section, key) {
  const special = { "ec2:launch": "/ec2/launch" };
  return special[`${section}:${key}`] || `/${section}?tab=${key}`;
}

/* ==================================================================
   활동 기록 → 사람이 읽는 문장
   ================================================================== */
const EVENT_RULES = [
  [/^\/reset$/, "실습 환경 초기화", "home", "gray"],
  [/^\/vpcs$/, "VPC {n} 생성", "vpc"],
  [/^\/subnets$/, "서브넷 {n} 생성", "subnet"],
  [/^\/internet-gateways$/, "인터넷 게이트웨이 {n} 생성", "igw"],
  [/^\/internet-gateways\/.+\/attach$/, "인터넷 게이트웨이를 VPC에 연결", "igw", "blue"],
  [/^\/internet-gateways\/.+\/detach$/, "인터넷 게이트웨이 분리", "igw", "blue"],
  [/^\/route-tables$/, "라우팅 테이블 {n} 생성", "route"],
  [/^\/route-tables\/.+\/routes$/, "라우트 추가", "route", "blue"],
  [/^\/route-tables\/.+\/associate$/, "서브넷을 라우팅 테이블에 연결", "route", "blue"],
  [/^\/nat-gateways$/, "NAT 게이트웨이 {n} 생성", "nat"],
  [/^\/elastic-ips$/, "탄력적 IP 할당", "eip"],
  [/^\/elastic-ips\/.+\/associate$/, "탄력적 IP를 인스턴스에 연결", "eip", "blue"],
  [/^\/security-groups$/, "보안 그룹 {n} 생성", "sg"],
  [/^\/security-groups\/.+\/rules$/, "보안 그룹 인바운드 규칙 추가", "sg", "blue"],
  [/^\/nacls/, "네트워크 ACL 변경", "nacl", "blue"],
  [/^\/vpn-|^\/customer-gateways/, "VPN 구성 변경", "vpn", "blue"],
  [/^\/dx-connections$/, "Direct Connect 연결 {n} 요청", "dx"],
  [/^\/instances$/, "EC2 인스턴스 {n} 시작", "ec2"],
  [/^\/instances\/.+\/stop$/, "인스턴스 중지", "ec2", "blue"],
  [/^\/instances\/.+\/start$/, "인스턴스 시작", "ec2", "blue"],
  [/^\/instances\/.+\/reboot$/, "인스턴스 재부팅", "ec2", "blue"],
  [/^\/instances\/.+\/create-image$/, "AMI {n} 생성", "snapshot"],
  [/^\/volumes$/, "EBS 볼륨 {n} 생성", "volume"],
  [/^\/volumes\/.+\/snapshot$/, "EBS 스냅샷 생성", "snapshot", "blue"],
  [/^\/volumes\/.+\/(attach|detach|modify)$/, "EBS 볼륨 변경", "volume", "blue"],
  [/^\/launch-templates$/, "시작 템플릿 {n} 생성", "lt"],
  [/^\/auto-scaling-groups$/, "Auto Scaling 그룹 {n} 생성", "asg"],
  [/^\/auto-scaling-groups\/scale-out$/, "Auto Scaling 확장: {n}", "asg", "orange"],
  [/^\/auto-scaling-groups\/scale-in$/, "Auto Scaling 축소: {n}", "asg", "orange"],
  [/^\/auto-scaling-groups\/.+/, "Auto Scaling 설정 변경", "asg", "blue"],
  [/^\/load-balancers$/, "로드 밸런서 {n} 생성", "elb"],
  [/^\/load-balancers\/.+/, "리스너·규칙 변경", "elb", "blue"],
  [/^\/target-groups$/, "대상 그룹 {n} 생성", "tg"],
  [/^\/target-groups\/.+\/targets$/, "대상 등록", "tg", "blue"],
  [/^\/cloudfront$/, "CloudFront 배포 생성", "cloudfront"],
  [/^\/cloudfront\/.+\/invalidations$/, "CloudFront 캐시 무효화", "cloudfront", "blue"],
  [/^\/cloudfront\/.+/, "CloudFront 배포 변경", "cloudfront", "blue"],
  [/^\/hosted-zones$/, "호스팅 영역 {n} 생성", "route53"],
  [/^\/hosted-zones\/.+\/records$/, "DNS 레코드 {n} 추가", "route53", "blue"],
  [/^\/eks-clusters$/, "EKS 클러스터 {n} 생성", "eks"],
  [/^\/eks-clusters\/.+\/addons$/, "EKS 추가 기능 {n} 설치", "eks", "blue"],
  [/^\/eks-clusters\/.+\/upgrade$/, "EKS 버전 업그레이드", "eks", "blue"],
  [/^\/node-groups$/, "노드 그룹 {n} 생성", "ec2"],
  [/^\/node-groups\/.+\/scale$/, "노드 그룹 크기 조정", "ec2", "blue"],
  [/^\/ecr-repositories$/, "ECR 리포지토리 {n} 생성", "ecr"],
  [/^\/ecr-repositories\/.+\/images$/, "이미지 푸시 :{n}", "ecr", "blue"],
  [/^\/deployments$/, "디플로이먼트 {n} 배포", "pod"],
  [/^\/deployments\/.+\/scale$/, "디플로이먼트 스케일 조정", "pod", "blue"],
  [/^\/deployments\/.+\/image$/, "롤링 업데이트 시작", "pod", "blue"],
  [/^\/k8s-services$/, "서비스 {n} 생성", "ksvc"],
  [/^\/ingresses$/, "인그레스 {n} 생성", "ingress"],
  [/^\/buckets$/, "S3 버킷 {n} 생성", "s3"],
  [/^\/buckets\/.+\/objects$/, "S3에 파일 업로드", "s3", "blue"],
  [/^\/buckets\/.+\/(policy|website|lifecycle|versioning|encryption|public-access-block)$/, "S3 버킷 설정 변경", "s3", "blue"],
  [/^\/buckets\/.+\/restore$/, "S3 이전 버전 복원", "s3", "blue"],
  [/^\/db-instances$/, "RDS 데이터베이스 {n} 생성", "rds"],
  [/^\/db-instances\/.+\/failover$/, "RDS 장애 조치(failover) 실행", "rds", "orange"],
  [/^\/db-instances\/.+/, "RDS 설정 변경", "rds", "blue"],
  [/^\/cache-clusters$/, "ElastiCache {n} 생성", "cache"],
  [/^\/efs$/, "EFS {n} 생성", "efs"],
  [/^\/efs\/.+/, "EFS 설정 변경", "efs", "blue"],
  [/^\/iam\/users$/, "IAM 사용자 {n} 생성", "iam"],
  [/^\/iam\/roles$/, "IAM 역할 {n} 생성", "iam"],
  [/^\/iam\/policies$/, "IAM 정책 {n} 생성", "iam"],
  [/^\/iam\/.+/, "IAM 설정 변경", "iam", "blue"],
  [/^\/alarms$/, "CloudWatch 경보 {n} 생성", "alarm"],
  [/^\/alarms\/alarm$/, "경보 발생: {n}", "alarm", "red"],
];
function eventInfo(e) {
  const path = e.path || "";
  for (const [re, text, icon, tone] of EVENT_RULES) {
    if (re.test(path)) {
      const t = e.method === "DELETE" ? text.replace(/ (생성|시작|할당|배포|추가|요청|설치)$/, " 삭제").replace("{n} 삭제", "삭제") : text;
      const toneFinal = e.method === "DELETE" ? "gray" : tone || "green";
      return { text: esc(t).replace("{n}", e.name ? `<b>${esc(e.name)}</b>` : "").replace(/\s+/g, " "), icon, tone: toneFinal };
    }
  }
  return { text: esc(`${e.method} ${path}`), icon: "cube", tone: "gray" };
}

// 여러 화면에서 쓰는 목록 조회 (한 번에 가져오기)
const load = {
  overview: () => api.get("/api/overview"),
};

function vpcName(o, id) {
  const v = (o.vpcs || []).find((x) => x.id === id);
  return v ? v.name : id || "-";
}
function subnetLabel(s) {
  return `${s.name} · ${s.availabilityZone.slice(-2)} · ${s.egress === "igw" ? "퍼블릭" : s.egress === "nat" ? "프라이빗(NAT)" : "프라이빗"}`;
}
function subnetTag(s) {
  if (!s) return "-";
  if (s.egress === "igw") return tag("퍼블릭", "green");
  if (s.egress === "nat") return tag("프라이빗 · NAT", "blue");
  return tag("프라이빗", "gray");
}
