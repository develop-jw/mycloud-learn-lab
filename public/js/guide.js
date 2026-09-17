/* ---- 실습 가이드 · 학습 진행률 · 통합 검색 ---- */

// 강의(AWS Cloud Essentials · 워크숍) 흐름을 따라가는 실습 모듈
// 각 항목은 지금 만들어진 리소스를 보고 자동으로 완료 여부를 판단해요.
function guideModules(o) {
  const live = (list) => list.filter((x) => !["terminated", "deleted", "deleting"].includes(x.state));
  const instances = live(o.instances);
  const running = instances.filter((i) => i.state === "running");
  const hasRecord = o.zones.some((z) => z.records.some((r) => !r.system));
  return [
    {
      key: "network", title: "네트워크 기초", icon: "vpc", href: "#/vpc",
      desc: "리전 안에 나만의 가상 네트워크를 만들고, 인터넷으로 나가는 길과 막힌 길을 나눠요.",
      checks: [
        ["VPC 만들기 (예: 10.0.0.0/16)", o.vpcs.length > 0, newHref("vpc", "vpcs")],
        ["서로 다른 가용 영역에 서브넷 2개 이상", new Set(o.subnets.map((s) => s.availabilityZone)).size >= 2, newHref("vpc", "subnets")],
        ["인터넷 게이트웨이를 VPC에 연결", o.igws.some((g) => g.state === "attached"), listHref("vpc", "igw")],
        ["라우팅 테이블로 퍼블릭 서브넷 만들기 (0.0.0.0/0 → IGW)", o.subnets.some((s) => s.egress === "igw"), listHref("vpc", "routetables")],
        ["NAT 게이트웨이로 프라이빗 서브넷의 외부 통신 열기", o.subnets.some((s) => s.egress === "nat"), listHref("vpc", "nat")],
        ["온프레미스 연결: Site-to-Site VPN 또는 Direct Connect", o.vpns.length + o.dxs.length > 0, listHref("vpc", "hybrid")],
      ],
    },
    {
      key: "security", title: "보안 그룹 · IAM", icon: "shield", href: "#/iam",
      desc: "누가(IAM) 어디서(보안 그룹 · NACL) 들어올 수 있는지 최소 권한으로 정해요.",
      checks: [
        ["보안 그룹에 인바운드 규칙 추가 (HTTP 80)", o.sgs.some((s) => s.inboundRules.some((r) => String(r.port) === "80")), listHref("vpc", "sg")],
        ["보안 그룹 체이닝 (소스에 다른 보안 그룹 지정)", o.sgs.some((s) => s.inboundRules.some((r) => String(r.source).startsWith("sg-"))), listHref("vpc", "sg")],
        ["IAM 사용자 만들고 MFA 켜기", o.iam.users.some((u) => u.mfaEnabled), listHref("iam", "users")],
        ["EC2용 IAM 역할 만들기 (액세스 키 대신)", o.iam.roles.some((r) => r.trustedService === "ec2"), listHref("iam", "roles")],
        ["고객 관리형 정책 작성 (JSON)", o.iam.policies.length > 0, newHref("iam", "policies")],
      ],
    },
    {
      key: "compute", title: "EC2 · Auto Scaling", icon: "ec2", href: "#/ec2",
      desc: "가상 서버를 띄우고, 템플릿과 Auto Scaling으로 부하에 맞춰 늘고 줄게 만들어요.",
      checks: [
        ["EC2 인스턴스 시작하기", running.length > 0, "#/ec2/launch"],
        ["탄력적 IP를 인스턴스에 연결", o.eips.some((e) => e.instanceId), listHref("vpc", "eip")],
        ["EBS 스냅샷 만들기 (백업)", o.volumes.some((v) => v.snapshots && v.snapshots.length), listHref("ec2", "volumes")],
        ["시작 템플릿 만들기", o.launchTemplates.length > 0, newHref("ec2", "templates")],
        ["Auto Scaling 그룹 만들기 (여러 AZ)", o.asgs.length > 0, newHref("ec2", "asg")],
      ],
    },
    {
      key: "storage", title: "S3 · EFS 스토리지", icon: "s3", href: "#/storage",
      desc: "객체 스토리지(S3)와 공유 파일 시스템(EFS)의 차이를 직접 써 보며 익혀요.",
      checks: [
        ["S3 버킷 만들기", o.buckets.length > 0, newHref("storage", "s3")],
        ["파일(객체) 업로드", o.buckets.some((b) => b.objectCount > 0), listHref("storage", "s3")],
        ["정적 웹 사이트 호스팅 + 버킷 정책", o.buckets.some((b) => b.website && b.policy), listHref("storage", "s3")],
        ["버전 관리 또는 수명 주기 규칙 설정", o.buckets.some((b) => b.versioning === "Enabled" || (b.lifecycleRules || []).length), listHref("storage", "s3")],
        ["EFS 만들고 마운트 대상 연결", o.efs.some((f) => (f.mountTargets || []).length), listHref("storage", "efs")],
      ],
    },
    {
      key: "traffic", title: "트래픽 경로", icon: "elb", href: "#/elb",
      desc: "사용자 → Route 53 → CloudFront → 로드 밸런서 → 대상 그룹 순서로 요청이 흐르게 연결해요.",
      checks: [
        ["대상 그룹 만들고 대상 등록", o.tgs.some((t) => t.targets.length), newHref("elb", "tgs")],
        ["로드 밸런서에 정상(healthy) 대상 확보", o.lbs.some((l) => l.healthy > 0), newHref("elb", "lbs")],
        ["CloudFront 배포로 캐시 · HTTPS 적용", o.cloudfront.length > 0, newHref("edge", "cloudfront")],
        ["Route 53 호스팅 영역에 레코드 추가", hasRecord, listHref("edge", "route53")],
      ],
    },
    {
      key: "containers", title: "EKS 컨테이너", icon: "eks", href: "#/eks",
      desc: "이미지를 ECR에 올리고, EKS 클러스터에 디플로이먼트 · 서비스 · 인그레스로 배포해요.",
      checks: [
        ["EKS 클러스터 만들기", o.clusters.some((c) => c.status === "ACTIVE"), newHref("eks", "clusters")],
        ["관리형 노드 그룹 추가", o.nodeGroups.some((n) => n.status === "ACTIVE"), newHref("eks", "nodegroups")],
        ["ECR에 이미지 푸시", o.ecr.some((r) => r.images.length), listHref("eks", "ecr")],
        ["디플로이먼트 배포 → 파드 실행", o.pods.some((p) => p.state === "Running"), newHref("workloads", "deployments")],
        ["서비스 · 인그레스로 외부 노출", o.services.length > 0 && o.ingresses.length > 0, listHref("workloads", "services")],
      ],
    },
    {
      key: "data", title: "데이터베이스", icon: "rds", href: "#/db",
      desc: "관리형 DB(RDS)를 프라이빗 서브넷에 두고, 가용성과 캐시로 성능을 챙겨요.",
      checks: [
        ["RDS 데이터베이스 만들기", o.dbs.length > 0, newHref("db", "rds")],
        ["Multi-AZ로 대기 DB 두기", o.dbs.some((d) => d.multiAz), listHref("db", "rds")],
        ["ElastiCache로 캐시 계층 추가", o.caches.length > 0, newHref("db", "cache")],
      ],
    },
    {
      key: "ops", title: "운영 · 비용", icon: "cloudwatch", href: "#/monitoring",
      desc: "지표 · 경보로 이상을 먼저 알아채고, 예산으로 비용이 새지 않게 막아요.",
      checks: [
        ["CloudWatch 경보 만들기", o.alarms.length > 0, newHref("monitoring", "alarms")],
        ["경보가 실제로 울리는 것 확인", o.alarms.some((a) => (a.history || []).some((h) => h.to === "ALARM")), listHref("monitoring", "alarms")],
        ["월 예산 설정 (AWS Budgets)", !!o.budget, "#/cost"],
      ],
    },
  ].map((m) => ({ ...m, checks: m.checks.map(([label, done, href]) => ({ label, done: !!done, href })) }));
}

function computeProgress(o) {
  const mods = guideModules(o);
  const total = mods.reduce((s, m) => s + m.checks.length, 0);
  const done = mods.reduce((s, m) => s + m.checks.filter((c) => c.done).length, 0);
  return {
    pct: total ? Math.round((done / total) * 100) : 0,
    done,
    total,
    modules: mods.map((m) => ({ key: m.key, title: m.title, done: m.checks.filter((c) => c.done).length, total: m.checks.length })),
  };
}

// 강의 자료의 핵심 개념 요약
const CONCEPTS = [
  {
    icon: "home", title: "클라우드 서비스 모델",
    items: [
      ["IaaS", "서버 · 네트워크 · 스토리지를 빌려 씀 (EC2, VPC, EBS)"],
      ["PaaS", "플랫폼까지 맡김 — 코드와 데이터만 관리 (RDS, EKS 컨트롤 플레인)"],
      ["SaaS", "완성된 소프트웨어를 그대로 사용"],
      ["장점", "초기 투자 대신 사용한 만큼 지불, 몇 분 만에 전 세계 배포"],
    ],
  },
  {
    icon: "route53", title: "글로벌 인프라",
    items: [
      ["리전", "지리적으로 떨어진 데이터센터 묶음 (예: 서울 ap-northeast-2)"],
      ["가용 영역(AZ)", "리전 안의 독립된 데이터센터 그룹 — 여러 AZ에 나눠 배치해 장애에 대비"],
      ["엣지 로케이션", "CloudFront · Route 53이 사용자 가까이에서 응답"],
      ["리전 선택 기준", "규정 준수 · 지연 시간 · 제공 서비스 · 요금"],
    ],
  },
  {
    icon: "shield", title: "공동 책임 모델",
    items: [
      ["AWS 책임", "클라우드 <i>자체</i>의 보안 — 데이터센터, 하드웨어, 가상화 계층"],
      ["고객 책임", "클라우드 <i>안</i>의 보안 — OS 패치, 보안 그룹, IAM, 데이터 암호화"],
      ["관리형일수록", "고객 책임이 줄어듦 (EC2 → RDS → S3)"],
    ],
  },
  {
    icon: "guide", title: "Well-Architected 6가지 원칙",
    items: [
      ["운영 우수성", "코드형 운영, 작고 잦은 변경, 실패에서 배우기"],
      ["보안", "최소 권한, 모든 계층 보안, 추적 가능성"],
      ["안정성", "여러 AZ, 자동 복구, 수평 확장"],
      ["성능 효율성", "알맞은 리소스 유형 · 서버리스 · 캐시"],
      ["비용 최적화", "사용량 기반 지불, 불필요 리소스 정리"],
      ["지속 가능성", "사용률을 높여 낭비 줄이기"],
    ],
  },
  {
    icon: "cube", title: "코드형 인프라 (IaC)",
    items: [
      ["CloudFormation", "YAML/JSON 템플릿으로 스택 단위 생성 · 변경 · 삭제"],
      ["CDK", "TypeScript · Python 코드로 작성 → CloudFormation으로 변환"],
      ["Terraform", "여러 클라우드를 같은 문법으로 관리하는 오픈소스 도구"],
      ["왜?", "콘솔 클릭은 재현이 어려움 — 같은 환경을 반복해서 똑같이 만들기"],
    ],
  },
  {
    icon: "eks", title: "컨테이너와 쿠버네티스",
    items: [
      ["컨테이너", "앱 + 실행 환경을 이미지로 묶어 어디서나 똑같이 실행"],
      ["EKS", "쿠버네티스 컨트롤 플레인을 AWS가 운영 (시간당 요금)"],
      ["노드 그룹", "파드가 실제로 도는 EC2 — 인스턴스 유형별 최대 파드 수 제한"],
      ["서비스 · 인그레스", "파드 묶음에 고정 주소 부여 → ALB로 외부 노출"],
    ],
  },
];

async function renderGuide(p) {
  const o = await load.overview();
  const mods = guideModules(o);
  const prog = computeProgress(o);
  const currentIdx = mods.findIndex((m) => m.checks.some((c) => !c.done));
  const focus = p.get("focus");

  byId("content").innerHTML =
    pageHead({ icon: "guide", title: "실습 가이드", desc: `강의 흐름대로 직접 만들어 보며 익혀요. 리소스를 만들면 체크가 <b>자동으로</b> 채워져요. 지금 ${prog.done}/${prog.total}개 완료 (${prog.pct}%).`, actions: `<a class="btn" href="#/">개요로</a>` }) +
    `<div class="path">${mods
      .map((m, i) => {
        const done = m.checks.every((c) => c.done);
        const cls = done ? "done" : i === currentIdx ? "current" : "";
        const nextCheck = m.checks.find((c) => !c.done);
        return `<section class="card step-card ${cls}" id="mod-${m.key}">
          <div class="step-num">${done ? glyph("check") : i + 1}</div>
          ${svc(m.icon, "lg")}
          <div>
            <h3>${esc(m.title)} <span class="count-pill">${m.checks.filter((c) => c.done).length}/${m.checks.length}</span></h3>
            <p>${esc(m.desc)}</p>
            <ul class="checks">${m.checks
              .map((c) => `<li><span class="mcheck ${c.done ? "done" : ""}">${c.done ? glyph("check") : ""}</span><a href="${c.href}">${esc(c.label)}</a></li>`)
              .join("")}</ul>
          </div>
          ${done ? tag("완료", "green") : `<a class="btn ${i === currentIdx ? "primary" : ""}" href="${nextCheck.href}">${i === currentIdx ? "이어서 하기" : "바로 가기"}</a>`}
        </section>`;
      })
      .join("")}</div>` +
    `<h2 class="section-title">핵심 개념 정리</h2>` +
    `<div class="concepts">${CONCEPTS.map(
      (c) => `<section class="card concept"><h3>${svc(c.icon, "sm")}${esc(c.title)}</h3><ul>${c.items.map(([k, v]) => `<li><b>${esc(k)}</b> — ${v}</li>`).join("")}</ul></section>`
    ).join("")}</div>`;

  if (focus && byId(`mod-${focus}`)) {
    const el = byId(`mod-${focus}`);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("focus-flash");
  }
}

App.route("/guide", renderGuide, { section: "guide", crumbs: () => ["실습 가이드"] });

/* ==================================================================
   통합 검색 (상단 검색창)
   ================================================================== */
async function renderSearch(p) {
  const q = (p.get("q") || "").trim().toLowerCase();
  const o = await load.overview();
  const box = byId("search-input");
  if (box && document.activeElement !== box) box.value = p.get("q") || "";

  const all = [
    ...o.vpcs.map((x) => ["VPC", "vpc", x.name, `${x.id} · ${x.cidrBlock}`, listHref("vpc", "vpcs")]),
    ...o.subnets.map((x) => ["서브넷", "subnet", x.name, `${x.id} · ${x.cidrBlock} · ${x.availabilityZone}`, listHref("vpc", "subnets")]),
    ...o.sgs.map((x) => ["보안 그룹", "sg", x.name, x.id, detailHref("vpc", "sg", x.id)]),
    ...o.nats.map((x) => ["NAT 게이트웨이", "nat", x.name, x.id, listHref("vpc", "nat")]),
    ...o.instances.filter((x) => x.state !== "terminated").map((x) => ["EC2 인스턴스", "ec2", x.name, `${x.id} · ${x.instanceType} · ${x.privateIp}${x.publicIp ? ` · ${x.publicIp}` : ""}`, detailHref("ec2", "instances", x.id)]),
    ...o.volumes.map((x) => ["EBS 볼륨", "volume", x.name, x.id, listHref("ec2", "volumes")]),
    ...o.launchTemplates.map((x) => ["시작 템플릿", "lt", x.name, x.id, listHref("ec2", "templates")]),
    ...o.asgs.map((x) => ["Auto Scaling 그룹", "asg", x.name, `원하는 용량 ${x.desired}`, detailHref("ec2", "asg", x.id)]),
    ...o.lbs.map((x) => ["로드 밸런서", "elb", x.name, x.dnsName || x.id, detailHref("elb", "lbs", x.id)]),
    ...o.tgs.map((x) => ["대상 그룹", "tg", x.name, x.id, detailHref("elb", "tgs", x.id)]),
    ...o.cloudfront.map((x) => ["CloudFront", "cloudfront", x.domainName || x.id, x.comment || x.id, detailHref("edge", "cloudfront", x.id)]),
    ...o.zones.map((x) => ["호스팅 영역", "route53", x.domain, x.id, detailHref("edge", "route53", x.id)]),
    ...o.clusters.map((x) => ["EKS 클러스터", "eks", x.name, `v${x.version}`, detailHref("eks", "clusters", x.id)]),
    ...o.nodeGroups.map((x) => ["노드 그룹", "ec2", x.name, x.instanceType || "", listHref("eks", "nodegroups")]),
    ...o.ecr.map((x) => ["ECR 리포지토리", "ecr", x.name, x.uri || "", listHref("eks", "ecr")]),
    ...o.deployments.map((x) => ["디플로이먼트", "pod", x.name, x.image || "", detailHref("workloads", "deployments", x.id)]),
    ...o.services.map((x) => ["서비스", "ksvc", x.name, x.type || "", listHref("workloads", "services")]),
    ...o.buckets.map((x) => ["S3 버킷", "s3", x.name, `객체 ${x.objectCount}개`, detailHref("storage", "s3", x.name)]),
    ...o.efs.map((x) => ["EFS", "efs", x.name, x.id, listHref("storage", "efs")]),
    ...o.dbs.map((x) => ["RDS", "rds", x.identifier, `${x.engine} · ${x.instanceClass}`, listHref("db", "rds")]),
    ...o.caches.map((x) => ["ElastiCache", "cache", x.name || x.id, x.engine || "", listHref("db", "cache")]),
    ...o.iam.users.map((x) => ["IAM 사용자", "iam", x.name, x.arn, detailHref("iam", "users", x.id)]),
    ...o.iam.roles.map((x) => ["IAM 역할", "iam", x.name, x.trustedService, detailHref("iam", "roles", x.id)]),
    ...o.alarms.map((x) => ["경보", "alarm", x.name, x.state, detailHref("monitoring", "alarms", x.id)]),
  ].map(([kind, icon, name, sub, href]) => ({ kind, icon, name: String(name || ""), sub: String(sub || ""), href }));

  const pages = NAV.flatMap((n) => [[n.label, n.glyph, n.href], ...(n.sub || []).map(([k, label]) => [`${n.label} › ${label}`, n.glyph, `#${subHref(n.key, k)}`])]).concat([["실습 가이드", "guide", "#/guide"]]);

  const hits = q ? all.filter((r) => `${r.kind} ${r.name} ${r.sub}`.toLowerCase().includes(q)) : [];
  const pageHits = q ? pages.filter(([label]) => label.toLowerCase().includes(q)) : [];

  byId("content").innerHTML =
    pageHead({ icon: "search", title: q ? `"${esc(p.get("q"))}" 검색 결과` : "검색", desc: q ? `리소스 ${hits.length}개 · 메뉴 ${pageHits.length}개` : "리소스 이름 · ID · IP · CIDR이나 메뉴 이름으로 찾아보세요." }) +
    (pageHits.length
      ? card("메뉴", `<div class="search-groups">${pageHits.map(([label, icon, href]) => `<a class="search-result" href="${href}">${svc(icon, "sm")}<span><b>${esc(label)}</b></span></a>`).join("")}</div>`)
      : "") +
    (q
      ? card(
          "리소스",
          hits.length
            ? `<div class="search-groups">${hits.map((r) => `<a class="search-result" href="${r.href}">${svc(r.icon, "sm")}<span><b>${esc(r.name)}</b><small>${esc(r.kind)} · ${esc(r.sub)}</small></span></a>`).join("")}</div>`
            : `<p class="muted">일치하는 리소스가 없어요.</p>`
        )
      : "");
}

App.route("/search", renderSearch, { section: "search", crumbs: () => ["검색"] });
