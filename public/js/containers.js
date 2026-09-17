/* ---- 컨테이너 화면: EKS 클러스터 · 노드 그룹 · ECR · 워크로드(디플로이먼트/파드/서비스/인그레스) ---- */

const ADDON_INFO = {
  "vpc-cni": "파드마다 VPC IP를 붙여 주는 네트워크 플러그인",
  "kube-proxy": "서비스 IP로 온 트래픽을 파드로 전달",
  coredns: "클러스터 내부 DNS (서비스 이름 → IP)",
  "aws-load-balancer-controller": "Ingress → ALB, Service → NLB를 만들어 주는 컨트롤러",
  "aws-ebs-csi-driver": "PVC로 EBS 볼륨을 붙여 주는 스토리지 드라이버",
  "aws-efs-csi-driver": "여러 파드가 공유하는 EFS 볼륨 드라이버",
  "metrics-server": "kubectl top, HPA가 쓰는 CPU/메모리 지표",
  "amazon-cloudwatch-observability": "Container Insights로 로그·지표를 CloudWatch에 전송",
  "eks-pod-identity-agent": "파드에 IAM 역할을 부여 (Pod Identity)",
};

const ECR_PREFIX = "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/";

function activeClusters(o) {
  return o.clusters.filter((c) => c.status === "ACTIVE");
}
function needCluster(o) {
  return activeClusters(o).length ? "" : info(`ACTIVE 상태인 EKS 클러스터가 필요해요. <a href="${newHref("eks", "clusters")}">클러스터 만들기</a>`, "warn");
}
function clusterName(o, id) {
  return (o.clusters.find((c) => c.id === id) || {}).name || "-";
}
function usageBar(used, total, label) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return `<div class="row"><span>${label}</span><span>${used} / ${total} (${pct}%)</span></div><div class="bar ${pct > 90 ? "bad" : pct > 70 ? "warn" : ""}"><i style="width:${pct}%"></i></div>`;
}

const EksPages = {
  /* ===== 클러스터 ===== */
  clusters: {
    list: (o) =>
      pageHead({ icon: "eks", title: "EKS 클러스터", desc: "AWS가 쿠버네티스 컨트롤 플레인(API 서버·etcd)을 대신 운영해 주는 서비스예요. 우리는 워커 노드(노드 그룹)와 워크로드만 신경 쓰면 돼요.", actions: `<a class="btn primary" href="${newHref("eks", "clusters")}">클러스터 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (c) => `<span class="cell-title">${svc("eks", "sm")}${esc(c.name)}</span>` },
            { label: "버전", render: (c) => `v${esc(c.version)}` },
            { label: "상태", render: (c) => badge(c.status) },
            { label: "노드 · 파드", render: (c) => `${c.nodeCount ?? o.instances.filter((i) => i.managedBy && i.managedBy.clusterId === c.id && i.state === "running").length}대 · ${o.pods.filter((p) => p.clusterId === c.id && p.state === "Running").length}개` },
            { label: "VPC", render: (c) => esc(vpcName(o, c.vpcId)) },
            { label: "추가 기능", render: (c) => `${c.addons.length}개` },
          ],
          o.clusters,
          { empty: "클러스터가 없어요. 서로 다른 AZ의 서브넷 2개 이상이 필요해요.", rowHref: (c) => detailHref("eks", "clusters", c.id) }
        )
      ),
    form: (o) =>
      pageHead({ icon: "eks", title: "EKS 클러스터 생성", desc: "실제로는 10분 넘게 걸리지만 여기선 몇 초면 ACTIVE가 돼요." }) +
      errorBox() +
      section(
        "1. 클러스터 구성",
        field("이름", input("f-name", { placeholder: "demo-cluster" })) +
          field("쿠버네티스 버전", select("f-ver", ["1.33", "1.32", "1.31"])) +
          field("클러스터 IAM 역할", select("f-role", [{ value: "", label: "(아래에서 자동 생성)" }, ...o.iam.roles.filter((r) => r.trustedService === "eks").map((r) => ({ value: r.name, label: r.name }))])) +
          checkbox("f-autorole", "클러스터 역할 자동 생성 (eksClusterRole + AmazonEKSClusterPolicy)", true, "EKS가 내 계정의 ENI·로드 밸런서를 관리하려면 이 권한이 필요해요.")
      ) +
      section(
        "2. 네트워킹 — 서로 다른 AZ의 서브넷 2개 이상",
        `<div class="full">${checkList("eks-subnets", o.subnets.map((s) => ({ value: s.id, label: esc(subnetLabel(s)) })))}</div>` +
          field("API 엔드포인트 접근", select("f-access", [{ value: "public-and-private", label: "퍼블릭 및 프라이빗 (기본)" }, { value: "public", label: "퍼블릭" }, { value: "private", label: "프라이빗 (VPC 안에서만 kubectl)" }])),
        "인그레스·로드밸런서 서비스를 쓰려면 퍼블릭 서브넷도 포함하고, 노드는 프라이빗 서브넷에 두는 게 일반적이에요."
      ) +
      section("3. 기본 추가 기능", `<div class="full">${["vpc-cni", "kube-proxy", "coredns"].map((a) => `<div class="cell-title" style="margin-bottom:6px">${svc("eks", "xs")}${a}<span class="muted small">${ADDON_INFO[a]}</span></div>`).join("")}</div>`) +
      formActions(listHref("eks", "clusters"), "클러스터 생성"),
    submit: async () => {
      const c = await api.post("/api/eks-clusters", { name: val("f-name"), version: val("f-ver"), roleName: val("f-role"), autoCreateRole: isChecked("f-autorole"), subnetIds: checkedValues("eks-subnets"), endpointAccess: val("f-access") });
      toast("클러스터를 만드는 중이에요 (CREATING).");
      location.hash = detailHref("eks", "clusters", c.id);
    },
    detail: (o, id) => {
      const c = o.clusters.find((x) => x.id === id);
      if (!c) return info("클러스터를 찾을 수 없어요.", "error");
      const ngs = o.nodeGroups.filter((n) => n.clusterId === id);
      const installed = c.addons.map((a) => a.name);
      const optional = Object.keys(ADDON_INFO).filter((a) => !installed.includes(a));
      return (
        pageHead({ icon: "eks", title: c.name, desc: `Kubernetes v${esc(c.version)} · ${badge(c.status)}`, actions: `${btn("버전 업그레이드", "upgrade", c.id, { disabled: c.status !== "ACTIVE" || c.version === "1.33" })}${btn("삭제", "del-cluster", c.id, { tone: "danger" })}` }) +
        card(
          "개요",
          kv([
            ["API 서버 엔드포인트", `<span class="small">${esc(c.endpoint)}</span>`],
            ["엔드포인트 접근", esc(c.endpointAccess)],
            ["OIDC 발급자 (IRSA)", `<span class="small">${esc(c.oidcIssuer)}</span>`],
            ["클러스터 IAM 역할", esc(c.roleName)],
            ["VPC", esc(vpcName(o, c.vpcId))],
            ["서브넷", c.subnetIds.map((s) => { const x = o.subnets.find((y) => y.id === s); return x ? `${esc(x.name)} ${subnetTag(x)}` : s; }).join("<br/>")],
          ])
        ) +
        card(
          "kubectl 연결",
          `<pre class="code-block">aws eks update-kubeconfig --region ap-northeast-2 --name ${esc(c.name)}
kubectl get nodes
kubectl get pods -A</pre>`,
          { sub: "실제 환경이라면 이 명령으로 내 PC의 kubectl이 이 클러스터를 바라보게 돼요." }
        ) +
        card(
          "노드 그룹",
          table(
            [
              { label: "이름", render: (n) => `<a href="${detailHref("eks", "nodegroups", n.id)}">${esc(n.name)}</a>` },
              { label: "유형", render: (n) => `${esc(n.instanceType)} · ${n.capacityType === "SPOT" ? "스팟" : "온디맨드"}` },
              { label: "크기", render: (n) => `${n.min} / ${n.desired} / ${n.max}` },
              { label: "상태", render: (n) => badge(n.status) },
            ],
            ngs,
            { empty: "노드 그룹이 없어요. 파드를 실행할 워커 노드가 필요해요.", emptyAction: c.status === "ACTIVE" ? `<a class="btn primary" href="${newHref("eks", "nodegroups")}&cluster=${c.id}">노드 그룹 추가</a>` : "" }
          )
        ) +
        card(
          "추가 기능 (Add-ons)",
          table(
            [
              { label: "이름", render: (a) => `<b>${esc(a.name)}</b><span class="cell-sub">${esc(ADDON_INFO[a.name] || "")}</span>` },
              { label: "상태", render: (a) => badge(a.status) },
            ],
            c.addons
          ) +
            `<div class="inline-form">${field("추가 기능 설치", select("addon", optional.map((a) => ({ value: a, label: `${a} — ${ADDON_INFO[a]}` }))))}<button class="btn blue" data-act="addon" data-id="${c.id}" ${c.status !== "ACTIVE" ? "disabled" : ""}>설치</button></div>`,
          { sub: "인그레스로 ALB를 만들려면 aws-load-balancer-controller가 꼭 필요해요." }
        )
      );
    },
    wire: {
      addon: (id) => act(api.post(`/api/eks-clusters/${id}/addons`, { name: val("addon") }), "추가 기능을 설치하는 중이에요."),
      upgrade: async (id) => {
        if (!(await modal({ title: "컨트롤 플레인 업그레이드", body: "<p>EKS는 마이너 버전을 <b>한 단계씩만</b> 올릴 수 있어요. 컨트롤 플레인을 먼저 올린 뒤 노드 그룹과 추가 기능을 맞춰 올리는 순서예요.</p>", okLabel: "업그레이드" }))) return;
        await act(api.post(`/api/eks-clusters/${id}/upgrade`), "업그레이드를 시작했어요 (UPDATING).");
      },
      "del-cluster": async (id) => {
        if (!(await confirmBox("클러스터 삭제", "<p>노드 그룹이 남아 있으면 삭제할 수 없어요. 클러스터 안의 워크로드와 컨트롤러가 만든 로드 밸런서도 함께 정리돼요.</p>"))) return;
        await api.del(`/api/eks-clusters/${id}`);
        location.hash = listHref("eks", "clusters");
      },
    },
  },

  /* ===== 노드 그룹 ===== */
  nodegroups: {
    list: () => `${pageHead({ icon: "ec2", title: "관리형 노드 그룹", desc: "파드가 실제로 도는 EC2 워커 노드 묶음이에요. 내부적으로는 Auto Scaling 그룹이라 노드가 죽으면 새로 채워져요.", actions: `<a class="btn primary" href="${newHref("eks", "nodegroups")}">노드 그룹 추가</a>` })}<div id="ng-slot"></div>`,
    after: async (o, p) => {
      if (p.get("new")) return;
      const ngs = await api.get("/api/node-groups");
      const id = p.get("id");
      if (id) {
        const n = ngs.find((x) => x.id === id);
        if (!n) return (byId("content").innerHTML = info("노드 그룹을 찾을 수 없어요.", "error"));
        byId("content").innerHTML =
          pageHead({ icon: "ec2", title: n.name, desc: `클러스터 ${esc(clusterName(o, n.clusterId))} · ${esc(n.instanceType)} · ${badge(n.status)}`, actions: btn("삭제", "del-ng", n.id, { tone: "danger" }) }) +
          card(
            "크기 조정",
            `<div class="inline-form">${field("최소", input("s-min", { type: "number", value: n.min }))}${field("원하는 크기", input("s-des", { type: "number", value: n.desired }))}${field("최대", input("s-max", { type: "number", value: n.max }))}<button class="btn blue" data-act="scale" data-id="${n.id}">적용</button></div>
            <p class="muted small">노드 IAM 역할: ${esc(n.nodeRoleName)} · 디스크 ${n.diskSize} GiB · 서브넷 ${n.subnetIds.length}개</p>`
          ) +
          card(
            "워커 노드",
            n.nodes.length
              ? `<div class="node-cards">${n.nodes
                  .map(
                    (x) => `<div class="node-card">
                <div class="row"><b>${svc("ec2", "xs")} ${esc(x.id)}</b>${badge(x.state)}</div>
                <div class="row"><span>${esc(x.az)} · ${esc(x.privateIp)}</span></div>
                ${usageBar(x.used.cpu, x.capacity.cpu, "CPU 요청 (m)")}
                ${usageBar(x.used.mem, x.capacity.mem, "메모리 요청 (Mi)")}
                ${usageBar(x.used.pods, x.capacity.pods, "파드 수 (VPC CNI 한도)")}
              </div>`
                  )
                  .join("")}</div>`
              : `<p class="muted">노드를 시작하는 중이에요...</p>`,
            { sub: "스케줄러는 파드의 requests(요청량)를 보고 남은 용량이 있는 노드에 배치해요. 노드당 최대 파드 수는 인스턴스 유형의 ENI·IP 수로 정해져요." }
          );
        App.autoRefresh(true, 3000);
        return;
      }
      byId("ng-slot").innerHTML = card(
        "",
        table(
          [
            { label: "이름", render: (n) => `<span class="cell-title">${svc("ec2", "sm")}${esc(n.name)}</span>` },
            { label: "클러스터", render: (n) => esc(clusterName(o, n.clusterId)) },
            { label: "인스턴스", render: (n) => `${esc(n.instanceType)} · ${n.capacityType === "SPOT" ? "스팟" : "온디맨드"}` },
            { label: "노드", render: (n) => `${n.nodes.filter((x) => x.state === "running").length} / ${n.desired}` },
            { label: "상태", render: (n) => badge(n.status) },
          ],
          ngs,
          { empty: "노드 그룹이 없어요.", rowHref: (n) => detailHref("eks", "nodegroups", n.id) }
        )
      );
    },
    form: (o, p) =>
      pageHead({ icon: "ec2", title: "노드 그룹 추가" }) +
      needCluster(o) +
      errorBox() +
      section(
        "1. 노드 그룹 구성",
        field("클러스터", select("f-cluster", activeClusters(o).map((c) => ({ value: c.id, label: c.name })), p.get("cluster"))) +
          field("이름", input("f-name", { value: "workers" })) +
          field("노드 IAM 역할", select("f-role", [{ value: "", label: "(아래에서 자동 생성)" }, ...o.iam.roles.filter((r) => r.trustedService === "ec2").map((r) => ({ value: r.name, label: r.name }))])) +
          checkbox("f-autorole", "노드 역할 자동 생성 (WorkerNode + ECR ReadOnly + CNI 정책)", true, "ECR에서 이미지를 받으려면 AmazonEC2ContainerRegistryReadOnly가 필요해요.")
      ) +
      section(
        "2. 컴퓨팅 구성",
        field("인스턴스 유형", select("f-type", [{ value: "t3.small", label: "t3.small · 최대 파드 11" }, { value: "t3.medium", label: "t3.medium · 최대 파드 17" }, { value: "m5.large", label: "m5.large · 최대 파드 29" }, { value: "c5.large", label: "c5.large · 최대 파드 29" }], "t3.medium")) +
          field("용량 유형", select("f-cap", [{ value: "ON_DEMAND", label: "온디맨드" }, { value: "SPOT", label: "스팟" }])) +
          field("디스크 (GiB)", input("f-disk", { type: "number", value: 20 })) +
          field("최소", input("f-min", { type: "number", value: 1 })) +
          field("원하는 크기", input("f-des", { type: "number", value: 2 })) +
          field("최대", input("f-max", { type: "number", value: 3 }))
      ) +
      section("3. 서브넷 (클러스터 서브넷 중에서)", `<div class="full" id="ng-subnets"></div>`, "노드는 보안상 프라이빗 서브넷에 두고, NAT 게이트웨이로 이미지를 받게 하는 구성이 일반적이에요.") +
      formActions(listHref("eks", "nodegroups"), "노드 그룹 생성"),
    bind: (o, p) => {
      if (!p.get("new") || !byId("f-cluster")) return;
      const fill = () => {
        const c = o.clusters.find((x) => x.id === val("f-cluster"));
        byId("ng-subnets").innerHTML = c ? checkList("ng-subnets", o.subnets.filter((s) => c.subnetIds.includes(s.id)).map((s) => ({ value: s.id, label: esc(subnetLabel(s)) })), o.subnets.filter((s) => c.subnetIds.includes(s.id) && s.egress !== "igw").map((s) => s.id)) : "";
      };
      fill();
      byId("f-cluster").addEventListener("change", fill);
    },
    submit: async () => {
      const r = await api.post("/api/node-groups", {
        clusterId: val("f-cluster"),
        name: val("f-name"),
        nodeRoleName: val("f-role"),
        autoCreateRole: isChecked("f-autorole"),
        instanceType: val("f-type"),
        capacityType: val("f-cap"),
        diskSize: val("f-disk"),
        min: val("f-min"),
        desired: val("f-des"),
        max: val("f-max"),
        subnetIds: checkedValues("ng-subnets"),
      });
      toast(r.warning || "노드 그룹을 만드는 중이에요. 곧 워커 노드가 시작돼요.", !!r.warning);
      location.hash = detailHref("eks", "nodegroups", r.id);
    },
    wire: {
      scale: (id) => act(api.post(`/api/node-groups/${id}/scale`, { min: val("s-min"), desired: val("s-des"), max: val("s-max") }), "크기를 조정하는 중이에요."),
      "del-ng": async (id) => {
        if (!(await confirmBox("노드 그룹 삭제", "<p>노드가 모두 종료되고, 그 위의 파드는 갈 곳이 없어 Pending 상태가 돼요.</p>"))) return;
        await api.del(`/api/node-groups/${id}`);
        location.hash = listHref("eks", "nodegroups");
      },
    },
  },

  /* ===== ECR ===== */
  ecr: {
    list: (o) =>
      pageHead({ icon: "ecr", title: "ECR 리포지토리", desc: "컨테이너 이미지를 저장하는 AWS의 프라이빗 레지스트리예요. docker build → docker push로 올리고, EKS 노드가 여기서 이미지를 받아요.", actions: `<button class="btn primary" data-act="new-repo">리포지토리 생성</button>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (r) => `<span class="cell-title">${svc("ecr", "sm")}${esc(r.name)}</span>` },
            { label: "URI", render: (r) => `<span class="small" style="word-break:break-all">${esc(r.uri)}</span>` },
            { label: "이미지", render: (r) => `${r.images.length}개` },
            { label: "태그 불변성", render: (r) => (r.tagImmutable ? tag("켜짐", "green") : tag("꺼짐", "gray")) },
            { label: "푸시 시 스캔", render: (r) => (r.scanOnPush ? tag("켜짐", "green") : tag("꺼짐", "gray")) },
          ],
          o.ecr,
          { empty: "리포지토리가 없어요.", rowHref: (r) => detailHref("eks", "ecr", r.id) }
        )
      ),
    detail: (o, id) => {
      const r = o.ecr.find((x) => x.id === id);
      if (!r) return info("리포지토리를 찾을 수 없어요.", "error");
      return (
        pageHead({ icon: "ecr", title: r.name, desc: mono(r.uri), actions: btn("리포지토리 삭제", "del-repo", r.id, { tone: "danger" }) }) +
        card(
          "푸시 명령 보기",
          `<pre class="code-block">aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin ${ECR_PREFIX.slice(0, -1)}
docker build -t ${esc(r.name)} .
docker tag ${esc(r.name)}:latest ${esc(r.uri)}:v1
docker push ${esc(r.uri)}:v1</pre>
          <div class="inline-form">${field("푸시할 태그", input("push-tag", { value: `v${r.images.length + 1}` }))}<button class="btn blue" data-act="push" data-id="${r.id}">이미지 푸시 (시뮬레이션)</button></div>`
        ) +
        card(
          "이미지",
          table(
            [
              { label: "태그", render: (i) => `<b>${esc(i.tag)}</b>` },
              { label: "다이제스트", render: (i) => `<span class="small">${esc(i.digest.slice(0, 19))}…</span>` },
              { label: "크기", render: (i) => `${i.sizeMb} MB` },
              { label: "취약점 스캔", render: (i) => (!i.scan ? "-" : i.scan.status !== "COMPLETE" ? badge("IN_PROGRESS", "스캔 중") : `${i.scan.critical ? tag(`Critical ${i.scan.critical}`, "red") : ""} ${tag(`High ${i.scan.high}`, i.scan.high ? "orange" : "gray")} ${tag(`Medium ${i.scan.medium}`, "gray")}`) },
              { label: "푸시", render: (i) => timeAgo(i.pushedAt) },
              { label: "", render: (i) => btn("삭제", "del-img", i.tag, { tone: "danger" }) },
            ],
            r.images,
            { empty: "이미지가 없어요. 위에서 푸시해 보세요." }
          ),
          { sub: `디플로이먼트 이미지 주소: ${esc(r.uri)}:<태그>` }
        )
      );
    },
    wire: {
      "new-repo": async () => {
        const r = await modal({
          title: "ECR 리포지토리 생성",
          fields: [
            { id: "m-name", label: "리포지토리 이름", value: "web-app" },
            { id: "m-imm", label: "태그 불변성", options: [{ value: "0", label: "끄기 (같은 태그 덮어쓰기 허용)" }, { value: "1", label: "켜기 (권장 — 태그 덮어쓰기 금지)" }], value: "1" },
            { id: "m-scan", label: "푸시 시 스캔", options: [{ value: "1", label: "켜기" }, { value: "0", label: "끄기" }], value: "1" },
          ],
          okLabel: "생성",
        });
        if (r) await act(api.post("/api/ecr-repositories", { name: r["m-name"], tagImmutable: r["m-imm"] === "1", scanOnPush: r["m-scan"] === "1" }), "리포지토리를 만들었어요.");
      },
      push: (id) => act(api.post(`/api/ecr-repositories/${id}/images`, { tag: val("push-tag") }), "이미지를 푸시했어요."),
      "del-img": (t) => act(api.del(`/api/ecr-repositories/${App.parse().params.get("id")}/images/${encodeURIComponent(t)}`), "이미지를 삭제했어요."),
      "del-repo": async (id) => {
        if (!(await confirmBox("리포지토리 삭제", "<p>이미지가 남아 있으면 강제 삭제로 함께 지워져요.</p>"))) return;
        await api.del(`/api/ecr-repositories/${id}?force=1`);
        location.hash = listHref("eks", "ecr");
      },
    },
  },
};

/* ---- 워크로드 ---- */
function podStateBadge(p) {
  return badge(p.state);
}

function deploymentYaml(d) {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${d.name}
  namespace: ${d.namespace}
spec:
  replicas: ${d.replicas}
  selector:
    matchLabels:
      app: ${d.name}
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  template:
    metadata:
      labels:
        app: ${d.name}
    spec:
      containers:
        - name: ${d.name}
          image: ${d.image}
          ports:
            - containerPort: ${d.containerPort}
          resources:
            requests:
              cpu: ${d.cpu}m
              memory: ${d.mem}Mi`;
}

const WorkloadPages = {
  deployments: {
    list: (o) =>
      pageHead({ icon: "pod", title: "디플로이먼트", desc: "'이 이미지로 파드 N개를 항상 유지해 줘'라는 선언이에요. 파드가 죽으면 새로 만들고, 이미지를 바꾸면 롤링 업데이트로 하나씩 교체해요.", actions: `<a class="btn primary" href="${newHref("workloads", "deployments")}">디플로이먼트 배포</a>` }) +
      needCluster(o) +
      card(
        "",
        table(
          [
            { label: "이름", render: (d) => `<span class="cell-title">${svc("pod", "sm")}<span>${esc(d.name)}<span class="cell-sub">${esc(d.namespace)} · ${esc(clusterName(o, d.clusterId))}</span></span></span>` },
            { label: "준비", render: (d) => { const pods = o.pods.filter((p) => p.deploymentId === d.id && p.state !== "Terminating"); const ready = pods.filter((p) => p.state === "Running").length; return `${ready}/${d.replicas} ${ready === d.replicas ? tag("정상", "green") : tag("진행 중", "orange")}`; } },
            { label: "이미지", render: (d) => `<span class="small" style="word-break:break-all">${esc(d.image.replace(ECR_PREFIX, "ecr/"))}</span>` },
            { label: "요청량", render: (d) => `${d.cpu}m · ${d.mem}Mi` },
            { label: "리비전", render: (d) => d.revision },
          ],
          o.deployments,
          { empty: "디플로이먼트가 없어요.", rowHref: (d) => detailHref("workloads", "deployments", d.id) }
        )
      ),
    form: (o) => {
      const ecrImages = o.ecr.flatMap((r) => r.images.map((i) => ({ value: `${r.uri}:${i.tag}`, label: `ECR · ${r.name}:${i.tag}` })));
      return (
        pageHead({ icon: "pod", title: "디플로이먼트 배포", desc: "kubectl apply -f deployment.yaml 을 클릭으로 하는 화면이에요." }) +
        needCluster(o) +
        errorBox() +
        section(
          "기본",
          field("클러스터", select("f-cluster", activeClusters(o).map((c) => ({ value: c.id, label: c.name })))) +
            field("네임스페이스", input("f-ns", { value: "default" })) +
            field("이름", input("f-name", { value: "web" }), "소문자·숫자·하이픈") +
            field("레플리카 수", input("f-rep", { type: "number", value: 3 }))
        ) +
        section(
          "컨테이너",
          field("이미지 고르기", select("f-imgpick", [{ value: "", label: "(직접 입력)" }, { value: "nginx:1.27", label: "Docker Hub · nginx:1.27" }, { value: "httpd:2.4", label: "Docker Hub · httpd:2.4" }, ...ecrImages])) +
            field("이미지 주소", input("f-image", { value: "nginx:1.27" }), `ECR 이미지: ${esc(ECR_PREFIX)}&lt;리포지토리&gt;:&lt;태그&gt;`) +
            field("컨테이너 포트", input("f-port", { type: "number", value: 80 })) +
            field("CPU 요청 (m)", input("f-cpu", { type: "number", value: 250 }), "1000m = vCPU 1개") +
            field("메모리 요청 (Mi)", input("f-mem", { type: "number", value: 256 }))
        ) +
        formActions(listHref("workloads", "deployments"), "배포")
      );
    },
    bind: (o, p) => {
      if (!p.get("new") || !byId("f-imgpick")) return;
      byId("f-imgpick").addEventListener("change", () => {
        if (val("f-imgpick")) byId("f-image").value = val("f-imgpick");
      });
    },
    submit: async () => {
      const d = await api.post("/api/deployments", { clusterId: val("f-cluster"), namespace: val("f-ns"), name: val("f-name"), replicas: val("f-rep"), image: val("f-image"), containerPort: val("f-port"), cpu: val("f-cpu"), memory: val("f-mem") });
      toast("디플로이먼트를 만들었어요. 스케줄러가 파드를 노드에 배치해요.");
      location.hash = detailHref("workloads", "deployments", d.id);
    },
    detail: (o, id) => {
      const d = o.deployments.find((x) => x.id === id);
      if (!d) return info("디플로이먼트를 찾을 수 없어요.", "error");
      const pods = o.pods.filter((p) => p.deploymentId === id);
      const nodeName = (nid) => (o.instances.find((i) => i.id === nid) || {}).id || "-";
      return (
        pageHead({ icon: "pod", title: d.name, desc: `${esc(d.namespace)} · 클러스터 ${esc(clusterName(o, d.clusterId))} · 리비전 ${d.revision}`, actions: btn("삭제", "del-dep", d.id, { tone: "danger" }) }) +
        `<div class="grid-2">` +
        card("스케일", `<div class="inline-form">${field("레플리카", input("sc-rep", { type: "number", value: d.replicas }))}<button class="btn blue" data-act="scale" data-id="${d.id}">적용</button></div><p class="muted small">kubectl scale deployment ${esc(d.name)} --replicas=N 과 같아요.</p>`) +
        card("이미지 변경 (롤링 업데이트)", `<div class="inline-form">${field("새 이미지", input("up-img", { value: d.image }))}<button class="btn blue" data-act="image" data-id="${d.id}">업데이트</button></div><p class="muted small">새 리비전 파드가 준비되면 옛 파드를 하나씩 내려서 중단 없이 교체해요.</p>`) +
        `</div>` +
        card(
          "파드",
          table(
            [
              { label: "이름", render: (p) => `<b>${esc(p.id)}</b><span class="cell-sub">리비전 ${p.revision}</span>` },
              { label: "상태", render: (p) => podStateBadge(p) },
              { label: "노드", render: (p) => `<span class="small">${esc(nodeName(p.nodeId))}</span>` },
              { label: "파드 IP", render: (p) => esc(p.podIp || "-") },
              { label: "이유/이벤트", render: (p) => `<span class="small">${esc(p.reason || "")}</span>` },
              { label: "", render: (p) => (p.state === "Terminating" ? "" : btn("삭제", "del-pod", p.id, { tone: "danger" })) },
            ],
            pods,
            { empty: "파드가 없어요." }
          ),
          { sub: "파드를 하나 지워 보세요. 디플로이먼트가 곧바로 새 파드를 만들어 개수를 맞춰요 (자가 치유)." }
        ) +
        card("매니페스트 (YAML)", `<pre class="code-block">${esc(deploymentYaml(d))}</pre>`)
      );
    },
    wire: {
      scale: (id) => act(api.post(`/api/deployments/${id}/scale`, { replicas: val("sc-rep") }), "레플리카 수를 바꿨어요."),
      image: (id) => act(api.post(`/api/deployments/${id}/image`, { image: val("up-img") }), "롤링 업데이트를 시작했어요."),
      "del-pod": (pid) => act(api.del(`/api/pods/${encodeURIComponent(pid)}`), "파드를 삭제했어요. 곧 새 파드가 생겨요."),
      "del-dep": async (id) => {
        await api.del(`/api/deployments/${id}`);
        location.hash = listHref("workloads", "deployments");
      },
    },
  },

  pods: {
    list: (o) =>
      pageHead({ icon: "pod", title: "파드", desc: "컨테이너가 실제로 실행되는 가장 작은 단위예요. Pending(배치 대기) → ContainerCreating(이미지 받는 중) → Running 순서로 바뀌어요." }) +
      needCluster(o) +
      card(
        "",
        table(
          [
            { label: "이름", render: (p) => `<b>${esc(p.id)}</b><span class="cell-sub">${esc(p.namespace)}</span>` },
            { label: "상태", render: (p) => podStateBadge(p) },
            { label: "재시작", render: (p) => p.restarts },
            { label: "노드", render: (p) => `<span class="small">${esc(p.nodeId || "-")}</span>` },
            { label: "IP", render: (p) => esc(p.podIp || "-") },
            { label: "이유", render: (p) => `<span class="small">${esc(p.reason || "")}</span>` },
            { label: "", render: (p) => (p.state === "Terminating" ? "" : btn("삭제", "del-pod", p.id, { tone: "danger" })) },
          ],
          o.pods,
          { empty: "파드가 없어요. 디플로이먼트를 배포하면 생겨요." }
        )
      ),
    wire: { "del-pod": (pid) => act(api.del(`/api/pods/${encodeURIComponent(pid)}`), "파드를 삭제했어요.") },
  },

  services: {
    list: (o) =>
      pageHead({ icon: "ksvc", title: "서비스", desc: "계속 바뀌는 파드 IP 대신 고정된 주소를 주는 리소스예요. ClusterIP(내부), NodePort(노드 포트), LoadBalancer(AWS NLB 자동 생성) 유형이 있어요.", actions: `<button class="btn primary" data-act="new-svc">서비스 생성</button>` }) +
      needCluster(o) +
      card(
        "",
        table(
          [
            { label: "이름", render: (s) => `<span class="cell-title">${svc("ksvc", "sm")}${esc(s.name)}</span>` },
            { label: "유형", render: (s) => tag(s.type, s.type === "LoadBalancer" ? "blue" : "gray") },
            { label: "대상", render: (s) => esc((o.deployments.find((d) => d.id === s.deploymentId) || {}).name || "-") },
            { label: "클러스터 IP", render: (s) => esc(s.clusterIp) },
            { label: "포트", render: (s) => `${s.port}→${s.targetPort}${s.nodePort ? `:${s.nodePort}` : ""}` },
            { label: "외부 주소", render: (s) => { const lb = o.lbs.find((l) => l.id === s.loadBalancerId); return lb ? `<span class="small">${esc(lb.state === "active" ? lb.dnsName : "&lt;pending&gt;")}</span>` : "-"; } },
            { label: "상태", render: (s) => `${badge(s.status)}${s.message ? `<span class="cell-sub">${esc(s.message)}</span>` : ""}` },
            { label: "", render: (s) => btn("삭제", "del-svc", s.id, { tone: "danger" }) },
          ],
          o.services,
          { empty: "서비스가 없어요." }
        )
      ),
    wire: {
      "new-svc": async () => {
        const o = await load.overview();
        if (!o.deployments.length) return toast("먼저 디플로이먼트를 배포하세요.", true);
        const r = await modal({
          title: "서비스 생성",
          fields: [
            { id: "m-dep", label: "대상 디플로이먼트 (셀렉터)", options: o.deployments.map((d) => ({ value: d.id, label: `${d.name} · ${clusterName(o, d.clusterId)}` })) },
            { id: "m-name", label: "이름", value: "web-svc" },
            { id: "m-type", label: "유형", options: [{ value: "ClusterIP", label: "ClusterIP — 클러스터 내부 전용" }, { value: "NodePort", label: "NodePort — 각 노드의 포트로 노출" }, { value: "LoadBalancer", label: "LoadBalancer — AWS NLB 자동 생성" }], value: "ClusterIP" },
            { id: "m-port", label: "서비스 포트", value: "80" },
          ],
          okLabel: "생성",
        });
        if (!r) return;
        const dep = o.deployments.find((d) => d.id === r["m-dep"]);
        await act(api.post("/api/k8s-services", { clusterId: dep.clusterId, deploymentId: dep.id, name: r["m-name"], type: r["m-type"], port: r["m-port"] }), "서비스를 만들었어요.");
      },
      "del-svc": (id) => act(api.del(`/api/k8s-services/${id}`), "서비스를 삭제했어요."),
    },
  },

  ingresses: {
    list: (o) =>
      pageHead({ icon: "ingress", title: "인그레스", desc: "HTTP 경로·호스트별로 여러 서비스에 트래픽을 나누는 L7 규칙이에요. EKS에서는 AWS Load Balancer Controller가 이 규칙을 보고 ALB를 만들어 줘요.", actions: `<button class="btn primary" data-act="new-ing">인그레스 생성</button>` }) +
      needCluster(o) +
      card(
        "",
        table(
          [
            { label: "이름", render: (i) => `<span class="cell-title">${svc("ingress", "sm")}${esc(i.name)}</span>` },
            { label: "클래스", render: (i) => esc(i.className) },
            { label: "호스트", render: (i) => esc(i.host || "*") },
            { label: "규칙", render: (i) => i.rules.map((r) => `<span class="cell-sub">${esc(r.path)} → ${esc((o.services.find((s) => s.id === r.serviceId) || {}).name || "?")}</span>`).join("") },
            { label: "ADDRESS", render: (i) => { const lb = o.lbs.find((l) => l.id === i.loadBalancerId); return lb && lb.state === "active" ? `<span class="small">${esc(lb.dnsName)}</span>` : `<span class="muted small">(비어 있음)</span>`; } },
            { label: "메시지", render: (i) => (i.message ? `<span class="small">${esc(i.message)}</span>` : tag("정상", "green")) },
            { label: "", render: (i) => btn("삭제", "del-ing", i.id, { tone: "danger" }) },
          ],
          o.ingresses,
          { empty: "인그레스가 없어요." }
        )
      ),
    wire: {
      "new-ing": async () => {
        const o = await load.overview();
        if (!o.services.length) return toast("먼저 서비스를 만드세요.", true);
        const r = await modal({
          title: "인그레스 생성",
          body: "<p>경로 2개까지 지정할 수 있어요. 두 번째 규칙은 비워 두면 생략돼요.</p>",
          fields: [
            { id: "m-name", label: "이름", value: "web-ingress" },
            { id: "m-host", label: "호스트 (선택)", value: "", placeholder: "www.mycloud-lab.com" },
            { id: "m-p1", label: "경로 1", value: "/" },
            { id: "m-s1", label: "서비스 1", options: o.services.map((s) => ({ value: s.id, label: `${s.name} · ${clusterName(o, s.clusterId)}` })) },
            { id: "m-p2", label: "경로 2 (선택)", value: "", placeholder: "/api" },
            { id: "m-s2", label: "서비스 2", options: o.services.map((s) => ({ value: s.id, label: s.name })) },
          ],
          okLabel: "생성",
        });
        if (!r) return;
        const s1 = o.services.find((s) => s.id === r["m-s1"]);
        const rules = [{ path: r["m-p1"], serviceId: r["m-s1"] }];
        if (r["m-p2"]) rules.push({ path: r["m-p2"], serviceId: r["m-s2"] });
        const ing = await api.post("/api/ingresses", { clusterId: s1.clusterId, name: r["m-name"], host: r["m-host"], rules });
        toast(ing.message || "인그레스를 만들었어요. 컨트롤러가 ALB를 만드는 중이에요.", !ing.loadBalancerId);
        App.refresh();
      },
      "del-ing": (id) => act(api.del(`/api/ingresses/${id}`), "인그레스와 ALB를 삭제했어요."),
    },
  },
};

App.route("/eks", (p) => renderSection(EksPages, "eks", "clusters", p), sectionMeta("eks", "clusters"));
App.route("/workloads", (p) => renderSection(WorkloadPages, "workloads", "deployments", p), sectionMeta("workloads", "deployments"));
