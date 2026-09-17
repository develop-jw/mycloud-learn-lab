/* ---- 네트워크(VPC) 화면: VPC · 서브넷 · 라우팅 · 게이트웨이 · 보안 그룹 · NACL · 하이브리드 ---- */

const AZS = ["ap-northeast-2a", "ap-northeast-2b", "ap-northeast-2c", "ap-northeast-2d"];
const vpcOptions = (o) => o.vpcs.map((v) => ({ value: v.id, label: `${v.name} (${v.cidrBlock})` }));
const needVpc = (o) =>
  o.vpcs.length ? "" : info(`먼저 VPC가 필요해요. <a href="${newHref("vpc", "vpcs")}">VPC 만들기</a>`, "warn");

const NetworkPages = {
  /* ===== VPC ===== */
  vpcs: {
    list: (o) => {
      const rows = o.vpcs.map((v) => ({
        ...v,
        subnets: o.subnets.filter((s) => s.vpcId === v.id).length,
        igw: o.igws.some((g) => g.vpcId === v.id),
      }));
      return (
        pageHead({ icon: "vpc", title: "VPC", desc: "AWS 안에 논리적으로 격리된 나만의 네트워크예요. 만들면 메인 라우팅 테이블이 자동으로 함께 생겨요.", actions: `<a class="btn primary" href="${newHref("vpc", "vpcs")}">VPC 생성</a>` }) +
        card(
          "",
          table(
            [
              { label: "이름", render: (v) => `<span class="cell-title">${svc("vpc", "sm")}${esc(v.name)}</span>` },
              { label: "VPC ID", render: (v) => mono(v.id) },
              { label: "IPv4 CIDR", render: (v) => esc(v.cidrBlock) },
              { label: "서브넷", render: (v) => `${v.subnets}개` },
              { label: "인터넷 게이트웨이", render: (v) => (v.igw ? tag("연결됨", "green") : tag("없음", "gray")) },
              { label: "상태", render: (v) => badge(v.state) },
              { label: "", render: (v) => btn("삭제", "del-vpc", v.id, { tone: "danger" }) },
            ],
            rows,
            { empty: "아직 VPC가 없어요. VPC부터 만드는 게 모든 실습의 시작이에요.", emptyAction: `<a class="btn primary" href="${newHref("vpc", "vpcs")}">VPC 생성</a>` }
          )
        )
      );
    },
    wire: {
      "del-vpc": async (id) => (await confirmBox("VPC 삭제", "<p>VPC 안에 리소스가 남아 있으면 실제 AWS처럼 DependencyViolation 오류가 나요.</p>")) && act(api.del(`/api/vpcs/${id}`), "VPC를 삭제했어요."),
    },
    form: () =>
      pageHead({ icon: "vpc", title: "VPC 생성" }) +
      errorBox() +
      section(
        "VPC 설정",
        field("이름 태그", input("f-name", { placeholder: "예: web-service-vpc" })) +
          field("IPv4 CIDR 블록", input("f-cidr", { value: "10.0.0.0/16" }), "/16 ~ /28 범위. 이 안에서 서브넷을 나눠요. 다른 네트워크(온프레미스 등)와 겹치지 않게 정하는 게 중요해요.") +
          info("<b>팁</b> · 10.0.0.0/16이면 IP가 65,536개예요. 서브넷을 /24로 나누면 서브넷당 256개(그중 5개는 AWS 예약)를 쓸 수 있어요.", "info")
      ) +
      formActions(listHref("vpc", "vpcs"), "VPC 생성"),
    submit: async () => {
      await api.post("/api/vpcs", { name: val("f-name") || "my-vpc", cidrBlock: val("f-cidr") });
      toast("VPC를 만들었어요. 메인 라우팅 테이블도 함께 생성됐어요.");
      location.hash = listHref("vpc", "vpcs");
    },
  },

  /* ===== 서브넷 ===== */
  subnets: {
    list: (o) =>
      pageHead({ icon: "subnet", title: "서브넷", desc: "VPC를 가용 영역(AZ)별로 나눈 구역이에요. 연결된 라우팅 테이블에 IGW 라우트가 있으면 퍼블릭, NAT 라우트가 있으면 '나가는 것만 되는' 프라이빗이 돼요.", actions: `<a class="btn primary" href="${newHref("vpc", "subnets")}">서브넷 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (s) => `<span class="cell-title">${svc("subnet", "sm")}${esc(s.name)}</span>` },
            { label: "서브넷 ID", render: (s) => mono(s.id) },
            { label: "VPC", render: (s) => esc(vpcName(o, s.vpcId)) },
            { label: "CIDR", render: (s) => `${esc(s.cidrBlock)}<span class="cell-sub">사용 가능 IP ${s.usableIps ?? "-"}개</span>` },
            { label: "가용 영역", render: (s) => esc(s.availabilityZone) },
            { label: "구분", render: (s) => subnetTag(s) },
            { label: "라우팅 테이블", render: (s) => (s.routeTableId ? `<a href="${detailHref("vpc", "routetables", s.routeTableId)}">${esc((o.routeTables.find((r) => r.id === s.routeTableId) || {}).name || s.routeTableId)}</a>` : "-") },
            { label: "", render: (s) => btn("삭제", "del", s.id, { tone: "danger" }) },
          ],
          o.subnets,
          { empty: "서브넷이 없어요. 가용 영역 2개에 퍼블릭/프라이빗을 하나씩, 총 4개를 만들어 보세요.", emptyAction: `<a class="btn primary" href="${newHref("vpc", "subnets")}">서브넷 생성</a>` }
        )
      ),
    wire: { del: async (id) => (await confirmBox("서브넷 삭제", "<p>이 서브넷을 삭제할까요?</p>")) && act(api.del(`/api/subnets/${id}`), "서브넷을 삭제했어요.") },
    form: (o) => {
      const used = o.subnets.map((s) => s.cidrBlock);
      const vpc = o.vpcs[0];
      let suggestion = "10.0.1.0/24";
      if (vpc) {
        const pre = vpc.cidrBlock.split(".").slice(0, 2).join(".");
        for (let i = 1; i < 250; i++) {
          if (!used.includes(`${pre}.${i}.0/24`)) {
            suggestion = `${pre}.${i}.0/24`;
            break;
          }
        }
      }
      return (
        pageHead({ icon: "subnet", title: "서브넷 생성" }) +
        needVpc(o) +
        errorBox() +
        section(
          "서브넷 설정",
          field("VPC", select("f-vpc", vpcOptions(o))) +
            field("이름 태그", input("f-name", { placeholder: "예: public-a, private-app-c" })) +
            field("가용 영역", select("f-az", AZS), "서비스를 살리려면 서로 다른 AZ에 나눠 두는 게 기본이에요.") +
            field("IPv4 CIDR", input("f-cidr", { value: suggestion }), "VPC 범위 안에서 다른 서브넷과 겹치지 않게") +
            info("만들고 나면 일단 VPC의 <b>메인 라우팅 테이블</b>에 연결돼요. 퍼블릭 서브넷으로 쓰려면 IGW 라우트가 있는 라우팅 테이블에 연결하세요.", "info")
        ) +
        formActions(listHref("vpc", "subnets"), "서브넷 생성")
      );
    },
    submit: async () => {
      await api.post("/api/subnets", { vpcId: val("f-vpc"), name: val("f-name") || "subnet", availabilityZone: val("f-az"), cidrBlock: val("f-cidr") });
      toast("서브넷을 만들었어요.");
      location.hash = listHref("vpc", "subnets");
    },
  },

  /* ===== 라우팅 테이블 ===== */
  routetables: {
    list: (o) =>
      pageHead({ icon: "route", title: "라우팅 테이블", desc: "서브넷의 트래픽이 어디로 갈지 정하는 규칙표예요. 대상(Destination) CIDR과 가장 길게 일치하는 라우트가 선택돼요.", actions: `<a class="btn primary" href="${newHref("vpc", "routetables")}">라우팅 테이블 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (r) => `<span class="cell-title">${svc("route", "sm")}${esc(r.name)}${r.isMain ? tag("메인", "gray") : ""}</span>` },
            { label: "ID", render: (r) => mono(r.id) },
            { label: "VPC", render: (r) => esc(vpcName(o, r.vpcId)) },
            { label: "라우트", render: (r) => r.routes.map((x) => `<span class="cell-sub">${esc(x.destination)} → ${esc(x.target)}</span>`).join("") },
            { label: "연결된 서브넷", render: (r) => `${r.subnetIds.length}개` },
          ],
          o.routeTables,
          { empty: "라우팅 테이블이 없어요. VPC를 만들면 메인 테이블이 자동으로 생겨요.", rowHref: (r) => detailHref("vpc", "routetables", r.id) }
        )
      ),
    form: (o) =>
      pageHead({ icon: "route", title: "라우팅 테이블 생성" }) +
      needVpc(o) +
      errorBox() +
      section("설정", field("VPC", select("f-vpc", vpcOptions(o))) + field("이름", input("f-name", { placeholder: "예: public-rtb" })), "생성하면 VPC 내부 통신용 local 라우트가 자동으로 들어가요.") +
      formActions(listHref("vpc", "routetables"), "생성"),
    submit: async () => {
      const rt = await api.post("/api/route-tables", { vpcId: val("f-vpc"), name: val("f-name") || "route-table" });
      toast("라우팅 테이블을 만들었어요. 이제 라우트를 추가하고 서브넷을 연결하세요.");
      location.hash = detailHref("vpc", "routetables", rt.id);
    },
    detail: (o, id) => {
      const rt = o.routeTables.find((r) => r.id === id);
      if (!rt) return info("라우팅 테이블을 찾을 수 없어요.", "error");
      const targets = [
        ...o.igws.filter((g) => g.vpcId === rt.vpcId).map((g) => ({ value: g.id, label: `${g.id} · 인터넷 게이트웨이` })),
        ...o.nats.filter((n) => n.vpcId === rt.vpcId).map((n) => ({ value: n.id, label: `${n.id} · NAT 게이트웨이 (${n.name})` })),
        ...o.vgws.filter((v) => v.vpcId === rt.vpcId).map((v) => ({ value: v.id, label: `${v.id} · 가상 프라이빗 게이트웨이(VPN)` })),
      ];
      const alive = (t) =>
        t === "local" ||
        o.igws.some((g) => g.id === t && g.state === "attached") ||
        o.nats.some((n) => n.id === t && n.state === "available") ||
        o.vgws.some((v) => v.id === t && v.vpcId);
      const sameVpc = o.subnets.filter((s) => s.vpcId === rt.vpcId);
      return (
        pageHead({ icon: "route", title: rt.name, desc: `${mono(rt.id)} · ${esc(vpcName(o, rt.vpcId))}${rt.isMain ? " · 메인 라우팅 테이블" : ""}`, actions: rt.isMain ? "" : btn("삭제", "del-rt", rt.id, { tone: "danger" }) }) +
        card(
          "라우트",
          table(
            [
              { label: "대상", render: (r) => esc(r.destination) },
              { label: "타깃", render: (r) => mono(r.target) },
              { label: "상태", render: (r) => (alive(r.target) ? badge("active", "활성") : badge("blackhole")) },
              { label: "", render: (r) => (r.target === "local" ? `<span class="muted small">기본 라우트</span>` : btn("삭제", "del-route", r.id, { tone: "danger" })) },
            ],
            rt.routes
          ) +
            `<div class="inline-form">
              ${field("대상 CIDR", input("r-dest", { value: "0.0.0.0/0" }))}
              ${field("타깃", targets.length ? select("r-target", targets) : `<span class="muted small">연결된 게이트웨이가 없어요 → <a href="${listHref("vpc", "igw")}">IGW</a> · <a href="${listHref("vpc", "nat")}">NAT</a></span>`)}
              ${targets.length ? `<button class="btn blue" data-act="add-route" data-id="${rt.id}">라우트 추가</button>` : ""}
            </div>
            <p class="muted small">퍼블릭 서브넷용: 0.0.0.0/0 → igw-… · 프라이빗 서브넷용: 0.0.0.0/0 → nat-… · 사내망: 192.168.0.0/16 → vgw-…</p>`
        ) +
        card(
          "서브넷 연결",
          checkList(
            "assoc",
            sameVpc.map((s) => ({ value: s.id, label: `${esc(s.name)} · ${s.availabilityZone.slice(-2)} ${s.routeTableId === rt.id ? "(연결됨)" : ""}` })),
            rt.subnetIds
          ) + `<div class="inline-form"><button class="btn blue" data-act="assoc" data-id="${rt.id}">선택한 서브넷 연결</button></div>`,
          { sub: "서브넷은 한 번에 하나의 라우팅 테이블에만 연결돼요. 여기서 연결하면 기존 연결은 자동으로 옮겨져요." }
        )
      );
    },
    wire: {
      "add-route": (id) => act(api.post(`/api/route-tables/${id}/routes`, { destination: val("r-dest"), target: val("r-target") }), "라우트를 추가했어요."),
      "del-route": (rid) => act(api.del(`/api/route-tables/${App.parse().params.get("id")}/routes/${rid}`), "라우트를 삭제했어요."),
      assoc: async (id) => {
        const ids = checkedValues("assoc");
        for (const s of ids) await api.post(`/api/route-tables/${id}/associate`, { subnetId: s });
        toast(`서브넷 ${ids.length}개를 연결했어요.`);
        App.refresh();
      },
      "del-rt": async (id) => {
        if (!(await confirmBox("라우팅 테이블 삭제", "<p>연결된 서브넷이 있으면 삭제할 수 없어요.</p>"))) return;
        await api.del(`/api/route-tables/${id}`);
        location.hash = listHref("vpc", "routetables");
      },
    },
  },

  /* ===== 인터넷 게이트웨이 ===== */
  igw: {
    list: (o) =>
      pageHead({ icon: "igw", title: "인터넷 게이트웨이", desc: "VPC와 인터넷을 잇는 관문이에요. ① 생성 → ② VPC에 연결 → ③ 라우팅 테이블에 0.0.0.0/0 → igw 라우트 추가 순서예요. VPC당 1개만 연결할 수 있어요.", actions: `<button class="btn primary" data-act="create-igw">인터넷 게이트웨이 생성</button>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (g) => `<span class="cell-title">${svc("igw", "sm")}${esc(g.name)}</span>` },
            { label: "ID", render: (g) => mono(g.id) },
            { label: "상태", render: (g) => badge(g.state) },
            { label: "VPC", render: (g) => (g.vpcId ? esc(vpcName(o, g.vpcId)) : "-") },
            {
              label: "",
              render: (g) =>
                g.state === "attached"
                  ? btn("분리", "detach", g.id)
                  : `<div class="btn-row">${o.vpcs.length ? select(`vpc-${g.id}`, vpcOptions(o), "", 'style="width:auto;min-height:30px;padding:3px 8px"') + btn("VPC에 연결", "attach", g.id, { tone: "blue" }) : ""}${btn("삭제", "del", g.id, { tone: "danger" })}</div>`,
            },
          ],
          o.igws,
          { empty: "인터넷 게이트웨이가 없어요." }
        )
      ),
    wire: {
      "create-igw": async () => {
        const r = await modal({ title: "인터넷 게이트웨이 생성", fields: [{ id: "m-name", label: "이름 태그", value: "web-igw" }], okLabel: "생성" });
        if (r) await act(api.post("/api/internet-gateways", { name: r["m-name"] }), "생성했어요. 이제 VPC에 연결하세요 (아직은 분리 상태).");
      },
      attach: (id) => act(api.post(`/api/internet-gateways/${id}/attach`, { vpcId: val(`vpc-${id}`) }), "VPC에 연결했어요. 라우팅 테이블에 라우트를 추가해야 인터넷이 돼요."),
      detach: (id) => act(api.post(`/api/internet-gateways/${id}/detach`), "분리했어요."),
      del: (id) => act(api.del(`/api/internet-gateways/${id}`), "삭제했어요."),
    },
  },

  /* ===== NAT 게이트웨이 ===== */
  nat: {
    list: (o) =>
      pageHead({ icon: "nat", title: "NAT 게이트웨이", desc: "프라이빗 서브넷의 서버가 인터넷으로 '나가는' 통신(패키지 업데이트, 외부 API 호출)만 할 수 있게 해줘요. 퍼블릭 서브넷에 만들고 프라이빗 라우팅 테이블이 가리키게 해요.", actions: `<a class="btn primary" href="${newHref("vpc", "nat")}">NAT 게이트웨이 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (n) => `<span class="cell-title">${svc("nat", "sm")}${esc(n.name)}</span>` },
            { label: "ID", render: (n) => mono(n.id) },
            { label: "유형", render: (n) => (n.connectivity === "public" ? tag("퍼블릭", "green") : tag("프라이빗", "gray")) },
            { label: "서브넷 · AZ", render: (n) => `${esc((o.subnets.find((s) => s.id === n.subnetId) || {}).name || n.subnetId)}<span class="cell-sub">${n.availabilityZone}</span>` },
            { label: "탄력적 IP", render: (n) => esc(n.publicIp || "-") },
            { label: "상태", render: (n) => badge(n.state) },
            { label: "", render: (n) => btn("삭제", "del", n.id, { tone: "danger" }) },
          ],
          o.nats,
          { empty: "NAT 게이트웨이가 없어요. 프라이빗 서브넷의 서버가 인터넷에서 패키지를 받으려면 필요해요." }
        )
      ),
    wire: { del: async (id) => (await confirmBox("NAT 게이트웨이 삭제", "<p>이 NAT를 가리키던 라우트는 blackhole 상태가 돼요. 탄력적 IP는 계정에 남아요.</p>")) && act(api.del(`/api/nat-gateways/${id}`), "삭제를 시작했어요.") },
    form: (o) =>
      pageHead({ icon: "nat", title: "NAT 게이트웨이 생성" }) +
      needVpc(o) +
      errorBox() +
      section(
        "설정",
        field("이름", input("f-name", { value: "nat-a" })) +
          field("서브넷", select("f-subnet", o.subnets.map((s) => ({ value: s.id, label: subnetLabel(s) }))), "퍼블릭 NAT는 반드시 퍼블릭 서브넷에") +
          field("연결 유형", select("f-conn", [{ value: "public", label: "퍼블릭 (인터넷으로 나감, 탄력적 IP 자동 할당)" }, { value: "private", label: "프라이빗 (다른 VPC/온프레미스로만)" }])) +
          info("NAT 게이트웨이는 <b>AZ에 종속</b>돼요. 한 AZ에만 두면 그 AZ가 멈출 때 다른 AZ의 프라이빗 서버도 인터넷에 못 나가요. 운영 환경은 AZ마다 하나씩 두는 게 권장이에요.", "info")
      ) +
      formActions(listHref("vpc", "nat"), "NAT 게이트웨이 생성"),
    submit: async () => {
      await api.post("/api/nat-gateways", { name: val("f-name"), subnetId: val("f-subnet"), connectivity: val("f-conn") });
      toast("NAT 게이트웨이를 만드는 중이에요. 프라이빗 라우팅 테이블에 0.0.0.0/0 → nat 라우트를 추가하세요.");
      location.hash = listHref("vpc", "nat");
    },
  },

  /* ===== 탄력적 IP ===== */
  eip: {
    list: (o) => {
      const insts = o.instances.filter((i) => i.state === "running" || i.state === "stopped");
      return (
        pageHead({ icon: "eip", title: "탄력적 IP", desc: "껐다 켜도 바뀌지 않는 고정 퍼블릭 IPv4 주소예요. 연결하지 않고 두면 시간당 요금이 나가요.", actions: `<button class="btn primary" data-act="alloc">탄력적 IP 할당</button>` }) +
        card(
          "",
          table(
            [
              { label: "퍼블릭 IP", render: (e) => `<span class="cell-title">${svc("eip", "sm")}${esc(e.publicIp)}</span>` },
              { label: "할당 ID", render: (e) => mono(e.id) },
              { label: "연결 대상", render: (e) => (e.instanceId ? esc((o.instances.find((i) => i.id === e.instanceId) || {}).name || e.instanceId) : e.natGatewayId ? `NAT ${esc(e.natGatewayId)}` : tag("미연결 · 과금 중", "orange")) },
              {
                label: "",
                render: (e) =>
                  e.natGatewayId
                    ? `<span class="muted small">NAT 사용 중</span>`
                    : e.instanceId
                    ? btn("연결 해제", "disassoc", e.id)
                    : `<div class="btn-row">${insts.length ? select(`eip-${e.id}`, insts.map((i) => ({ value: i.id, label: i.name })), "", 'style="width:auto;min-height:30px;padding:3px 8px"') + btn("연결", "assoc", e.id, { tone: "blue" }) : ""}${btn("해제(릴리스)", "release", e.id, { tone: "danger" })}</div>`,
              },
            ],
            o.eips,
            { empty: "할당된 탄력적 IP가 없어요." }
          )
        )
      );
    },
    wire: {
      alloc: () => act(api.post("/api/elastic-ips", {}), "탄력적 IP를 할당했어요. 인스턴스에 연결하세요."),
      assoc: (id) => act(api.post(`/api/elastic-ips/${id}/associate`, { instanceId: val(`eip-${id}`) }), "연결했어요. 이제 인스턴스를 재시작해도 IP가 유지돼요."),
      disassoc: (id) => act(api.post(`/api/elastic-ips/${id}/disassociate`), "연결을 해제했어요."),
      release: (id) => act(api.del(`/api/elastic-ips/${id}`), "IP를 해제했어요."),
    },
  },

  /* ===== 보안 그룹 ===== */
  sg: {
    list: (o) =>
      pageHead({ icon: "sg", title: "보안 그룹", desc: "인스턴스(ENI) 단위의 가상 방화벽이에요. 허용 규칙만 있고 Stateful이라, 들어온 요청의 응답은 자동으로 나가요.", actions: `<a class="btn primary" href="${newHref("vpc", "sg")}">보안 그룹 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (s) => `<span class="cell-title">${svc("sg", "sm")}${esc(s.name)}${s.managedBy ? tag("컨트롤러 생성", "orange") : ""}</span><span class="cell-sub">${esc(s.description)}</span>` },
            { label: "ID", render: (s) => mono(s.id) },
            { label: "VPC", render: (s) => esc(vpcName(o, s.vpcId)) },
            { label: "인바운드 규칙", render: (s) => (s.inboundRules.length ? s.inboundRules.map((r) => `<span class="cell-sub">${esc(r.protocol.toUpperCase())} ${esc(r.port || "전체")} ← ${esc(sgSourceLabel(o, r.source))}</span>`).join("") : tag("규칙 없음 (전부 차단)", "gray")) },
          ],
          o.sgs,
          { empty: "보안 그룹이 없어요.", rowHref: (s) => detailHref("vpc", "sg", s.id) }
        )
      ),
    form: (o) =>
      pageHead({ icon: "sg", title: "보안 그룹 생성" }) +
      needVpc(o) +
      errorBox() +
      section(
        "기본 정보",
        field("VPC", select("f-vpc", vpcOptions(o))) + field("이름", input("f-name", { placeholder: "예: web-sg" })) + field("설명", input("f-desc", { placeholder: "예: 웹 서버 HTTP/HTTPS 허용" }), "", { full: true }),
        "인바운드 규칙은 만든 다음 상세 화면에서 추가해요. 규칙이 없으면 들어오는 트래픽은 모두 차단돼요."
      ) +
      formActions(listHref("vpc", "sg"), "보안 그룹 생성"),
    submit: async () => {
      const sg = await api.post("/api/security-groups", { vpcId: val("f-vpc"), name: val("f-name") || "sg", description: val("f-desc") });
      toast("보안 그룹을 만들었어요. 인바운드 규칙을 추가하세요.");
      location.hash = detailHref("vpc", "sg", sg.id);
    },
    detail: (o, id) => {
      const sg = o.sgs.find((s) => s.id === id);
      if (!sg) return info("보안 그룹을 찾을 수 없어요.", "error");
      const others = o.sgs.filter((s) => s.vpcId === sg.vpcId && s.id !== sg.id);
      const usedBy = o.instances.filter((i) => i.securityGroupId === id && i.state !== "terminated");
      return (
        pageHead({ icon: "sg", title: sg.name, desc: `${mono(sg.id)} · ${esc(vpcName(o, sg.vpcId))} · Stateful`, actions: btn("삭제", "del-sg", sg.id, { tone: "danger" }) }) +
        card(
          "인바운드 규칙",
          table(
            [
              { label: "프로토콜", render: (r) => esc(r.protocol.toUpperCase()) },
              { label: "포트", render: (r) => esc(r.port || "전체") },
              { label: "소스", render: (r) => (r.source.startsWith("sg-") ? `${tag("보안 그룹 참조", "blue")} ${esc(sgSourceLabel(o, r.source))}` : esc(r.source)) },
              { label: "설명", render: (r) => esc(r.description || "") },
              { label: "", render: (r) => btn("삭제", "del-rule", r.id, { tone: "danger" }) },
            ],
            sg.inboundRules,
            { empty: "규칙이 없어요. 기본값은 모든 인바운드 차단이에요." }
          ) +
            `<div class="inline-form">
              ${field("프로토콜", select("r-proto", [{ value: "tcp", label: "TCP" }, { value: "udp", label: "UDP" }, { value: "icmp", label: "ICMP" }]))}
              ${field("포트", select("r-port", [{ value: "80", label: "80 (HTTP)" }, { value: "443", label: "443 (HTTPS)" }, { value: "22", label: "22 (SSH)" }, { value: "3306", label: "3306 (MySQL)" }, { value: "5432", label: "5432 (PostgreSQL)" }, { value: "6379", label: "6379 (Redis/Valkey)" }, { value: "2049", label: "2049 (NFS/EFS)" }, { value: "8080", label: "8080 (앱)" }]))}
              ${field("소스", select("r-source", [{ value: "0.0.0.0/0", label: "0.0.0.0/0 (어디서나)" }, { value: "10.0.0.0/16", label: "10.0.0.0/16 (VPC 내부)" }, { value: "203.0.113.10/32", label: "203.0.113.10/32 (내 IP 예시)" }, ...others.map((s) => ({ value: s.id, label: `보안 그룹: ${s.name}` }))]))}
              ${field("설명", input("r-desc", { placeholder: "선택" }))}
              <button class="btn blue" data-act="add-rule" data-id="${sg.id}">규칙 추가</button>
            </div>
            ${info("<b>보안 그룹 체이닝</b> · 소스에 IP 대신 다른 보안 그룹을 지정하면 '그 보안 그룹이 붙은 인스턴스'에서 오는 트래픽만 허용해요. 예: DB 보안 그룹 → 소스 = 웹 서버 보안 그룹. IP가 바뀌어도 규칙을 고칠 필요가 없어요.", "info")}`
        ) +
        card("아웃바운드 규칙", `<p class="muted">기본값: 모든 트래픽 허용 (0.0.0.0/0). Stateful이라 인바운드로 허용된 연결의 응답은 따로 규칙이 없어도 나가요.</p>`) +
        card("이 보안 그룹을 쓰는 리소스", usedBy.length ? usedBy.map((i) => `<div class="cell-title">${svc("ec2", "xs")}${esc(i.name)} ${badge(i.state)}</div>`).join("") : `<p class="muted">없음</p>`)
      );
    },
    wire: {
      "add-rule": (id) => act(api.post(`/api/security-groups/${id}/rules`, { protocol: val("r-proto"), port: val("r-port"), source: val("r-source"), description: val("r-desc") }), "규칙을 추가했어요."),
      "del-rule": (rid) => act(api.del(`/api/security-groups/${App.parse().params.get("id")}/rules/${rid}`), "규칙을 삭제했어요."),
      "del-sg": async (id) => {
        if (!(await confirmBox("보안 그룹 삭제", "<p>다른 보안 그룹이 참조 중이거나 인스턴스가 사용 중이면 삭제할 수 없어요.</p>"))) return;
        await api.del(`/api/security-groups/${id}`);
        location.hash = listHref("vpc", "sg");
      },
    },
  },

  /* ===== 네트워크 ACL ===== */
  nacl: {
    list: (o) =>
      pageHead({ icon: "nacl", title: "네트워크 ACL", desc: "서브넷 경계의 방화벽이에요. Stateless라 응답 트래픽도 아웃바운드 규칙으로 허용해야 하고, 규칙 번호가 낮은 것부터 평가해 처음 일치하는 규칙을 적용해요.", actions: `<a class="btn primary" href="${newHref("vpc", "nacl")}">네트워크 ACL 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (n) => `<span class="cell-title">${svc("nacl", "sm")}${esc(n.name)}</span>` },
            { label: "ID", render: (n) => mono(n.id) },
            { label: "VPC", render: (n) => esc(vpcName(o, n.vpcId)) },
            { label: "규칙", render: (n) => `인바운드 ${n.rules.filter((r) => r.direction === "inbound").length} · 아웃바운드 ${n.rules.filter((r) => r.direction === "outbound").length}` },
            { label: "연결된 서브넷", render: (n) => `${n.subnetIds.length}개` },
          ],
          o.nacls,
          { empty: "사용자 지정 네트워크 ACL이 없어요. (기본 ACL은 모든 트래픽을 허용해요)", rowHref: (n) => detailHref("vpc", "nacl", n.id) }
        )
      ),
    form: (o) =>
      pageHead({ icon: "nacl", title: "네트워크 ACL 생성" }) +
      needVpc(o) +
      errorBox() +
      section("설정", field("VPC", select("f-vpc", vpcOptions(o))) + field("이름", input("f-name", { placeholder: "예: public-nacl" })), "새 ACL은 규칙이 없어서 연결하는 순간 모든 트래픽이 차단돼요. 규칙부터 추가하세요.") +
      formActions(listHref("vpc", "nacl"), "생성"),
    submit: async () => {
      const n = await api.post("/api/nacls", { vpcId: val("f-vpc"), name: val("f-name") || "nacl" });
      location.hash = detailHref("vpc", "nacl", n.id);
    },
    detail: (o, id) => {
      const n = o.nacls.find((x) => x.id === id);
      if (!n) return info("네트워크 ACL을 찾을 수 없어요.", "error");
      const rulesTable = (dir) =>
        table(
          [
            { label: "규칙 #", render: (r) => r.ruleNumber },
            { label: "프로토콜", render: (r) => esc(r.protocol.toUpperCase()) },
            { label: "포트", render: (r) => esc(r.port || "전체") },
            { label: dir === "inbound" ? "소스" : "대상", render: (r) => esc(r.cidr) },
            { label: "동작", render: (r) => (r.action === "allow" ? tag("허용", "green") : tag("거부", "red")) },
            { label: "", render: (r) => btn("삭제", "del-rule", r.id, { tone: "danger" }) },
          ],
          n.rules.filter((r) => r.direction === dir).concat([{ id: "*", ruleNumber: "*", protocol: "all", port: "", cidr: "0.0.0.0/0", action: "deny", fixed: true }]).map((r) => r),
          {}
        ).replace(/<button class="btn sm danger" data-act="del-rule" data-id="\*"[^>]*>삭제<\/button>/, '<span class="muted small">기본 규칙</span>');
      const ruleForm = (dir) => `<div class="inline-form">
        ${field("규칙 #", input(`n-num-${dir}`, { type: "number", value: dir === "inbound" ? 100 : 100 }))}
        ${field("프로토콜", select(`n-proto-${dir}`, [{ value: "tcp", label: "TCP" }, { value: "udp", label: "UDP" }, { value: "all", label: "전체" }]))}
        ${field("포트", input(`n-port-${dir}`, { value: dir === "inbound" ? "80" : "1024-65535" }))}
        ${field("CIDR", input(`n-cidr-${dir}`, { value: "0.0.0.0/0" }))}
        ${field("동작", select(`n-act-${dir}`, [{ value: "allow", label: "허용" }, { value: "deny", label: "거부" }]))}
        <button class="btn blue" data-act="add-rule" data-id="${dir}">추가</button>
      </div>`;
      return (
        pageHead({ icon: "nacl", title: n.name, desc: `${mono(n.id)} · Stateless · 번호가 낮은 규칙부터 평가`, actions: btn("삭제", "del-nacl", n.id, { tone: "danger" }) }) +
        card("인바운드 규칙", rulesTable("inbound") + ruleForm("inbound")) +
        card("아웃바운드 규칙", rulesTable("outbound") + ruleForm("outbound") + info("Stateless라서 웹 서버 응답이 나가려면 <b>임시 포트(1024-65535)</b>로의 아웃바운드 허용이 필요해요.", "info")) +
        card(
          "서브넷 연결",
          checkList("nassoc", o.subnets.filter((s) => s.vpcId === n.vpcId).map((s) => ({ value: s.id, label: esc(s.name) })), n.subnetIds) +
            `<div class="inline-form"><button class="btn blue" data-act="assoc" data-id="${n.id}">선택한 서브넷 연결</button></div>`
        )
      );
    },
    wire: {
      "add-rule": (dir) =>
        act(
          api.post(`/api/nacls/${App.parse().params.get("id")}/rules`, {
            direction: dir,
            ruleNumber: val(`n-num-${dir}`),
            protocol: val(`n-proto-${dir}`),
            port: val(`n-port-${dir}`),
            cidr: val(`n-cidr-${dir}`),
            action: val(`n-act-${dir}`),
          }),
          "규칙을 추가했어요."
        ),
      "del-rule": (rid) => act(api.del(`/api/nacls/${App.parse().params.get("id")}/rules/${rid}`), "규칙을 삭제했어요."),
      assoc: async (id) => {
        for (const s of checkedValues("nassoc")) await api.post(`/api/nacls/${id}/associate`, { subnetId: s });
        toast("서브넷을 연결했어요.");
        App.refresh();
      },
      "del-nacl": async (id) => {
        await api.del(`/api/nacls/${id}`);
        location.hash = listHref("vpc", "nacl");
      },
    },
  },

  /* ===== VPN · Direct Connect ===== */
  hybrid: {
    list: (o) => {
      const vpnData = { vgws: o.vgws, vpns: o.vpns, dxs: o.dxs };
      return (
        pageHead({ icon: "vpn", title: "VPN · Direct Connect", desc: "사내 데이터센터(온프레미스)와 VPC를 연결하는 두 가지 방법이에요. VPN은 인터넷 위의 암호화 터널로 빠르게, Direct Connect는 전용선으로 안정적으로 연결해요." }) +
        `<div class="pipeline" style="margin-bottom:18px">
          <span class="pnode ${o.dxs.length || o.vpns.length ? "" : "off"}">${svc("dx", "xs")}사내망 (온프레미스)</span>${glyph("arrow", "arrow")}
          <span class="pnode ${vpnData.vpns.length ? "" : "off"}">${svc("vpn", "xs")}고객 게이트웨이 → VPN 터널 ×2</span>${glyph("arrow", "arrow")}
          <span class="pnode ${o.vgws.some((v) => v.vpcId) ? "" : "off"}">${svc("vpn", "xs")}가상 프라이빗 게이트웨이</span>${glyph("arrow", "arrow")}
          <span class="pnode ${o.vpcs.length ? "" : "off"}">${svc("vpc", "xs")}VPC (라우팅 테이블에 vgw 라우트)</span>
        </div>` +
        `<div class="grid-2">` +
        card(
          "① 가상 프라이빗 게이트웨이 (VGW)",
          table(
            [
              { label: "이름/ID", render: (v) => `${esc(v.name)}<span class="cell-sub">${esc(v.id)} · ASN ${v.asn}</span>` },
              { label: "상태", render: (v) => badge(v.state) },
              { label: "", render: (v) => (v.vpcId ? `${esc(vpcName(o, v.vpcId))} ${btn("분리", "vgw-detach", v.id)}` : `<div class="btn-row">${o.vpcs.length ? select(`vgw-${v.id}`, vpcOptions(o), "", 'style="width:auto;min-height:30px;padding:3px 8px"') + btn("연결", "vgw-attach", v.id, { tone: "blue" }) : ""}${btn("삭제", "vgw-del", v.id, { tone: "danger" })}</div>`) },
            ],
            o.vgws,
            { empty: "VGW가 없어요." }
          ),
          { actions: `<button class="btn sm primary" data-act="vgw-new">생성</button>` }
        ) +
        card(
          "② 고객 게이트웨이 (CGW)",
          `<div id="cgw-list"></div>`,
          { actions: `<button class="btn sm primary" data-act="cgw-new">생성</button>`, sub: "사내 라우터/방화벽 장비의 정보를 AWS에 등록해요." }
        ) +
        `</div>` +
        card(
          "③ Site-to-Site VPN 연결",
          table(
            [
              { label: "이름", render: (v) => `<span class="cell-title">${svc("vpn", "sm")}${esc(v.name)}</span><span class="cell-sub">${esc(v.id)}</span>` },
              { label: "VPC", render: (v) => esc(vpcName(o, v.vpcId)) },
              { label: "사내 대역", render: (v) => esc(v.onPremCidr) },
              { label: "터널", render: (v) => v.tunnels.map((t, i) => `<span class="cell-sub">터널 ${i + 1} ${esc(t.outsideIp)} ${badge(t.status)}</span>`).join("") },
              { label: "상태", render: (v) => badge(v.state) },
              { label: "", render: (v) => btn("삭제", "vpn-del", v.id, { tone: "danger" }) },
            ],
            o.vpns,
            { empty: "VPN 연결이 없어요." }
          ),
          { actions: `<button class="btn sm primary" data-act="vpn-new">VPN 연결 생성</button>`, sub: "가용성을 위해 터널이 항상 2개 만들어져요. 연결 후 라우팅 테이블에 사내 대역 → vgw 라우트를 추가하세요." }
        ) +
        card(
          "AWS Direct Connect",
          table(
            [
              { label: "연결", render: (d) => `<span class="cell-title">${svc("dx", "sm")}${esc(d.name)}</span><span class="cell-sub">${esc(d.id)}</span>` },
              { label: "위치", render: (d) => esc(d.location) },
              { label: "대역폭", render: (d) => esc(d.bandwidth) },
              { label: "상태", render: (d) => badge(d.state) },
              { label: "", render: (d) => btn("삭제", "dx-del", d.id, { tone: "danger" }) },
            ],
            o.dxs,
            { empty: "전용선 연결이 없어요." }
          ),
          { actions: `<button class="btn sm primary" data-act="dx-new">연결 요청</button>`, sub: "실제로는 물리 회선 작업에 수 주가 걸려요. 인터넷을 거치지 않아 지연이 일정하고 대용량 전송에 유리해요." }
        )
      );
    },
    after: async () => {
      const cgws = await api.get("/api/customer-gateways");
      byId("cgw-list").innerHTML = table(
        [
          { label: "이름/ID", render: (c) => `${esc(c.name)}<span class="cell-sub">${esc(c.id)}</span>` },
          { label: "IP · ASN", render: (c) => `${esc(c.ipAddress)} · ${c.bgpAsn}` },
          { label: "", render: (c) => btn("삭제", "cgw-del", c.id, { tone: "danger" }) },
        ],
        cgws,
        { empty: "등록된 고객 게이트웨이가 없어요." }
      );
      NetworkPages.hybrid.cgws = cgws;
    },
    wire: {
      "vgw-new": async () => {
        const r = await modal({ title: "가상 프라이빗 게이트웨이 생성", fields: [{ id: "m-name", label: "이름", value: "vgw" }, { id: "m-asn", label: "Amazon 측 ASN", value: "64512" }], okLabel: "생성" });
        if (r) await act(api.post("/api/vpn-gateways", { name: r["m-name"], asn: r["m-asn"] }), "VGW를 만들었어요. VPC에 연결하세요.");
      },
      "vgw-attach": (id) => act(api.post(`/api/vpn-gateways/${id}/attach`, { vpcId: val(`vgw-${id}`) }), "VPC에 연결했어요."),
      "vgw-detach": (id) => act(api.post(`/api/vpn-gateways/${id}/detach`), "분리했어요."),
      "vgw-del": (id) => act(api.del(`/api/vpn-gateways/${id}`), "삭제했어요."),
      "cgw-new": async () => {
        const r = await modal({ title: "고객 게이트웨이 생성", fields: [{ id: "m-name", label: "이름", value: "office-router" }, { id: "m-ip", label: "사내 장비 퍼블릭 IP", value: "203.0.113.10" }, { id: "m-asn", label: "BGP ASN", value: "65000" }], okLabel: "생성" });
        if (r) await act(api.post("/api/customer-gateways", { name: r["m-name"], ipAddress: r["m-ip"], bgpAsn: r["m-asn"] }), "고객 게이트웨이를 등록했어요.");
      },
      "cgw-del": (id) => act(api.del(`/api/customer-gateways/${id}`), "삭제했어요."),
      "vpn-new": async (_, el) => {
        const o = await load.overview();
        const cgws = await api.get("/api/customer-gateways");
        const r = await modal({
          title: "Site-to-Site VPN 연결",
          fields: [
            { id: "m-name", label: "이름", value: "office-vpn" },
            { id: "m-vgw", label: "가상 프라이빗 게이트웨이", options: o.vgws.filter((v) => v.vpcId).map((v) => ({ value: v.id, label: `${v.name} (${vpcName(o, v.vpcId)})` })) },
            { id: "m-cgw", label: "고객 게이트웨이", options: cgws.map((c) => ({ value: c.id, label: `${c.name} (${c.ipAddress})` })) },
            { id: "m-cidr", label: "사내 네트워크 대역", value: "192.168.0.0/16" },
          ],
          okLabel: "생성",
        });
        if (r) await act(api.post("/api/vpn-connections", { name: r["m-name"], vgwId: r["m-vgw"], cgwId: r["m-cgw"], onPremCidr: r["m-cidr"] }), "VPN 연결을 만드는 중이에요 (터널 2개).");
      },
      "vpn-del": (id) => act(api.del(`/api/vpn-connections/${id}`), "삭제했어요."),
      "dx-new": async () => {
        const r = await modal({
          title: "Direct Connect 연결 요청",
          fields: [
            { id: "m-name", label: "이름", value: "dx-seoul" },
            { id: "m-loc", label: "로케이션", options: ["KINX 가산 (Seoul)", "LG U+ 평촌 (Seoul)"], value: "KINX 가산 (Seoul)" },
            { id: "m-bw", label: "포트 대역폭", options: ["1Gbps", "10Gbps"], value: "1Gbps" },
          ],
          okLabel: "요청",
        });
        if (r) await act(api.post("/api/dx-connections", { name: r["m-name"], location: r["m-loc"], bandwidth: r["m-bw"] }), "연결을 요청했어요 (주문 중 → 대기 → 사용 가능).");
      },
      "dx-del": (id) => act(api.del(`/api/dx-connections/${id}`), "삭제했어요."),
    },
  },
};

function sgSourceLabel(o, source) {
  if (!source || !source.startsWith("sg-")) return source;
  const s = o.sgs.find((x) => x.id === source);
  return s ? `${s.name} (${s.id.slice(0, 11)}…)` : source;
}

// 섹션 공통 렌더러: 목록 / 생성 폼 / 상세를 tab·new·id 파라미터로 나눠 보여줌
async function renderSection(pages, sectionKey, defaultTab, p) {
  const tab = p.get("tab") || defaultTab;
  const page = pages[tab] || pages[defaultTab];
  const o = await load.overview();
  let html;
  if (p.get("new") && page.form) html = page.form(o, p);
  else if (p.get("id") && page.detail) html = page.detail(o, p.get("id"), p);
  else html = page.list(o, p);
  byId("content").innerHTML = html;
  if (page.after) await page.after(o, p);
  wire(page.wire || {});
  if (p.get("new") && page.submit) onSubmit(() => page.submit(o, p));
  if (page.bind) page.bind(o, p);
  const busy = JSON.stringify(o).match(/"(pending|creating|CREATING|UPDATING|DELETING|provisioning|shutting-down|stopping|deleting|modifying|rebooting|InProgress|ordering|ContainerCreating|Pending|Terminating|IN_PROGRESS)"/);
  App.autoRefresh(!p.get("new") && !!busy, 2500);
}

App.route("/vpc", (p) => renderSection(NetworkPages, "vpc", "vpcs", p), sectionMeta("vpc", "vpcs"));
