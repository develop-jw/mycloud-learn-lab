/* ---- 컴퓨팅(EC2) 화면: 인스턴스 · 시작 마법사 · 시작 템플릿 · Auto Scaling · EBS · 스냅샷/AMI ---- */

const AMIS = [
  { value: "ami-amazon-linux-2023", label: "Amazon Linux 2023", desc: "AWS 최적화 리눅스 · dnf", badge: "프리 티어" },
  { value: "ami-ubuntu-24.04", label: "Ubuntu Server 24.04 LTS", desc: "가장 널리 쓰이는 배포판 · apt", badge: "프리 티어" },
  { value: "ami-rhel-9", label: "Red Hat Enterprise Linux 9", desc: "기업용 리눅스" },
  { value: "ami-windows-2022", label: "Windows Server 2022", desc: "윈도우 서버 · RDP 접속" },
];

const FAMILIES = [
  { key: "general", label: "범용 (T·M)", types: ["t2.micro", "t3.micro", "t3.small", "t3.medium", "m5.large", "m6i.large"] },
  { key: "compute", label: "컴퓨팅 최적화 (C)", types: ["c5.large", "c6i.large", "c7g.large"] },
  { key: "memory", label: "메모리 최적화 (R·X)", types: ["r5.large", "r6g.large", "x1e.xlarge"] },
  { key: "storage", label: "스토리지 최적화 (I·D)", types: ["i3.large", "d2.xlarge"] },
  { key: "gpu", label: "가속 컴퓨팅 (G·P)", types: ["g4dn.xlarge", "p4d.24xlarge"] },
];

const USERDATA_PRESETS = {
  httpd: "#!/bin/bash\ndnf update -y\ndnf install -y httpd\necho \"<h1>Hello from $(hostname -f)</h1>\" > /var/www/html/index.html\nsystemctl enable --now httpd",
  nginx: "#!/bin/bash\ndnf install -y nginx\nsystemctl enable --now nginx",
  none: "",
};

// 인스턴스 유형 이름 읽기: m6i.large → 패밀리 m · 세대 6 · 속성 i(인텔) · 크기 large
function typeNameHelp(t) {
  const m = /^([a-z]+)(\d)([a-z]*)\.(.+)$/.exec(t);
  if (!m) return "";
  const attr = { g: "Graviton(ARM)", i: "인텔", a: "AMD", d: "로컬 NVMe", n: "네트워크 강화" };
  return `패밀리 ${m[1]} · ${m[2]}세대${m[3] ? ` · ${m[3].split("").map((c) => attr[c] || c).join(", ")}` : ""} · 크기 ${m[4]}`;
}

function instanceActions(i) {
  const s = i.state;
  if (s === "running") return `<div class="btn-row">${btn("중지", "stop", i.id)}${btn("재부팅", "reboot", i.id)}${btn("종료", "term", i.id, { tone: "danger" })}</div>`;
  if (s === "stopped") return `<div class="btn-row">${btn("시작", "start", i.id, { tone: "blue" })}${btn("종료", "term", i.id, { tone: "danger" })}</div>`;
  if (s === "terminated") return `<span class="muted small">종료됨</span>`;
  return `<span class="muted small">처리 중…</span>`;
}

const ComputePages = {
  /* ===== 인스턴스 ===== */
  instances: {
    list: (o) => {
      const rows = o.instances.slice().sort((a, b) => (a.state === "terminated") - (b.state === "terminated"));
      return (
        pageHead({ icon: "ec2", title: "인스턴스", desc: "가상 서버예요. 시작하면 pending → running, 중지하면 stopping → stopped 순으로 바뀌어요. 중지 중에는 EC2 요금이 안 나가지만 EBS 요금은 계속 나가요.", actions: `<a class="btn primary" href="#/ec2/launch">인스턴스 시작</a>` }) +
        card(
          "",
          table(
            [
              { label: "이름", render: (i) => `<span class="cell-title">${svc("ec2", "sm")}<span>${esc(i.name)}<span class="cell-sub">${i.managedBy ? (i.managedBy.type === "asg" ? "Auto Scaling 관리" : "EKS 노드 그룹 관리") : ""}</span></span></span>` },
              { label: "인스턴스 ID", render: (i) => mono(i.id) },
              { label: "상태", render: (i) => badge(i.state) },
              { label: "유형", render: (i) => `${esc(i.instanceType)}<span class="cell-sub">${i.spec.vcpu} vCPU · ${i.spec.mem} GiB${i.purchasingOption === "spot" ? " · 스팟" : ""}</span>` },
              { label: "가용 영역", render: (i) => esc(i.availabilityZone) },
              { label: "IP", render: (i) => `${esc(i.publicIp || "-")}${i.elasticIp ? tag("EIP", "blue") : ""}<span class="cell-sub">사설 ${esc(i.privateIp)}</span>` },
              { label: "", render: (i) => instanceActions(i) },
            ],
            rows,
            { empty: "인스턴스가 없어요. 웹 서버 한 대를 시작해 보세요.", emptyAction: `<a class="btn primary" href="#/ec2/launch">인스턴스 시작</a>`, rowHref: (i) => detailHref("ec2", "instances", i.id) }
          )
        )
      );
    },
    detail: (o, id) => {
      const i = o.instances.find((x) => x.id === id);
      if (!i) return info("인스턴스를 찾을 수 없어요.", "error");
      const subnet = o.subnets.find((s) => s.id === i.subnetId);
      const sg = o.sgs.find((s) => s.id === i.securityGroupId);
      const vols = o.volumes.filter((v) => v.attachedInstanceId === i.id);
      const tgs = o.tgs.filter((t) => t.targets.includes(i.id));
      return (
        pageHead({ icon: "ec2", title: i.name, desc: `${mono(i.id)} ${badge(i.state)}`, actions: instanceActions(i) + (i.state !== "terminated" ? btn("AMI 만들기", "ami", i.id) : "") }) +
        card(
          "세부 정보",
          kv([
            ["인스턴스 유형", `${esc(i.instanceType)}<br/><small class="muted">${esc(typeNameHelp(i.instanceType))}</small>`],
            ["AMI", esc(i.ami)],
            ["퍼블릭 IPv4", esc(i.publicIp || "없음") + (i.elasticIp ? " (탄력적 IP)" : "")],
            ["사설 IPv4", esc(i.privateIp)],
            ["VPC", esc(vpcName(o, i.vpcId))],
            ["서브넷", subnet ? `${esc(subnet.name)} ${subnetTag(subnet)}` : "-"],
            ["가용 영역", esc(i.availabilityZone)],
            ["보안 그룹", sg ? `<a href="${detailHref("vpc", "sg", sg.id)}">${esc(sg.name)}</a>` : tag("없음", "red")],
            ["IAM 역할", esc(i.iamRole || "없음")],
            ["키 페어", esc(i.keyName)],
            ["구매 옵션", i.purchasingOption === "spot" ? "스팟" : "온디맨드"],
            ["루트 디바이스", i.rootDeviceType === "instance-store" ? "인스턴스 스토어 (휘발성)" : "EBS"],
            ["IMDSv2", i.imdsv2Required ? "필수 (권장)" : "선택"],
            ["시작 시각", fmtTime(i.launchedAt)],
            ["대상 그룹", tgs.map((t) => esc(t.name)).join(", ") || "-"],
          ])
        ) +
        `<div class="grid-2">` +
        card("스토리지 (EBS)", vols.length ? table([{ label: "볼륨", render: (v) => `${esc(v.name)}${v.isRoot ? tag("루트", "gray") : ""}` }, { label: "크기/유형", render: (v) => `${v.size} GiB · ${esc(v.type)}` }, { label: "암호화", render: (v) => (v.encrypted ? "예" : "아니요") }], vols) : `<p class="muted">${i.rootDeviceType === "instance-store" ? "인스턴스 스토어는 호스트에 붙은 임시 디스크라 EBS 목록에 없어요. 중지/종료 시 데이터가 사라져요." : "연결된 볼륨이 없어요."}</p>`) +
        card("사용자 데이터 (User Data)", i.userData ? `<pre class="code-block">${esc(i.userData)}</pre>` : `<p class="muted">없음</p>`, { sub: "최초 부팅 시 root 권한으로 한 번 실행돼요." }) +
        `</div>` +
        card("태그", `${Object.entries(i.tags || {}).map(([k, v]) => tag(`${k} = ${v}`, "gray")).join(" ") || `<span class="muted">태그 없음</span>`}
          <div class="inline-form">${field("키", input("t-key", { placeholder: "Environment" }))}${field("값", input("t-val", { placeholder: "dev" }))}<button class="btn blue" data-act="tag" data-id="${i.id}">태그 추가</button></div>`, { sub: "Name, Environment, Owner 같은 태그로 비용과 리소스를 추적해요." })
      );
    },
    wire: {
      stop: (id) => act(api.post(`/api/instances/${id}/stop`), "인스턴스를 중지하는 중이에요."),
      start: (id) => act(api.post(`/api/instances/${id}/start`), "인스턴스를 시작하는 중이에요."),
      reboot: (id) => act(api.post(`/api/instances/${id}/reboot`), "재부팅 중이에요."),
      term: async (id) => (await confirmBox("인스턴스 종료", "<p>종료(terminate)하면 되돌릴 수 없어요. 루트 EBS 볼륨도 함께 삭제돼요.</p>", "종료")) && act(api.del(`/api/instances/${id}`), "종료하는 중이에요."),
      tag: (id) => act(api.post(`/api/instances/${id}/tags`, { key: val("t-key"), value: val("t-val") }), "태그를 추가했어요."),
      ami: async (id) => {
        const r = await modal({ title: "이미지(AMI) 생성", body: "<p>지금 인스턴스의 설정을 '골든 이미지'로 저장해요. Auto Scaling 시작 템플릿에서 재사용할 수 있어요.</p>", fields: [{ id: "m-name", label: "이미지 이름", value: "golden-web-image" }], okLabel: "생성" });
        if (r) await act(api.post(`/api/instances/${id}/create-image`, { name: r["m-name"] }), "AMI를 만들었어요.");
      },
    },
  },

  /* ===== 시작 템플릿 ===== */
  templates: {
    list: (o) =>
      pageHead({ icon: "lt", title: "시작 템플릿", desc: "AMI·인스턴스 유형·보안 그룹·User Data를 미리 저장해 둔 설정이에요. Auto Scaling 그룹이 이 템플릿으로 인스턴스를 찍어내요.", actions: `<a class="btn primary" href="${newHref("ec2", "templates")}">시작 템플릿 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (t) => `<span class="cell-title">${svc("lt", "sm")}${esc(t.name)}</span>` },
            { label: "ID", render: (t) => mono(t.id) },
            { label: "AMI · 유형", render: (t) => `${esc(t.ami)}<span class="cell-sub">${esc(t.instanceType)}</span>` },
            { label: "보안 그룹", render: (t) => esc((o.sgs.find((s) => s.id === t.securityGroupId) || {}).name || "-") },
            { label: "User Data", render: (t) => (t.userData ? tag("있음", "green") : tag("없음", "gray")) },
            { label: "", render: (t) => btn("삭제", "del", t.id, { tone: "danger" }) },
          ],
          o.launchTemplates,
          { empty: "시작 템플릿이 없어요." }
        )
      ),
    wire: { del: (id) => act(api.del(`/api/launch-templates/${id}`), "삭제했어요.") },
    form: (o) =>
      pageHead({ icon: "lt", title: "시작 템플릿 생성" }) +
      errorBox() +
      section(
        "템플릿 내용",
        field("이름", input("f-name", { placeholder: "web-template" })) +
          field("AMI", select("f-ami", [...AMIS.map((a) => ({ value: a.value, label: a.label })), ...(o.amis || []).map((a) => ({ value: a.id, label: `내 AMI: ${a.name}` }))])) +
          field("인스턴스 유형", select("f-type", FAMILIES.flatMap((f) => f.types), "t3.micro")) +
          field("보안 그룹", select("f-sg", [{ value: "", label: "(선택 안 함)" }, ...o.sgs.map((s) => ({ value: s.id, label: `${s.name} · ${vpcName(o, s.vpcId)}` }))])) +
          field("IAM 역할 (인스턴스 프로파일)", select("f-role", [{ value: "", label: "(없음)" }, ...o.iam.roles.filter((r) => r.trustedService === "ec2").map((r) => ({ value: r.name, label: r.name }))])) +
          field("User Data", textarea("f-ud", { value: USERDATA_PRESETS.httpd, rows: 6, mono: true }), "대상 그룹 헬스 체크를 통과하려면 웹 서버가 설치돼 있어야 해요.", { full: true })
      ) +
      formActions(listHref("ec2", "templates"), "생성"),
    submit: async () => {
      await api.post("/api/launch-templates", { name: val("f-name"), ami: val("f-ami"), instanceType: val("f-type"), securityGroupId: val("f-sg"), iamRole: val("f-role"), userData: byId("f-ud").value });
      toast("시작 템플릿을 만들었어요.");
      location.hash = listHref("ec2", "templates");
    },
  },

  /* ===== Auto Scaling 그룹 ===== */
  asg: {
    list: (o, p) => `${pageHead({ icon: "asg", title: "Auto Scaling 그룹", desc: "원하는 용량(desired)을 유지하고, CPU 같은 지표에 맞춰 인스턴스를 자동으로 늘리고 줄여요. 인스턴스를 직접 종료해도 그룹이 다시 채워요.", actions: `<a class="btn primary" href="${newHref("ec2", "asg")}">Auto Scaling 그룹 생성</a>` })}<div id="asg-list"></div>`,
    after: async (o, p) => {
      if (p.get("new")) return;
      const asgs = await api.get("/api/auto-scaling-groups");
      const id = p.get("id");
      if (id) return ComputePages.asg.renderDetail(o, asgs.find((a) => a.id === id));
      byId("asg-list").innerHTML = card(
        "",
        table(
          [
            { label: "이름", render: (a) => `<span class="cell-title">${svc("asg", "sm")}${esc(a.name)}</span>` },
            { label: "용량 (최소/원하는/최대)", render: (a) => `${a.min} / <b>${a.desired}</b> / ${a.max}` },
            { label: "실행 중", render: (a) => `${a.running}대` },
            { label: "평균 CPU", render: (a) => `<div class="bar ${a.cpu > 70 ? "bad" : a.cpu > 50 ? "warn" : ""}" title="${a.cpu}%"><i style="width:${a.cpu}%"></i></div><span class="cell-sub">${a.cpu}%</span>` },
            { label: "조정 정책", render: (a) => (a.scalingPolicy ? `대상 추적 · CPU ${a.scalingPolicy.target}%` : "없음 (수동)") },
            { label: "가용 영역", render: (a) => [...new Set(a.subnetIds.map((s) => ((o.subnets.find((x) => x.id === s) || {}).availabilityZone || "").slice(-2)))].join(", ") },
          ],
          asgs,
          { empty: "Auto Scaling 그룹이 없어요. 먼저 시작 템플릿을 만들어 두세요.", rowHref: (a) => detailHref("ec2", "asg", a.id) }
        )
      );
      App.autoRefresh(true, 3000);
    },
    renderDetail: (o, a) => {
      if (!a) {
        byId("content").innerHTML = info("그룹을 찾을 수 없어요.", "error");
        return;
      }
      const lt = o.launchTemplates.find((l) => l.id === a.launchTemplateId) || {};
      byId("content").innerHTML =
        pageHead({ icon: "asg", title: a.name, desc: `시작 템플릿 ${esc(lt.name || "-")} · 헬스 체크 ${a.healthCheckType}`, actions: btn("그룹 삭제", "del", a.id, { tone: "danger" }) }) +
        `<div class="grid-3">
          ${card("원하는 용량", `<div class="kpi-value">${a.desired}</div><div class="muted small">최소 ${a.min} · 최대 ${a.max}</div>`)}
          ${card("실행 중", `<div class="kpi-value">${a.running}</div><div class="muted small">전체 ${a.instanceIds.length}대</div>`)}
          ${card("평균 CPU", `<div class="kpi-value">${a.cpu}%</div><div class="bar ${a.cpu > 70 ? "bad" : a.cpu > 50 ? "warn" : ""}"><i style="width:${a.cpu}%"></i></div>`)}
        </div>` +
        card(
          "용량 변경",
          `<div class="inline-form">${field("최소", input("c-min", { type: "number", value: a.min }))}${field("원하는 용량", input("c-des", { type: "number", value: a.desired }))}${field("최대", input("c-max", { type: "number", value: a.max }))}<button class="btn blue" data-act="cap" data-id="${a.id}">적용</button></div>`
        ) +
        card(
          "동적 조정 정책",
          `<p class="muted small">대상 추적(Target tracking): 평균 CPU가 목표보다 높으면 확장(scale-out), 한참 낮으면 축소(scale-in)해요. 새 인스턴스 워밍업 동안은 조정하지 않아요.</p>
          <div class="inline-form">${field("목표 CPU (%)", input("p-cpu", { type: "number", value: a.scalingPolicy ? a.scalingPolicy.target : 50 }))}<button class="btn blue" data-act="policy" data-id="${a.id}">정책 저장</button>${a.scalingPolicy ? btn("정책 제거", "nopolicy", a.id) : ""}</div>`
        ) +
        card(
          "인스턴스",
          table(
            [
              { label: "인스턴스", render: (i) => `${esc(i.id)}<span class="cell-sub">${esc(i.availabilityZone)}</span>` },
              { label: "상태", render: (i) => badge(i.state) },
              { label: "", render: (i) => (i.state === "running" ? btn("종료해 보기", "kill", i.id, { tone: "danger" }) : "") },
            ],
            o.instances.filter((i) => a.instanceIds.includes(i.id))
          ),
          { sub: "'종료해 보기'를 누르면 그룹이 원하는 용량을 맞추려고 새 인스턴스를 다시 띄워요 (자가 치유)." }
        ) +
        card("활동 기록", `<ul class="feed">${a.activities.map((x) => `<li><span class="dot ${/확장|축소/.test(x.text) ? "orange" : "blue"}"></span><div><div class="feed-text">${esc(x.text)}</div><div class="feed-time">${timeAgo(x.t)}</div></div></li>`).join("")}</ul>`);
      App.autoRefresh(true, 3000);
    },
    wire: {
      cap: (id) => act(api.post(`/api/auto-scaling-groups/${id}/capacity`, { min: val("c-min"), desired: val("c-des"), max: val("c-max") }), "용량을 바꿨어요."),
      policy: (id) => act(api.post(`/api/auto-scaling-groups/${id}/policy`, { targetCpu: val("p-cpu") }), "조정 정책을 저장했어요."),
      nopolicy: (id) => act(api.post(`/api/auto-scaling-groups/${id}/policy`, {}), "정책을 제거했어요."),
      kill: (id) => act(api.del(`/api/instances/${id}`), "인스턴스를 종료했어요. 곧 그룹이 새로 띄울 거예요."),
      del: async (id) => {
        if (!(await confirmBox("Auto Scaling 그룹 삭제", "<p>그룹이 관리하던 인스턴스도 모두 종료돼요.</p>"))) return;
        await api.del(`/api/auto-scaling-groups/${id}`);
        location.hash = listHref("ec2", "asg");
      },
    },
    form: (o) =>
      pageHead({ icon: "asg", title: "Auto Scaling 그룹 생성" }) +
      (o.launchTemplates.length ? "" : info(`시작 템플릿이 먼저 필요해요. <a href="${newHref("ec2", "templates")}">시작 템플릿 만들기</a>`, "warn")) +
      errorBox() +
      section("1. 이름과 템플릿", field("그룹 이름", input("f-name", { placeholder: "web-asg" })) + field("시작 템플릿", select("f-lt", o.launchTemplates.map((l) => ({ value: l.id, label: l.name }))))) +
      section("2. 네트워크", `<div class="full">${checkList("asg-subnets", o.subnets.map((s) => ({ value: s.id, label: esc(subnetLabel(s)) })))}</div>`, "여러 가용 영역의 서브넷을 고르면 인스턴스가 AZ마다 고르게 퍼져요.") +
      section(
        "3. 로드 밸런서 연결 (선택)",
        `<div class="full">${checkList("asg-tgs", o.tgs.filter((t) => t.targetType === "instance").map((t) => ({ value: t.id, label: esc(t.name) })))}</div>` +
          field("헬스 체크 유형", select("f-hc", [{ value: "EC2", label: "EC2 (인스턴스 상태만)" }, { value: "ELB", label: "ELB (로드 밸런서 헬스 체크까지)" }]))
      ) +
      section(
        "4. 용량과 조정 정책",
        field("최소", input("f-min", { type: "number", value: 1 })) +
          field("원하는 용량", input("f-des", { type: "number", value: 2 })) +
          field("최대", input("f-max", { type: "number", value: 4 })) +
          field("대상 추적 목표 CPU (%)", input("f-cpu", { type: "number", value: 50 }), "비우면 자동 조정 없음")
      ) +
      formActions(listHref("ec2", "asg"), "그룹 생성"),
    submit: async () => {
      const a = await api.post("/api/auto-scaling-groups", {
        name: val("f-name"),
        launchTemplateId: val("f-lt"),
        subnetIds: checkedValues("asg-subnets"),
        targetGroupIds: checkedValues("asg-tgs"),
        healthCheckType: val("f-hc"),
        min: val("f-min"),
        desired: val("f-des"),
        max: val("f-max"),
        targetCpu: val("f-cpu"),
      });
      toast("그룹을 만들었어요. 원하는 용량만큼 인스턴스를 띄우기 시작해요.");
      location.hash = detailHref("ec2", "asg", a.id);
    },
  },

  /* ===== EBS 볼륨 ===== */
  volumes: {
    list: (o) => {
      const insts = o.instances.filter((i) => i.state !== "terminated");
      return (
        pageHead({ icon: "volume", title: "EBS 볼륨", desc: "인스턴스에 네트워크로 붙는 영구 블록 스토리지예요. 같은 가용 영역의 인스턴스에만 연결할 수 있고, 크기는 늘리기만 가능해요.", actions: `<a class="btn primary" href="${newHref("ec2", "volumes")}">볼륨 생성</a>` }) +
        card(
          "",
          table(
            [
              { label: "이름", render: (v) => `<span class="cell-title">${svc("volume", "sm")}${esc(v.name)}${v.isRoot ? tag("루트", "gray") : ""}</span>` },
              { label: "볼륨 ID", render: (v) => mono(v.id) },
              { label: "크기 · 유형", render: (v) => `${v.size} GiB · ${esc(v.type)}${v.encrypted ? tag("암호화", "blue") : ""}` },
              { label: "AZ", render: (v) => esc(v.availabilityZone) },
              { label: "상태", render: (v) => badge(v.state) },
              { label: "연결", render: (v) => esc((o.instances.find((i) => i.id === v.attachedInstanceId) || {}).name || "-") },
              {
                label: "",
                render: (v) =>
                  `<div class="btn-row">${btn("스냅샷", "snap", v.id)}${btn("수정", "modify", v.id)}${
                    v.state === "in-use"
                      ? v.isRoot
                        ? ""
                        : btn("분리", "detach", v.id)
                      : (insts.length ? select(`att-${v.id}`, insts.map((i) => ({ value: i.id, label: `${i.name} (${i.availabilityZone.slice(-2)})` })), "", 'style="width:auto;min-height:30px;padding:3px 8px"') + btn("연결", "attach", v.id, { tone: "blue" }) : "") + btn("삭제", "del", v.id, { tone: "danger" })
                  }</div>`,
              },
            ],
            o.volumes,
            { empty: "EBS 볼륨이 없어요. 인스턴스를 시작하면 루트 볼륨이 자동으로 생겨요." }
          )
        ) +
        card(
          "볼륨 유형 비교",
          table(
            [
              { label: "유형", render: (r) => `<b>${r[0]}</b>` },
              { label: "매체", render: (r) => r[1] },
              { label: "특징", render: (r) => r[2] },
              { label: "어울리는 곳", render: (r) => r[3] },
            ],
            [
              ["gp3", "SSD", "기본 3,000 IOPS, 성능을 용량과 따로 조절", "대부분의 부트 볼륨 · 웹/앱 서버"],
              ["io2", "SSD", "프로비저닝 IOPS, 최고 수준 내구성", "대형 운영 DB"],
              ["st1", "HDD", "처리량(MB/s) 최적화, 저렴", "로그 · 빅데이터 순차 처리"],
              ["sc1", "HDD", "가장 저렴, 느림", "자주 안 읽는 콜드 데이터"],
            ]
          )
        )
      );
    },
    wire: {
      attach: (id) => act(api.post(`/api/volumes/${id}/attach`, { instanceId: val(`att-${id}`) }), "연결했어요."),
      detach: (id) => act(api.post(`/api/volumes/${id}/detach`), "분리했어요."),
      del: (id) => act(api.del(`/api/volumes/${id}`), "삭제했어요."),
      snap: async (id) => {
        const r = await modal({ title: "스냅샷 생성", body: "<p>스냅샷은 S3에 증분 방식으로 저장돼요. 다른 AZ로 볼륨을 옮길 때도 스냅샷을 거쳐요.</p>", fields: [{ id: "m-desc", label: "설명", value: "daily-backup" }], okLabel: "생성" });
        if (r) await act(api.post(`/api/volumes/${id}/snapshot`, { description: r["m-desc"] }), "스냅샷을 만들었어요.");
      },
      modify: async (id) => {
        const r = await modal({ title: "볼륨 수정", fields: [{ id: "m-size", label: "새 크기 (GiB, 늘리기만 가능)", type: "number", value: "" }, { id: "m-type", label: "유형", options: ["gp3", "io2", "st1", "sc1"], value: "gp3" }], okLabel: "수정" });
        if (r) await act(api.post(`/api/volumes/${id}/modify`, { size: r["m-size"], type: r["m-type"] }), "볼륨을 수정했어요.");
      },
    },
    form: () =>
      pageHead({ icon: "volume", title: "EBS 볼륨 생성" }) +
      errorBox() +
      section(
        "설정",
        field("이름", input("f-name", { placeholder: "data-volume" })) +
          field("볼륨 유형", select("f-type", [{ value: "gp3", label: "gp3 · 범용 SSD" }, { value: "io2", label: "io2 · 프로비저닝 IOPS SSD" }, { value: "st1", label: "st1 · 처리량 최적화 HDD" }, { value: "sc1", label: "sc1 · 콜드 HDD" }])) +
          field("크기 (GiB)", input("f-size", { type: "number", value: 20 })) +
          field("가용 영역", select("f-az", AZS), "연결할 인스턴스와 같은 AZ여야 해요.") +
          checkbox("f-enc", "암호화 (KMS)", true, "저장 데이터(at-rest) 암호화. 한 번 정하면 바꿀 수 없어요.")
      ) +
      formActions(listHref("ec2", "volumes"), "볼륨 생성"),
    submit: async () => {
      await api.post("/api/volumes", { name: val("f-name"), type: val("f-type"), size: val("f-size"), availabilityZone: val("f-az"), encrypted: isChecked("f-enc") });
      toast("볼륨을 만들었어요.");
      location.hash = listHref("ec2", "volumes");
    },
  },

  /* ===== 스냅샷 · AMI ===== */
  snapshots: {
    list: (o) => `${pageHead({ icon: "snapshot", title: "스냅샷 · AMI", desc: "스냅샷은 EBS 볼륨의 특정 시점 백업, AMI는 인스턴스를 다시 찍어낼 수 있는 이미지(골든 이미지)예요." })}<div id="snap-slot"></div>`,
    after: async () => {
      const [snaps, amis] = await Promise.all([api.get("/api/snapshots"), api.get("/api/amis")]);
      byId("snap-slot").innerHTML =
        card("EBS 스냅샷", table([{ label: "스냅샷 ID", render: (s) => mono(s.id) }, { label: "원본 볼륨", render: (s) => esc(s.volumeName) }, { label: "크기", render: (s) => `${s.size} GiB` }, { label: "설명", render: (s) => esc(s.description) }, { label: "생성", render: (s) => timeAgo(s.createdAt) }], snaps, { empty: "스냅샷이 없어요. EBS 볼륨 화면에서 만들 수 있어요." })) +
        card("내 AMI", table([{ label: "AMI ID", render: (a) => mono(a.id) }, { label: "이름", render: (a) => esc(a.name) }, { label: "기반 이미지", render: (a) => esc(a.baseAmi) }, { label: "생성", render: (a) => timeAgo(a.createdAt) }], amis, { empty: "만든 AMI가 없어요. 인스턴스 상세에서 'AMI 만들기'를 눌러 보세요." }));
    },
  },
};

/* ---- 인스턴스 시작 마법사 ---- */
async function renderLaunch() {
  const o = await load.overview();
  o.amis = await api.get("/api/amis");
  const types = await api.get("/api/instance-types");
  if (!o.subnets.length) {
    byId("content").innerHTML = pageHead({ icon: "ec2", title: "인스턴스 시작" }) + info(`인스턴스를 놓을 서브넷이 필요해요. <a href="${newHref("vpc", "vpcs")}">VPC</a>와 <a href="${newHref("vpc", "subnets")}">서브넷</a>을 먼저 만드세요.`, "warn");
    return;
  }
  let family = "general";
  const typeChoices = (fam) =>
    choiceCards(
      "type",
      FAMILIES.find((f) => f.key === fam).types.map((t) => ({ value: t, label: t, desc: `${types[t].vcpu} vCPU · ${types[t].mem} GiB · 약 $${types[t].price}/시간`, badge: ["t2.micro", "t3.micro"].includes(t) ? "프리 티어" : "" })),
      FAMILIES.find((f) => f.key === fam).types[0]
    );
  const vpc0 = o.vpcs[0];
  byId("content").innerHTML =
    pageHead({ icon: "ec2", title: "인스턴스 시작", desc: "실제 EC2 콘솔의 '인스턴스 시작' 순서 그대로예요: 이름 → AMI → 유형 → 키 페어 → 네트워크 → 스토리지 → 고급 설정." }) +
    errorBox() +
    section("이름 및 태그", field("이름", input("f-name", { placeholder: "예: web-server-1" })) + field("개수", input("f-count", { type: "number", value: 1, attrs: 'min="1" max="5"' }))) +
    section("애플리케이션 및 OS 이미지 (AMI)", choiceCards("ami", [...AMIS, ...o.amis.map((a) => ({ value: a.id, label: a.name, desc: "내 AMI" }))], AMIS[0].value), "AMI는 리전마다 ID가 달라요. 내가 만든 AMI(골든 이미지)도 여기서 고를 수 있어요.") +
    section(
      "인스턴스 유형",
      `<div class="family-tabs">${FAMILIES.map((f) => `<button type="button" data-family="${f.key}" class="${f.key === family ? "on" : ""}">${f.label}</button>`).join("")}</div><div class="wide" id="type-slot">${typeChoices(family)}</div><p class="wide muted small" id="type-help">${typeNameHelp("t2.micro")}</p>`
    ) +
    section("키 페어 (로그인)", field("키 페어 이름", input("f-key", { placeholder: "my-key-pair" }), "실제로는 .pem 파일로 SSH 접속해요. 키 대신 Session Manager(SSM)로 접속하는 방법도 권장돼요.")) +
    section(
      "네트워크 설정",
      field("VPC", select("f-vpc", vpcOptions(o), vpc0 && vpc0.id)) +
        field("서브넷", `<select id="f-subnet"></select>`, "퍼블릭 서브넷이면 퍼블릭 IP가 자동으로 붙어요.") +
        field("보안 그룹", `<select id="f-sg"></select>`, `<a href="${newHref("vpc", "sg")}">새 보안 그룹 만들기</a>`) +
        checkbox("f-pubip", "퍼블릭 IP 자동 할당", true, "퍼블릭 서브넷에서만 적용돼요.")
    ) +
    section(
      "스토리지 구성",
      field("루트 디바이스", select("f-root", [{ value: "ebs", label: "EBS 기반 (권장) — 중지해도 데이터 유지" }, { value: "instance-store", label: "인스턴스 스토어 기반 — 빠르지만 휘발성, 중지 불가" }])) +
        field("루트 볼륨 크기 (GiB)", input("f-vsize", { type: "number", value: 8 })) +
        field("볼륨 유형", select("f-vtype", ["gp3", "io2"])) +
        checkbox("f-venc", "EBS 암호화", true)
    ) +
    section(
      "고급 세부 정보",
      field("구매 옵션", choiceCards("purchase", [{ value: "on-demand", label: "온디맨드", desc: "약정 없이 초 단위 과금" }, { value: "spot", label: "스팟 인스턴스", desc: "최대 90% 할인 · 2분 전 통보 후 회수될 수 있음" }], "on-demand"), "", { full: true }) +
        field("IAM 인스턴스 프로파일", select("f-role", [{ value: "", label: "(없음)" }, ...o.iam.roles.filter((r) => r.trustedService === "ec2").map((r) => ({ value: r.name, label: r.name }))]), "액세스 키를 서버에 넣지 말고 역할로 권한을 주세요.") +
        checkbox("f-imds", "IMDSv2 필수 (권장)", true, "세션 토큰 기반 메타데이터 조회로 SSRF 공격에서 자격 증명을 보호해요.") +
        field(
          "사용자 데이터 (User Data)",
          `<div class="btn-row" style="margin-bottom:6px"><button type="button" class="btn sm" data-ud="httpd">Apache 웹 서버</button><button type="button" class="btn sm" data-ud="nginx">Nginx</button><button type="button" class="btn sm" data-ud="none">비우기</button></div>${textarea("f-ud", { value: USERDATA_PRESETS.httpd, rows: 6, mono: true })}`,
          "최초 부팅 때 root 권한으로 한 번 실행돼요. 로드 밸런서 헬스 체크를 통과하려면 웹 서버가 있어야 해요.",
          { full: true }
        )
    ) +
    formActions("#/ec2?tab=instances", "인스턴스 시작");

  const fillNet = () => {
    const vid = val("f-vpc");
    byId("f-subnet").innerHTML = o.subnets.filter((s) => s.vpcId === vid).map((s) => `<option value="${s.id}">${esc(subnetLabel(s))}</option>`).join("");
    byId("f-sg").innerHTML = `<option value="">(선택 안 함 — 모든 인바운드 차단)</option>` + o.sgs.filter((s) => s.vpcId === vid).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  };
  fillNet();
  byId("f-vpc").addEventListener("change", fillNet);
  wire({});
  const bindTypes = () => {
    wire({});
    const grp = document.querySelector('[data-choice="type"]');
    grp.addEventListener("change", (e) => (byId("type-help").textContent = typeNameHelp(e.detail)));
  };
  bindTypes();
  document.querySelectorAll("[data-family]").forEach((b) =>
    b.addEventListener("click", () => {
      family = b.dataset.family;
      document.querySelectorAll("[data-family]").forEach((x) => x.classList.toggle("on", x === b));
      byId("type-slot").innerHTML = typeChoices(family);
      byId("type-help").textContent = typeNameHelp(FAMILIES.find((f) => f.key === family).types[0]);
      // 새로 그린 카드에만 클릭 연결
      byId("type-slot").querySelectorAll(".choice").forEach((c) =>
        c.addEventListener("click", () => {
          byId("type-slot").querySelectorAll(".choice").forEach((x) => x.classList.remove("on"));
          c.classList.add("on");
          byId("type-help").textContent = typeNameHelp(c.dataset.value);
        })
      );
    })
  );
  document.querySelectorAll("[data-ud]").forEach((b) => b.addEventListener("click", () => (byId("f-ud").value = USERDATA_PRESETS[b.dataset.ud])));
  onSubmit(async () => {
    const res = await api.post("/api/instances", {
      name: val("f-name") || "web-server",
      count: val("f-count"),
      ami: choiceValue("ami"),
      instanceType: choiceValue("type"),
      keyName: val("f-key"),
      vpcId: val("f-vpc"),
      subnetId: val("f-subnet"),
      securityGroupId: val("f-sg"),
      associatePublicIp: isChecked("f-pubip"),
      rootDeviceType: val("f-root"),
      rootVolumeSize: val("f-vsize"),
      rootVolumeType: val("f-vtype"),
      rootVolumeEncrypted: isChecked("f-venc"),
      purchasingOption: choiceValue("purchase"),
      iamRole: val("f-role"),
      imdsv2Required: isChecked("f-imds"),
      userData: byId("f-ud").value,
    });
    toast(`인스턴스 ${Array.isArray(res) ? res.length + "대를" : "를"} 시작했어요. 잠시 뒤 running이 돼요.`);
    location.hash = "#/ec2?tab=instances";
  });
}

App.route("/ec2", (p) => renderSection(ComputePages, "ec2", "instances", p), sectionMeta("ec2", "instances"));
App.route("/ec2/launch", renderLaunch, { section: "ec2", sub: "launch", crumbs: () => [["컴퓨팅", "#/ec2"], "인스턴스 시작"] });
