/* ---- 실시간 아키텍처 위를 흐르는 트래픽 애니메이션 ---- */
// 다이어그램의 선(path[data-flow])을 따라 작은 점(패킷)을 움직여요.
// 어떤 패킷이 어디까지 가는지는 "지금 만들어진 리소스"로 정해져요.
//   - 리소스가 없으면 트래픽도 없음
//   - Route 53이 있으면 DNS 조회, CloudFront가 있으면 캐시 적중 시 엣지에서 바로 응답
//   - ALB에 정상 대상이 없으면 503으로 되돌아감, 보안 그룹이 80을 막으면 차단
//   - DB · 캐시 · S3 · ECR · CloudWatch는 각자 성격에 맞는 색과 주기로 오감

/* ---- 패킷 종류 (색 · 설명) ---- */
const PACKET = {
  req: { color: "#f07b16", label: "요청" },
  res: { color: "#16a34a", label: "응답" },
  dns: { color: "#8b5cf6", label: "DNS 조회" },
  db: { color: "#2563eb", label: "DB 쿼리" },
  cache: { color: "#0e9fb5", label: "캐시 조회" },
  s3: { color: "#65a30d", label: "S3 읽기·쓰기" },
  pull: { color: "#b45309", label: "이미지 받기" },
  metric: { color: "#db2777", label: "지표 · 로그" },
  err: { color: "#dc2626", label: "차단 · 오류" },
};

const Flow = {
  o: null,
  packets: [],
  raf: 0,
  timers: [],
  paused: false,
  lastCaption: 0,
  reduced: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,

  legendHtml() {
    const kinds = ["req", "res", "dns", "db", "cache", "s3", "pull", "metric", "err"];
    return `<div class="flow-bar">
      <button type="button" class="flow-toggle" data-flow-toggle>${this.paused ? "▶ 트래픽 재생" : "❚❚ 일시 정지"}</button>
      <div class="flow-caption" id="flow-caption"><i></i><span>${esc(this.idleText())}</span></div>
    </div>
    <div class="flow-legend">${kinds.map((k) => `<span><b style="background:${PACKET[k].color}"></b>${PACKET[k].label}</span>`).join("")}</div>`;
  },

  idleText() {
    if (!this.o) return "트래픽을 준비하는 중이에요.";
    const p = this.profile;
    if (p && p.hasTraffic) return "요청이 흐르고 있어요. 점 하나가 요청 하나예요.";
    if (!this.o.vpcs.length && !this.o.buckets.length) return "아직 리소스가 없어 트래픽이 없어요. VPC와 서버를 만들면 요청이 흐르기 시작해요.";
    return "요청을 받을 곳이 아직 없어요. 퍼블릭 서브넷의 인스턴스나 로드 밸런서를 만들어 보세요.";
  },

  /* ---- 리소스 → 트래픽 성격 ---- */
  analyze(o) {
    const running = o.instances.filter((i) => i.state === "running");
    const appHosts = running.filter((i) => !(i.managedBy && i.managedBy.type === "nodegroup"));
    const nodes = running.filter((i) => i.managedBy && i.managedBy.type === "nodegroup");
    const igwVpcs = new Set(o.igws.filter((g) => g.state === "attached").map((g) => g.vpcId));
    const subnetOf = (id) => o.subnets.find((s) => s.id === id);
    const sgOf = (id) => o.sgs.find((s) => s.id === id);
    const opens80 = (i) => {
      const sg = sgOf(i.securityGroupId);
      return !!(sg && sg.inboundRules.some((r) => ["80", "443"].includes(String(r.port)) || r.protocol === "all"));
    };
    const publicHosts = appHosts.filter((i) => i.publicIp && igwVpcs.has(i.vpcId) && (subnetOf(i.subnetId) || {}).egress === "igw");
    const lbs = o.lbs.filter((l) => l.state === "active" && l.scheme === "internet-facing");
    const alb = lbs.find((l) => l.type === "application") || lbs[0] || null;
    const cf = o.cloudfront.find((c) => c.status === "Deployed" && c.enabled !== false) || null;
    const zone = o.zones.find((z) => z.type !== "private" && z.records.some((r) => !r.system)) || null;
    const cluster = o.clusters.find((c) => c.status === "ACTIVE") || null;
    const runningPods = o.pods.filter((p) => p.state === "Running").length;
    const ingress = o.ingresses.length > 0;

    // 요청이 도착할 수 있는 곳이 있어야 트래픽이 생김
    let target = null;
    if (alb) target = alb.healthy > 0 ? "alb" : "alb-empty";
    else if (cf && cf.originType === "s3") target = "cf-s3";
    else if (publicHosts.length) target = opens80(publicHosts[0]) ? "direct" : "direct-blocked";

    return {
      target,
      alb, cf, zone, cluster,
      eks: !!(cluster && runningPods && ingress && byId("dg-ingress") && !byId("dg-ingress").classList.contains("ghost")),
      hosts: appHosts.length + nodes.length,
      db: o.dbs.some((d) => d.state === "available"),
      cache: o.caches.some((c) => c.state === "available"),
      buckets: o.buckets.length > 0,
      pulling: o.pods.filter((p) => ["ContainerCreating"].includes(p.state)).length,
      pullFail: o.pods.filter((p) => p.state === "ImagePullBackOff").length,
      privateNodes: nodes.some((n) => (subnetOf(n.subnetId) || {}).egress === "nat"),
      firing: o.alarms.some((a) => a.state === "ALARM"),
      twoCompute: !!byId("dg-compute-2"),
      rps: (o.metrics && o.metrics.rps) || 0,
      hasTraffic: !!target || running.length > 0,
    };
  },

  /* ---- 시작 · 갱신 · 정지 ---- */
  start(o) {
    this.stop();
    this.update(o);
    if (this.reduced) return this.caption("움직임 줄이기 설정이 켜져 있어 트래픽 애니메이션을 멈췄어요.", "res");
    const loop = (now) => {
      if (!byId("dg-slot")) return this.stop();
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.schedule();
  },

  update(o) {
    this.o = o;
    this.profile = this.analyze(o);
    const cap = byId("flow-caption");
    if (cap && Date.now() - this.lastCaption > 4000) cap.querySelector("span").textContent = this.idleText();
    const t = document.querySelector("[data-flow-toggle]");
    if (t) t.textContent = this.paused ? "▶ 트래픽 재생" : "❚❚ 일시 정지";
  },

  stop() {
    cancelAnimationFrame(this.raf);
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.packets = [];
  },

  // 종류별로 따로 도는 타이머 (간격은 매번 다시 계산 → 리소스가 바뀌면 바로 반영)
  schedule() {
    const every = (fn, gap) => {
      const run = () => {
        if (!byId("dg-slot")) return;
        const ms = gap();
        if (ms && !this.paused && !document.hidden && this.packets.length < 70) fn();
        this.timers.push(setTimeout(run, (ms || 1500) * (0.75 + Math.random() * 0.5)));
      };
      this.timers.push(setTimeout(run, 300 + Math.random() * 600));
    };
    const p = () => this.profile || {};
    // 사용자 요청: 요청 수 지표가 높을수록 자주
    every(() => this.webRequest(), () => (p().target || p().zone ? Math.max(380, 1700 - p().rps * 2.4) : 0));
    // 앱 → S3
    every(() => this.s3Io(), () => (p().buckets && p().hosts ? 2600 : 0));
    // ECR 이미지 받기 (파드가 만들어지는 중일 때만)
    every(() => this.imagePull(), () => (p().pulling || p().pullFail ? 700 : 0));
    // CloudWatch로 지표 · 로그 전송
    every(() => this.metric(), () => (p().hosts || p().db ? 1500 : 0));
    // EKS ↔ EC2 계층 사이 내부 호출
    every(() => this.internal(), () => (p().twoCompute && p().hosts ? 3200 : 0));
  },

  /* ---- 여정(journey) 만들기 ---- */
  // hop = { flow, rev, kind, pulse, text }  — pulse: 도착했을 때 반짝일 요소 선택자
  launch(hops, opts = {}) {
    const list = hops.filter((h) => this.pathOf(h.flow));
    if (!list.length) return;
    this.packets.push({ hops: list, i: 0, t: 0, wait: 0, fade: opts.fade || null, dur: 0 });
  },

  // 가는 길 + (성공이면) 같은 길로 초록색 응답
  roundTrip(forward, { fail = null } = {}) {
    const back = forward
      .slice()
      .reverse()
      .map((h) => ({ flow: h.flow, rev: !h.rev, kind: fail ? "err" : "res", pulse: h.backPulse || null }));
    const hops = forward.concat(back);
    if (fail) hops[forward.length - 1] = { ...hops[forward.length - 1], text: fail };
    this.launch(hops);
  },

  webRequest() {
    const p = this.profile;
    const hops = [];
    const fwd = (flow, kind, pulse, text, extra = {}) => hops.push({ flow, rev: false, kind, pulse, text, ...extra });
    // 1) DNS
    if (p.zone) fwd("users-r53", "dns", "#dg-r53", `Route 53이 ${p.zone.domain} 주소를 알려줘요 (DNS 조회)`);
    else fwd("users-r53", "req", null);
    if (!p.target) {
      // 요청 받을 곳이 없으면 DNS 조회만 하고 끝
      return this.roundTrip(hops.slice(0, 1));
    }
    // 2) CloudFront
    fwd("r53-cf", "req", p.cf ? "#dg-cf" : null);
    if (p.cf) {
      const hitRate = p.target === "cf-s3" ? 0.7 : 0.45;
      if (Math.random() < hitRate) {
        hops[hops.length - 1].text = "CloudFront 캐시 적중 → 원본까지 가지 않고 엣지에서 바로 응답";
        return this.roundTrip(hops);
      }
      if (p.target === "cf-s3") {
        hops[hops.length - 1].text = "캐시에 없어서 CloudFront가 S3 원본에서 가져와요";
        hops[hops.length - 1].pulse = "#dg-cf, #dg-s3";
        return this.roundTrip(hops);
      }
    }
    // 3) 로드 밸런서 (없으면 인터넷 게이트웨이 → 퍼블릭 IP로 직접)
    const ec2Box = !!document.querySelector("#dg .dg-ec2 .dg-host");
    const viaEks = p.eks && (!ec2Box || Math.random() < 0.5);
    const hostPulse = ec2Box ? ".dg-ec2 .dg-host" : ".dg-pod";
    if (p.target === "alb" || p.target === "alb-empty") {
      fwd("cf-alb", "req", "#dg-alb");
      if (p.target === "alb-empty") return this.roundTrip(hops, { fail: `${p.alb.name}: 정상(healthy) 대상이 없어 503 응답` });
      hops[hops.length - 1].text = p.alb.type === "network" ? "NLB가 TCP 연결을 그대로 대상에 넘겨요 (L4)" : "ALB가 경로 규칙을 보고 정상 대상 중 하나로 보내요 (L7)";
      fwd("alb-compute", "req", p.twoCompute || viaEks ? null : hostPulse);
    } else {
      fwd("cf-alb", "req", null);
      fwd("alb-compute", "req", p.twoCompute ? null : hostPulse, "인터넷 게이트웨이를 지나 인스턴스의 퍼블릭 IP로 바로 들어가요", { chip: ".dg-chip.igw" });
    }
    // 4) 안쪽 계층: EKS(인그레스 → 서비스 → 파드) 또는 EC2
    let atEc2 = false;
    if (viaEks && p.target !== "direct" && p.target !== "direct-blocked") {
      fwd("ingress-ksvc", "req", "#dg-ksvc", "인그레스 → 쿠버네티스 서비스 → 파드로 전달돼요");
      fwd("az-ingress", "req", ".dg-pod", null, { rev: true });
    } else if (p.twoCompute) {
      fwd("compute-compute2", "req", ".dg-ec2 .dg-host");
      atEc2 = true;
    }
    if (p.target === "direct-blocked") return this.roundTrip(hops, { fail: "보안 그룹에 80/443 인바운드 규칙이 없어 요청이 차단돼요" });
    // 5) 데이터 계층: 캐시를 먼저 보고, 없으면 DB
    const toData = [];
    if (p.twoCompute && !atEc2) toData.push({ flow: "compute-compute2", rev: false, kind: "req", pulse: null });
    if (p.cache && Math.random() < 0.65) {
      toData.push({ flow: "compute-data", rev: false, kind: "cache", pulse: "#dg-cache", text: "ElastiCache에서 바로 찾았어요 (캐시 적중) — DB까지 안 가요" });
    } else if (p.db) {
      toData.push({ flow: "compute-data", rev: false, kind: "db", pulse: "#dg-rds", text: p.cache ? "캐시에 없어서 RDS에 쿼리해요 (캐시 미스)" : "RDS에 쿼리해서 데이터를 가져와요" });
    }
    if (toData.length > (p.twoCompute && !atEc2 ? 1 : 0) && Math.random() < 0.8) hops.push(...toData);
    this.roundTrip(hops);
  },

  s3Io() {
    const up = Math.random() < 0.4;
    this.launch([{ flow: "compute-s3", rev: !up, kind: "s3", pulse: up ? "#dg-s3" : ".dg-host", text: up ? "앱이 S3에 파일을 올려요 (PutObject)" : "앱이 S3에서 파일을 읽어요 (GetObject)" }]);
  },

  imagePull() {
    const p = this.profile;
    if (p.pullFail && (!p.pulling || Math.random() < 0.5)) {
      this.launch([{ flow: "ecr-compute", rev: false, kind: "err", pulse: null, text: "이미지를 받지 못했어요 (ImagePullBackOff) — 이미지 태그 · ECR 권한 · NAT를 확인하세요", stopAt: 0.6 }]);
      return;
    }
    this.launch([{ flow: "ecr-compute", rev: false, kind: "pull", pulse: ".dg-pod.busy, .dg-host", chip: p.privateNodes ? ".dg-chip.nat" : null, text: p.privateNodes ? "프라이빗 서브넷 노드가 NAT를 거쳐 ECR에서 이미지를 받아요" : "노드가 ECR에서 컨테이너 이미지를 받아요" }]);
  },

  metric() {
    const p = this.profile;
    this.launch([
      {
        flow: "data-cw",
        rev: false,
        kind: p.firing ? "err" : "metric",
        pulse: "#dg-cw",
        text: p.firing ? "지표가 임계값을 넘어 CloudWatch 경보가 울려요" : Math.random() < 0.5 ? "CPU · 메모리 지표가 CloudWatch로 모여요" : null,
      },
    ]);
  },

  internal() {
    this.launch([{ flow: "compute-compute2", rev: Math.random() < 0.5, kind: "req", pulse: null, text: "보안 그룹 체이닝으로 허용된 계층끼리 내부 호출해요" }]);
  },

  /* ---- 그리기 ---- */
  pathOf(flow) {
    const list = document.querySelectorAll(`#dg-svg path[data-flow="${flow}"]`);
    if (!list.length) return null;
    return list;
  },

  pulse(sel) {
    if (!sel) return;
    const all = document.querySelectorAll(`#dg ${sel.split(",").map((s) => s.trim()).join(`, #dg `)}`);
    if (!all.length) return;
    // 여러 개(파드 · 호스트)면 그중 하나만
    const pick = sel.includes("#dg-") ? [...all] : [all[Math.floor(Math.random() * all.length)]];
    pick.forEach((el) => {
      const target = el.querySelector(".svc") || el;
      target.classList.remove("flow-hit");
      void target.offsetWidth;
      target.classList.add("flow-hit");
    });
  },

  caption(text, kind) {
    const el = byId("flow-caption");
    if (!el || !text) return;
    const now = Date.now();
    if (now - this.lastCaption < 2200) return;
    // 같은 설명이 계속 반복되지 않도록, 최근 10초 안에 보여준 문장은 건너뛰기
    this.seen = this.seen || {};
    if (now - (this.seen[text] || 0) < 10000) return;
    this.seen[text] = now;
    this.lastCaption = now;
    el.querySelector("i").style.background = PACKET[kind].color;
    el.querySelector("span").textContent = text;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  },

  frame(now) {
    const svg = byId("dg-traffic");
    if (!svg) return;
    const dt = Math.min(64, now - (this.lastFrame || now));
    this.lastFrame = now;
    const out = [];
    const alive = [];
    for (const pk of this.packets) {
      if (!this.paused) this.step(pk, dt);
      if (pk.done) continue;
      alive.push(pk);
      const hop = pk.hops[pk.i];
      const path = pk.path;
      if (!path || !path.isConnected) continue;
      const len = path.getTotalLength();
      const t = hop.rev ? 1 - pk.t : pk.t;
      const pt = path.getPointAtLength(len * t);
      const ghost = path.dataset.ghost === "1";
      const fading = hop.stopAt && pk.t >= hop.stopAt;
      const op = ghost ? 0.4 : fading ? Math.max(0, 1 - pk.wait / 500) : 1;
      out.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${hop.kind === "metric" ? 3.6 : 5}" fill="${PACKET[hop.kind].color}" opacity="${op}" class="pk"/>`);
    }
    this.packets = alive;
    svg.innerHTML = out.join("");
  },

  step(pk, dt) {
    const hop = pk.hops[pk.i];
    if (!pk.path) {
      const list = this.pathOf(hop.flow);
      if (!list) return this.nextHop(pk);
      pk.path = list[Math.floor(Math.random() * list.length)];
      const len = pk.path.getTotalLength();
      const ghost = pk.path.dataset.ghost === "1";
      pk.dur = Math.max(260, (len / (ghost ? 520 : 230)) * 1000);
    }
    if (pk.wait > 0 && pk.t >= 1) {
      pk.wait -= dt;
      if (pk.wait <= 0) this.nextHop(pk);
      return;
    }
    if (hop.stopAt && pk.t >= hop.stopAt) {
      // 가다가 멈추고 사라짐 (실패)
      pk.wait += dt;
      if (pk.wait === dt) this.caption(hop.text, hop.kind);
      if (pk.wait > 500) pk.done = true;
      return;
    }
    pk.t += dt / pk.dur;
    if (pk.t >= 1) {
      pk.t = 1;
      const ghost = pk.path.dataset.ghost === "1";
      if (!ghost) this.pulse(hop.pulse);
      if (hop.chip) this.pulse(hop.chip);
      if (hop.text) this.caption(hop.text, hop.kind);
      pk.wait = ghost || !hop.pulse ? 1 : 160; // 서비스가 처리하는 짧은 시간
    }
  },

  nextHop(pk) {
    pk.i += 1;
    pk.t = 0;
    pk.wait = 0;
    pk.path = null;
    if (pk.i >= pk.hops.length) pk.done = true;
  },
};

// 일시 정지 버튼 (다이어그램이 다시 그려져도 동작하도록 위임)
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-flow-toggle]");
  if (!b) return;
  Flow.paused = !Flow.paused;
  b.textContent = Flow.paused ? "▶ 트래픽 재생" : "❚❚ 일시 정지";
});
