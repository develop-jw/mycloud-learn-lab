/* ---- 트래픽 화면: 로드 밸런서 · 대상 그룹 · CloudFront · Route 53 ---- */

const TrafficPages = {
  /* ===== 로드 밸런서 ===== */
  lbs: {
    list: (o) =>
      pageHead({ icon: "elb", title: "로드 밸런서", desc: "여러 가용 영역의 서버에 트래픽을 나눠 줘요. ALB는 L7(HTTP 경로·호스트 기반), NLB는 L4(TCP/UDP, 초고성능·고정 IP)예요.", actions: `<a class="btn primary" href="${newHref("elb", "lbs")}">로드 밸런서 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (l) => `<span class="cell-title">${svc("elb", "sm")}<span>${esc(l.name)}<span class="cell-sub">${l.managedBy ? `쿠버네티스 ${l.managedBy.type === "ingress" ? "Ingress" : "Service"}가 생성` : ""}</span></span></span>` },
            { label: "유형", render: (l) => (l.type === "application" ? tag("ALB · L7", "blue") : tag("NLB · L4", "orange")) },
            { label: "체계", render: (l) => (l.scheme === "internet-facing" ? "인터넷 연결" : "내부") },
            { label: "DNS 이름", render: (l) => `<span class="cell-sub" style="max-width:260px;word-break:break-all">${esc(l.dnsName)}</span>` },
            { label: "정상 대상", render: (l) => `${l.healthy} / ${l.totalTargets}` },
            { label: "상태", render: (l) => badge(l.state) },
          ],
          o.lbs,
          { empty: "로드 밸런서가 없어요. 서로 다른 AZ의 퍼블릭 서브넷 2개와 대상 그룹이 필요해요.", rowHref: (l) => detailHref("elb", "lbs", l.id) }
        )
      ),
    form: (o) =>
      pageHead({ icon: "elb", title: "로드 밸런서 생성" }) +
      (o.tgs.length ? "" : info(`리스너가 트래픽을 보낼 <a href="${newHref("elb", "tgs")}">대상 그룹</a>을 먼저 만드세요.`, "warn")) +
      errorBox() +
      section(
        "1. 유형 선택",
        choiceCards(
          "lbtype",
          [
            { value: "application", label: "Application Load Balancer", icon: "elb", desc: "HTTP/HTTPS · 경로/호스트 라우팅 · 보안 그룹 사용" },
            { value: "network", label: "Network Load Balancer", icon: "elb", desc: "TCP/UDP/TLS · 초당 수백만 요청 · 초저지연" },
          ],
          "application"
        )
      ) +
      section(
        "2. 기본 구성",
        field("이름", input("f-name", { placeholder: "web-alb" })) +
          field("체계", select("f-scheme", [{ value: "internet-facing", label: "인터넷 연결 (퍼블릭 서브넷 필요)" }, { value: "internal", label: "내부 (VPC 안에서만)" }]))
      ) +
      section("3. 네트워크 매핑 — 서로 다른 AZ의 서브넷 2개 이상", `<div class="full">${checkList("lb-subnets", o.subnets.map((s) => ({ value: s.id, label: esc(subnetLabel(s)) })))}</div>`) +
      section("4. 보안 그룹 (ALB만)", `<div class="full">${checkList("lb-sgs", o.sgs.map((s) => ({ value: s.id, label: `${esc(s.name)} · ${esc(vpcName(o, s.vpcId))}` })))}</div>`, "80/443을 0.0.0.0/0에 연 보안 그룹을 고르세요.") +
      section(
        "5. 리스너와 라우팅",
        field("프로토콜", select("f-proto", ["HTTP", "HTTPS", "TCP", "TLS"])) +
          field("포트", input("f-port", { type: "number", value: 80 })) +
          field("기본 대상 그룹", select("f-tg", o.tgs.map((t) => ({ value: t.id, label: `${t.name} (${t.protocol}:${t.port})` })))) +
          field("인증서 (HTTPS/TLS일 때)", input("f-cert", { placeholder: "arn:aws:acm:ap-northeast-2:123456789012:certificate/..." }))
      ) +
      formActions(listHref("elb", "lbs"), "로드 밸런서 생성"),
    submit: async () => {
      const lb = await api.post("/api/load-balancers", {
        name: val("f-name"),
        type: choiceValue("lbtype"),
        scheme: val("f-scheme"),
        subnetIds: checkedValues("lb-subnets"),
        securityGroupIds: checkedValues("lb-sgs"),
        listeners: [{ protocol: val("f-proto"), port: val("f-port"), targetGroupId: val("f-tg"), certificate: val("f-cert") }],
      });
      toast("로드 밸런서를 프로비저닝하는 중이에요.");
      location.hash = detailHref("elb", "lbs", lb.id);
    },
    detail: (o, id) => {
      const lb = o.lbs.find((l) => l.id === id);
      if (!lb) return info("로드 밸런서를 찾을 수 없어요.", "error");
      const tgName = (tid) => (o.tgs.find((t) => t.id === tid) || {}).name || tid;
      const vpcTgs = o.tgs.filter((t) => t.vpcId === lb.vpcId).map((t) => ({ value: t.id, label: t.name }));
      return (
        pageHead({ icon: "elb", title: lb.name, desc: `${lb.type === "application" ? "Application" : "Network"} Load Balancer · ${badge(lb.state)}`, actions: btn("삭제", "del-lb", lb.id, { tone: "danger" }) }) +
        card(
          "세부 정보",
          kv([
            ["DNS 이름", `${mono(lb.dnsName)}<br/><small class="muted">이 주소를 Route 53 별칭 레코드나 CloudFront 원본으로 써요.</small>`],
            ["체계", lb.scheme === "internet-facing" ? "인터넷 연결" : "내부"],
            ["VPC", esc(vpcName(o, lb.vpcId))],
            ["가용 영역", lb.subnetIds.map((s) => { const x = o.subnets.find((y) => y.id === s); return x ? `${esc(x.availabilityZone)} (${esc(x.name)})` : esc(s); }).join("<br/>")],
            ["보안 그룹", (lb.securityGroupIds || []).map((s) => esc((o.sgs.find((x) => x.id === s) || {}).name || s)).join(", ") || "없음 (NLB)"],
            ["정상 대상", `${lb.healthy} / ${lb.totalTargets}`],
          ])
        ) +
        card(
          "리스너 및 규칙",
          lb.listeners
            .map(
              (ls) => `<div class="node-card" style="margin-bottom:10px">
            <div class="row"><b>${esc(ls.protocol)}:${ls.port}</b><span>${ls.certificate ? tag("인증서", "green") : ""}${btn("리스너 삭제", "del-ls", ls.id, { tone: "danger" })}</span></div>
            ${table(
              [
                { label: "조건", render: (r) => esc(r.cond) },
                { label: "동작", render: (r) => `대상 그룹 <b>${esc(r.tg)}</b>(으)로 전달` },
              ],
              [...(ls.rules || []).map((r) => ({ cond: `경로가 ${r.path}`, tg: tgName(r.targetGroupId) })), { cond: "기본(나머지 전부)", tg: tgName(ls.targetGroupId) }]
            )}
            ${
              lb.type === "application"
                ? `<div class="inline-form">${field("경로 패턴", input(`rp-${ls.id}`, { placeholder: "/api/*" }))}${field("대상 그룹", select(`rt-${ls.id}`, vpcTgs))}<button class="btn blue" data-act="add-rule" data-id="${ls.id}">경로 규칙 추가</button></div>`
                : ""
            }
          </div>`
            )
            .join("") +
            `<div class="inline-form">${field("새 리스너 프로토콜", select("nl-proto", lb.type === "application" ? ["HTTP", "HTTPS"] : ["TCP", "UDP", "TLS"]))}${field("포트", input("nl-port", { type: "number", value: 443 }))}${field("대상 그룹", select("nl-tg", vpcTgs))}${field("인증서", input("nl-cert", { placeholder: "HTTPS면 필수" }))}<button class="btn blue" data-act="add-ls" data-id="${lb.id}">리스너 추가</button></div>`,
          { sub: "ALB는 규칙을 위에서부터 평가해 처음 일치하는 곳으로 보내요." }
        )
      );
    },
    wire: {
      "add-rule": (lsId) => act(api.post(`/api/load-balancers/${App.parse().params.get("id")}/listeners/${lsId}/rules`, { path: val(`rp-${lsId}`), targetGroupId: val(`rt-${lsId}`) }), "규칙을 추가했어요."),
      "add-ls": (id) => act(api.post(`/api/load-balancers/${id}/listeners`, { protocol: val("nl-proto"), port: val("nl-port"), targetGroupId: val("nl-tg"), certificate: val("nl-cert") }), "리스너를 추가했어요."),
      "del-ls": (lsId) => act(api.del(`/api/load-balancers/${App.parse().params.get("id")}/listeners/${lsId}`), "리스너를 삭제했어요."),
      "del-lb": async (id) => {
        if (!(await confirmBox("로드 밸런서 삭제", "<p>이 주소로 들어오던 트래픽이 모두 끊겨요.</p>"))) return;
        await api.del(`/api/load-balancers/${id}`);
        location.hash = listHref("elb", "lbs");
      },
    },
  },

  /* ===== 대상 그룹 ===== */
  tgs: {
    list: () => `${pageHead({ icon: "tg", title: "대상 그룹", desc: "로드 밸런서가 요청을 보낼 서버 묶음이에요. 헬스 체크를 통과한(healthy) 대상에게만 트래픽이 가요.", actions: `<a class="btn primary" href="${newHref("elb", "tgs")}">대상 그룹 생성</a>` })}<div id="tg-slot"></div>`,
    after: async (o, p) => {
      if (p.get("new")) return;
      const tgs = await api.get("/api/target-groups");
      const id = p.get("id");
      if (id) {
        const tg = tgs.find((t) => t.id === id);
        if (!tg) return (byId("content").innerHTML = info("대상 그룹을 찾을 수 없어요.", "error"));
        const candidates = o.instances.filter((i) => i.vpcId === tg.vpcId && i.state !== "terminated" && !tg.targets.includes(i.id));
        byId("content").innerHTML =
          pageHead({ icon: "tg", title: tg.name, desc: `${tg.protocol}:${tg.port} · 대상 유형 ${tg.targetType === "ip" ? "IP (파드)" : "인스턴스"} · 헬스 체크 경로 ${esc(tg.healthCheckPath)}`, actions: tg.managedBy ? tag("쿠버네티스가 관리", "orange") : btn("삭제", "del-tg", tg.id, { tone: "danger" }) }) +
          card(
            "등록된 대상",
            table(
              [
                { label: "대상", render: (h) => { const i = o.instances.find((x) => x.id === h.id); return `${esc(i ? i.name : h.id)}<span class="cell-sub">${esc(h.id)}</span>`; } },
                { label: "상태", render: (h) => badge(h.state) },
                { label: "상세", render: (h) => `<span class="small">${esc(h.reason)}</span>` },
                { label: "", render: (h) => (tg.managedBy ? "" : btn("등록 해제", "dereg", h.id)) },
              ],
              tg.targetHealth,
              { empty: "등록된 대상이 없어요. 대상이 없으면 로드 밸런서가 503을 돌려줘요." }
            ) +
              (tg.managedBy || tg.targetType === "ip"
                ? `<p class="muted small">이 대상 그룹의 대상(파드 IP)은 컨트롤러가 자동으로 맞춰요.</p>`
                : `<div class="inline-form" style="display:block">${checkList("tg-add", candidates.map((i) => ({ value: i.id, label: `${esc(i.name)} · ${i.availabilityZone.slice(-2)} ${i.state !== "running" ? `(${i.state})` : ""}` })))}<button class="btn blue" style="margin-top:8px" data-act="reg" data-id="${tg.id}">선택한 인스턴스 등록</button></div>`),
            { sub: "unhealthy면 이유를 확인하세요: 보안 그룹 포트, 웹 서버 설치(User Data) 여부가 대표적인 원인이에요." }
          );
        App.autoRefresh(true, 3000);
        return;
      }
      byId("tg-slot").innerHTML = card(
        "",
        table(
          [
            { label: "이름", render: (t) => `<span class="cell-title">${svc("tg", "sm")}${esc(t.name)}</span>` },
            { label: "프로토콜:포트", render: (t) => `${esc(t.protocol)}:${t.port}` },
            { label: "대상 유형", render: (t) => (t.targetType === "ip" ? "IP" : "인스턴스") },
            { label: "VPC", render: (t) => esc(vpcName(o, t.vpcId)) },
            { label: "헬스", render: (t) => { const h = t.targetHealth.filter((x) => x.state === "healthy").length; return `${h} 정상 / ${t.targetHealth.length}`; } },
            { label: "사용하는 LB", render: (t) => esc(t.usedBy.join(", ") || "-") },
          ],
          tgs,
          { empty: "대상 그룹이 없어요.", rowHref: (t) => detailHref("elb", "tgs", t.id) }
        )
      );
    },
    wire: {
      reg: (id) => act(api.post(`/api/target-groups/${id}/targets`, { instanceIds: checkedValues("tg-add") }), "대상을 등록했어요. 헬스 체크가 시작돼요."),
      dereg: (iid) => act(api.del(`/api/target-groups/${App.parse().params.get("id")}/targets/${iid}`), "등록을 해제했어요."),
      "del-tg": async (id) => {
        await api.del(`/api/target-groups/${id}`);
        location.hash = listHref("elb", "tgs");
      },
    },
    form: (o) =>
      pageHead({ icon: "tg", title: "대상 그룹 생성" }) +
      errorBox() +
      section(
        "설정",
        field("이름", input("f-name", { placeholder: "web-tg" })) +
          field("VPC", select("f-vpc", vpcOptions(o))) +
          field("프로토콜", select("f-proto", ["HTTP", "HTTPS", "TCP"])) +
          field("포트", input("f-port", { type: "number", value: 80 })) +
          field("대상 유형", select("f-type", [{ value: "instance", label: "인스턴스" }, { value: "ip", label: "IP 주소 (컨테이너 등)" }])) +
          field("헬스 체크 경로", input("f-hc", { value: "/" }), "이 경로에 200 OK가 오면 정상으로 봐요.")
      ) +
      formActions(listHref("elb", "tgs"), "대상 그룹 생성"),
    submit: async () => {
      const tg = await api.post("/api/target-groups", { name: val("f-name"), vpcId: val("f-vpc"), protocol: val("f-proto"), port: val("f-port"), targetType: val("f-type"), healthCheckPath: val("f-hc") });
      location.hash = detailHref("elb", "tgs", tg.id);
    },
  },
};

const EdgePages = {
  /* ===== CloudFront ===== */
  cloudfront: {
    list: (o) =>
      pageHead({ icon: "cloudfront", title: "CloudFront 배포", desc: "전 세계 엣지 로케이션에 콘텐츠를 캐싱하는 CDN이에요. 사용자와 가까운 곳에서 응답해 빠르고, 원본(S3·ALB)의 부하를 줄여요.", actions: `<a class="btn primary" href="${newHref("edge", "cloudfront")}">배포 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "배포", render: (d) => `<span class="cell-title">${svc("cloudfront", "sm")}<span>${esc(d.id)}<span class="cell-sub">${esc(d.domainName)}</span></span></span>` },
            { label: "원본", render: (d) => `${d.originType === "s3" ? tag("S3", "green") : tag("ALB", "blue")} <span class="cell-sub">${esc(d.originDomain)}</span>` },
            { label: "뷰어 프로토콜", render: (d) => (d.viewerProtocol === "redirect-to-https" ? "HTTP→HTTPS 리디렉션" : "HTTP/HTTPS 모두") },
            { label: "WAF", render: (d) => (d.wafEnabled ? tag("사용", "green") : tag("없음", "gray")) },
            { label: "상태", render: (d) => `${badge(d.status)} ${d.enabled ? "" : tag("비활성", "gray")}` },
          ],
          o.cloudfront.map((d) => ({ ...d, originDomain: d.originType === "s3" ? `${d.originId}.s3.amazonaws.com` : (o.lbs.find((l) => l.id === d.originId) || {}).dnsName || "(삭제된 원본)" })),
          { empty: "CloudFront 배포가 없어요.", rowHref: (d) => detailHref("edge", "cloudfront", d.id) }
        )
      ),
    form: (o) =>
      pageHead({ icon: "cloudfront", title: "CloudFront 배포 생성" }) +
      errorBox() +
      section(
        "원본 (Origin)",
        field("원본 유형", select("f-otype", [{ value: "s3", label: "S3 버킷" }, { value: "elb", label: "로드 밸런서 (ALB)" }])) +
          field("원본", `<select id="f-origin"></select>`) +
          checkbox("f-oac", "원본 액세스 제어(OAC) 사용", true, "S3 버킷을 퍼블릭으로 열지 않고 CloudFront만 읽게 해요 (권장).")
      ) +
      section(
        "캐시 · 보안",
        field("뷰어 프로토콜 정책", select("f-vp", [{ value: "redirect-to-https", label: "HTTP → HTTPS 리디렉션" }, { value: "allow-all", label: "HTTP와 HTTPS 모두" }])) +
          field("기본 TTL (초)", input("f-ttl", { type: "number", value: 86400 }), "엣지에 캐시를 보관하는 시간") +
          field("가격 등급", select("f-pc", [{ value: "PriceClass_All", label: "모든 엣지 로케이션 (최고 성능)" }, { value: "PriceClass_200", label: "북미·유럽·아시아 등" }, { value: "PriceClass_100", label: "북미·유럽만 (최저가)" }])) +
          checkbox("f-waf", "AWS WAF 보호 켜기", false, "SQL 인젝션, XSS 같은 웹 공격을 엣지에서 차단해요. Shield Standard(DDoS 보호)는 기본 포함.") +
          field("설명", input("f-comment", { placeholder: "예: 정적 웹사이트 CDN" }))
      ) +
      formActions(listHref("edge", "cloudfront"), "배포 생성"),
    bind: (o, p) => {
      if (!p.get("new")) return;
      const fill = () => {
        const t = val("f-otype");
        const opts = t === "s3" ? o.buckets.map((b) => ({ value: b.name, label: b.name })) : o.lbs.filter((l) => l.scheme === "internet-facing").map((l) => ({ value: l.id, label: l.name }));
        byId("f-origin").innerHTML = opts.map((x) => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join("") || `<option value="">(선택할 원본이 없어요)</option>`;
      };
      fill();
      byId("f-otype").addEventListener("change", fill);
    },
    submit: async () => {
      const d = await api.post("/api/cloudfront", { originType: val("f-otype"), originId: val("f-origin"), useOac: isChecked("f-oac"), viewerProtocol: val("f-vp"), defaultTtl: val("f-ttl"), priceClass: val("f-pc"), wafEnabled: isChecked("f-waf"), comment: val("f-comment") });
      toast("전 세계 엣지에 배포하는 중이에요 (InProgress).");
      location.hash = detailHref("edge", "cloudfront", d.id);
    },
    detail: (o, id) => {
      const d = o.cloudfront.find((x) => x.id === id);
      if (!d) return info("배포를 찾을 수 없어요.", "error");
      return (
        pageHead({ icon: "cloudfront", title: d.id, desc: `${esc(d.domainName)} · ${badge(d.status)} ${d.enabled ? tag("활성", "green") : tag("비활성", "gray")}`, actions: `${btn(d.enabled ? "비활성화" : "활성화", "toggle", d.id)}${btn("삭제", "del-cf", d.id, { tone: "danger" })}` }) +
        card(
          "설정",
          kv([
            ["도메인", mono(d.domainName)],
            ["원본", d.originType === "s3" ? `S3 · ${esc(d.originId)}${d.useOac ? " (OAC)" : ""}` : `ALB · ${esc((o.lbs.find((l) => l.id === d.originId) || {}).name || d.originId)}`],
            ["뷰어 프로토콜", esc(d.viewerProtocol)],
            ["기본 TTL", `${d.defaultTtl}초`],
            ["가격 등급", esc(d.priceClass)],
            ["WAF", d.wafEnabled ? "사용" : "없음"],
          ])
        ) +
        card(
          "캐시 무효화 (Invalidation)",
          table([{ label: "ID", render: (i) => mono(i.id) }, { label: "경로", render: (i) => esc(i.paths.join(", ")) }, { label: "상태", render: (i) => badge(i.status) }, { label: "요청", render: (i) => timeAgo(i.createdAt) }], d.invalidations, { empty: "무효화 기록이 없어요." }) +
            `<div class="inline-form">${field("경로", input("inv-paths", { value: "/*" }))}<button class="btn blue" data-act="inv" data-id="${d.id}">무효화 생성</button></div>`,
          { sub: "원본 파일을 바꿨는데 엣지에 옛날 캐시가 남아 있을 때, TTL을 기다리지 않고 지우는 기능이에요." }
        ) +
        info("삭제하려면 먼저 <b>비활성화</b> → 상태가 Deployed가 된 뒤 삭제할 수 있어요 (실제 CloudFront와 같은 절차).", "info")
      );
    },
    wire: {
      toggle: (id) => act(api.post(`/api/cloudfront/${id}/toggle`), "상태를 바꾸는 중이에요."),
      inv: (id) => act(api.post(`/api/cloudfront/${id}/invalidations`, { paths: val("inv-paths") }), "무효화를 요청했어요."),
      "del-cf": async (id) => {
        await api.del(`/api/cloudfront/${id}`);
        location.hash = listHref("edge", "cloudfront");
      },
    },
  },

  /* ===== Route 53 ===== */
  route53: {
    list: (o) =>
      pageHead({ icon: "route53", title: "Route 53 호스팅 영역", desc: "도메인 이름을 IP·로드 밸런서·CloudFront로 연결해 주는 DNS 서비스예요. AWS 리소스에는 별칭(Alias) 레코드를 쓰면 편해요.", actions: `<a class="btn primary" href="${newHref("edge", "route53")}">호스팅 영역 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "도메인", render: (z) => `<span class="cell-title">${svc("route53", "sm")}${esc(z.domain)}</span>` },
            { label: "유형", render: (z) => (z.type === "public" ? tag("퍼블릭", "green") : tag("프라이빗", "gray")) },
            { label: "레코드", render: (z) => `${z.records.length}개` },
            { label: "ID", render: (z) => mono(z.id) },
          ],
          o.zones,
          { empty: "호스팅 영역이 없어요.", rowHref: (z) => detailHref("edge", "route53", z.id) }
        )
      ),
    form: (o) =>
      pageHead({ icon: "route53", title: "호스팅 영역 생성" }) +
      errorBox() +
      section(
        "설정",
        field("도메인 이름", input("f-domain", { placeholder: "mycloud-lab.com" })) +
          field("유형", select("f-type", [{ value: "public", label: "퍼블릭 — 인터넷에서 조회" }, { value: "private", label: "프라이빗 — 연결한 VPC 안에서만" }])) +
          field("VPC (프라이빗일 때)", select("f-vpc", [{ value: "", label: "(선택)" }, ...vpcOptions(o)]))
      ) +
      formActions(listHref("edge", "route53"), "생성"),
    submit: async () => {
      const z = await api.post("/api/hosted-zones", { domain: val("f-domain"), type: val("f-type"), vpcId: val("f-vpc") });
      location.hash = detailHref("edge", "route53", z.id);
    },
    detail: (o, id) => {
      const z = o.zones.find((x) => x.id === id);
      if (!z) return info("호스팅 영역을 찾을 수 없어요.", "error");
      return (
        pageHead({ icon: "route53", title: z.domain, desc: `${z.type === "public" ? "퍼블릭" : "프라이빗"} 호스팅 영역 · ${mono(z.id)}`, actions: btn("영역 삭제", "del-zone", z.id, { tone: "danger" }) }) +
        card(
          "레코드",
          table(
            [
              { label: "이름", render: (r) => esc(r.name) },
              { label: "유형", render: (r) => `${esc(r.type)}${r.alias ? tag("별칭", "blue") : ""}` },
              { label: "라우팅", render: (r) => esc(r.routingPolicy ? { simple: "단순", weighted: `가중치 ${r.weight}`, failover: `장애 조치 ${r.failoverRole}`, latency: "지연 시간" }[r.routingPolicy] : "-") },
              { label: "값 / 대상", render: (r) => `<span class="small" style="word-break:break-all">${esc(r.alias ? r.alias.dnsName : r.values.join(", "))}</span>` },
              { label: "TTL", render: (r) => (r.alias ? "-" : r.ttl) },
              { label: "", render: (r) => (r.system ? `<span class="muted small">기본</span>` : btn("삭제", "del-rec", r.id, { tone: "danger" })) },
            ],
            z.records
          )
        ) +
        card(
          "레코드 생성",
          `<div class="inline-form">
            ${field("레코드 이름", input("rr-name", { placeholder: "www (비우면 루트)" }))}
            ${field("방식", select("rr-kind", [{ value: "alias", label: "별칭 (AWS 리소스)" }, { value: "A", label: "A (IPv4)" }, { value: "CNAME", label: "CNAME" }, { value: "TXT", label: "TXT" }]))}
            ${field("별칭 대상 / 값", `<select id="rr-target">${[
              ...o.cloudfront.map((d) => `<option value="cloudfront|${d.id}">CloudFront · ${esc(d.domainName)}</option>`),
              ...o.lbs.map((l) => `<option value="elb|${l.id}">로드 밸런서 · ${esc(l.name)}</option>`),
              ...o.buckets.filter((b) => b.website).map((b) => `<option value="s3website|${esc(b.name)}">S3 웹사이트 · ${esc(b.name)}</option>`),
            ].join("")}</select>${input("rr-value", { placeholder: "A: 1.2.3.4 / CNAME: x.example.com", attrs: 'style="margin-top:6px"' })}`)}
            ${field("라우팅 정책", select("rr-policy", [{ value: "simple", label: "단순" }, { value: "weighted", label: "가중치 기반" }, { value: "failover", label: "장애 조치" }, { value: "latency", label: "지연 시간 기반" }]))}
            ${field("가중치 / 역할", input("rr-extra", { placeholder: "가중치 50 또는 PRIMARY" }))}
            <button class="btn blue" data-act="add-rec" data-id="${z.id}">레코드 추가</button>
          </div>
          <p class="muted small">루트 도메인(zone apex)에는 CNAME을 못 써요. ALB·CloudFront는 별칭 A 레코드로 연결하세요 (조회 요금도 무료).</p>`
        ) +
        card("DNS 조회 테스트", `<div class="inline-form">${field("조회할 이름", input("dig-name", { value: `www.${z.domain}` }))}<button class="btn blue" data-act="dig" data-id="x">조회 (dig)</button></div><pre class="code-block" id="dig-out" hidden></pre>`)
      );
    },
    wire: {
      "add-rec": (id) => {
        const kind = val("rr-kind");
        const [tt, tid] = val("rr-target").split("|");
        const extra = val("rr-extra");
        return act(
          api.post(`/api/hosted-zones/${id}/records`, {
            name: val("rr-name"),
            type: kind === "alias" ? "A" : kind,
            alias: kind === "alias" ? { targetType: tt, targetId: tid } : null,
            value: val("rr-value"),
            routingPolicy: val("rr-policy"),
            weight: Number(extra) || undefined,
            failoverRole: /SECONDARY/i.test(extra) ? "SECONDARY" : "PRIMARY",
          }),
          "레코드를 추가했어요."
        );
      },
      "del-rec": (rid) => act(api.del(`/api/hosted-zones/${App.parse().params.get("id")}/records/${rid}`), "레코드를 삭제했어요."),
      "del-zone": async (id) => {
        await api.del(`/api/hosted-zones/${id}`);
        location.hash = listHref("edge", "route53");
      },
      dig: async () => {
        const out = byId("dig-out");
        out.hidden = false;
        try {
          const r = await api.get(`/api/dns-lookup?name=${encodeURIComponent(val("dig-name"))}`);
          out.textContent = `;; QUESTION\n${val("dig-name")}.  IN  A\n\n;; ANSWER (${r.zone})\n${r.answers.map((a) => `${val("dig-name")}.  ${a.alias ? "ALIAS →" : a.type}  ${a.answer}  [${a.routingPolicy || "simple"}]`).join("\n")}\n\n;; 최종 응답 IP 예시: ${r.resolvedIp}`;
        } catch (e) {
          out.textContent = e.message;
        }
      },
    },
  },
};

App.route("/elb", (p) => renderSection(TrafficPages, "elb", "lbs", p), sectionMeta("elb", "lbs"));
App.route("/edge", (p) => renderSection(EdgePages, "edge", "cloudfront", p), sectionMeta("edge", "cloudfront"));
