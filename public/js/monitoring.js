/* ---- 모니터링(CloudWatch) · 비용 화면 ---- */

const CMP_KO = { gt: "초과(>)", lt: "미만(<)" };
const ALARM_STATE = {
  OK: ["green", "정상"],
  ALARM: ["red", "경보"],
  INSUFFICIENT_DATA: ["gray", "데이터 부족"],
};
const alarmBadge = (s) => `<span class="badge ${ALARM_STATE[s] ? ALARM_STATE[s][0] : "gray"}"><i></i>${esc(ALARM_STATE[s] ? ALARM_STATE[s][1] : s)}</span>`;

const MonitoringPages = {
  metrics: {
    list: (o) => {
      const running = o.instances.filter((i) => i.state === "running");
      const sources = [
        ...running.map((i) => ({ kind: "EC2", name: i.name, sub: `${i.instanceType} · ${i.availabilityZone.slice(-2)}`, icon: "ec2" })),
        ...o.dbs.filter((d) => d.state === "available").map((d) => ({ kind: "RDS", name: d.identifier, sub: d.instanceClass, icon: "rds" })),
        ...o.lbs.filter((l) => l.state === "active").map((l) => ({ kind: l.type === "network" ? "NLB" : "ALB", name: l.name, sub: `대상 ${l.healthy}/${l.totalTargets} 정상`, icon: "elb" })),
        ...o.caches.map((c) => ({ kind: "ElastiCache", name: c.name || c.id, sub: c.nodeType || "", icon: "cache" })),
      ];
      return (
        pageHead({ icon: "cloudwatch", title: "CloudWatch 지표", desc: "실행 중인 리소스의 CPU · 메모리 · 요청 수를 모아 보여줘요. 이 사이트는 부하를 <b>시뮬레이션</b>해서 2초마다 새 값이 들어와요." }) +
        card("전체 지표", `<div id="mon-metrics"></div>`, { actions: rangeButtons("1h"), sub: "리소스 수와 Auto Scaling 상태에 따라 값이 달라져요. 인스턴스를 늘리면 평균 CPU가 내려가요." }) +
        `<div class="grid-2">` +
        card(
          "지표를 보내는 리소스",
          table(
            [
              { label: "리소스", render: (s) => `<span class="cell-title">${svc(s.icon, "sm")}${esc(s.name)}</span>` },
              { label: "유형", render: (s) => tag(s.kind, "blue") },
              { label: "정보", render: (s) => esc(s.sub) },
            ],
            sources,
            { empty: "지표를 보내는 리소스가 없어요.", emptyAction: `<a class="btn" href="#/ec2/launch">인스턴스 시작</a>` }
          )
        ) +
        card(
          "알아두기",
          `<ul class="plain-list">
            <li><b>기본 지표</b>: EC2는 CPU · 네트워크 · 디스크 지표를 5분 간격으로 무료 제공 (상세 모니터링은 1분).</li>
            <li><b>메모리 · 디스크 사용률</b>은 기본 지표에 없어요 → <b>CloudWatch 에이전트</b>를 설치하고 역할에 <code>CloudWatchAgentServerPolicy</code>를 붙여야 해요.</li>
            <li><b>경보</b>는 지표가 임계값을 넘으면 SNS 알림 · Auto Scaling 정책을 실행해요.</li>
            <li>EKS는 <b>Container Insights</b> 추가 기능으로 노드 · 파드 지표를 모아요.</li>
          </ul>`
        ) +
        `</div>`
      );
    },
    bind: () => {
      const panel = MetricsPanel("mon-metrics", { range: "1h" });
      bindRange(panel);
    },
  },

  alarms: {
    list: (o) =>
      pageHead({ icon: "alarm", title: "CloudWatch 경보", desc: "지표가 기준을 넘으면 상태가 <b>경보(ALARM)</b>로 바뀌고 알림을 보내요. 상태는 OK · ALARM · INSUFFICIENT_DATA 세 가지예요.", actions: `<a class="btn primary" href="${newHref("monitoring", "alarms")}">경보 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "경보", render: (a) => `<span class="cell-title">${svc("alarm", "sm")}${esc(a.name)}</span><span class="cell-sub">${esc(a.stateReason || "")}</span>` },
            { label: "상태", render: (a) => alarmBadge(a.state) },
            { label: "조건", render: (a) => `${METRIC_DEF[a.metric].label} ${CMP_KO[a.comparison]} ${a.threshold}${a.metric === "rps" ? "" : "%"} · ${a.periodMinutes}분` },
            { label: "알림", render: (a) => (a.notifyEmail ? esc(a.notifyEmail) : `<span class="muted">없음</span>`) },
            { label: "", render: (a) => btn("삭제", "del-alarm", a.id, { tone: "danger" }) },
          ],
          o.alarms,
          { empty: "경보가 없어요. CPU 70% 초과 경보부터 만들어 보세요.", emptyAction: `<a class="btn primary" href="${newHref("monitoring", "alarms")}">경보 생성</a>`, rowHref: (a) => detailHref("monitoring", "alarms", a.id) }
        )
      ),
    detail: (o, id) => {
      const a = o.alarms.find((x) => x.id === id);
      if (!a) return info("경보를 찾을 수 없어요.", "error");
      return (
        pageHead({ icon: "alarm", title: a.name, desc: esc(a.stateReason || ""), actions: btn("경보 삭제", "del-alarm", a.id, { tone: "danger" }) }) +
        `<div class="grid-2">` +
        card(
          "설정",
          kv([
            ["상태", alarmBadge(a.state)],
            ["지표", METRIC_DEF[a.metric].label],
            ["조건", `${CMP_KO[a.comparison]} ${a.threshold}${a.metric === "rps" ? " req/s" : "%"}`],
            ["평가 기간", `${a.periodMinutes}분`],
            ["알림 (SNS → 이메일)", a.notifyEmail ? esc(a.notifyEmail) : "없음"],
            ["생성", fmtTime(a.createdAt)],
          ])
        ) +
        card(
          "상태 변경 기록",
          a.history && a.history.length
            ? `<ul class="feed">${a.history
                .map((h) => `<li><span class="dot ${h.to === "ALARM" ? "red" : h.to === "OK" ? "green" : "gray"}"></span><div><div class="feed-text">${alarmBadge(h.from)} → ${alarmBadge(h.to)}</div><div class="feed-time">${esc(h.reason)} · ${timeAgo(h.t)}</div></div></li>`)
                .join("")}</ul>`
            : `<p class="muted">아직 상태가 바뀐 적이 없어요.</p>`
        ) +
        `</div>` +
        card("현재 지표", `<div id="mon-metrics"></div>`, { actions: rangeButtons("1h") })
      );
    },
    bind: (o, p) => {
      if (!p.get("id") || !byId("mon-metrics")) return;
      bindRange(MetricsPanel("mon-metrics", { range: "1h" }));
    },
    form: () =>
      pageHead({ icon: "alarm", title: "경보 생성" }) +
      errorBox() +
      section(
        "지표와 조건",
        field("경보 이름", input("f-name", { value: "high-cpu" })) +
          field("지표", select("f-metric", [{ value: "cpu", label: "CPU 사용률 (%)" }, { value: "mem", label: "메모리 사용률 (%)" }, { value: "rps", label: "요청 수 (req/s)" }], "cpu")) +
          field("조건", select("f-cmp", [{ value: "gt", label: "보다 큼 (>)" }, { value: "lt", label: "보다 작음 (<)" }], "gt")) +
          field("임계값", input("f-threshold", { value: "70", type: "number" })) +
          field("평가 기간", select("f-period", [{ value: "1", label: "1분" }, { value: "5", label: "5분" }, { value: "15", label: "15분" }], "5"), "이 기간 동안 조건을 계속 만족해야 경보 상태가 돼요."),
        "Auto Scaling의 대상 추적 정책도 내부적으로 이런 경보를 만들어서 동작해요."
      ) +
      section("알림", field("이메일 (SNS 주제 구독)", input("f-email", { placeholder: "me@example.com", type: "email" }), "실제로 메일이 가지는 않아요. 알림 벨에 표시돼요.")) +
      formActions(listHref("monitoring", "alarms"), "경보 생성"),
    submit: async () => {
      await api.post("/api/alarms", { name: val("f-name"), metric: val("f-metric"), comparison: val("f-cmp"), threshold: val("f-threshold"), periodMinutes: val("f-period"), notifyEmail: val("f-email") });
      toast("경보를 만들었어요. 몇 초 안에 평가가 시작돼요.");
      location.hash = listHref("monitoring", "alarms");
    },
    wire: {
      "del-alarm": async (id) => {
        await api.del(`/api/alarms/${id}`);
        toast("경보를 삭제했어요.");
        if (App.parse().params.get("id")) location.hash = listHref("monitoring", "alarms");
        else App.refresh();
      },
    },
  },

  logs: {
    list: () => pageHead({ icon: "cloudwatch", title: "로그 그룹", desc: "서비스가 로그를 보내는 곳이에요. 로그 그룹마다 보존 기간을 정해서 비용을 관리해요." }) + `<div id="logs-slot"></div>`,
    after: async () => {
      const groups = await api.get("/api/log-groups");
      byId("logs-slot").innerHTML = card(
        "",
        table(
          [
            { label: "로그 그룹", render: (g) => `<span class="cell-title">${svc("cloudwatch", "sm")}${mono(g.name)}</span>` },
            { label: "보내는 곳", render: (g) => tag(g.source, "blue") },
            { label: "보존 기간", render: () => "1개월" },
          ],
          groups,
          { empty: "로그 그룹이 없어요. EKS 클러스터 · RDS를 만들거나, 인스턴스 역할에 CloudWatchAgentServerPolicy를 붙이면 생겨요." }
        )
      );
    },
  },

  health: {
    list: (o) => {
      const issues = healthIssues(o);
      const warn = issues.filter((i) => i.level === "warn");
      const infos = issues.filter((i) => i.level !== "warn");
      const row = (i) => `<li><a href="${i.href}"><span class="dot ${i.level === "warn" ? "orange" : "blue"}"></span><span>${esc(i.text)}</span></a></li>`;
      return (
        pageHead({ icon: "shield", title: "환경 점검", desc: "Trusted Advisor · Security Hub처럼 보안 · 안정성 · 비용 관점에서 지금 구성을 자동으로 점검해요." }) +
        (issues.length ? "" : info("점검 항목이 없어요. 지금 구성은 기본 원칙을 잘 지키고 있어요.", "ok")) +
        `<div class="grid-2">` +
        card(`주의 <span class="count-pill">${warn.length}</span>`, warn.length ? `<ul class="issue-list">${warn.map(row).join("")}</ul>` : `<p class="muted">없음</p>`, { sub: "보안 위험이나 서비스 장애로 이어질 수 있는 항목" }) +
        card(`권장 <span class="count-pill">${infos.length}</span>`, infos.length ? `<ul class="issue-list">${infos.map(row).join("")}</ul>` : `<p class="muted">없음</p>`, { sub: "비용 절감 · 가용성 개선 제안" }) +
        `</div>`
      );
    },
  },

  activity: {
    list: () => pageHead({ icon: "guide", title: "활동 기록", desc: "CloudTrail처럼 이 계정에서 일어난 변경(API 호출)을 시간순으로 보여줘요." }) + `<div id="act-slot"></div>`,
    after: async () => {
      const events = await api.get("/api/events?limit=200");
      byId("act-slot").innerHTML = card(
        "",
        table(
          [
            { label: "시간", render: (e) => `<span title="${esc(fmtTime(e.t))}">${timeAgo(e.t)}</span>` },
            { label: "활동", render: (e) => { const t = eventInfo(e); return `<span class="cell-title"><span class="dot ${t.tone}"></span>${t.text}</span>`; } },
            { label: "API", render: (e) => mono(`${e.method} ${e.path}`) },
          ],
          events,
          { empty: "아직 활동이 없어요." }
        )
      );
    },
  },
};

App.route("/monitoring", (p) => renderSection(MonitoringPages, "monitoring", "metrics", p), sectionMeta("monitoring", "metrics"));

/* ==================================================================
   비용
   ================================================================== */
async function renderCost() {
  const c = await api.get("/api/cost");
  const bySvc = {};
  c.items.forEach((i) => (bySvc[i.service] = (bySvc[i.service] || 0) + i.monthly));
  const svcRows = Object.entries(bySvc).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...svcRows.map((r) => r[1]));
  const budget = c.budget;
  const pct = budget ? Math.round((c.total / budget.monthlyLimit) * 100) : null;
  const tone = pct === null ? "" : pct >= 100 ? "bad" : pct >= budget.alertPercent ? "warn" : "";
  const daily = c.total / 30;

  byId("content").innerHTML =
    pageHead({ icon: "cost", title: "비용 관리", desc: "지금 만들어 둔 리소스를 한 달 내내 켜 두면 얼마쯤 나올지 계산해요. <b>서울 리전 온디맨드 기준 학습용 근사치</b>예요 (데이터 전송 · 요청 요금 제외)." }) +
    `<div class="kpis">
      <div class="kpi"><span class="kpi-icon orange"><svg viewBox="0 0 24 24">${GLYPHS.cost}</svg></span><div><div class="kpi-label">예상 월 비용</div><div class="kpi-value">${money(c.total)}</div><div class="kpi-sub">${c.hoursPerMonth}시간 기준</div></div></div>
      <div class="kpi"><span class="kpi-icon blue"><svg viewBox="0 0 24 24">${GLYPHS.cube}</svg></span><div><div class="kpi-label">하루 평균</div><div class="kpi-value">${money(daily)}</div><div class="kpi-sub">과금 항목 ${c.items.length}개</div></div></div>
      <div class="kpi"><span class="kpi-icon ${tone === "bad" ? "red" : tone === "warn" ? "amber" : "green"}"><svg viewBox="0 0 24 24">${GLYPHS.alarm}</svg></span><div><div class="kpi-label">예산 (AWS Budgets)</div><div class="kpi-value">${budget ? `${pct}%` : "미설정"}</div><div class="kpi-sub">${budget ? `월 ${money(budget.monthlyLimit)} · ${budget.alertPercent}%에서 알림` : "예산을 정하면 초과 전에 알려줘요"}</div></div></div>
    </div>` +
    `<div class="grid-2">` +
    card(
      "서비스별 비용",
      svcRows.length
        ? `<div class="cost-bars">${svcRows.map(([s, v]) => `<div class="cost-row"><span>${esc(s)}</span><div class="bar"><i style="width:${Math.max(2, (v / max) * 100)}%"></i></div><b>${money(v)}</b></div>`).join("")}</div>`
        : `<p class="muted">비용이 드는 리소스가 없어요. S3 버킷 · IAM · VPC 자체는 무료예요.</p>`
    ) +
    card(
      "예산 설정",
      `${budget ? `<div class="bar ${tone}" style="margin-bottom:12px"><i style="width:${Math.min(100, pct)}%"></i></div>` : ""}
      <div class="inline-form">
        ${field("월 예산 (USD)", input("b-limit", { value: budget ? budget.monthlyLimit : "50", type: "number" }))}
        ${field("알림 기준 (%)", input("b-alert", { value: budget ? budget.alertPercent : "80", type: "number" }))}
        <button class="btn blue" data-act="budget" data-id="x">저장</button>
        ${budget ? `<button class="btn" data-act="budget-off" data-id="x">해제</button>` : ""}
      </div>`,
      { sub: "실제 AWS에서는 계정을 만들자마자 예산 알림부터 설정하는 게 좋아요." }
    ) +
    `</div>` +
    (c.tips.length ? card("절약 팁", `<ul class="plain-list">${c.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`) : "") +
    card(
      "항목별 내역",
      table(
        [
          { label: "서비스", render: (i) => tag(i.service, "blue") },
          { label: "리소스", render: (i) => `<b>${esc(i.name)}</b>` },
          { label: "근거", render: (i) => `<span class="muted">${esc(i.note || "")}</span>` },
          { label: "월 예상", render: (i) => `<b class="num">${money(i.monthly)}</b>` },
        ],
        c.items.slice().sort((a, b) => b.monthly - a.monthly),
        { empty: "과금 항목이 없어요." }
      )
    ) +
    card(
      "비용 원칙 (Well-Architected · 비용 최적화)",
      `<ul class="plain-list">
        <li><b>쓰지 않으면 끄기</b>: 개발 서버는 밤에 중지, 남은 EBS · 탄력적 IP · NAT 게이트웨이는 정리.</li>
        <li><b>알맞은 크기</b>: CPU가 늘 20% 이하라면 한 단계 작은 인스턴스로.</li>
        <li><b>구매 옵션</b>: 꾸준한 부하는 Savings Plans · 예약 인스턴스, 중단 가능한 작업은 스팟.</li>
        <li><b>스토리지 계층</b>: 자주 안 읽는 S3 객체는 수명 주기 규칙으로 Standard-IA · Glacier로 옮기기.</li>
      </ul>`
    );

  wire({
    budget: async () => act(api.post("/api/cost/budget", { monthlyLimit: val("b-limit"), alertPercent: val("b-alert") }), "예산을 저장했어요."),
    "budget-off": async () => act(api.post("/api/cost/budget", { monthlyLimit: 0 }), "예산을 해제했어요."),
  });
}

App.route("/cost", renderCost, { section: "cost", crumbs: () => ["비용"] });
