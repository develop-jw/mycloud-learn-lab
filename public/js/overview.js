/* ---- 개요(대시보드): KPI · 실시간 아키텍처 · 학습 진행 · 최근 활동 · 지표 ---- */

/* ==================================================================
   환경 점검 (보안·비용·안정성) — 대시보드와 모니터링 화면이 함께 사용
   ================================================================== */
function healthIssues(o) {
  const out = [];
  const add = (level, text, href) => out.push({ level, text, href });
  o.instances
    .filter((i) => i.state === "running" && !i.securityGroupId && !(i.managedBy && i.managedBy.type === "nodegroup"))
    .forEach((i) => add("warn", `${i.name}: 보안 그룹이 없는 인스턴스`, "#/ec2?tab=instances"));
  o.sgs
    .filter((s) => s.inboundRules.some((r) => String(r.port) === "22" && r.source === "0.0.0.0/0"))
    .forEach((s) => add("warn", `${s.name}: SSH(22)가 전체 인터넷(0.0.0.0/0)에 열려 있어요`, `#/vpc?tab=sg&id=${s.id}`));
  o.buckets.filter((b) => b.publicRead && !b.website).forEach((b) => add("warn", `${b.name}: 누구나 읽을 수 있는 버킷이에요`, `#/storage?tab=s3&id=${encodeURIComponent(b.name)}`));
  o.dbs.filter((d) => d.publiclyAccessible).forEach((d) => add("warn", `${d.identifier}: DB가 퍼블릭 액세스 허용 상태예요`, "#/db?tab=rds"));
  o.dbs.filter((d) => d.state === "available" && !d.multiAz).forEach((d) => add("info", `${d.identifier}: 단일 AZ DB — 운영용이면 Multi-AZ를 켜세요`, "#/db?tab=rds"));
  o.lbs.filter((l) => l.state === "active" && l.totalTargets && l.healthy < l.totalTargets).forEach((l) => add("warn", `${l.name}: 비정상 대상 ${l.totalTargets - l.healthy}개`, "#/elb?tab=tgs"));
  o.lbs.filter((l) => l.state === "active" && !l.totalTargets).forEach((l) => add("warn", `${l.name}: 등록된 대상이 없어 요청을 처리할 수 없어요`, "#/elb?tab=tgs"));
  o.pods.filter((p) => p.state === "ImagePullBackOff").slice(0, 3).forEach((p) => add("warn", `파드 ${p.id}: 이미지를 받지 못해요`, "#/workloads?tab=pods"));
  const pend = o.pods.filter((p) => p.state === "Pending" && Date.now() - p.since > 6000).length;
  if (pend) add("warn", `스케줄링되지 못한 파드 ${pend}개 (노드 용량 부족)`, "#/workloads?tab=pods");
  o.alarms.filter((a) => a.state === "ALARM").forEach((a) => add("warn", `경보 발생: ${a.name}`, "#/monitoring?tab=alarms"));
  o.volumes.filter((v) => v.state === "available").forEach((v) => add("info", `${v.name}: 연결되지 않은 EBS 볼륨 (비용 발생)`, "#/ec2?tab=volumes"));
  o.eips.filter((e) => !e.instanceId && !e.natGatewayId).forEach((e) => add("info", `탄력적 IP ${e.publicIp}: 연결되지 않음 (비용 발생)`, "#/vpc?tab=eip"));
  o.iam.users.filter((u) => u.consoleAccess && !u.mfaEnabled).forEach((u) => add("warn", `IAM 사용자 ${u.name}: 콘솔 로그인에 MFA가 없어요`, "#/iam?tab=users"));
  o.ecr.forEach((r) => r.images.filter((i) => i.scan && i.scan.critical).forEach((i) => add("warn", `${r.name}:${i.tag} 이미지에 심각(Critical) 취약점`, "#/eks?tab=ecr")));
  return out;
}

/* ==================================================================
   작은 라인 차트 (지표용) — 1개 계열, 십자선 + 툴팁
   ================================================================== */
const METRIC_DEF = {
  cpu: { label: "CPU", glyph: "cpu", color: "#ea6f0c", max: 100, fmt: (v) => `${Math.round(v)}%`, axis: (v) => `${v}%` },
  mem: { label: "메모리", glyph: "memory", color: "#2563eb", max: 100, fmt: (v) => `${Math.round(v)}%`, axis: (v) => `${v}%` },
  rps: { label: "요청 수", glyph: "requests", color: "#1f9d55", max: null, fmt: (v) => `${Math.round(v)} req/s`, axis: (v) => `${v}` },
};

function niceMax(v) {
  const steps = [10, 20, 50, 100, 200, 300, 500, 600, 1000, 1500, 2000, 3000, 5000];
  return steps.find((s) => s >= v * 1.15) || Math.ceil(v / 1000) * 1000;
}

function timeLabel(t, range) {
  const d = new Date(t);
  if (range === "7d") return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function drawLineChart(host, points, key, range, hasCompute) {
  const def = METRIC_DEF[key];
  const W = Math.max(220, host.clientWidth);
  const H = 132;
  const L = 36, R = 8, T = 8, B = 22;
  const vals = points.map((p) => p[key]);
  const max = def.max || niceMax(Math.max(10, ...vals));
  const x = (i) => L + (i / Math.max(1, points.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - Math.min(v, max) / max) * (H - T - B);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${H - B} L${L} ${H - B} Z`;
  const ticks = [0, max / 2, max];
  const labelIdx = [0, 1, 2, 3, 4, 5].map((k) => Math.round((k / 5) * (points.length - 1)));
  host.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${def.label} 추이">
      ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-label" x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${def.axis(Math.round(t))}</text>`).join("")}
      ${labelIdx.map((i, k) => `<text class="axis-label" x="${x(i)}" y="${H - 5}" text-anchor="${k === 0 ? "start" : k === 5 ? "end" : "middle"}">${points[i] ? timeLabel(points[i].t, range) : ""}</text>`).join("")}
      <path class="area" d="${area}" fill="${def.color}"/>
      <path class="line" d="${line}" stroke="${def.color}"/>
      <g class="hover" visibility="hidden"><line class="hair" y1="${T}" y2="${H - B}"/><circle class="hdot" r="4.5" fill="${def.color}"/></g>
      <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent" class="hit"/>
    </svg>
    <div class="chart-tip" hidden></div>
    ${hasCompute ? "" : `<div class="chart-empty">실행 중인 컴퓨팅 리소스가 없어<br/>지표가 수집되지 않아요</div>`}`;
  const svg = host.querySelector("svg");
  const g = svg.querySelector(".hover");
  const tip = host.querySelector(".chart-tip");
  const hit = svg.querySelector(".hit");
  const move = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const px = clientX - rect.left;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1))));
    const p = points[i];
    g.setAttribute("visibility", "visible");
    g.querySelector("line").setAttribute("x1", x(i));
    g.querySelector("line").setAttribute("x2", x(i));
    g.querySelector("circle").setAttribute("cx", x(i));
    g.querySelector("circle").setAttribute("cy", y(p[key]));
    tip.hidden = false;
    tip.style.left = `${x(i)}px`;
    tip.style.top = `${y(p[key])}px`;
    tip.replaceChildren();
    const b = document.createElement("b");
    b.textContent = def.fmt(p[key]);
    tip.append(b, document.createTextNode(new Date(p.t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })));
  };
  hit.addEventListener("pointermove", (e) => move(e.clientX));
  hit.addEventListener("pointerleave", () => {
    g.setAttribute("visibility", "hidden");
    tip.hidden = true;
  });
}

// 지표 카드 3개를 관리하는 작은 컨트롤러 (개요 · 모니터링 화면 공용)
function MetricsPanel(rootId, { range = "24h" } = {}) {
  const state = { range, points: [], hasCompute: false };
  const root = byId(rootId);
  const draw = () => {
    ["cpu", "mem", "rps"].forEach((k) => {
      const host = root.querySelector(`[data-chart="${k}"]`);
      if (!host || !state.points.length) return;
      drawLineChart(host, state.points, k, state.range, state.hasCompute);
      const last = state.points[state.points.length - 1];
      root.querySelector(`[data-value="${k}"]`).textContent = METRIC_DEF[k].fmt(last[k]);
    });
  };
  const loadHistory = async () => {
    const h = await api.get(`/api/metrics/history?range=${state.range}`);
    state.points = h.points;
    state.hasCompute = h.hasCompute;
    draw();
  };
  const tick = async () => {
    if (!document.body.contains(root)) return;
    const c = await api.get(`/api/metrics/current?range=${state.range}`);
    state.hasCompute = c.hasCompute;
    // 새 점을 오른쪽에 붙이고 가장 오래된 점을 버려서 '흘러가는' 느낌
    state.points.push({ t: c.t, cpu: c.cpu, mem: c.mem, rps: c.rps });
    state.points.shift();
    draw();
  };
  root.innerHTML = `<div class="metrics">${["cpu", "mem", "rps"]
    .map(
      (k) => `<div class="metric">
        <div class="metric-head"><svg viewBox="0 0 24 24" style="stroke:${METRIC_DEF[k].color}">${GLYPHS[METRIC_DEF[k].glyph]}</svg>${METRIC_DEF[k].label}<span class="metric-value" data-value="${k}">-</span></div>
        <div class="chart" data-chart="${k}"></div>
      </div>`
    )
    .join("")}</div>`;
  const ro = new ResizeObserver(() => draw());
  ro.observe(root);
  loadHistory();
  App.every(2000, () => tick().catch(() => {}));
  return {
    setRange(r) {
      state.range = r;
      loadHistory();
    },
  };
}

function rangeButtons(active) {
  return `<div class="range" id="range">${["1h", "6h", "24h", "7d"].map((r) => `<button data-range="${r}" class="${r === active ? "on" : ""}">${r.toUpperCase()}</button>`).join("")}</div>`;
}
function bindRange(panel) {
  document.querySelectorAll("#range button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#range button").forEach((x) => x.classList.toggle("on", x === b));
      panel.setRange(b.dataset.range);
    })
  );
}

/* ==================================================================
   실시간 아키텍처 다이어그램
   ================================================================== */
const Diagram = { vpcId: null };

function dgNode(id, key, label, sub, { ghost = false, href = "#", count = 0, size = "md" } = {}) {
  return `<a class="dg-node ${ghost ? "ghost" : ""}" id="${id}" href="${href}" title="${ghost ? `${label}: 아직 없어요 — 클릭해서 만들기` : esc(label)}">
    ${svc(key, size)}${count > 1 ? `<span class="count">${count}</span>` : ""}<b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}
  </a>`;
}

const LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const GLOBE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.3 2.5 13.7 0 16M12 4c-2.5 2.3-2.5 13.7 0 16"/></svg>';

function groupByAz(items, azOf) {
  const map = new Map();
  items.forEach((it) => {
    const az = azOf(it);
    if (!map.has(az)) map.set(az, []);
    map.get(az).push(it);
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function azName(az, i) {
  return `가용 영역 ${i + 1} · ${az.slice(-2)}`;
}

function hostState(state) {
  if (state === "running") return "";
  if (["pending", "stopping", "shutting-down", "rebooting"].includes(state)) return "busy";
  return "off";
}

function subnetBlock(o, subnet, hostsHtml) {
  const pub = subnet && subnet.egress === "igw";
  return `<div class="dg-subnet ${pub ? "public" : ""}">
    <div class="dg-subnet-head">${pub ? GLOBE : LOCK}${pub ? "퍼블릭 서브넷" : subnet && subnet.egress === "nat" ? "프라이빗 서브넷 · NAT" : "프라이빗 서브넷"}<code>${esc(subnet ? subnet.cidrBlock : "")}</code></div>
    <div class="dg-hosts">${hostsHtml}</div>
  </div>`;
}

function eksBox(o, cluster) {
  const nodes = o.instances.filter((i) => i.managedBy && i.managedBy.clusterId === cluster.id && i.state !== "terminated");
  const ngs = o.nodeGroups.filter((n) => n.clusterId === cluster.id);
  let azHtml;
  if (!nodes.length) {
    azHtml = `<div class="dg-slot">${ngs.length ? "워커 노드를 시작하는 중이에요..." : `<a href="#/eks?tab=nodegroups&new=1">노드 그룹을 추가</a>하면 가용 영역별 워커 노드와 파드가 표시돼요`}</div>`;
  } else {
    azHtml = `<div class="dg-azs">${groupByAz(nodes, (n) => n.availabilityZone)
      .map(([az, list], i) => {
        const bySubnet = groupByAz(list, (n) => n.subnetId);
        return `<div class="dg-az" id="dg-az-${i}"><div class="dg-az-label">${azName(az, i)}</div>
          ${bySubnet
            .map(([sid, nodesIn]) =>
              subnetBlock(
                o,
                o.subnets.find((s) => s.id === sid),
                nodesIn
                  .map((n) => {
                    const pods = o.pods.filter((p) => p.nodeId === n.id && p.state !== "Terminating");
                    const shown = pods.slice(0, 6);
                    return `<div class="dg-host">
                      <div class="dg-host-top">${svc("ec2", "sm")}<span>EC2 (워커 노드)<br/><small>${esc(n.instanceType)}${n.purchasingOption === "spot" ? " · 스팟" : ""}</small></span><i class="st ${hostState(n.state)}"></i></div>
                      <div class="dg-pods">${
                        shown
                          .map((p) => `<span class="dg-pod ${p.state === "Running" ? "" : p.state === "ImagePullBackOff" ? "err" : "busy"}" title="${esc(p.id)} · ${esc(p.state)}">${svc("pod", "sm")}Pod</span>`)
                          .join("") || `<span class="dg-slot">파드 없음</span>`
                      }${pods.length > 6 ? `<span class="dg-slot">+${pods.length - 6}</span>` : ""}</div>
                    </div>`;
                  })
                  .join("")
              )
            )
            .join("")}
        </div>`;
      })
      .join("")}</div>`;
  }
  const lbc = cluster.addons.some((a) => a.name === "aws-load-balancer-controller" && a.status === "ACTIVE");
  const ings = o.ingresses.filter((x) => x.clusterId === cluster.id);
  const svcs = o.services.filter((x) => x.clusterId === cluster.id);
  return `<div class="dg-box dg-eks" id="dg-compute">
    <div class="dg-box-title">${svc("eks", "sm")}Amazon EKS <small>${esc(cluster.name)} · v${esc(cluster.version)} · ${esc(cluster.status)}</small></div>
    ${azHtml}
    <div class="dg-k8s-row">
      ${dgNode("dg-ingress", "ingress", "인그레스 컨트롤러", ings.length ? `인그레스 ${ings.length}개` : lbc ? "설치됨" : "미설치", { ghost: !lbc && !ings.length, href: lbc ? "#/workloads?tab=ingresses" : "#/eks?tab=clusters", size: "md" })}
      ${dgNode("dg-ksvc", "ksvc", "쿠버네티스 서비스", svcs.length ? `${svcs.length}개` : "", { ghost: !svcs.length, href: "#/workloads?tab=services", size: "md" })}
    </div>
  </div>`;
}

function ec2Box(o, vpc, instances, first) {
  const asgIds = new Set(instances.filter((i) => i.managedBy && i.managedBy.type === "asg").map((i) => i.managedBy.id));
  const asgNames = o.asgs.filter((a) => asgIds.has(a.id)).map((a) => a.name);
  const groups = groupByAz(instances, (i) => i.availabilityZone);
  return `<div class="dg-box dg-ec2" ${first ? 'id="dg-compute"' : 'id="dg-compute-2"'}>
    <div class="dg-box-title">${svc("ec2", "sm")}EC2 워크로드 <small>${instances.length}대${asgNames.length ? ` · Auto Scaling: ${esc(asgNames.join(", "))}` : ""}</small></div>
    <div class="dg-azs">${groups
      .map(([az, list], i) => `<div class="dg-az" ${first ? `id="dg-az-${i}"` : ""}><div class="dg-az-label">${azName(az, i)}</div>
        ${groupByAz(list, (x) => x.subnetId)
          .map(([sid, inSub]) =>
            subnetBlock(
              o,
              o.subnets.find((s) => s.id === sid),
              inSub
                .map(
                  (n) => `<div class="dg-host"><div class="dg-host-top">${svc("ec2", "sm")}<span>${esc(n.name)}<br/><small>${esc(n.instanceType)}${n.publicIp ? ` · ${esc(n.publicIp)}` : ""}</small></span><i class="st ${hostState(n.state)}"></i></div></div>`
                )
                .join("")
            )
          )
          .join("")}</div>`)
      .join("")}</div>
  </div>`;
}

function buildDiagram(o) {
  const scoreOf = (v) =>
    o.instances.filter((i) => i.vpcId === v.id && i.state !== "terminated").length * 2 +
    o.clusters.filter((c) => c.vpcId === v.id).length * 5 +
    o.lbs.filter((l) => l.vpcId === v.id).length * 3 +
    o.subnets.filter((s) => s.vpcId === v.id).length;
  const vpcs = o.vpcs.slice().sort((a, b) => scoreOf(b) - scoreOf(a));
  const vpc = vpcs.find((v) => v.id === Diagram.vpcId) || vpcs[0] || null;

  const zones = o.zones;
  const cfs = o.cloudfront;
  const lbs = vpc ? o.lbs.filter((l) => l.vpcId === vpc.id && l.scheme === "internet-facing") : [];
  const alb = lbs.find((l) => l.type === "application") || lbs[0];
  const chain = `<div class="dg-chain">
    ${dgNode("dg-users", "users", "사용자", "인터넷", { href: "#/guide" })}
    ${dgNode("dg-r53", "route53", "Route 53", zones[0] ? zones[0].domain : "DNS", { ghost: !zones.length, href: "#/edge?tab=route53", count: zones.length })}
    ${dgNode("dg-cf", "cloudfront", "CloudFront", cfs[0] ? (cfs[0].status === "Deployed" ? "배포됨" : "배포 중") : "CDN", { ghost: !cfs.length, href: "#/edge?tab=cloudfront", count: cfs.length })}
    ${dgNode("dg-alb", "elb", alb ? (alb.type === "network" ? "NLB" : "ALB") : "ALB", alb ? `${alb.healthy}/${alb.totalTargets} 정상` : "로드 밸런서", { ghost: !alb, href: "#/elb?tab=lbs", count: lbs.length })}
  </div>`;

  let vpcHtml;
  if (!vpc) {
    vpcHtml = `<div class="dg-vpc" id="dg-vpc">
      <div class="dg-vpc-tag"><span class="cloud">${glyph("vpc")}</span><b>VPC</b><code>아직 없음</code></div>
      <div class="dg-box dg-ec2 dg-empty" id="dg-compute"><p>VPC를 만들면 이곳에 가용 영역 · 서브넷 · 서버가 그려져요.</p><a class="btn primary" href="#/vpc?tab=vpcs&new=1">VPC 만들기</a></div>
      <div class="dg-box dg-data" id="dg-data"><div class="dg-box-title">데이터 계층 <span>(프라이빗 서브넷)</span></div>
        <div class="dg-row">${dgNode("dg-rds", "rds", "RDS", "", { ghost: true, href: "#/db?tab=rds" })}${dgNode("dg-cache", "cache", "ElastiCache", "", { ghost: true, href: "#/db?tab=cache" })}</div></div>
    </div>`;
  } else {
    const igw = o.igws.find((g) => g.vpcId === vpc.id && g.state === "attached");
    const nats = o.nats.filter((n) => n.vpcId === vpc.id);
    const vgw = o.vgws.find((v) => v.vpcId === vpc.id);
    const clusters = o.clusters.filter((c) => c.vpcId === vpc.id);
    const loose = o.instances.filter((i) => i.vpcId === vpc.id && i.state !== "terminated" && !(i.managedBy && i.managedBy.type === "nodegroup"));
    let compute = "";
    if (clusters.length) compute += eksBox(o, clusters[0]);
    if (loose.length) compute += ec2Box(o, vpc, loose, !clusters.length);
    if (!compute) {
      const hasSubnets = o.subnets.some((s) => s.vpcId === vpc.id);
      compute = `<div class="dg-box dg-ec2 dg-empty" id="dg-compute">
        <p>${hasSubnets ? "서브넷이 준비됐어요. EC2 인스턴스를 시작하거나 EKS 클러스터를 만들어 보세요." : "먼저 서브넷을 나눠야 서버를 배치할 수 있어요."}</p>
        <div class="btn-row" style="justify-content:center">${hasSubnets ? `<a class="btn primary" href="#/ec2/launch">인스턴스 시작</a><a class="btn" href="#/eks?tab=clusters&new=1">EKS 클러스터 만들기</a>` : `<a class="btn primary" href="#/vpc?tab=subnets&new=1">서브넷 만들기</a>`}</div>
      </div>`;
    }
    const dbs = o.dbs.filter((d) => d.vpcId === vpc.id);
    const caches = o.caches.filter((c) => c.vpcId === vpc.id);
    const efs = o.efs.filter((f) => f.vpcId === vpc.id);
    const db0 = dbs[0];
    vpcHtml = `<div class="dg-vpc" id="dg-vpc">
      <div class="dg-vpc-tag"><span class="cloud">${glyph("vpc")}</span><b>VPC</b><code>${esc(vpc.cidrBlock)}</code><small class="muted">${esc(vpc.name)}</small></div>
      <div class="dg-vpc-meta">
        <span class="dg-chip igw ${igw ? "" : "off"}">${igw ? svc("igw", "xs") : ""}인터넷 게이트웨이</span>
        <span class="dg-chip nat ${nats.length ? "" : "off"}">${nats.length ? svc("nat", "xs") : ""}NAT ${nats.length || ""}</span>
        ${vgw ? `<span class="dg-chip">${svc("vpn", "xs")}VPN</span>` : ""}
      </div>
      ${vpcs.length > 1 ? `<div class="dg-vpc-select">${vpcs.map((v) => `<button data-vpc="${v.id}" class="${v.id === vpc.id ? "on" : ""}">${esc(v.name)}</button>`).join("")}</div>` : ""}
      ${compute}
      <div class="dg-box dg-data" id="dg-data"><div class="dg-box-title">데이터 계층 <span>(프라이빗 서브넷)</span></div>
        <div class="dg-row">
          ${dgNode("dg-rds", "rds", "RDS", db0 ? `${db0.engine}${db0.multiAz ? " · Multi-AZ" : ""}` : "", { ghost: !dbs.length, href: "#/db?tab=rds", count: dbs.length })}
          ${dgNode("dg-cache", "cache", "ElastiCache", caches[0] ? caches[0].engine : "", { ghost: !caches.length, href: "#/db?tab=cache", count: caches.length })}
          ${efs.length ? dgNode("dg-efs", "efs", "EFS", `${efs[0].mountTargets.length}개 AZ 탑재`, { href: "#/storage?tab=efs", count: efs.length }) : ""}
        </div>
      </div>
    </div>`;
  }

  const firing = o.alarms.filter((a) => a.state === "ALARM").length;
  const right = `<div class="dg-right" id="dg-right">
    ${dgNode("dg-s3", "s3", "S3", o.buckets.length ? `${o.buckets.length}개 버킷` : "", { ghost: !o.buckets.length, href: "#/storage?tab=s3" })}
    ${dgNode("dg-ecr", "ecr", "ECR", o.ecr.length ? `${o.ecr.length}개 리포지토리` : "", { ghost: !o.ecr.length, href: "#/eks?tab=ecr" })}
    ${dgNode("dg-cw", "cloudwatch", "CloudWatch", firing ? `경보 ${firing}개 발생` : "로그 · 지표", { ghost: !o.alarms.length && !o.metrics.hasCompute, href: "#/monitoring" })}
  </div>`;

  return `<div class="dg" id="dg">
    <svg class="dg-svg" id="dg-svg"></svg>
    <svg class="dg-traffic" id="dg-traffic" aria-hidden="true"></svg>
    <div class="dg-grid">${chain}${vpcHtml}${right}</div>
  </div>
  <div class="dg-legend"><span><i class="l-edge"></i>외부 요청 흐름</span><span><i class="l-inner"></i>내부 연결</span><span><i class="l-ghost"></i>아직 만들지 않은 서비스 (클릭해서 만들기)</span></div>
  ${Flow.legendHtml()}`;
}

// 노드 사이 화살표 그리기 (레이아웃이 바뀌면 다시 계산)
function drawDiagramEdges() {
  const dg = byId("dg");
  const svg = byId("dg-svg");
  if (!dg || !svg) return;
  const base = dg.getBoundingClientRect();
  // whole=false: 아이콘만 기준 (가로 연결), whole=true: 이름표까지 포함 (세로 연결)
  const box = (id, whole = false) => {
    const el = id && byId(id);
    if (!el) return null;
    const target = !whole && el.classList.contains("dg-node") ? el.querySelector(".svc") : el;
    const r = target.getBoundingClientRect();
    return { l: r.left - base.left, t: r.top - base.top, r: r.right - base.left, b: r.bottom - base.top, ghost: el.classList.contains("ghost") };
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const paths = [];
  // dir: "v"(세로 고정) 또는 자동 — 자동이면 가로로 겹치는 상자끼리만 세로로 잇기
  const link = (a, b, cls, both = false, dir = "auto", flow = "") => {
    const Aw = box(a, true);
    const Bw = box(b, true);
    if (!Aw || !Bw) return;
    const klass = Aw.ghost || Bw.ghost ? "ghost" : cls;
    let d;
    const xOverlap = Math.min(Aw.r, Bw.r) - Math.max(Aw.l, Bw.l) > 0;
    if ((Bw.t >= Aw.b - 2 || Bw.b <= Aw.t + 2) && (dir === "v" || xOverlap)) {
      // 위아래로 떨어져 있으면 세로 연결 (이름표를 가로지르지 않도록 전체 상자 기준)
      const down = Bw.t >= Aw.b - 2;
      const x2 = (Bw.l + Bw.r) / 2;
      const x1 = clamp(x2, Aw.l + 12, Aw.r - 12);
      const y1 = down ? Aw.b + 2 : Aw.t - 2;
      const yEnd = down ? Bw.t - 5 : Bw.b + 5;
      const mid = (y1 + yEnd) / 2;
      d = Math.abs(x1 - x2) < 1 ? `M${x1} ${y1} V${yEnd}` : `M${x1} ${y1} V${mid} H${x2} V${yEnd}`;
      paths.push(`<path class="${klass}" data-flow="${flow}" data-ghost="${klass === "ghost" ? 1 : 0}" d="${d}" marker-end="url(#ah-${klass})" ${both ? `marker-start="url(#ahs-${klass})"` : ""}/>`);
      return;
    }
    const A = box(a);
    const B = box(b);
    if (B.l >= A.r - 2) {
      // 오른쪽으로
      const y2 = (B.t + B.b) / 2;
      const y1 = clamp(y2, A.t + 12, A.b - 12);
      const ya = A.b - A.t < 80 ? (A.t + A.b) / 2 : y1;
      const mid = (A.r + B.l) / 2;
      d = `M${A.r + 3} ${ya} H${mid} V${y2} H${B.l - 5}`;
    } else if (B.r <= A.l + 2) {
      const y2 = (B.t + B.b) / 2;
      const y1 = clamp(y2, A.t + 12, A.b - 12);
      const mid = (A.l + B.r) / 2;
      d = `M${A.l - 3} ${y1} H${mid} V${y2} H${B.r + 5}`;
    } else if (B.t >= A.b - 2) {
      // 아래로
      const x2 = (B.l + B.r) / 2;
      const x1 = clamp(x2, A.l + 12, A.r - 12);
      const mid = (A.b + B.t) / 2;
      d = `M${x1} ${A.b + 2} V${mid} H${x2} V${B.t - 5}`;
    } else if (B.b <= A.t + 2) {
      const x2 = (B.l + B.r) / 2;
      const x1 = clamp(x2, A.l + 12, A.r - 12);
      const mid = (A.t + B.b) / 2;
      d = `M${x1} ${A.t - 2} V${mid} H${x2} V${B.b + 5}`;
    } else return;
    paths.push(`<path class="${klass}" data-flow="${flow}" data-ghost="${klass === "ghost" ? 1 : 0}" d="${d}" marker-end="url(#ah-${klass})" ${both ? `marker-start="url(#ahs-${klass})"` : ""}/>`);
  };
  link("dg-users", "dg-r53", "edge", false, "auto", "users-r53");
  link("dg-r53", "dg-cf", "edge", false, "auto", "r53-cf");
  link("dg-cf", "dg-alb", "edge", false, "auto", "cf-alb");
  link("dg-alb", "dg-compute", "edge", false, "auto", "alb-compute");
  link(byId("dg-compute-2") ? "dg-compute-2" : "dg-compute", "dg-data", "inner", false, "auto", "compute-data");
  if (byId("dg-compute-2")) link("dg-compute", "dg-compute-2", "inner", false, "auto", "compute-compute2");
  // 좁은 화면에서는 오른쪽 서비스들이 VPC 아래로 내려가므로 VPC 테두리에서 바로 잇기
  const R = box("dg-right", true);
  const V = box("dg-vpc", true);
  const stacked = R && V && R.t >= V.b - 2;
  link(stacked ? "dg-vpc" : "dg-compute", "dg-s3", "inner", true, "auto", "compute-s3");
  link("dg-ecr", stacked ? "dg-vpc" : "dg-compute", "inner", false, "auto", "ecr-compute");
  link(stacked ? "dg-vpc" : "dg-data", "dg-cw", "inner", false, "auto", "data-cw");
  // 가용 영역이 세로로 쌓이면 맨 아래 영역에서만 선을 그어 다른 영역을 가로지르지 않게
  const azBoxes = [0, 1, 2, 3, 4, 5].map((i) => box(`dg-az-${i}`, true));
  const lowest = Math.max(0, ...azBoxes.filter(Boolean).map((b) => b.b));
  azBoxes.forEach((b, i) => {
    if (b && b.b >= lowest - 4) link(`dg-az-${i}`, byId("dg-ingress") ? "dg-ingress" : "", "inner", false, "v", "az-ingress");
  });
  link("dg-ingress", "dg-ksvc", "inner", false, "auto", "ingress-ksvc");
  const marker = (id, color, start) =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="${start ? 1 : 9}" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${color}"/></marker>`;
  svg.innerHTML = `<defs>
      ${marker("ah-edge", "#f07b16")}${marker("ah-inner", "#2563eb")}${marker("ah-ghost", "#c3cad6")}
      ${marker("ahs-edge", "#f07b16", true)}${marker("ahs-inner", "#2563eb", true)}${marker("ahs-ghost", "#c3cad6", true)}
    </defs>${paths.join("")}`;
}

/* ==================================================================
   개요 화면
   ================================================================== */
function kpiCards(o, issues) {
  const warn = issues.filter((i) => i.level === "warn").length;
  const hasAny = o.vpcs.length || o.buckets.length || o.instances.length;
  const status = !hasAny ? "gray" : warn ? "amber" : "green";
  const statusText = !hasAny ? "리소스 없음" : warn ? `점검 필요 ${warn}` : "정상";
  const useCluster = o.clusters.length > 0;
  const pods = o.pods.filter((p) => p.state === "Running").length;
  const running = o.instances.filter((i) => i.state === "running").length;
  const nodes = o.instances.filter((i) => i.managedBy && i.managedBy.type === "nodegroup" && i.state === "running").length;
  const budget = o.budget ? Math.round((o.cost.total / o.budget.monthlyLimit) * 100) : null;
  return `<div class="kpis" id="kpis">
    <a class="kpi" href="#/monitoring?tab=health"><span class="kpi-icon ${status}">${'<svg viewBox="0 0 24 24"><path d="M12 2.8 20 5.8v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10v-6z"/><path d="M8.4 12.2l2.6 2.6 4.8-5.2" fill="none"/></svg>'}</span>
      <div><div class="kpi-label">${useCluster ? "클러스터 상태" : "환경 상태"}</div><div class="kpi-value ${status}">${statusText}</div><div class="kpi-sub">${issues.length ? `점검 항목 ${issues.length}개` : "보안 · 비용 자동 점검"}</div></div></a>
    <a class="kpi" href="${useCluster ? "#/workloads?tab=pods" : "#/ec2?tab=instances"}"><span class="kpi-icon blue">${`<svg viewBox="0 0 24 24">${GLYPHS.cube}</svg>`}</span>
      <div><div class="kpi-label">${useCluster ? "실행 중인 파드" : "실행 중인 인스턴스"}</div><div class="kpi-value">${useCluster ? pods : running}</div><div class="kpi-sub">${useCluster ? `워커 노드 ${nodes}대 · 디플로이먼트 ${o.deployments.length}개` : `전체 인스턴스 ${o.instances.filter((i) => i.state !== "terminated").length}대`}</div></div></a>
    <a class="kpi" href="#/cost"><span class="kpi-icon orange">${`<svg viewBox="0 0 24 24">${GLYPHS.cost}</svg>`}</span>
      <div><div class="kpi-label">예상 월 비용</div><div class="kpi-value">${money(o.cost.total)}</div><div class="kpi-sub">${budget !== null ? `예산의 ${budget}%` : "학습용 근사치 · 서울 리전"}</div></div></a>
  </div>`;
}

function progressCard(o) {
  const p = computeProgress(o);
  const R = 52;
  const C = 2 * Math.PI * R;
  return `<div class="progress-wrap">
    <div class="donut"><svg viewBox="0 0 132 132"><circle class="track" cx="66" cy="66" r="${R}"/><circle class="fill" cx="66" cy="66" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p.pct / 100)}"/></svg><b>${p.pct}%</b></div>
    <ul class="module-list">${p.modules
      .map((m) => {
        const cls = m.done === m.total ? "done" : m.done ? "part" : "";
        return `<li><a href="#/guide?focus=${m.key}"><span class="mcheck ${cls}" style="--p:${Math.round((m.done / m.total) * 100)}%">${m.done === m.total ? glyph("check") : ""}</span>${esc(m.title)}<small>${m.done}/${m.total}</small></a></li>`;
      })
      .join("")}</ul>
  </div>`;
}

function activityList(events, limit = 6) {
  if (!events.length) return `<p class="muted">아직 활동이 없어요. 첫 VPC를 만들어 보세요.</p>`;
  return `<ul class="feed">${events
    .slice(0, limit)
    .map((e) => {
      const t = eventInfo(e);
      return `<li><span class="dot ${t.tone}"></span><div><div class="feed-text">${t.text}</div><div class="feed-time">${timeAgo(e.t)}</div></div></li>`;
    })
    .join("")}</ul>`;
}

function diagramSignature(o) {
  return JSON.stringify([
    o.vpcs.map((v) => v.id),
    o.subnets.map((s) => s.id + s.egress),
    o.igws.map((g) => g.state),
    o.nats.map((n) => n.state),
    o.instances.map((i) => i.id + i.state + i.publicIp),
    o.pods.map((p) => p.id + p.state + p.nodeId),
    o.lbs.map((l) => l.id + l.state + l.healthy + l.totalTargets),
    o.clusters.map((c) => c.id + c.status + c.addons.map((a) => a.status).join()),
    o.services.length, o.ingresses.length, o.zones.length,
    o.cloudfront.map((c) => c.status), o.dbs.map((d) => d.state + d.multiAz), o.caches.map((c) => c.state), o.efs.length,
    o.buckets.length, o.ecr.length, o.alarms.map((a) => a.state), o.metrics.hasCompute, o.vgws.map((v) => v.vpcId),
    Diagram.vpcId,
  ]);
}

App.route(
  "/",
  async () => {
    const o = await load.overview();
    const issues = healthIssues(o);
    const firing = issues.filter((i) => i.level === "warn").length;
    const hasAny = o.vpcs.length || o.buckets.length;
    byId("content").innerHTML = `
      <div class="ov">
        <div class="ov-main">
          <div class="hero-head"><h1>인프라 개요</h1><p>구성하고, 관찰하고, 이해하는 나만의 클라우드 아키텍처</p></div>
          <div id="kpi-slot">${kpiCards(o, issues)}</div>
          ${card(
            "실시간 아키텍처",
            `<div id="dg-slot">${buildDiagram(o)}</div>`,
            {
              cls: "dg-card",
              actions: `<span class="status-line ${!hasAny ? "idle" : firing ? "warn" : ""}" id="dg-status"><i></i>${!hasAny ? "구성 대기 중" : firing ? `점검 필요 ${firing}건` : "모든 시스템 정상"}</span>`,
            }
          )}
        </div>
        <div class="ov-side">
          ${card("학습 진행", `<div id="progress-slot">${progressCard(o)}</div>`, { actions: `<a class="card-link" href="#/guide">전체 보기</a>` })}
          ${card("최근 활동", `<div id="activity-slot">${activityList(o.events)}</div>`, { actions: `<a class="card-link" href="#/monitoring?tab=activity">전체 보기</a>` })}
        </div>
        <div class="ov-wide">
          ${card(o.clusters.length ? "클러스터 지표" : "리소스 지표", `<div id="metrics-root"></div>`, { actions: rangeButtons("24h"), sub: "CloudWatch 시뮬레이션 · 2초마다 새 값이 들어와요" })}
        </div>
      </div>`;

    let sig = diagramSignature(o);
    const bindDiagram = () => {
      document.querySelectorAll("[data-vpc]").forEach((b) =>
        b.addEventListener("click", () => {
          Diagram.vpcId = b.dataset.vpc;
          App.refresh(true);
        })
      );
      requestAnimationFrame(drawDiagramEdges);
      byId("dg-slot").querySelectorAll("img").forEach((img) => img.addEventListener("load", drawDiagramEdges, { once: true }));
    };
    bindDiagram();
    Flow.start(o);
    const ro = new ResizeObserver(() => drawDiagramEdges());
    ro.observe(byId("dg-slot"));

    const panel = MetricsPanel("metrics-root", { range: "24h" });
    bindRange(panel);

    // 3초마다 현황을 다시 받아서 바뀐 부분만 갈아끼움
    App.every(3000, async () => {
      if (!byId("dg-slot")) return;
      const n = await load.overview().catch(() => null);
      if (!n) return;
      const iss = healthIssues(n);
      byId("kpi-slot").innerHTML = kpiCards(n, iss);
      byId("progress-slot").innerHTML = progressCard(n);
      byId("activity-slot").innerHTML = activityList(n.events);
      const warnN = iss.filter((i) => i.level === "warn").length;
      const any = n.vpcs.length || n.buckets.length;
      byId("dg-status").className = `status-line ${!any ? "idle" : warnN ? "warn" : ""}`;
      byId("dg-status").innerHTML = `<i></i>${!any ? "구성 대기 중" : warnN ? `점검 필요 ${warnN}건` : "모든 시스템 정상"}`;
      const s2 = diagramSignature(n);
      if (s2 !== sig) {
        sig = s2;
        byId("dg-slot").innerHTML = buildDiagram(n);
        bindDiagram();
      }
      Flow.update(n);
    });
  },
  { section: "home", crumbs: () => ["개요"] }
);
