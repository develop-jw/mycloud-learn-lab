/* ---- API 호출 헬퍼 ---- */
const api = {
  get: (url) => fetch(url).then((r) => r.json()),
  post: (url, body) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "요청 실패");
      return data;
    }),
  del: (url) =>
    fetch(url, { method: "DELETE" }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "요청 실패");
      return data;
    }),
  upload: (url, file, extraFields) => {
    const form = new FormData();
    form.append("file", file);
    Object.entries(extraFields || {}).forEach(([k, v]) => form.append(k, v));
    return fetch(url, { method: "POST", body: form }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "업로드 실패");
      return data;
    });
  },
};

/* ---- 서비스 아이콘 (직접 그린 단순 선 아이콘, 서비스 구분이 필요한 곳에만 사용) ---- */
const ICON_PATHS = {
  vpc: '<polygon points="12,2.5 20.5,7.2 20.5,16.8 12,21.5 3.5,16.8 3.5,7.2" />',
  subnet: '<rect x="3.5" y="6" width="17" height="12" rx="3" stroke-dasharray="3 2" />',
  ec2: '<rect x="4" y="4" width="16" height="16" rx="2.5" /><rect x="8.5" y="8.5" width="7" height="7" rx="1" />',
  s3: '<path d="M5 5 H19 L17 20 H7 Z" /><line x1="5.6" y1="9" x2="18.4" y2="9" />',
  rds: '<ellipse cx="12" cy="5.8" rx="7.5" ry="2.6" /><path d="M4.5 5.8 V18.2 A7.5 2.6 0 0 0 19.5 18.2 V5.8" /><path d="M4.5 12 A7.5 2.6 0 0 0 19.5 12" />',
  igw: '<circle cx="12" cy="12" r="8.5" /><line x1="12" y1="6.5" x2="12" y2="17.5" /><polyline points="9.2,9.2 12,6.5 14.8,9.2" /><polyline points="9.2,14.8 12,17.5 14.8,14.8" />',
  sg: '<path d="M12 2.8 L19.5 5.6 V11.2 C19.5 16.2 16.3 19.8 12 21.2 C7.7 19.8 4.5 16.2 4.5 11.2 V5.6 Z" />',
  nacl: '<path d="M4 5 H20 L14 12.5 V19 L10 20.5 V12.5 Z" />',
  volume: '<ellipse cx="12" cy="6.5" rx="7" ry="2.5" /><path d="M5 6.5 V16.5 A7 2.5 0 0 0 19 16.5 V6.5" />',
  route: '<circle cx="6" cy="6" r="2.3" /><circle cx="18" cy="18" r="2.3" /><path d="M8.3 6 H15 A3 3 0 0 1 15 12 H9 A3 3 0 0 0 9 18 H15.7" />',
  internet: '<circle cx="12" cy="12" r="8.5" /><path d="M3.5 12 H20.5" /><path d="M12 3.5 C15 6.5 15 17.5 12 20.5 M12 3.5 C9 6.5 9 17.5 12 20.5" />',
  guide: '<path d="M5 4.5 H14 A4 4 0 0 1 18 8.5 V19.5 H9 A4 4 0 0 1 5 15.5 Z" /><path d="M9 9 H14 M9 13 H14" />',
  check: '<polyline points="5.5,12.5 10,17 18.5,7.5" />',
  arrow: '<line x1="5" y1="12" x2="18.5" y2="12" /><polyline points="13,6.5 18.5,12 13,17.5" />',
};
function icon(name) {
  return `<svg class="svc-icon ic-${name}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}
function tile(name, size) {
  return `<span class="tile ic-${name} ${size || ""}">${icon(name)}</span>`;
}

/* ---- 공통 UI 유틸 ---- */
const STATE_LABEL = {
  available: ["green", "사용 가능"],
  running: ["green", "실행 중"],
  "in-use": ["green", "사용 중"],
  attached: ["green", "연결됨"],
  pending: ["orange", "대기 중"],
  stopped: ["gray", "중지됨"],
  stopping: ["orange", "중지 중"],
  "shutting-down": ["orange", "종료 중"],
  terminated: ["red", "종료됨"],
  creating: ["orange", "생성 중"],
  deleting: ["orange", "삭제 중"],
  detached: ["gray", "분리됨"],
};
const TRANSITIONAL = ["pending", "stopping", "shutting-down", "creating", "deleting"];

function badge(state) {
  const [cls, label] = STATE_LABEL[state] || ["gray", state];
  return `<span class="badge ${cls}"><span class="dot"></span>${label}</span>`;
}

function fmtTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR");
}

function timeAgo(iso) {
  if (!iso) return "";
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "방금 전";
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer = null;
function toast(msg, isError) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.className = isError ? "error" : "";
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = "none"), 2600);
}

/* ---- 서비스별 좌측 메뉴 (실제 콘솔처럼 서비스 안에서만 하위 메뉴를 보여줌) ---- */
const SIDE_MENUS = {
  vpc: {
    title: "VPC",
    sub: "네트워크 · 보안",
    icon: "vpc",
    groups: [
      {
        label: "가상 프라이빗 클라우드",
        items: [
          { key: "vpc", label: "내 VPC", href: "#/vpc?tab=vpc" },
          { key: "subnets", label: "서브넷", href: "#/vpc?tab=subnets" },
          { key: "routetables", label: "라우팅 테이블", href: "#/vpc?tab=routetables" },
          { key: "igw", label: "인터넷 게이트웨이", href: "#/vpc?tab=igw" },
        ],
      },
      {
        label: "보안",
        items: [
          { key: "sg", label: "보안 그룹", href: "#/vpc?tab=sg" },
          { key: "nacl", label: "네트워크 ACL", href: "#/vpc?tab=nacl" },
        ],
      },
    ],
  },
  ec2: {
    title: "EC2",
    sub: "가상 서버 · 블록 스토리지",
    icon: "ec2",
    groups: [
      {
        label: "인스턴스",
        items: [
          { key: "instances", label: "인스턴스", href: "#/ec2?tab=instances" },
          { key: "launch", label: "인스턴스 시작", href: "#/ec2/launch" },
        ],
      },
      { label: "Elastic Block Store", items: [{ key: "volumes", label: "볼륨", href: "#/ec2?tab=volumes" }] },
    ],
  },
  s3: {
    title: "S3",
    sub: "객체 스토리지",
    icon: "s3",
    groups: [
      {
        label: "스토리지",
        items: [
          { key: "buckets", label: "버킷", href: "#/s3" },
          { key: "create", label: "버킷 만들기", href: "#/s3/create" },
        ],
      },
    ],
  },
  rds: {
    title: "RDS",
    sub: "관리형 데이터베이스",
    icon: "rds",
    groups: [
      {
        label: "데이터베이스",
        items: [
          { key: "dbs", label: "데이터베이스", href: "#/rds" },
          { key: "create", label: "데이터베이스 생성", href: "#/rds/create" },
        ],
      },
    ],
  },
};

function activeSideKey(section, path, params) {
  if (section === "vpc") {
    if (path === "/vpc") return params.get("tab") || "vpc";
    const seg = path.split("/")[2];
    return { create: "vpc", subnets: "subnets", sg: "sg", routetables: "routetables", nacl: "nacl" }[seg] || "vpc";
  }
  if (section === "ec2") {
    if (path === "/ec2") return params.get("tab") || "instances";
    return path === "/ec2/launch" ? "launch" : "volumes";
  }
  if (section === "s3") return path === "/s3/create" ? "create" : "buckets";
  if (section === "rds") return path === "/rds/create" ? "create" : "dbs";
  return "";
}

function renderChrome(path, params) {
  const section = path.split("/")[1] || "home";
  document.querySelectorAll("#main-nav a").forEach((a) => a.classList.toggle("active", a.dataset.section === section));
  document.getElementById("create-menu").removeAttribute("open");

  const menu = SIDE_MENUS[section];
  const shell = document.getElementById("shell");
  const sidebar = document.getElementById("sidebar");
  const crumbs = document.getElementById("crumbs");
  shell.classList.toggle("no-sidebar", !menu);

  if (!menu) {
    sidebar.innerHTML = "";
    crumbs.innerHTML = section === "search" ? `<a href="#/">홈</a><span class="sep">/</span><span class="here">검색</span>` : "";
    return;
  }

  const activeKey = activeSideKey(section, path, params);
  sidebar.innerHTML = `
    <div class="side-head">${tile(menu.icon)}<div><div class="side-title">${menu.title}</div><div class="side-sub">${menu.sub}</div></div></div>
    ${menu.groups
      .map(
        (g) => `<div class="side-group"><div class="side-group-label">${g.label}</div>
          ${g.items.map((it) => `<a class="side-link ${it.key === activeKey ? "active" : ""}" href="${it.href}">${it.label}</a>`).join("")}
        </div>`
      )
      .join("")}
    <div class="side-progress" id="side-progress"></div>
  `;
  fillSideProgress();

  // 현재 위치 표시 (예: VPC / 보안 그룹 / 상세)
  const activeItem = menu.groups.flatMap((g) => g.items).find((it) => it.key === activeKey);
  const parts = [`<a href="#/${section}">${menu.title}</a>`];
  const isLeaf = path.endsWith("/create") || path.endsWith("/detail") || path === "/s3/bucket";
  if (activeItem) parts.push(isLeaf ? `<a href="${activeItem.href}">${activeItem.label}</a>` : `<span class="here">${activeItem.label}</span>`);
  if (path.endsWith("/create") && activeItem && !/만들기|생성/.test(activeItem.label)) parts.push(`<span class="here">생성</span>`);
  if (path.endsWith("/detail")) parts.push(`<span class="here">상세</span>`);
  if (path === "/s3/bucket") parts.push(`<span class="here">${esc(params.get("name"))}</span>`);
  crumbs.innerHTML = parts.join('<span class="sep">/</span>');
}

async function fillSideProgress() {
  const box = document.getElementById("side-progress");
  if (!box) return;
  try {
    const j = computeJourney(await loadOverview());
    box.innerHTML = `<a href="#/guide">
      <div class="label"><span>실습 진행률</span><b>${j.pct}%</b></div>
      <div class="progress"><div class="bar" style="width:${j.pct}%"></div></div>
      <div class="next">${j.current ? `다음 단계 · <b>${j.current.short}</b>` : "모든 단계를 완료했어요"}</div>
    </a>`;
  } catch (e) {
    box.innerHTML = "";
  }
}

/* ---- 라우터 ---- */
let homeRefreshTimer = null;

function parseHash() {
  const hash = location.hash.slice(1) || "/";
  const [path, qs] = hash.split("?");
  return { path, params: new URLSearchParams(qs || "") };
}

async function router() {
  const { path, params } = parseHash();
  clearTimeout(homeRefreshTimer);
  renderChrome(path, params);
  const content = document.getElementById("content");
  content.innerHTML = `<div class="loading">불러오는 중...</div>`;
  window.scrollTo(0, 0);

  try {
    if (path === "/") return await renderHome();
    if (path === "/guide") return await renderGuide();
    if (path === "/search") return await renderSearch(params.get("q") || "");
    if (path === "/vpc") return await renderVpcList(params.get("tab") || "vpc");
    if (path === "/vpc/create") return await renderVpcCreate();
    if (path === "/vpc/subnets/create") return await renderSubnetCreate(params.get("vpcId"));
    if (path === "/vpc/sg/create") return await renderSgCreate(params.get("vpcId"));
    if (path === "/vpc/sg/detail") return await renderSgDetail(params.get("id"));
    if (path === "/vpc/routetables/create") return await renderRouteTableCreate(params.get("vpcId"));
    if (path === "/vpc/routetables/detail") return await renderRouteTableDetail(params.get("id"));
    if (path === "/vpc/nacl/create") return await renderNaclCreate(params.get("vpcId"));
    if (path === "/vpc/nacl/detail") return await renderNaclDetail(params.get("id"));
    if (path === "/ec2") return await renderEc2List(params.get("tab") || "instances");
    if (path === "/ec2/launch") return await renderEc2Launch();
    if (path === "/ec2/volumes/create") return await renderVolumeCreate();
    if (path === "/s3") return await renderS3List();
    if (path === "/s3/create") return await renderS3Create();
    if (path === "/s3/bucket") return await renderS3BucketDetail(params.get("name"));
    if (path === "/rds") return await renderRdsList();
    if (path === "/rds/create") return await renderRdsCreate();
    content.innerHTML = emptyState("페이지를 찾을 수 없어요", `<a href="#/">홈으로 돌아가기</a>`);
  } catch (err) {
    content.innerHTML = `<div class="alert error">오류: ${esc(err.message)}</div>`;
  }
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("header-search").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = document.getElementById("search-input").value.trim();
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("create-menu");
    if (menu.open && !menu.contains(e.target)) menu.removeAttribute("open");
  });
  router();
});

/* ==================================================================
   전체 현황 데이터 + 실습 여정 + 점검 + 활동 기록
   ================================================================== */

async function loadOverview() {
  const [vpcs, subnets, instances, buckets, dbs, igws, sgs, volumes, routeTables, nacls] = await Promise.all([
    api.get("/api/vpcs"),
    api.get("/api/subnets"),
    api.get("/api/instances"),
    api.get("/api/buckets"),
    api.get("/api/db-instances"),
    api.get("/api/internet-gateways"),
    api.get("/api/security-groups"),
    api.get("/api/volumes"),
    api.get("/api/route-tables"),
    api.get("/api/nacls"),
  ]);
  const counts = await Promise.all(
    buckets.map((b) =>
      api
        .get(`/api/buckets/${encodeURIComponent(b.name)}/objects`)
        .then((o) => o.length)
        .catch(() => 0)
    )
  );
  buckets.forEach((b, i) => (b.objectCount = counts[i]));
  return { vpcs, subnets, instances, buckets, dbs, igws, sgs, volumes, routeTables, nacls };
}

const JOURNEY = [
  {
    short: "VPC 생성",
    title: "나만의 네트워크(VPC) 만들기",
    icon: "vpc",
    href: "#/vpc/create",
    goal: "VPC 1개 이상",
    done: (d) => d.vpcs.length > 0,
    concept: "VPC는 AWS 안에 만드는 나만의 격리된 네트워크예요. CIDR 블록(예: 10.0.0.0/16)으로 쓸 IP 범위를 먼저 정합니다.",
  },
  {
    short: "서브넷 구성",
    title: "가용 영역별로 서브넷 나누기",
    icon: "subnet",
    href: "#/vpc/subnets/create",
    goal: "서브넷 1개 이상 (AZ를 나눠 2개면 더 좋아요)",
    done: (d) => d.subnets.length > 0,
    concept: "VPC의 IP 범위를 가용 영역(AZ)별로 쪼갠 것이 서브넷이에요. 서로 다른 AZ에 나눠두면 한쪽 데이터센터가 멈춰도 서비스가 살아남아요.",
  },
  {
    short: "인터넷 연결",
    title: "인터넷 게이트웨이 + 라우팅으로 퍼블릭 서브넷 만들기",
    icon: "igw",
    href: "#/vpc?tab=igw",
    goal: "IGW를 VPC에 연결하고, 0.0.0.0/0 → igw 라우트로 퍼블릭 서브넷 1개 이상",
    done: (d) => d.igws.some((g) => g.state === "attached") && d.subnets.some((s) => s.isPublic),
    concept: "인터넷 게이트웨이를 VPC에 붙이는 것만으로는 부족해요. 라우팅 테이블에 0.0.0.0/0 → igw 라우트를 넣고 서브넷을 연결해야 그 서브넷이 '퍼블릭'이 됩니다.",
  },
  {
    short: "방화벽 설정",
    title: "보안 그룹으로 필요한 포트만 열기",
    icon: "sg",
    href: "#/vpc?tab=sg",
    goal: "인바운드 규칙이 있는 보안 그룹 1개 이상",
    done: (d) => d.sgs.some((s) => s.inboundRules.length > 0),
    concept: "보안 그룹은 인스턴스 앞의 방화벽(Stateful)이에요. 웹 서버라면 80(HTTP)·443(HTTPS)만 열고, SSH(22)는 내 IP로만 제한하는 게 기본이에요.",
  },
  {
    short: "서버 띄우기",
    title: "퍼블릭 서브넷에 EC2 인스턴스 시작하기",
    icon: "ec2",
    href: "#/ec2/launch",
    goal: "실행 중(running) 인스턴스 1개 이상",
    done: (d) => d.instances.some((i) => i.state === "running"),
    concept: "퍼블릭 서브넷에 EC2를 시작하면 퍼블릭 IP가 붙어 외부에서 접속할 수 있어요. 루트 EBS 볼륨도 함께 만들어집니다.",
  },
  {
    short: "파일 저장",
    title: "S3 버킷에 정적 파일 올리기",
    icon: "s3",
    href: "#/s3",
    goal: "객체가 1개 이상 들어있는 버킷",
    done: (d) => d.buckets.some((b) => b.objectCount > 0),
    concept: "S3는 VPC 바깥에 있는 리전 단위 객체 스토리지예요. 이미지·정적 파일처럼 서버 디스크에 둘 필요가 없는 데이터를 저장합니다.",
  },
  {
    short: "DB 연결",
    title: "RDS 데이터베이스 만들기",
    icon: "rds",
    href: "#/rds/create",
    goal: "사용 가능(available) DB 인스턴스 1개 이상",
    done: (d) => d.dbs.some((x) => x.state === "available"),
    concept: "RDS는 백업·패치를 AWS가 대신 해주는 관리형 데이터베이스예요. 보통 프라이빗 서브넷에 두고 웹 서버에서만 접근하게 구성합니다.",
  },
];

function computeJourney(d) {
  const steps = JOURNEY.map((s) => ({ ...s, isDone: s.done(d) }));
  const doneCount = steps.filter((s) => s.isDone).length;
  return {
    steps,
    doneCount,
    pct: Math.round((doneCount / steps.length) * 100),
    current: steps.find((s) => !s.isDone) || null,
  };
}

// 실제 콘솔의 Trusted Advisor처럼 보안·비용 관점에서 가볍게 점검
function computeHealth(d) {
  const issues = [];
  d.instances
    .filter((i) => i.state === "running" && !i.securityGroupId)
    .forEach((i) => issues.push({ level: "warn", text: `${i.name} 인스턴스에 보안 그룹이 없어요`, href: "#/ec2" }));
  d.sgs
    .filter((s) => s.inboundRules.some((r) => String(r.port) === "22" && r.source === "0.0.0.0/0"))
    .forEach((s) => issues.push({ level: "warn", text: `${s.name}: SSH(22)가 전체 인터넷에 열려 있어요`, href: `#/vpc/sg/detail?id=${s.id}` }));
  d.buckets
    .filter((b) => !b.blockPublicAccess)
    .forEach((b) => issues.push({ level: "warn", text: `${b.name} 버킷이 퍼블릭으로 열려 있어요`, href: `#/s3/bucket?name=${encodeURIComponent(b.name)}` }));
  d.dbs
    .filter((x) => x.publiclyAccessible)
    .forEach((x) => issues.push({ level: "warn", text: `${x.identifier} DB가 퍼블릭 액세스 허용 상태예요`, href: "#/rds" }));
  d.volumes
    .filter((v) => v.state === "available")
    .forEach((v) => issues.push({ level: "info", text: `${v.name} 볼륨이 연결 없이 남아있어요 (비용 발생)`, href: "#/ec2?tab=volumes" }));
  d.igws
    .filter((g) => g.state === "detached")
    .forEach((g) => issues.push({ level: "info", text: `${g.name} 인터넷 게이트웨이가 분리된 상태예요`, href: "#/vpc?tab=igw" }));
  return issues;
}

function buildActivity(d) {
  const ev = [];
  const push = (t, ic, text, sub) => ev.push({ t, icon: ic, text, sub });
  d.vpcs.forEach((v) => push(v.createdAt, "vpc", `VPC <b>${esc(v.name)}</b> 생성`, v.cidrBlock));
  d.subnets.forEach((s) => push(s.createdAt, "subnet", `서브넷 <b>${esc(s.name)}</b> 생성`, `${s.availabilityZone} · ${s.isPublic ? "퍼블릭" : "프라이빗"}`));
  d.routeTables.filter((r) => !r.isMain).forEach((r) => push(r.createdAt, "route", `라우팅 테이블 <b>${esc(r.name)}</b> 생성`, `라우트 ${r.routes.length}개`));
  d.igws.forEach((g) => push(g.createdAt, "igw", `인터넷 게이트웨이 <b>${esc(g.name)}</b> 생성`, (STATE_LABEL[g.state] || [])[1]));
  d.sgs.forEach((s) => push(s.createdAt, "sg", `보안 그룹 <b>${esc(s.name)}</b> 생성`, `인바운드 규칙 ${s.inboundRules.length}개`));
  d.nacls.forEach((n) => push(n.createdAt, "nacl", `네트워크 ACL <b>${esc(n.name)}</b> 생성`, `규칙 ${n.rules.length}개`));
  d.instances.forEach((i) => push(i.launchedAt, "ec2", `인스턴스 <b>${esc(i.name)}</b> 시작`, `${i.instanceType} · ${(STATE_LABEL[i.state] || [])[1] || i.state}`));
  d.volumes.filter((v) => !v.isRoot).forEach((v) => push(v.createdAt, "volume", `EBS 볼륨 <b>${esc(v.name)}</b> 생성`, `${v.size}GiB ${v.type}`));
  d.buckets.forEach((b) => push(b.createdAt, "s3", `S3 버킷 <b>${esc(b.name)}</b> 생성`, `객체 ${b.objectCount}개`));
  d.dbs.forEach((x) => push(x.createdAt, "rds", `데이터베이스 <b>${esc(x.identifier)}</b> 생성`, `${x.engine} · ${(STATE_LABEL[x.state] || [])[1] || x.state}`));
  return ev.filter((e) => e.t).sort((a, b) => new Date(b.t) - new Date(a.t));
}

/* ==================================================================
   대시보드 홈
   ================================================================== */

async function renderHome() {
  const d = await loadOverview();
  if (parseHash().path !== "/") return;
  const j = computeJourney(d);
  const health = computeHealth(d);
  const activity = buildActivity(d).slice(0, 8);
  const liveInstances = d.instances.filter((i) => i.state !== "terminated");
  const running = liveInstances.filter((i) => i.state === "running").length;
  const hasAny = d.vpcs.length || d.buckets.length || d.dbs.length || d.igws.length;
  const status = !hasAny ? "idle" : health.some((i) => i.level === "warn") ? "warn" : "ok";
  const statusLabel = { idle: "리소스 없음", warn: "점검 필요", ok: "정상" }[status];
  const publicSubnets = d.subnets.filter((s) => s.isPublic).length;

  const services = [
    { key: "vpc", name: "VPC", count: d.vpcs.length, sub: `서브넷 ${d.subnets.length} · 퍼블릭 ${publicSubnets}` },
    { key: "ec2", name: "EC2", count: liveInstances.length, sub: `실행 중 ${running} · 볼륨 ${d.volumes.length}` },
    { key: "s3", name: "S3", count: d.buckets.length, sub: `객체 ${d.buckets.reduce((n, b) => n + b.objectCount, 0)}개` },
    { key: "rds", name: "RDS", count: d.dbs.length, sub: `사용 가능 ${d.dbs.filter((x) => x.state === "available").length}` },
  ];

  document.getElementById("content").innerHTML = `
    <div class="dash">
      <div class="dash-main">
        <section class="card hero">
          <div class="hero-text">
            <div class="eyebrow">Infrastructure Digital Twin</div>
            <h1 class="hero-title">클릭으로 설계하는<br />나만의 AWS 인프라</h1>
            <p class="hero-desc">실제 콘솔과 같은 순서로 VPC, EC2, S3, RDS를 만들어보세요. 만든 리소스가 어떻게 연결되는지 오른쪽 다이어그램에 바로 그려져요.</p>
            <div class="hero-actions">
              ${
                j.current
                  ? `<a class="btn primary" href="${j.current.href}">다음 단계: ${j.current.short} ${icon("arrow")}</a>`
                  : `<span class="btn success">모든 실습 단계 완료</span>`
              }
              <a class="btn ghost" href="#/guide">실습 가이드</a>
            </div>
            <dl class="hero-stats">
              <div><dt>VPC</dt><dd>${d.vpcs.length}</dd></div>
              <div><dt>실행 중 인스턴스</dt><dd>${running}</dd></div>
              <div><dt>S3 버킷</dt><dd>${d.buckets.length}</dd></div>
              <div><dt>데이터베이스</dt><dd>${d.dbs.length}</dd></div>
            </dl>
          </div>
          <div class="hero-diagram">
            <div class="diagram-head"><span>아키텍처 다이어그램</span><span class="live-dot">실시간 반영</span></div>
            ${buildArchDiagram(d)}
          </div>
        </section>

        <div class="dash-row">
          <section class="card">
            <div class="card-head"><h2>나의 실습 여정</h2><span class="muted small">${j.doneCount} / ${j.steps.length} 단계 완료</span></div>
            <ol class="stepper">
              ${j.steps
                .map(
                  (s, i) => `<li class="step ${s.isDone ? "done" : s === j.current ? "current" : ""}">
                    <a href="${s.href}" title="${esc(s.title)}"><span class="step-dot">${s.isDone ? icon("check") : icon(s.icon)}</span><span class="step-label"><span class="step-num">STEP ${i + 1}</span>${s.short}</span></a>
                  </li>`
                )
                .join("")}
            </ol>
            <div class="progress"><div class="bar" style="width:${j.pct}%"></div></div>
            <div class="progress-meta"><span>3-Tier 웹 서비스 구성 진행률</span><b>${j.pct}%</b></div>
          </section>

          <section class="card">
            <div class="card-head"><h2>${j.current ? "지금 배울 개념" : "복습 포인트"}</h2></div>
            ${
              j.current
                ? `<div class="concept">${tile(j.current.icon, "lg")}<div>
                    <div class="concept-title">${j.current.title}</div>
                    <p>${j.current.concept}</p>
                    <a class="text-link" href="${j.current.href}">바로 해보기 ${icon("arrow")}</a>
                  </div></div>`
                : `<ul class="recap">
                    <li>퍼블릭/프라이빗은 서브넷 속성이 아니라 <b>연결된 라우팅 테이블</b>이 결정해요.</li>
                    <li>보안 그룹은 Stateful(인스턴스 단위), 네트워크 ACL은 Stateless(서브넷 단위)예요.</li>
                    <li>EBS 볼륨은 같은 가용 영역의 인스턴스에만 붙일 수 있어요.</li>
                  </ul>`
            }
          </section>
        </div>

        <section class="card">
          <div class="card-head"><h2>서비스</h2><a class="text-link" href="#/guide">전체 실습 흐름 보기 ${icon("arrow")}</a></div>
          <div class="svc-grid">
            ${services
              .map(
                (s) => `<a class="svc-card" href="#/${s.key}">
                  ${tile(s.key)}
                  <div><div class="name">${s.name}</div><div class="sub">${s.sub}</div></div>
                  <div class="count">${s.count}</div>
                </a>`
              )
              .join("")}
          </div>
        </section>
      </div>

      <aside class="dash-side">
        <section class="card status-card ${status}">
          <div class="status-pill"><span class="dot"></span>환경 상태: <b>${statusLabel}</b></div>
          ${
            health.length
              ? `<ul class="issue-list">${health
                  .slice(0, 5)
                  .map((i) => `<li class="${i.level}"><a href="${i.href}">${esc(i.text)}</a></li>`)
                  .join("")}</ul>`
              : `<p class="muted small" style="margin:0">${
                  hasAny ? "보안·비용 점검 항목에 걸린 리소스가 없어요." : "리소스를 만들면 보안·비용 관점에서 자동으로 점검해드려요."
                }</p>`
          }
        </section>

        <section class="card">
          <div class="card-head"><h2>최근 활동</h2></div>
          ${
            activity.length
              ? `<ul class="feed">${activity
                  .map(
                    (e) => `<li>${tile(e.icon, "sm")}<div>
                      <div class="feed-text">${e.text}</div>
                      <div class="feed-meta">${e.sub ? esc(e.sub) + " · " : ""}${timeAgo(e.t)}</div>
                    </div></li>`
                  )
                  .join("")}</ul>`
              : `<p class="muted small" style="margin:0">아직 활동이 없어요. 첫 VPC를 만들어보세요.</p>`
          }
        </section>
      </aside>
    </div>
  `;

  // 생성 중/시작 중인 리소스가 있으면 상태가 바뀔 때까지 대시보드를 자동으로 새로고침
  const busy = d.instances.some((i) => TRANSITIONAL.includes(i.state)) || d.dbs.some((x) => TRANSITIONAL.includes(x.state));
  if (busy) {
    homeRefreshTimer = setTimeout(() => {
      if (parseHash().path === "/") renderHome().catch(() => {});
    }, 2000);
  }
}

/* ---- 아키텍처 다이어그램: 인터넷 → IGW → VPC → 가용 영역 → 서브넷 → 인스턴스 / DB / S3 ---- */
function buildArchDiagram(d) {
  const { vpcs, subnets, instances, buckets, dbs, igws } = d;
  if (!vpcs.length && !buckets.length) {
    return `<div class="dg-empty">${tile("vpc", "lg")}
      <p>아직 그릴 리소스가 없어요.<br />VPC를 만들면 이곳에 네트워크 구조가 나타나요.</p>
      <a class="btn primary sm" href="#/vpc/create">VPC 만들기</a>
    </div>`;
  }

  const nodeHtml = (ic, name, state, meta, title) =>
    `<div class="dg-node ${state ? "st-" + state : ""}" title="${esc(title || name)}">${tile(ic, "sm")}<span class="dg-node-name">${esc(name)}</span>${
      meta ? `<span class="dg-node-meta">${esc(meta)}</span>` : ""
    }${state ? `<span class="st-dot"></span>` : ""}</div>`;

  const vpcHtml = vpcs
    .map((vpc) => {
      const igw = igws.find((g) => g.vpcId === vpc.id && g.state === "attached");
      const vpcSubnets = subnets.filter((s) => s.vpcId === vpc.id);
      const azs = [...new Set(vpcSubnets.map((s) => s.availabilityZone))].sort();
      const vpcInstances = instances.filter((i) => i.vpcId === vpc.id && i.state !== "terminated");
      const vpcDbs = dbs.filter((x) => x.vpcId === vpc.id);

      const subnetHtml = (s) => {
        const insts = vpcInstances.filter((i) => i.subnetId === s.id);
        return `<div class="dg-subnet ${s.isPublic ? "public" : "private"}">
          <div class="dg-subnet-head"><span>${s.isPublic ? "퍼블릭" : "프라이빗"} 서브넷</span><code>${esc(s.cidrBlock)}</code></div>
          <div class="dg-subnet-name">${esc(s.name)}</div>
          <div class="dg-nodes">${
            insts.length
              ? insts.map((i) => nodeHtml("ec2", i.name, i.state, "", `${i.id} · ${i.instanceType}`)).join("")
              : `<div class="dg-slot">인스턴스 없음</div>`
          }</div>
        </div>`;
      };

      const azHtml = azs.length
        ? azs
            .map((az) => {
              const list = vpcSubnets.filter((s) => s.availabilityZone === az).sort((a, b) => Number(b.isPublic) - Number(a.isPublic));
              return `<div class="dg-az">
                <div class="dg-az-label">가용 영역 ${az.slice(-1).toUpperCase()}<span>${az}</span></div>
                ${list.map(subnetHtml).join("")}
              </div>`;
            })
            .join("")
        : `<div class="dg-slot wide">서브넷을 추가하면 가용 영역별로 나뉘어 표시돼요</div>`;

      const dbHtml = vpcDbs.length
        ? `<div class="dg-tier"><div class="dg-tier-label">데이터 계층</div><div class="dg-tier-nodes">${vpcDbs
            .map((x) => nodeHtml("rds", x.identifier, x.state, x.engine))
            .join("")}</div></div>`
        : "";

      return `<div class="dg-vpc-wrap">
        <div class="dg-internet ${igw ? "on" : "off"}">
          <div class="dg-pill">${icon("internet")}인터넷</div>
          <div class="dg-line"></div>
          ${igw ? `<div class="dg-igw">${tile("igw", "sm")}인터넷 게이트웨이</div>` : `<div class="dg-igw off">인터넷 게이트웨이 없음</div>`}
        </div>
        <div class="dg-vpc">
          <div class="dg-vpc-head">${tile("vpc", "sm")}<b>${esc(vpc.name)}</b><code>${esc(vpc.cidrBlock)}</code></div>
          <div class="dg-azs">${azHtml}</div>
          ${dbHtml}
        </div>
      </div>`;
    })
    .join("");

  const s3Html = buckets.length
    ? `<div class="dg-regional"><div class="dg-tier-label">리전 서비스 · VPC 외부 (HTTPS API로 접근)</div><div class="dg-tier-nodes">${buckets
        .map((b) => nodeHtml("s3", b.name, "", `객체 ${b.objectCount ?? 0}`))
        .join("")}</div></div>`
    : "";

  return `<div class="dg-region"><div class="dg-region-label">리전 · 아시아 태평양(서울) ap-northeast-2</div>${vpcHtml}${s3Html}</div>`;
}

/* ==================================================================
   실습 가이드
   ================================================================== */

async function renderGuide() {
  const d = await loadOverview();
  const j = computeJourney(d);
  document.getElementById("content").innerHTML = `
    <div class="guide-hero">
      <div>
        <div class="eyebrow">Learning Path</div>
        <h1 class="hero-title">3-Tier 웹 서비스 올리기</h1>
        <p>수업 워크숍 흐름 그대로, 네트워크를 먼저 깔고 그 위에 서버·스토리지·DB를 얹는 순서예요. 각 단계는 실제로 리소스를 만들면 자동으로 완료 처리돼요.</p>
      </div>
      <div class="card guide-progress">
        <div class="progress-meta" style="margin:0 0 8px"><span>진행률</span><b>${j.pct}%</b></div>
        <div class="progress"><div class="bar" style="width:${j.pct}%"></div></div>
        <div class="muted small" style="margin-top:8px">${j.doneCount} / ${j.steps.length} 단계 완료</div>
      </div>
    </div>
    <ol class="guide-list">
      ${j.steps
        .map(
          (s, i) => `<li class="card guide-item ${s.isDone ? "done" : s === j.current ? "current" : ""}">
            <span class="guide-num">${s.isDone ? icon("check") : i + 1}</span>
            ${tile(s.icon, "lg")}
            <div>
              <h3>${s.title}</h3>
              <p>${s.concept}</p>
              <div class="guide-goal">완료 조건 · <b>${s.goal}</b></div>
            </div>
            ${
              s.isDone
                ? `<span class="badge green"><span class="dot"></span>완료</span>`
                : `<a class="btn ${s === j.current ? "primary" : ""}" href="${s.href}">해보기</a>`
            }
          </li>`
        )
        .join("")}
    </ol>
  `;
}

/* ==================================================================
   리소스 검색
   ================================================================== */

async function renderSearch(q) {
  const d = await loadOverview();
  const all = [
    ...d.vpcs.map((v) => ({ icon: "vpc", type: "VPC", name: v.name, id: v.id, href: "#/vpc?tab=vpc" })),
    ...d.subnets.map((s) => ({ icon: "subnet", type: "서브넷", name: s.name, id: s.id, href: "#/vpc?tab=subnets" })),
    ...d.routeTables.map((r) => ({ icon: "route", type: "라우팅 테이블", name: r.name, id: r.id, href: `#/vpc/routetables/detail?id=${r.id}` })),
    ...d.igws.map((g) => ({ icon: "igw", type: "인터넷 게이트웨이", name: g.name, id: g.id, href: "#/vpc?tab=igw" })),
    ...d.sgs.map((s) => ({ icon: "sg", type: "보안 그룹", name: s.name, id: s.id, href: `#/vpc/sg/detail?id=${s.id}` })),
    ...d.nacls.map((n) => ({ icon: "nacl", type: "네트워크 ACL", name: n.name, id: n.id, href: `#/vpc/nacl/detail?id=${n.id}` })),
    ...d.instances.map((i) => ({ icon: "ec2", type: "EC2 인스턴스", name: i.name, id: i.id, href: "#/ec2", state: i.state })),
    ...d.volumes.map((v) => ({ icon: "volume", type: "EBS 볼륨", name: v.name, id: v.id, href: "#/ec2?tab=volumes", state: v.state })),
    ...d.buckets.map((b) => ({ icon: "s3", type: "S3 버킷", name: b.name, id: b.region, href: `#/s3/bucket?name=${encodeURIComponent(b.name)}` })),
    ...d.dbs.map((x) => ({ icon: "rds", type: "RDS", name: x.identifier, id: x.id, href: "#/rds", state: x.state })),
  ];
  const ql = q.trim().toLowerCase();
  const hits = ql
    ? all.filter((r) => [r.name, r.id, r.type].some((f) => String(f || "").toLowerCase().includes(ql)))
    : all;
  const input = document.getElementById("search-input");
  if (input && input.value !== q) input.value = q;

  document.getElementById("content").innerHTML = `
    <h1 class="page-title">${ql ? `‘${esc(q)}’ 검색 결과` : "전체 리소스"}</h1>
    <p class="page-desc">${hits.length}개 리소스 · 이름, ID, 리소스 종류로 검색할 수 있어요.</p>
    ${
      hits.length
        ? `<div class="card"><ul class="result-list">${hits
            .map(
              (r) => `<li><a href="${r.href}">${tile(r.icon, "sm")}<span class="result-type">${r.type}</span>
                <span class="result-name">${esc(r.name)}</span><code>${esc(r.id)}</code>${r.state ? badge(r.state) : ""}</a></li>`
            )
            .join("")}</ul></div>`
        : emptyState("일치하는 리소스가 없어요", "다른 이름이나 ID로 검색해보세요.")
    }
  `;
}

/* ==================================================================
   VPC 서비스
   ================================================================== */

// 하위 메뉴는 좌측 사이드바가 담당하고, 여기서는 화면별 제목/설명만 정의
const VPC_TABS = [
  { key: "vpc", label: "내 VPC", icon: "vpc", desc: "AWS 안의 나만의 격리된 네트워크예요. VPC를 만들면 메인 라우팅 테이블이 함께 생겨요." },
  { key: "subnets", label: "서브넷", icon: "subnet", desc: "VPC를 가용 영역별로 나눈 구역이에요. 연결된 라우팅 테이블에 따라 퍼블릭/프라이빗이 정해져요." },
  { key: "routetables", label: "라우팅 테이블", icon: "route", desc: "서브넷의 트래픽이 어디로 나갈지 정하는 규칙표예요. 0.0.0.0/0 → igw 라우트가 있으면 퍼블릭이 돼요." },
  { key: "sg", label: "보안 그룹", icon: "sg", desc: "인스턴스 단위 방화벽(Stateful)이에요. 허용 규칙만 있고, 들어온 요청의 응답은 자동으로 나갈 수 있어요." },
  { key: "nacl", label: "네트워크 ACL", icon: "nacl", desc: "서브넷 경계의 방화벽(Stateless)이에요. 규칙 번호 순서대로 평가하고, 거부 규칙도 둘 수 있어요." },
  { key: "igw", label: "인터넷 게이트웨이", icon: "igw", desc: "VPC와 인터넷을 잇는 관문이에요. 생성 → VPC에 연결 → 라우팅 테이블에 라우트 추가 순서로 설정해요." },
];

function vpcTabsHtml() {
  return "";
}

async function renderVpcList(tab) {
  const vpcs = await api.get("/api/vpcs");
  const tabs = vpcTabsHtml(tab);
  const tabInfo = VPC_TABS.find((t) => t.key === tab) || VPC_TABS[0];
  const vpcName = (id) => (vpcs.find((v) => v.id === id) || {}).name || id;

  let body = "";
  if (tab === "vpc") {
    body = vpcs.length
      ? `<table><thead><tr><th>이름</th><th>VPC ID</th><th>CIDR</th><th>상태</th><th></th></tr></thead><tbody>
          ${vpcs
            .map(
              (v) => `<tr>
                <td>${esc(v.name)}</td><td><code class="mono">${v.id}</code></td>
                <td>${esc(v.cidrBlock)}</td><td>${badge(v.state)}</td>
                <td><button data-del-vpc="${v.id}" class="danger">삭제</button></td>
              </tr>`
            )
            .join("")}
        </tbody></table>`
      : emptyState("아직 VPC가 없어요", "VPC를 만들면 그 안에 EC2, 서브넷, 보안 그룹을 배치할 수 있어요.");
    body = `<div class="toolbar"><div></div><a class="btn primary" href="#/vpc/create">VPC 생성</a></div>` + body;
  } else if (tab === "subnets") {
    const subnets = await api.get("/api/subnets");
    body = subnets.length
      ? `<table><thead><tr><th>이름</th><th>서브넷 ID</th><th>VPC</th><th>CIDR</th><th>가용 영역</th><th>구분</th><th></th></tr></thead><tbody>
          ${subnets
            .map(
              (s) => `<tr>
                <td>${esc(s.name)}</td><td><code class="mono">${s.id}</code></td>
                <td>${esc(vpcName(s.vpcId))}</td><td>${esc(s.cidrBlock)}</td><td>${s.availabilityZone}</td>
                <td><span class="net-tag ${s.isPublic ? "public" : "private"}">${s.isPublic ? "퍼블릭" : "프라이빗"}</span></td>
                <td><button data-del-subnet="${s.id}" class="danger">삭제</button></td>
              </tr>`
            )
            .join("")}
        </tbody></table>`
      : emptyState("아직 서브넷이 없어요", "먼저 VPC를 만든 뒤, 그 VPC 안에 서브넷을 추가하세요.");
    const createBtn = vpcs.length
      ? `<a class="btn primary" href="#/vpc/subnets/create?vpcId=${vpcs[0].id}">서브넷 생성</a>`
      : `<button class="primary" disabled title="먼저 VPC를 만드세요">서브넷 생성</button>`;
    body = `<div class="toolbar"><div></div>${createBtn}</div>` + body;
  } else if (tab === "routetables") {
    const tables = await api.get("/api/route-tables");
    body = tables.length
      ? `<table><thead><tr><th>이름</th><th>라우팅 테이블 ID</th><th>VPC</th><th>연결된 서브넷</th><th></th></tr></thead><tbody>
          ${tables
            .map(
              (rt) => `<tr class="clickable" data-open-rt="${rt.id}">
                <td>${esc(rt.name)}${rt.isMain ? '<span class="main-badge">메인</span>' : ""}</td>
                <td><code class="mono">${rt.id}</code></td><td>${esc(vpcName(rt.vpcId))}</td><td>${rt.subnetIds.length}개</td>
                <td></td>
              </tr>`
            )
            .join("")}
        </tbody></table>`
      : emptyState("라우팅 테이블이 없어요", "VPC를 만들면 메인 라우팅 테이블이 자동으로 함께 생깁니다.");
    const createBtn = vpcs.length
      ? `<a class="btn primary" href="#/vpc/routetables/create?vpcId=${vpcs[0].id}">라우팅 테이블 생성</a>`
      : `<button class="primary" disabled>라우팅 테이블 생성</button>`;
    body = `<div class="toolbar"><div></div>${createBtn}</div>` + body;
  } else if (tab === "sg") {
    const sgs = await api.get("/api/security-groups");
    body = sgs.length
      ? `<table><thead><tr><th>이름</th><th>보안 그룹 ID</th><th>VPC</th><th>인바운드 규칙</th><th></th></tr></thead><tbody>
          ${sgs
            .map(
              (sg) => `<tr class="clickable" data-open-sg="${sg.id}">
                <td>${esc(sg.name)}</td><td><code class="mono">${sg.id}</code></td>
                <td>${esc(vpcName(sg.vpcId))}</td><td>${sg.inboundRules.length}개</td>
                <td><button data-del-sg="${sg.id}" class="danger">삭제</button></td>
              </tr>`
            )
            .join("")}
        </tbody></table>`
      : emptyState("아직 보안 그룹이 없어요", "보안 그룹은 인스턴스 단위 방화벽입니다 (Stateful).");
    const createBtn = vpcs.length
      ? `<a class="btn primary" href="#/vpc/sg/create?vpcId=${vpcs[0].id}">보안 그룹 생성</a>`
      : `<button class="primary" disabled>보안 그룹 생성</button>`;
    body = `<div class="toolbar"><div></div>${createBtn}</div>` + body;
  } else if (tab === "nacl") {
    const nacls = await api.get("/api/nacls");
    body = nacls.length
      ? `<table><thead><tr><th>이름</th><th>ACL ID</th><th>VPC</th><th>규칙 수</th><th>연결된 서브넷</th><th></th></tr></thead><tbody>
          ${nacls
            .map(
              (n) => `<tr class="clickable" data-open-nacl="${n.id}">
                <td>${esc(n.name)}</td><td><code class="mono">${n.id}</code></td>
                <td>${esc(vpcName(n.vpcId))}</td><td>${n.rules.length}개</td><td>${n.subnetIds.length}개</td>
                <td></td>
              </tr>`
            )
            .join("")}
        </tbody></table>`
      : emptyState("네트워크 ACL이 없어요", "서브넷 경계에서 동작하는 Stateless 방화벽입니다. 규칙이 없으면 기본적으로 모두 차단돼요.");
    const createBtn = vpcs.length
      ? `<a class="btn primary" href="#/vpc/nacl/create?vpcId=${vpcs[0].id}">네트워크 ACL 생성</a>`
      : `<button class="primary" disabled>네트워크 ACL 생성</button>`;
    body = `<div class="toolbar"><div></div>${createBtn}</div>` + body;
  } else if (tab === "igw") {
    const igws = await api.get("/api/internet-gateways");
    body = igws.length
      ? `<table><thead><tr><th>이름</th><th>게이트웨이 ID</th><th>상태</th><th>연결된 VPC</th><th></th></tr></thead><tbody>
          ${igws
            .map((g) => {
              let actions;
              if (g.state === "attached") {
                actions = `<button data-detach-igw="${g.id}">분리</button>`;
              } else {
                const opts = vpcs.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join("");
                actions = vpcs.length
                  ? `<select id="attach-vpc-${g.id}" style="padding:4px">${opts}</select> <button data-attach-igw="${g.id}">VPC에 연결</button> <button data-del-igw="${g.id}" class="danger">삭제</button>`
                  : `<button data-del-igw="${g.id}" class="danger">삭제</button>`;
              }
              return `<tr><td>${esc(g.name)}</td><td><code class="mono">${g.id}</code></td><td>${badge(g.state)}</td><td>${g.vpcId ? esc(vpcName(g.vpcId)) : "-"}</td><td>${actions}</td></tr>`;
            })
            .join("")}
        </tbody></table>`
      : emptyState("인터넷 게이트웨이가 없어요", "VPC가 외부 인터넷과 통신하려면 인터넷 게이트웨이를 만들고 연결해야 해요.");
    body = `<div class="toolbar"><div></div><button class="primary" id="create-igw">인터넷 게이트웨이 생성</button></div>` + body;
  }

  document.getElementById("content").innerHTML = `
    <h1 class="page-title">${icon(tabInfo.icon)}${tabInfo.label}</h1>
    <p class="page-desc">${tabInfo.desc}</p>
    ${tabs}${body}
  `;

  document.querySelectorAll("[data-del-vpc]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await api.del(`/api/vpcs/${btn.dataset.delVpc}`);
        toast("VPC를 삭제했습니다.");
        router();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
  document.querySelectorAll("[data-del-subnet]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.del(`/api/subnets/${btn.dataset.delSubnet}`);
      toast("서브넷을 삭제했습니다.");
      router();
    })
  );
  document.querySelectorAll("[data-del-sg]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await api.del(`/api/security-groups/${btn.dataset.delSg}`);
      toast("보안 그룹을 삭제했습니다.");
      router();
    })
  );
  document.querySelectorAll("[data-open-sg]").forEach((row) =>
    row.addEventListener("click", () => (location.hash = `#/vpc/sg/detail?id=${row.dataset.openSg}`))
  );
  document.querySelectorAll("[data-open-rt]").forEach((row) =>
    row.addEventListener("click", () => (location.hash = `#/vpc/routetables/detail?id=${row.dataset.openRt}`))
  );
  document.querySelectorAll("[data-open-nacl]").forEach((row) =>
    row.addEventListener("click", () => (location.hash = `#/vpc/nacl/detail?id=${row.dataset.openNacl}`))
  );
  const createIgwBtn = document.getElementById("create-igw");
  if (createIgwBtn)
    createIgwBtn.addEventListener("click", async () => {
      await api.post("/api/internet-gateways", { name: `igw-${Date.now().toString(16)}` });
      toast("인터넷 게이트웨이를 생성했습니다. 이제 VPC에 연결해보세요.");
      router();
    });
  document.querySelectorAll("[data-attach-igw]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const vpcId = document.getElementById(`attach-vpc-${btn.dataset.attachIgw}`).value;
      try {
        await api.post(`/api/internet-gateways/${btn.dataset.attachIgw}/attach`, { vpcId });
        toast("VPC에 연결했습니다.");
        router();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
  document.querySelectorAll("[data-detach-igw]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.post(`/api/internet-gateways/${btn.dataset.detachIgw}/detach`);
      toast("분리했습니다.");
      router();
    })
  );
  document.querySelectorAll("[data-del-igw]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await api.del(`/api/internet-gateways/${btn.dataset.delIgw}`);
        toast("삭제했습니다.");
        router();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
}

function emptyState(title, desc) {
  return `<div class="empty-state"><div class="big">${title}</div><div>${desc}</div></div>`;
}

async function renderVpcCreate() {
  document.getElementById("content").innerHTML = `
    <h1 class="page-title">VPC 생성</h1>
    <div class="form-section">
      <h2>VPC 설정</h2>
      <p class="hint">실제 AWS 콘솔의 "VPC 생성" 화면과 같은 항목입니다.</p>
      <div id="err"></div>
      <div class="field">
        <label>이름 태그</label>
        <input type="text" id="f-name" placeholder="예: my-website-vpc" />
      </div>
      <div class="field">
        <label>IPv4 CIDR 블록</label>
        <input type="text" id="f-cidr" value="10.0.0.0/16" />
        <div class="field-hint">이 범위 안에서 서브넷을 나누게 됩니다. 서브넷마다 앞 4개 + 마지막 1개, 총 5개의 IP는 AWS가 예약해서 실제 쓸 수 있는 건 조금 더 적어요.</div>
      </div>
    </div>
    <div class="form-actions">
      <a class="btn" href="#/vpc">취소</a>
      <button class="primary" id="submit">VPC 생성</button>
    </div>
  `;
  document.getElementById("submit").addEventListener("click", async () => {
    try {
      await api.post("/api/vpcs", { name: val("f-name"), cidrBlock: val("f-cidr") });
      toast("VPC를 생성했습니다. (메인 라우팅 테이블도 함께 생성됨)");
      location.hash = "#/vpc";
    } catch (e) {
      showErr(e.message);
    }
  });
}

async function renderSubnetCreate(defaultVpcId) {
  const vpcs = await api.get("/api/vpcs");
  document.getElementById("content").innerHTML = `
    <h1 class="page-title">서브넷 생성</h1>
    <div class="form-section">
      <h2>서브넷 설정</h2>
      <div id="err"></div>
      <div class="field">
        <label>VPC 선택</label>
        <select id="f-vpc">${vpcs.map((v) => `<option value="${v.id}" ${v.id === defaultVpcId ? "selected" : ""}>${esc(v.name)} (${v.id})</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>이름 태그</label>
        <input type="text" id="f-name" placeholder="예: my-website-subnet-a" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>가용 영역</label>
          <select id="f-az">
            <option value="ap-northeast-2a">ap-northeast-2a</option>
            <option value="ap-northeast-2b">ap-northeast-2b</option>
            <option value="ap-northeast-2c">ap-northeast-2c</option>
          </select>
        </div>
        <div class="field">
          <label>IPv4 CIDR 블록</label>
          <input type="text" id="f-cidr" value="10.0.0.0/24" />
        </div>
      </div>
      <div class="field-hint">만들면 일단 VPC의 메인 라우팅 테이블에 연결돼요. 인터넷 게이트웨이로 가는 라우팅 테이블에 연결해야 "퍼블릭 서브넷"이 됩니다 (라우팅 테이블 메뉴에서 설정).</div>
    </div>
    <div class="form-actions">
      <a class="btn" href="#/vpc?tab=subnets">취소</a>
      <button class="primary" id="submit">서브넷 생성</button>
    </div>
  `;
  document.getElementById("submit").addEventListener("click", async () => {
    try {
      await api.post("/api/subnets", {
        vpcId: val("f-vpc"),
        name: val("f-name"),
        cidrBlock: val("f-cidr"),
        availabilityZone: val("f-az"),
      });
      toast("서브넷을 생성했습니다.");
      location.hash = "#/vpc?tab=subnets";
    } catch (e) {
      showErr(e.message);
    }
  });
}

/* ---- 라우팅 테이블 ---- */

async function renderRouteTableCreate(defaultVpcId) {
  const vpcs = await api.get("/api/vpcs");
  document.getElementById("content").innerHTML = `
    <h1 class="page-title">라우팅 테이블 생성</h1>
    <div class="form-section">
      <div id="err"></div>
      <div class="field">
        <label>VPC 선택</label>
        <select id="f-vpc">${vpcs.map((v) => `<option value="${v.id}" ${v.id === defaultVpcId ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
      </div>
      <div class="field"><label>이름 태그</label><input type="text" id="f-name" placeholder="예: public-rtb" /></div>
      <div class="field-hint">생성하면 VPC 내부 통신을 위한 local 라우트가 자동으로 하나 들어가 있어요.</div>
    </div>
    <div class="form-actions">
      <a class="btn" href="#/vpc?tab=routetables">취소</a>
      <button class="primary" id="submit">생성</button>
    </div>
  `;
  document.getElementById("submit").addEventListener("click", async () => {
    try {
      const rt = await api.post("/api/route-tables", { vpcId: val("f-vpc"), name: val("f-name") });
      toast("라우팅 테이블을 생성했습니다.");
      location.hash = `#/vpc/routetables/detail?id=${rt.id}`;
    } catch (e) {
      showErr(e.message);
    }
  });
}

async function renderRouteTableDetail(id) {
  const [tables, subnets, igws] = await Promise.all([api.get("/api/route-tables"), api.get("/api/subnets"), api.get("/api/internet-gateways")]);
  const rt = tables.find((r) => r.id === id);
  if (!rt) return (document.getElementById("content").innerHTML = emptyState("라우팅 테이블을 찾을 수 없어요", ""));

  const vpcIgws = igws.filter((g) => g.vpcId === rt.vpcId);
  const unassociated = subnets.filter((s) => s.vpcId === rt.vpcId && !rt.subnetIds.includes(s.id));
  const associated = subnets.filter((s) => rt.subnetIds.includes(s.id));

  document.getElementById("content").innerHTML = `
    <h1 class="page-title">${esc(rt.name)}${rt.isMain ? '<span class="main-badge">메인</span>' : ""}</h1>
    <p class="page-desc"><code class="mono">${rt.id}</code></p>

    <div class="form-section">
      <h2>라우트</h2>
      <table><thead><tr><th>대상(Destination)</th><th>타깃(Target)</th><th></th></tr></thead><tbody>
        ${rt.routes
          .map(
            (r) =>
              `<tr><td>${esc(r.destination)}</td><td class="route-target">${esc(r.target)}</td><td>${r.target === "local" ? "" : `<button data-del-route="${r.id}" class="danger">삭제</button>`}</td></tr>`
          )
          .join("")}
      </tbody></table>
      <div class="rule-row" style="margin-top:14px">
        <input type="text" id="r-dest" placeholder="대상 CIDR (예: 0.0.0.0/0)" style="width:180px" />
        <select id="r-target">
          <option value="">-- 타깃 선택 --</option>
          ${vpcIgws.map((g) => `<option value="${g.id}">${g.id} (인터넷 게이트웨이)</option>`).join("")}
        </select>
        <button id="add-route">라우트 추가</button>
      </div>
      ${!vpcIgws.length ? `<div class="field-hint">이 VPC에 연결된 인터넷 게이트웨이가 없어요. <a href="#/vpc?tab=igw">먼저 만들고 연결하세요</a>.</div>` : ""}
    </div>

    <div class="form-section">
      <h2>서브넷 연결</h2>
      <p class="hint">여기 연결된 서브넷은 이 테이블의 라우트를 따릅니다. 0.0.0.0/0 → igw 라우트가 있으면 그 서브넷은 "퍼블릭"이 돼요.</p>
      <ul>${associated.map((s) => `<li>${esc(s.name)} (${s.availabilityZone})</li>`).join("") || "<li>없음</li>"}</ul>
      ${
        unassociated.length
          ? `<div class="rule-row"><select id="assoc-subnet">${unassociated.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select><button id="assoc-btn">연결</button></div>`
          : ""
      }
    </div>
    <a class="btn" href="#/vpc?tab=routetables">← 목록으로</a>
  `;

  document.getElementById("add-route").addEventListener("click", async () => {
    const target = val("r-target");
    if (!target) return toast("타깃을 선택하세요.", true);
    await api.post(`/api/route-tables/${rt.id}/routes`, { destination: val("r-dest"), target });
    toast("라우트를 추가했습니다.");
    renderRouteTableDetail(id);
  });
  document.querySelectorAll("[data-del-route]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.del(`/api/route-tables/${rt.id}/routes/${btn.dataset.delRoute}`);
      renderRouteTableDetail(id);
    })
  );
  const assocBtn = document.getElementById("assoc-btn");
  if (assocBtn)
    assocBtn.addEventListener("click", async () => {
      await api.post(`/api/route-tables/${rt.id}/associate`, { subnetId: val("assoc-subnet") });
      toast("서브넷을 연결했습니다.");
      renderRouteTableDetail(id);
    });
}

/* ---- 보안 그룹 ---- */

async function renderSgCreate(defaultVpcId) {
  const vpcs = await api.get("/api/vpcs");
  document.getElementById("content").innerHTML = `
    <h1 class="page-title">보안 그룹 생성</h1>
    <div class="form-section">
      <h2>기본 정보</h2>
      <div id="err"></div>
      <div class="field">
        <label>VPC 선택</label>
        <select id="f-vpc">${vpcs.map((v) => `<option value="${v.id}" ${v.id === defaultVpcId ? "selected" : ""}>${esc(v.name)} (${v.id})</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>보안 그룹 이름</label>
        <input type="text" id="f-name" placeholder="예: my-website-sg" />
      </div>
      <div class="field">
        <label>설명</label>
        <input type="text" id="f-desc" placeholder="예: 웹 서버용 80/443 포트 개방" />
      </div>
      <div class="field-hint">보안 그룹은 Stateful이라, 인바운드를 허용하면 그에 대한 응답(아웃바운드)은 자동으로 허용돼요. 인바운드 규칙은 생성 후 추가합니다.</div>
    </div>
    <div class="form-actions">
      <a class="btn" href="#/vpc?tab=sg">취소</a>
      <button class="primary" id="submit">보안 그룹 생성</button>
    </div>
  `;
  document.getElementById("submit").addEventListener("click", async () => {
    try {
      const sg = await api.post("/api/security-groups", { vpcId: val("f-vpc"), name: val("f-name"), description: val("f-desc") });
      toast("보안 그룹을 생성했습니다.");
      location.hash = `#/vpc/sg/detail?id=${sg.id}`;
    } catch (e) {
      showErr(e.message);
    }
  });
}

async function renderSgDetail(id) {
  const sgs = await api.get("/api/security-groups");
  const sg = sgs.find((s) => s.id === id);
  if (!sg) return (document.getElementById("content").innerHTML = emptyState("보안 그룹을 찾을 수 없어요", ""));

  document.getElementById("content").innerHTML = `
    <h1 class="page-title">${esc(sg.name)}</h1>
    <p class="page-desc"><code class="mono">${sg.id}</code> · VPC <code class="mono">${sg.vpcId}</code> · Stateful (인스턴스 단위)</p>
    <div class="form-section">
      <h2>인바운드 규칙</h2>
      <p class="hint">이 보안 그룹을 쓰는 인스턴스로 들어오는 트래픽 중 어떤 것을 허용할지 정합니다.</p>
      ${
        sg.inboundRules.length
          ? `<table><thead><tr><th>프로토콜</th><th>포트</th><th>소스</th><th></th></tr></thead><tbody>
              ${sg.inboundRules
                .map(
                  (r) =>
                    `<tr><td>${r.protocol.toUpperCase()}</td><td>${r.port}</td><td>${esc(r.source)}</td><td><button data-del-rule="${r.id}" class="danger">삭제</button></td></tr>`
                )
                .join("")}
            </tbody></table>`
          : `<p class="hint">아직 규칙이 없어요. 기본값은 모든 인바운드 트래픽 차단입니다.</p>`
      }
      <div class="rule-row" style="margin-top:14px">
        <select id="r-proto"><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option></select>
        <input type="number" id="r-port" placeholder="포트 (예: 80)" style="width:120px" />
        <input type="text" id="r-source" placeholder="소스 (예: 0.0.0.0/0)" value="0.0.0.0/0" style="width:160px" />
        <button id="add-rule">규칙 추가</button>
      </div>
    </div>
    <a class="btn" href="#/vpc?tab=sg">← 목록으로</a>
  `;

  document.getElementById("add-rule").addEventListener("click", async () => {
    await api.post(`/api/security-groups/${sg.id}/rules`, { protocol: val("r-proto"), port: val("r-port"), source: val("r-source") });
    toast("규칙을 추가했습니다.");
    renderSgDetail(id);
  });
  document.querySelectorAll("[data-del-rule]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.del(`/api/security-groups/${sg.id}/rules/${btn.dataset.delRule}`);
      toast("규칙을 삭제했습니다.");
      renderSgDetail(id);
    })
  );
}

/* ---- 네트워크 ACL ---- */

async function renderNaclCreate(defaultVpcId) {
  const vpcs = await api.get("/api/vpcs");
  document.getElementById("content").innerHTML = `
    <h1 class="page-title">네트워크 ACL 생성</h1>
    <div class="form-section">
      <div id="err"></div>
      <div class="field">
        <label>VPC 선택</label>
        <select id="f-vpc">${vpcs.map((v) => `<option value="${v.id}" ${v.id === defaultVpcId ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
      </div>
      <div class="field"><label>이름 태그</label><input type="text" id="f-name" placeholder="예: public-nacl" /></div>
      <div class="field-hint">보안 그룹과 달리 Stateless입니다. 응답 트래픽도 별도 아웃바운드 규칙으로 허용해야 해요. 규칙이 없으면 기본적으로 전부 차단됩니다.</div>
    </div>
    <div class="form-actions">
      <a class="btn" href="#/vpc?tab=nacl">취소</a>
      <button class="primary" id="submit">생성</button>
    </div>
  `;
  document.getElementById("submit").addEventListener("click", async () => {
    try {
      const nacl = await api.post("/api/nacls", { vpcId: val("f-vpc"), name: val("f-name") });
      toast("네트워크 ACL을 생성했습니다.");
      location.hash = `#/vpc/nacl/detail?id=${nacl.id}`;
    } catch (e) {
      showErr(e.message);
    }
  });
}

async function renderNaclDetail(id) {
  const [nacls, subnets] = await Promise.all([api.get("/api/nacls"), api.get("/api/subnets")]);
  const nacl = nacls.find((n) => n.id === id);
  if (!nacl) return (document.getElementById("content").innerHTML = emptyState("네트워크 ACL을 찾을 수 없어요", ""));

  const unassociated = subnets.filter((s) => s.vpcId === nacl.vpcId && !nacl.subnetIds.includes(s.id));
  const associated = subnets.filter((s) => nacl.subnetIds.includes(s.id));

  function rulesTable(dir) {
    const rules = nacl.rules.filter((r) => r.direction === dir);
    if (!rules.length) return `<p class="hint">규칙 없음 (기본 차단)</p>`;
    return `<table><thead><tr><th>규칙 번호</th><th>프로토콜</th><th>포트</th><th>CIDR</th><th>동작</th><th></th></tr></thead><tbody>
      ${rules
        .map(
          (r) =>
            `<tr><td>${r.ruleNumber}</td><td>${r.protocol.toUpperCase()}</td><td>${r.port ?? "전체"}</td><td>${esc(r.cidr)}</td>
              <td><span class="badge ${r.action === "allow" ? "green" : "red"}">${r.action === "allow" ? "허용" : "거부"}</span></td>
              <td><button data-del-nrule="${r.id}" class="danger">삭제</button></td></tr>`
        )
        .join("")}
    </tbody></table>`;
  }

  document.getElementById("content").innerHTML = `
    <h1 class="page-title">${esc(nacl.name)}</h1>
    <p class="page-desc"><code class="mono">${nacl.id}</code> · Stateless (서브넷 경계 단위) · 규칙 번호가 낮은 순서대로 평가</p>

    <div class="form-section">
      <h2>인바운드 규칙</h2>
      ${rulesTable("inbound")}
      ${naclRuleForm("inbound")}
    </div>
    <div class="form-section">
      <h2>아웃바운드 규칙</h2>
      ${rulesTable("outbound")}
      ${naclRuleForm("outbound")}
    </div>
    <div class="form-section">
      <h2>서브넷 연결</h2>
      <ul>${associated.map((s) => `<li>${esc(s.name)}</li>`).join("") || "<li>없음</li>"}</ul>
      ${
        unassociated.length
          ? `<div class="rule-row"><select id="assoc-subnet">${unassociated.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select><button id="assoc-btn">연결</button></div>`
          : ""
      }
    </div>
    <a class="btn" href="#/vpc?tab=nacl">← 목록으로</a>
  `;

  function naclRuleForm(dir) {
    return `<div class="rule-row" data-dir="${dir}">
      <input type="number" class="r-num" placeholder="규칙 번호" value="100" style="width:90px" />
      <select class="r-proto"><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option></select>
      <input type="number" class="r-port" placeholder="포트" style="width:80px" />
      <input type="text" class="r-cidr" placeholder="CIDR" value="0.0.0.0/0" style="width:140px" />
      <select class="r-action"><option value="allow">허용</option><option value="deny">거부</option></select>
      <button class="add-nrule" data-dir="${dir}">규칙 추가</button>
    </div>`;
  }

  document.querySelectorAll(".add-nrule").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const row = btn.closest(".rule-row");
      await api.post(`/api/nacls/${nacl.id}/rules`, {
        direction: btn.dataset.dir,
        ruleNumber: row.querySelector(".r-num").value,
        protocol: row.querySelector(".r-proto").value,
        port: row.querySelector(".r-port").value,
        cidr: row.querySelector(".r-cidr").value,
        action: row.querySelector(".r-action").value,
      });
      toast("규칙을 추가했습니다.");
      renderNaclDetail(id);
    })
  );
  document.querySelectorAll("[data-del-nrule]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.del(`/api/nacls/${nacl.id}/rules/${btn.dataset.delNrule}`);
      renderNaclDetail(id);
    })
  );
  const assocBtn = document.getElementById("assoc-btn");
  if (assocBtn)
    assocBtn.addEventListener("click", async () => {
      await api.post(`/api/nacls/${nacl.id}/associate`, { subnetId: val("assoc-subnet") });
      toast("서브넷을 연결했습니다.");
      renderNaclDetail(id);
    });
}

/* ==================================================================
   EC2 서비스 (인스턴스 + EBS 볼륨)
   ================================================================== */

const EC2_TABS = [
  { key: "instances", label: "인스턴스" },
  { key: "volumes", label: "볼륨 (EBS)" },
];

async function renderEc2List(tab) {
  const tabsHtml = ""; // 하위 메뉴는 좌측 사이드바에서 선택

  if (tab === "volumes") return renderVolumesTab(tabsHtml);

  const instances = await api.get("/api/instances");
  const body = instances.length
    ? `<table><thead><tr><th>이름</th><th>인스턴스 ID</th><th>유형</th><th>구매 옵션</th><th>상태</th><th>퍼블릭 IP</th><th></th></tr></thead><tbody>
        ${instances
          .map(
            (i) => `<tr>
              <td>${esc(i.name)}</td><td><code class="mono">${i.id}</code></td><td>${i.instanceType}</td>
              <td>${i.purchasingOption === "spot" ? "스팟" : "온디맨드"}</td>
              <td>${badge(i.state)}</td><td>${i.publicIp || "-"}</td>
              <td>${ec2Actions(i)}</td>
            </tr>`
          )
          .join("")}
      </tbody></table>`
    : emptyState("실행 중인 인스턴스가 없어요", "인스턴스를 시작해서 우리 웹 서버 자리를 만들어보세요.");

  document.getElementById("content").innerHTML = `
    <h1 class="page-title">${icon("ec2")}인스턴스</h1>
    <p class="page-desc">가상 서버입니다. 시작하면 잠시 "대기 중" 상태였다가 "실행 중"으로 바뀌어요 (실제 AWS와 동일한 흐름).</p>
    ${tabsHtml}
    <div class="toolbar"><div></div><a class="btn primary" href="#/ec2/launch">인스턴스 시작</a></div>
    ${body}
  `;

  document.querySelectorAll("[data-stop]").forEach((b) => b.addEventListener("click", () => act(`/api/instances/${b.dataset.stop}/stop`)));
  document.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => act(`/api/instances/${b.dataset.start}/start`)));
  document.querySelectorAll("[data-term]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("인스턴스를 종료하시겠어요? 종료된 인스턴스는 되돌릴 수 없습니다.")) return;
      await api.del(`/api/instances/${b.dataset.term}`);
      toast("인스턴스를 종료하는 중입니다.");
      router();
      setTimeout(router, 3200);
    })
  );

  async function act(url) {
    await api.post(url);
    toast("요청을 보냈습니다. 상태가 곧 바뀝니다.");
    router();
    setTimeout(router, 4200);
  }
}

function ec2Actions(i) {
  if (i.state === "running") return `<button data-stop="${i.id}">중지</button> <button data-term="${i.id}" class="danger">종료</button>`;
  if (i.state === "stopped") return `<button data-start="${i.id}">시작</button> <button data-term="${i.id}" class="danger">종료</button>`;
  if (i.state === "terminated") return `-`;
  return `<button disabled>처리 중...</button>`;
}

async function renderVolumesTab(tabsHtml) {
  const [volumes, instances] = await Promise.all([api.get("/api/volumes"), api.get("/api/instances")]);
  const instName = (id) => (instances.find((i) => i.id === id) || {}).name;

  const body = volumes.length
    ? `<table><thead><tr><th>이름</th><th>볼륨 ID</th><th>크기</th><th>유형</th><th>AZ</th><th>상태</th><th>연결된 인스턴스</th><th></th></tr></thead><tbody>
        ${volumes
          .map(
            (v) => `<tr>
              <td>${esc(v.name)}${v.isRoot ? '<span class="main-badge">루트</span>' : ""}</td>
              <td><code class="mono">${v.id}</code></td><td>${v.size} GiB</td><td>${v.type}</td><td>${v.availabilityZone}</td>
              <td>${badge(v.state)}</td><td>${v.attachedInstanceId ? esc(instName(v.attachedInstanceId) || v.attachedInstanceId) : "-"}</td>
              <td>${volumeActions(v, instances)}</td>
            </tr>`
          )
          .join("")}
      </tbody></table>`
    : emptyState("EBS 볼륨이 없어요", "인스턴스를 시작하면 루트 볼륨이 자동으로 생기고, 추가 볼륨도 직접 만들 수 있어요.");

  document.getElementById("content").innerHTML = `
    <h1 class="page-title">${icon("volume")}볼륨 (EBS)</h1>
    <p class="page-desc">EBS는 인스턴스에 네트워크로 붙는 영구 블록 스토리지입니다. 인스턴스를 중지해도 데이터가 남아있어요.</p>
    ${tabsHtml}
    <div class="toolbar"><div></div><a class="btn primary" href="#/ec2/volumes/create">볼륨 생성</a></div>
    ${body}
  `;

  document.querySelectorAll("[data-attach-vol]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const instanceId = document.getElementById(`attach-inst-${btn.dataset.attachVol}`).value;
      try {
        await api.post(`/api/volumes/${btn.dataset.attachVol}/attach`, { instanceId });
        toast("인스턴스에 연결했습니다.");
        router();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
  document.querySelectorAll("[data-detach-vol]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await api.post(`/api/volumes/${btn.dataset.detachVol}/detach`);
        toast("분리했습니다.");
        router();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
  document.querySelectorAll("[data-snap-vol]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const desc = prompt("스냅샷 설명을 입력하세요 (선택)", "") || "";
      await api.post(`/api/volumes/${btn.dataset.snapVol}/snapshot`, { description: desc });
      toast("스냅샷을 생성했습니다 (S3에 증분 백업).");
    })
  );
  document.querySelectorAll("[data-del-vol]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await api.del(`/api/volumes/${btn.dataset.delVol}`);
        toast("볼륨을 삭제했습니다.");
        router();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
}

function volumeActions(v, instances) {
  const sameAz = instances.filter((i) => i.state !== "terminated");
  if (v.state === "in-use") {
    return v.isRoot
      ? `<button data-snap-vol="${v.id}">스냅샷</button>`
      : `<button data-snap-vol="${v.id}">스냅샷</button> <button data-detach-vol="${v.id}">분리</button>`;
  }
  const opts = sameAz.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  return `${sameAz.length ? `<select id="attach-inst-${v.id}" style="padding:4px">${opts}</select> <button data-attach-vol="${v.id}">연결</button>` : ""}
    <button data-snap-vol="${v.id}">스냅샷</button> <button data-del-vol="${v.id}" class="danger">삭제</button>`;
}

async function renderVolumeCreate() {
  document.getElementById("content").innerHTML = `
    <h1 class="page-title">볼륨 생성</h1>
    <div class="form-section">
      <div id="err"></div>
      <div class="field"><label>이름 태그</label><input type="text" id="f-name" placeholder="예: data-volume-1" /></div>
      <div class="field-row">
        <div class="field">
          <label>볼륨 유형</label>
          <select id="f-type">
            <option value="gp3">gp3 — 범용 SSD (최대 16,000 IOPS)</option>
            <option value="io2">io2 — 프로비저닝된 IOPS SSD (최대 256,000 IOPS)</option>
            <option value="st1">st1 — 처리량 최적화 HDD (대용량 순차 처리)</option>
            <option value="sc1">sc1 — 콜드 HDD (최저가, 저빈도 접근)</option>
          </select>
        </div>
        <div class="field"><label>크기 (GiB)</label><input type="number" id="f-size" value="20" style="max-width:120px" /></div>
      </div>
      <div class="field">
        <label>가용 영역</label>
        <select id="f-az">
          <option value="ap-northeast-2a">ap-northeast-2a</option>
          <option value="ap-northeast-2b">ap-northeast-2b</option>
          <option value="ap-northeast-2c">ap-northeast-2c</option>
        </select>
        <div class="field-hint">볼륨은 같은 가용 영역의 인스턴스에만 연결할 수 있어요.</div>
      </div>
    </div>
    <div class="form-actions">
      <a class="btn" href="#/ec2?tab=volumes">취소</a>
      <button class="primary" id="submit">볼륨 생성</button>
    </div>
  `;
  document.getElementById("submit").addEventListener("click", async () => {
    try {
      await api.post("/api/volumes", { name: val("f-name"), type: val("f-type"), size: val("f-size"), availabilityZone: val("f-az") });
      toast("볼륨을 생성했습니다.");
      location.hash = "#/ec2?tab=volumes";
    } catch (e) {
      showErr(e.message);
    }
  });
}

/* ---- 인스턴스 시작 마법사 ---- */

const AMIS = [
  { id: "ami-al2023", name: "Amazon Linux 2023", desc: "AWS 자체 배포 리눅스", freeTier: true },
  { id: "ami-ubuntu2204", name: "Ubuntu Server 22.04 LTS", desc: "가장 널리 쓰이는 배포판", freeTier: true },
  { id: "ami-windows2022", name: "Windows Server 2022", desc: "윈도우 기반 서버", freeTier: false },
];

const FAMILIES = [
  {
    key: "general",
    label: "범용",
    types: [
      { id: "t2.micro", vcpu: 1, mem: 1, freeTier: true, note: "버스터블" },
      { id: "t3.micro", vcpu: 2, mem: 1, freeTier: true, note: "버스터블 · 차세대" },
      { id: "t3.small", vcpu: 2, mem: 2 },
      { id: "m5.large", vcpu: 2, mem: 8 },
      { id: "m6i.large", vcpu: 2, mem: 8, note: "최신 세대" },
    ],
  },
  {
    key: "compute",
    label: "컴퓨팅 최적화",
    types: [
      { id: "c5.large", vcpu: 2, mem: 4 },
      { id: "c6i.large", vcpu: 2, mem: 4, note: "최신 세대" },
      { id: "c7g.large", vcpu: 2, mem: 4, note: "Graviton(ARM)" },
    ],
  },
  {
    key: "memory",
    label: "메모리 최적화",
    types: [
      { id: "r5.large", vcpu: 2, mem: 16 },
      { id: "r6g.large", vcpu: 2, mem: 16, note: "Graviton(ARM)" },
      { id: "x1e.xlarge", vcpu: 4, mem: 122, note: "초대용량 메모리" },
    ],
  },
  {
    key: "storage",
    label: "스토리지 최적화",
    types: [
      { id: "i3.large", vcpu: 2, mem: 15.25, note: "NVMe SSD" },
      { id: "d2.xlarge", vcpu: 4, mem: 30.5, note: "HDD 대용량" },
    ],
  },
  {
    key: "gpu",
    label: "가속 컴퓨팅 (GPU)",
    types: [
      { id: "g4dn.xlarge", vcpu: 4, mem: 16, note: "GPU 1개" },
      { id: "p4d.24xlarge", vcpu: 96, mem: 1152, note: "GPU 8개" },
    ],
  },
];

async function renderEc2Launch() {
  const [vpcs, subnets, sgs] = await Promise.all([api.get("/api/vpcs"), api.get("/api/subnets"), api.get("/api/security-groups")]);

  if (!vpcs.length) {
    document.getElementById("content").innerHTML = `
      <h1 class="page-title">인스턴스 시작</h1>
      <div class="alert error">먼저 VPC와 서브넷을 만들어야 인스턴스를 시작할 수 있어요.</div>
      <a class="btn primary" href="#/vpc/create">VPC 만들러 가기</a>
    `;
    return;
  }

  let selectedAmi = AMIS[0].id;
  let selectedFamily = FAMILIES[0].key;
  let selectedType = FAMILIES[0].types[0].id;

  function typeCardsHtml(familyKey) {
    const family = FAMILIES.find((f) => f.key === familyKey);
    return family.types
      .map(
        (t, idx) => `<div class="card-option ${t.id === selectedType ? "selected" : ""}" data-type="${t.id}">
          <div class="title">${t.id}</div><div class="desc">${t.vcpu} vCPU · ${t.mem}GiB${t.note ? " · " + t.note : ""}</div>
          ${t.freeTier ? `<span class="free-tier">프리 티어 가능</span>` : ""}
        </div>`
      )
      .join("");
  }

  document.getElementById("content").innerHTML = `
    <h1 class="page-title">인스턴스 시작</h1>
    <div id="err"></div>

    <div class="form-section">
      <h2>이름</h2>
      <div class="field"><input type="text" id="f-name" placeholder="예: my-website-server" /></div>
    </div>

    <div class="form-section">
      <h2>AMI(운영체제) 선택</h2>
      <div class="card-options" id="ami-options">
        ${AMIS.map(
          (a, idx) => `<div class="card-option ${idx === 0 ? "selected" : ""}" data-ami="${a.id}">
            <div class="title">${a.name}</div><div class="desc">${a.desc}</div>
            ${a.freeTier ? `<span class="free-tier">프리 티어 가능</span>` : ""}
          </div>`
        ).join("")}
      </div>
    </div>

    <div class="form-section">
      <h2>인스턴스 유형</h2>
      <div class="family-tabs" id="family-tabs">
        ${FAMILIES.map((f) => `<div class="family-tab ${f.key === selectedFamily ? "active" : ""}" data-family="${f.key}">${f.label}</div>`).join("")}
      </div>
      <div class="card-options" id="type-options">${typeCardsHtml(selectedFamily)}</div>
    </div>

    <div class="form-section">
      <h2>키 페어</h2>
      <div class="field">
        <input type="text" id="f-key" placeholder="예: my-key-pair (실제 pem 파일은 필요 없어요)" />
        <div class="field-hint">실제 AWS에서는 이 키로 서버에 SSH 접속합니다. 여기선 이름만 기록해요.</div>
      </div>
    </div>

    <div class="form-section">
      <h2>네트워크 설정</h2>
      <div class="field-row">
        <div class="field">
          <label>VPC</label>
          <select id="f-vpc">${vpcs.map((v) => `<option value="${v.id}">${esc(v.name)} (${v.id})</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>서브넷</label>
          <select id="f-subnet">${subnets.map((s) => `<option value="${s.id}" data-vpc="${s.vpcId}">${esc(s.name)} (${s.availabilityZone}${s.isPublic ? ", 퍼블릭" : ", 프라이빗"})</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>보안 그룹</label>
          <select id="f-sg">
            <option value="">(선택 안 함)</option>
            ${sgs.map((sg) => `<option value="${sg.id}" data-vpc="${sg.vpcId}">${esc(sg.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      ${!subnets.length ? `<div class="alert error">이 VPC에 서브넷이 없어요. <a href="#/vpc/subnets/create?vpcId=${vpcs[0].id}">서브넷을 먼저 만드세요</a>.</div>` : ""}
    </div>

    <div class="form-section">
      <h2>스토리지 (루트 볼륨)</h2>
      <div class="field-row">
        <div class="field"><label>크기 (GiB)</label><input type="number" id="f-vol-size" value="8" style="max-width:120px" /></div>
        <div class="field">
          <label>볼륨 유형</label>
          <select id="f-vol-type">
            <option value="gp3">gp3 (범용 SSD)</option>
            <option value="io2">io2 (프로비저닝 IOPS SSD)</option>
          </select>
        </div>
      </div>
    </div>

    <div class="form-section">
      <h2>구매 옵션</h2>
      <div class="card-options" id="purchase-options">
        <div class="card-option selected" data-purchase="on-demand"><div class="title">온디맨드</div><div class="desc">약정 없이 쓴 만큼만 결제</div></div>
        <div class="card-option" data-purchase="spot"><div class="title">스팟 인스턴스</div><div class="desc">최대 90% 할인, 회수될 수 있음</div></div>
      </div>
    </div>

    <div class="form-section">
      <h2>고급 세부 정보</h2>
      <div class="field">
        <label><input type="checkbox" id="f-imds" checked style="width:auto;margin-right:6px" />IMDSv2 필수화 (권장)</label>
        <div class="field-hint">세션 토큰 기반 메타데이터 조회를 강제해서 SSRF 공격으로부터 자격 증명을 보호해요.</div>
      </div>
      <div class="field">
        <label>사용자 데이터 (User Data)</label>
        <textarea id="f-userdata" rows="5" style="max-width:520px;font-family:monospace;font-size:12.5px" placeholder="#!/bin/bash&#10;dnf update -y&#10;dnf install -y httpd&#10;systemctl start httpd&#10;systemctl enable httpd"></textarea>
        <div class="field-hint">인스턴스가 최초 부팅될 때 root 권한으로 딱 한 번 실행되는 스크립트예요.</div>
      </div>
    </div>

    <div class="form-actions">
      <a class="btn" href="#/ec2">취소</a>
      <button class="primary" id="submit" ${!subnets.length ? "disabled" : ""}>인스턴스 시작</button>
    </div>
  `;

  document.querySelectorAll("#ami-options .card-option").forEach((el) =>
    el.addEventListener("click", () => {
      document.querySelectorAll("#ami-options .card-option").forEach((e) => e.classList.remove("selected"));
      el.classList.add("selected");
      selectedAmi = el.dataset.ami;
    })
  );
  document.querySelectorAll("#family-tabs .family-tab").forEach((el) =>
    el.addEventListener("click", () => {
      document.querySelectorAll("#family-tabs .family-tab").forEach((e) => e.classList.remove("active"));
      el.classList.add("active");
      selectedFamily = el.dataset.family;
      selectedType = FAMILIES.find((f) => f.key === selectedFamily).types[0].id;
      document.getElementById("type-options").innerHTML = typeCardsHtml(selectedFamily);
      bindTypeCards();
    })
  );
  function bindTypeCards() {
    document.querySelectorAll("#type-options .card-option").forEach((el) =>
      el.addEventListener("click", () => {
        document.querySelectorAll("#type-options .card-option").forEach((e) => e.classList.remove("selected"));
        el.classList.add("selected");
        selectedType = el.dataset.type;
      })
    );
  }
  bindTypeCards();

  let selectedPurchase = "on-demand";
  document.querySelectorAll("#purchase-options .card-option").forEach((el) =>
    el.addEventListener("click", () => {
      document.querySelectorAll("#purchase-options .card-option").forEach((e) => e.classList.remove("selected"));
      el.classList.add("selected");
      selectedPurchase = el.dataset.purchase;
    })
  );

  document.getElementById("submit").addEventListener("click", async () => {
    try {
      await api.post("/api/instances", {
        name: val("f-name"),
        ami: selectedAmi,
        instanceType: selectedType,
        keyName: val("f-key"),
        vpcId: val("f-vpc"),
        subnetId: val("f-subnet"),
        securityGroupId: val("f-sg") || null,
        purchasingOption: selectedPurchase,
        imdsv2Required: document.getElementById("f-imds").checked,
        userData: val("f-userdata"),
        rootVolumeSize: val("f-vol-size"),
        rootVolumeType: val("f-vol-type"),
      });
      toast("인스턴스를 시작했습니다. 잠시 후 실행 중 상태가 됩니다.");
      location.hash = "#/ec2";
      setTimeout(router, 4200);
    } catch (e) {
      showErr(e.message);
    }
  });
}

/* ==================================================================
   S3 서비스
   ================================================================== */

const STORAGE_CLASSES = [
  { id: "STANDARD", label: "S3 Standard — 자주 쓰는 활성 데이터" },
  { id: "INTELLIGENT_TIERING", label: "S3 Intelligent-Tiering — 접근 패턴 자동 분석" },
  { id: "STANDARD_IA", label: "S3 Standard-IA — 가끔 조회, 30% 이상 저렴" },
  { id: "GLACIER", label: "S3 Glacier Flexible — 장기 보관 아카이브" },
  { id: "DEEP_ARCHIVE", label: "S3 Glacier Deep Archive — 최저가, 법적 보관용" },
];

async function renderS3List() {
  const buckets = await api.get("/api/buckets");
  const body = buckets.length
    ? `<table><thead><tr><th>버킷 이름</th><th>리전</th><th>퍼블릭 액세스 차단</th><th>버전 관리</th><th>생성일</th><th></th></tr></thead><tbody>
        ${buckets
          .map(
            (b) => `<tr class="clickable" data-open="${b.name}">
              <td>${esc(b.name)}</td><td>${b.region}</td>
              <td>${b.blockPublicAccess ? "예" : "아니오"}</td><td>${b.versioning ? "활성화" : "비활성화"}</td><td>${fmtTime(b.createdAt)}</td>
              <td><button data-del="${b.name}" class="danger">삭제</button></td>
            </tr>`
          )
          .join("")}
      </tbody></table>`
    : emptyState("버킷이 없어요", "버킷을 만들어서 이미지나 파일을 저장해보세요.");

  document.getElementById("content").innerHTML = `
    <h1 class="page-title">${icon("s3")}버킷</h1>
    <p class="page-desc">파일 저장소입니다. 여기 업로드한 파일은 실제로 서버에 저장되고 다시 내려받을 수 있어요.</p>
    <div class="toolbar"><div></div><a class="btn primary" href="#/s3/create">버킷 만들기</a></div>
    ${body}
  `;

  document.querySelectorAll("[data-open]").forEach((row) =>
    row.addEventListener("click", () => (location.hash = `#/s3/bucket?name=${encodeURIComponent(row.dataset.open)}`))
  );
  document.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await api.del(`/api/buckets/${encodeURIComponent(btn.dataset.del)}`);
        toast("버킷을 삭제했습니다.");
        router();
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
}

async function renderS3Create() {
  document.getElementById("content").innerHTML = `
    <h1 class="page-title">버킷 만들기</h1>
    <div class="form-section">
      <h2>일반 구성</h2>
      <div id="err"></div>
      <div class="field">
        <label>버킷 이름</label>
        <input type="text" id="f-name" placeholder="예: my-website-bucket" />
        <div class="field-hint">소문자, 숫자, 하이픈만 사용 (실제 S3처럼 전역에서 고유해야 해요)</div>
      </div>
      <div class="field">
        <label>AWS 리전</label>
        <select id="f-region"><option value="ap-northeast-2">아시아 태평양(서울) ap-northeast-2</option></select>
      </div>
    </div>
    <div class="form-section">
      <h2>버전 관리</h2>
      <div class="field"><label><input type="checkbox" id="f-versioning" style="width:auto;margin-right:6px" />버전 관리 활성화</label>
        <div class="field-hint">켜두면 같은 이름으로 다시 업로드해도 이전 파일이 덮어써지지 않고 버전이 남아요.</div>
      </div>
    </div>
    <div class="form-section">
      <h2>퍼블릭 액세스 설정</h2>
      <div class="field">
        <label><input type="checkbox" id="f-block" checked style="width:auto;margin-right:6px" />모든 퍼블릭 액세스 차단 (권장)</label>
        <div class="field-hint">체크를 해제하면 업로드한 파일을 URL로 누구나 볼 수 있게 됩니다.</div>
      </div>
    </div>
    <div class="form-actions">
      <a class="btn" href="#/s3">취소</a>
      <button class="primary" id="submit">버킷 만들기</button>
    </div>
  `;
  document.getElementById("submit").addEventListener("click", async () => {
    try {
      const blockPublic = document.getElementById("f-block").checked;
      const versioning = document.getElementById("f-versioning").checked;
      await api.post("/api/buckets", { name: val("f-name"), region: val("f-region"), blockPublicAccess: blockPublic, versioning });
      toast("버킷을 만들었습니다.");
      location.hash = "#/s3";
    } catch (e) {
      showErr(e.message);
    }
  });
}

async function renderS3BucketDetail(name) {
  const [objects, buckets] = await Promise.all([
    api.get(`/api/buckets/${encodeURIComponent(name)}/objects`),
    api.get("/api/buckets"),
  ]);
  const bucket = buckets.find((b) => b.name === name) || {};

  document.getElementById("content").innerHTML = `
    <h1 class="page-title">${icon("s3")}${esc(name)}</h1>
    <p class="page-desc">
      ${bucket.blockPublicAccess ? `<span class="badge red">퍼블릭 액세스 차단됨</span>` : `<span class="badge green">퍼블릭 액세스 허용</span>`}
      ${bucket.versioning ? `<span class="badge green" style="margin-left:6px">버전 관리 켜짐</span>` : ""}
      <button id="toggle-block" style="margin-left:10px">${bucket.blockPublicAccess ? "퍼블릭 액세스 차단 해제" : "퍼블릭 액세스 차단 켜기"}</button>
    </p>
    <div class="card upload-bar">
      <input type="file" id="f-file" />
      <select id="f-storage-class">${STORAGE_CLASSES.map((c) => `<option value="${c.id}">${c.label}</option>`).join("")}</select>
      <button class="primary" id="upload-btn">업로드</button>
    </div>
    <div class="gallery">
      ${
        objects.length
          ? objects
              .map(
                (o) => `<div class="obj-card">
                  ${!bucket.blockPublicAccess && /\.(png|jpe?g|gif|webp)$/i.test(o.key) ? `<img src="${o.url}" alt="${esc(o.key)}" />` : `<div class="file-thumb" style="display:grid;place-items:center">${tile("s3","lg")}</div>`}
                  <div class="key">${esc(o.key)}</div>
                  <div class="sc-badge">${o.storageClass}</div>
                  <div style="display:flex;gap:4px;justify-content:center;margin-top:6px">
                    <a href="${o.url}" target="_blank"><button>보기</button></a>
                    <button data-del-obj="${esc(o.key)}" class="danger">삭제</button>
                  </div>
                </div>`
              )
              .join("")
          : `<div class="empty-state" style="width:100%">아직 업로드된 파일이 없어요.</div>`
      }
    </div>
    <div style="margin-top:20px"><a class="btn" href="#/s3">← 버킷 목록으로</a></div>
  `;

  document.getElementById("toggle-block").addEventListener("click", async () => {
    await api.post(`/api/buckets/${encodeURIComponent(name)}/public-access-block`, { blockPublicAccess: !bucket.blockPublicAccess });
    toast("설정을 변경했습니다.");
    renderS3BucketDetail(name);
  });

  document.getElementById("upload-btn").addEventListener("click", async () => {
    const fileInput = document.getElementById("f-file");
    if (!fileInput.files[0]) return toast("파일을 선택해주세요.", true);
    try {
      await api.upload(`/api/buckets/${encodeURIComponent(name)}/objects`, fileInput.files[0], {
        storageClass: val("f-storage-class"),
      });
      toast("업로드 완료!");
      renderS3BucketDetail(name);
    } catch (e) {
      toast(e.message, true);
    }
  });
  document.querySelectorAll("[data-del-obj]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.del(`/api/buckets/${encodeURIComponent(name)}/objects/${encodeURIComponent(btn.dataset.delObj)}`);
      toast("파일을 삭제했습니다.");
      renderS3BucketDetail(name);
    })
  );
}

/* ==================================================================
   RDS 서비스
   ================================================================== */

async function renderRdsList() {
  const dbs = await api.get("/api/db-instances");
  const body = dbs.length
    ? `<table><thead><tr><th>식별자</th><th>엔진</th><th>클래스</th><th>상태</th><th>엔드포인트</th><th></th></tr></thead><tbody>
        ${dbs
          .map(
            (d) => `<tr>
              <td>${esc(d.identifier)}</td><td>${d.engine}</td><td>${d.instanceClass}</td>
              <td>${badge(d.state)}</td><td>${d.endpoint ? `<code class="mono">${d.endpoint}:${d.port}</code>` : "-"}</td>
              <td><button data-del="${d.id}" class="danger" ${d.state === "deleting" ? "disabled" : ""}>삭제</button></td>
            </tr>`
          )
          .join("")}
      </tbody></table>`
    : emptyState("DB 인스턴스가 없어요", "우리 웹사이트의 방명록 데이터를 저장할 데이터베이스를 만들어보세요.");

  document.getElementById("content").innerHTML = `
    <h1 class="page-title">${icon("rds")}데이터베이스</h1>
    <p class="page-desc">관계형 데이터베이스입니다. 생성 후 "생성 중" 상태를 잠깐 거쳐 "사용 가능"으로 바뀌고, 접속 엔드포인트가 발급돼요.</p>
    <div class="toolbar"><div></div><a class="btn primary" href="#/rds/create">데이터베이스 생성</a></div>
    ${body}
  `;

  document.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("이 DB 인스턴스를 삭제하시겠어요?")) return;
      await api.del(`/api/db-instances/${btn.dataset.del}`);
      toast("삭제 중입니다.");
      router();
      setTimeout(router, 3200);
    })
  );
}

async function renderRdsCreate() {
  const vpcs = await api.get("/api/vpcs");
  document.getElementById("content").innerHTML = `
    <h1 class="page-title">데이터베이스 생성</h1>
    <div id="err"></div>

    <div class="form-section">
      <h2>엔진 선택</h2>
      <div class="card-options" id="engine-options">
        <div class="card-option selected" data-engine="postgres"><div class="title">PostgreSQL</div><div class="desc">기본 포트 5432</div></div>
        <div class="card-option" data-engine="mysql"><div class="title">MySQL</div><div class="desc">기본 포트 3306</div></div>
      </div>
    </div>

    <div class="form-section">
      <h2>설정</h2>
      <div class="field-row">
        <div class="field"><label>DB 인스턴스 식별자</label><input type="text" id="f-id" placeholder="예: my-website-db" /></div>
        <div class="field">
          <label>인스턴스 클래스</label>
          <select id="f-class">
            <option value="db.t3.micro">db.t3.micro (프리 티어 가능)</option>
            <option value="db.t3.small">db.t3.small</option>
            <option value="db.m5.large">db.m5.large</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>마스터 사용자 이름</label><input type="text" id="f-user" value="appuser" /></div>
        <div class="field"><label>마스터 비밀번호</label><input type="password" id="f-pass" placeholder="8자 이상" /></div>
      </div>
      <div class="field"><label>스토리지(GiB)</label><input type="number" id="f-storage" value="20" style="max-width:120px" /></div>
    </div>

    <div class="form-section">
      <h2>연결</h2>
      <div class="field"><label>VPC</label><select id="f-vpc">${vpcs.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join("")}</select></div>
      <div class="field"><label><input type="checkbox" id="f-public" style="width:auto;margin-right:6px" />퍼블릭 액세스 허용</label></div>
    </div>

    <div class="form-actions">
      <a class="btn" href="#/rds">취소</a>
      <button class="primary" id="submit">데이터베이스 생성</button>
    </div>
  `;

  let engine = "postgres";
  document.querySelectorAll("#engine-options .card-option").forEach((el) =>
    el.addEventListener("click", () => {
      document.querySelectorAll("#engine-options .card-option").forEach((e) => e.classList.remove("selected"));
      el.classList.add("selected");
      engine = el.dataset.engine;
    })
  );

  document.getElementById("submit").addEventListener("click", async () => {
    try {
      await api.post("/api/db-instances", {
        identifier: val("f-id"),
        engine,
        instanceClass: val("f-class"),
        allocatedStorage: Number(val("f-storage")),
        masterUsername: val("f-user"),
        masterPassword: val("f-pass"),
        vpcId: val("f-vpc"),
        publiclyAccessible: document.getElementById("f-public").checked,
      });
      toast("데이터베이스를 생성하고 있습니다.");
      location.hash = "#/rds";
      setTimeout(router, 5200);
    } catch (e) {
      showErr(e.message);
    }
  });
}

/* ---- 폼 공통 유틸 ---- */
function val(id) {
  return document.getElementById(id).value.trim();
}
function showErr(msg) {
  const el = document.getElementById("err");
  if (el) el.innerHTML = `<div class="alert error">${esc(msg)}</div>`;
  else toast(msg, true);
}
