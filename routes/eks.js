/* ---- 컨테이너: Amazon EKS / Amazon ECR / 쿠버네티스 워크로드 ---- */
// kubectl로 하던 일(디플로이먼트·서비스·인그레스 만들기)을 콘솔 클릭으로 흉내냅니다.
// 파드를 노드에 배치하는 "스케줄링"은 lib/sim.js가 주기적으로 처리해요.
const express = require("express");
const { readDB, writeDB, later, removeItem } = require("../lib/store");
const { makeId, randomHex, ACCOUNT_ID } = require("../lib/ids");
const { isSubnetPublic, distinctAzCount, subnetEgress } = require("../lib/net");
const { terminateInstance, typeSpec } = require("../lib/compute");
const { createLoadBalancer } = require("./elb");

const router = express.Router();
const now = () => new Date().toISOString();

const K8S_VERSIONS = ["1.33", "1.32", "1.31"];
const DEFAULT_ADDONS = ["vpc-cni", "kube-proxy", "coredns"];
const OPTIONAL_ADDONS = [
  "aws-load-balancer-controller",
  "aws-ebs-csi-driver",
  "aws-efs-csi-driver",
  "metrics-server",
  "amazon-cloudwatch-observability",
  "eks-pod-identity-agent",
];

// VPC CNI는 파드마다 VPC IP를 하나씩 쓰기 때문에 인스턴스 유형별로 최대 파드 수가 정해져 있어요.
const MAX_PODS = { "t3.micro": 4, "t3.small": 11, "t3.medium": 17, "t2.micro": 4, "m5.large": 29, "m6i.large": 29, "c5.large": 29, "c6i.large": 29, "r5.large": 29 };

function nodeCapacity(instanceType) {
  const s = typeSpec(instanceType);
  return {
    cpu: s.vcpu * 1000 - 80, // 시스템 예약분 제외 (millicore)
    mem: Math.round(s.mem * 1024 - 400), // MiB
    pods: MAX_PODS[instanceType] || 29,
  };
}

function ensureRole(db, name, trustedService, policies) {
  let role = db.iamRoles.find((r) => r.name === name);
  if (!role) {
    role = { id: makeId("AROA", 16).replace("-", ""), name, trustedService, attachedPolicies: policies, createdAt: now(), description: "콘솔에서 자동 생성" };
    db.iamRoles.push(role);
  }
  return role;
}

/* ===== 클러스터 ===== */

router.get("/eks/meta", (req, res) => res.json({ versions: K8S_VERSIONS, defaultAddons: DEFAULT_ADDONS, optionalAddons: OPTIONAL_ADDONS, maxPods: MAX_PODS }));

router.get("/eks-clusters", (req, res) => {
  const db = readDB();
  res.json(
    db.eksClusters.map((c) => ({
      ...c,
      nodeCount: db.instances.filter((i) => i.managedBy && i.managedBy.clusterId === c.id && i.state === "running").length,
      podCount: db.pods.filter((p) => p.clusterId === c.id && p.state === "Running").length,
    }))
  );
});

router.post("/eks-clusters", (req, res) => {
  const { name, version, subnetIds, endpointAccess, roleName, autoCreateRole } = req.body;
  const db = readDB();
  if (!/^[a-zA-Z][a-zA-Z0-9-]{0,99}$/.test(name || "")) return res.status(400).json({ error: "클러스터 이름은 영문자로 시작하고 영문·숫자·하이픈만 쓸 수 있어요." });
  if (db.eksClusters.some((c) => c.name === name)) return res.status(409).json({ error: "같은 이름의 클러스터가 이미 있어요." });
  if (distinctAzCount(db, subnetIds) < 2) return res.status(400).json({ error: "EKS 컨트롤 플레인은 서로 다른 가용 영역의 서브넷이 최소 2개 필요해요." });
  let role = db.iamRoles.find((r) => r.name === roleName);
  if (!role && autoCreateRole) role = ensureRole(db, "eksClusterRole", "eks", ["AmazonEKSClusterPolicy"]);
  if (!role) return res.status(400).json({ error: "클러스터 IAM 역할이 필요해요. '역할 자동 생성'을 체크하거나 IAM에서 먼저 만드세요." });
  if (role.trustedService !== "eks") return res.status(400).json({ error: `역할 ${role.name}의 신뢰 관계가 eks.amazonaws.com이 아니에요.` });
  if (!role.attachedPolicies.includes("AmazonEKSClusterPolicy")) return res.status(400).json({ error: "클러스터 역할에 AmazonEKSClusterPolicy 정책이 연결돼 있어야 해요." });
  const vpcId = db.subnets.find((s) => s.id === subnetIds[0]).vpcId;
  const cluster = {
    id: makeId("eks", 10),
    name,
    version: K8S_VERSIONS.includes(version) ? version : K8S_VERSIONS[0],
    vpcId,
    subnetIds,
    roleName: role.name,
    endpointAccess: ["public", "private", "public-and-private"].includes(endpointAccess) ? endpointAccess : "public-and-private",
    endpoint: `https://${randomHex(32).toUpperCase()}.gr7.ap-northeast-2.eks.amazonaws.com`,
    oidcIssuer: `https://oidc.eks.ap-northeast-2.amazonaws.com/id/${randomHex(32).toUpperCase()}`,
    addons: DEFAULT_ADDONS.map((a) => ({ name: a, status: "CREATING" })),
    status: "CREATING",
    createdAt: now(),
  };
  db.eksClusters.push(cluster);
  writeDB(db);
  later(8000, "eksClusters", cluster.id, (c) => ({ status: "ACTIVE", addons: c.addons.map((a) => ({ ...a, status: "ACTIVE" })) }));
  res.status(201).json(cluster);
});

router.post("/eks-clusters/:id/addons", (req, res) => {
  const db = readDB();
  const c = db.eksClusters.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "클러스터를 찾을 수 없어요." });
  if (c.status !== "ACTIVE") return res.status(409).json({ error: "클러스터가 ACTIVE가 된 뒤 추가 기능을 설치할 수 있어요." });
  const name = req.body.name;
  if (!OPTIONAL_ADDONS.includes(name)) return res.status(400).json({ error: "지원하지 않는 추가 기능이에요." });
  if (c.addons.some((a) => a.name === name)) return res.status(409).json({ error: "이미 설치돼 있어요." });
  c.addons.push({ name, status: "CREATING" });
  writeDB(db);
  setTimeout(() => {
    const d = readDB();
    const cl = d.eksClusters.find((x) => x.id === c.id);
    const ad = cl && cl.addons.find((a) => a.name === name);
    if (ad) ad.status = "ACTIVE";
    writeDB(d);
  }, 3500);
  res.status(201).json(c);
});

router.post("/eks-clusters/:id/upgrade", (req, res) => {
  const db = readDB();
  const c = db.eksClusters.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "클러스터를 찾을 수 없어요." });
  const idx = K8S_VERSIONS.indexOf(c.version);
  if (idx <= 0) return res.status(400).json({ error: "이미 최신 버전이에요." });
  const next = K8S_VERSIONS[idx - 1];
  c.status = "UPDATING";
  writeDB(db);
  // 컨트롤 플레인은 한 번에 마이너 버전 하나씩만 올릴 수 있어요
  later(6000, "eksClusters", c.id, { status: "ACTIVE", version: next });
  res.json({ ok: true, from: c.version, to: next });
});

router.delete("/eks-clusters/:id", (req, res) => {
  const db = readDB();
  if (db.nodeGroups.some((n) => n.clusterId === req.params.id)) {
    return res.status(409).json({ error: "ResourceInUse: 노드 그룹을 먼저 삭제해야 클러스터를 지울 수 있어요." });
  }
  const c = db.eksClusters.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "클러스터를 찾을 수 없어요." });
  // 클러스터 안의 쿠버네티스 리소스와, 그들이 만든 로드 밸런서도 함께 정리
  const svcIds = db.k8sServices.filter((s) => s.clusterId === c.id).map((s) => s.id);
  const ingIds = db.ingresses.filter((s) => s.clusterId === c.id).map((s) => s.id);
  db.loadBalancers = db.loadBalancers.filter((l) => !(l.managedBy && [...svcIds, ...ingIds].includes(l.managedBy.id)));
  db.targetGroups = db.targetGroups.filter((t) => !(t.managedBy && t.managedBy.clusterId === c.id));
  db.deployments = db.deployments.filter((d) => d.clusterId !== c.id);
  db.pods = db.pods.filter((p) => p.clusterId !== c.id);
  db.k8sServices = db.k8sServices.filter((s) => s.clusterId !== c.id);
  db.ingresses = db.ingresses.filter((s) => s.clusterId !== c.id);
  c.status = "DELETING";
  writeDB(db);
  setTimeout(() => removeItem("eksClusters", c.id), 4000);
  res.json({ ok: true });
});

/* ===== 관리형 노드 그룹 ===== */

router.get("/node-groups", (req, res) => {
  const db = readDB();
  res.json(
    db.nodeGroups.map((n) => {
      const nodes = db.instances.filter((i) => i.managedBy && i.managedBy.id === n.id && i.state !== "terminated");
      return {
        ...n,
        nodes: nodes.map((i) => {
          const pods = db.pods.filter((p) => p.nodeId === i.id && p.state !== "Terminating");
          return {
            id: i.id,
            name: i.name,
            state: i.state,
            az: i.availabilityZone,
            privateIp: i.privateIp,
            capacity: nodeCapacity(i.instanceType),
            used: { cpu: pods.reduce((s, p) => s + p.cpu, 0), mem: pods.reduce((s, p) => s + p.mem, 0), pods: pods.length },
          };
        }),
      };
    })
  );
});

router.post("/node-groups", (req, res) => {
  const { clusterId, name, instanceType, capacityType, min, desired, max, subnetIds, nodeRoleName, autoCreateRole, diskSize } = req.body;
  const db = readDB();
  const c = db.eksClusters.find((x) => x.id === clusterId);
  if (!c) return res.status(400).json({ error: "클러스터를 선택하세요." });
  if (c.status !== "ACTIVE") return res.status(409).json({ error: "클러스터가 ACTIVE 상태가 된 뒤 노드 그룹을 만들 수 있어요." });
  if (!name) return res.status(400).json({ error: "노드 그룹 이름을 입력하세요." });
  if (!(subnetIds || []).length || !subnetIds.every((id) => c.subnetIds.includes(id))) {
    return res.status(400).json({ error: "클러스터에 등록된 서브넷 중에서 골라야 해요." });
  }
  let role = db.iamRoles.find((r) => r.name === nodeRoleName);
  if (!role && autoCreateRole) {
    role = ensureRole(db, "eksNodeRole", "ec2", ["AmazonEKSWorkerNodePolicy", "AmazonEC2ContainerRegistryReadOnly", "AmazonEKS_CNI_Policy"]);
  }
  if (!role) return res.status(400).json({ error: "노드 IAM 역할이 필요해요 ('역할 자동 생성' 체크 또는 IAM에서 생성)." });
  if (role.trustedService !== "ec2") return res.status(400).json({ error: "노드 역할은 ec2.amazonaws.com을 신뢰해야 해요 (노드는 EC2 인스턴스라서)." });
  const mn = Number(min) || 1;
  const mx = Number(max) || 3;
  const ds = Number(desired) || 2;
  if (!(mn <= ds && ds <= mx)) return res.status(400).json({ error: "최소 ≤ 원하는 크기 ≤ 최대 순서가 되어야 해요." });
  const ng = {
    id: makeId("ng", 10),
    clusterId,
    name,
    instanceType: instanceType || "t3.medium",
    capacityType: capacityType === "SPOT" ? "SPOT" : "ON_DEMAND",
    subnetIds,
    nodeRoleName: role.name,
    diskSize: Number(diskSize) || 20,
    min: mn,
    desired: ds,
    max: mx,
    status: "CREATING",
    createdAt: now(),
  };
  db.nodeGroups.push(ng);
  writeDB(db);
  later(6000, "nodeGroups", ng.id, { status: "ACTIVE" });
  const warn = subnetIds.some((id) => subnetEgress(db, id) === "none")
    ? "선택한 서브넷 중 인터넷으로 나갈 길(IGW/NAT)이 없는 곳이 있어요. 외부 이미지를 받을 수 없을 수 있어요."
    : undefined;
  res.status(201).json({ ...ng, warning: warn });
});

router.post("/node-groups/:id/scale", (req, res) => {
  const db = readDB();
  const ng = db.nodeGroups.find((n) => n.id === req.params.id);
  if (!ng) return res.status(404).json({ error: "노드 그룹을 찾을 수 없어요." });
  const ds = Number(req.body.desired);
  const mn = req.body.min !== undefined ? Number(req.body.min) : ng.min;
  const mx = req.body.max !== undefined ? Number(req.body.max) : ng.max;
  if (!(mn <= ds && ds <= mx)) return res.status(400).json({ error: "최소 ≤ 원하는 크기 ≤ 최대 순서가 되어야 해요." });
  Object.assign(ng, { desired: ds, min: mn, max: mx, status: "UPDATING" });
  writeDB(db);
  later(3000, "nodeGroups", ng.id, { status: "ACTIVE" });
  res.json(ng);
});

router.delete("/node-groups/:id", (req, res) => {
  const db = readDB();
  const ng = db.nodeGroups.find((n) => n.id === req.params.id);
  if (!ng) return res.status(404).json({ error: "노드 그룹을 찾을 수 없어요." });
  const nodes = db.instances.filter((i) => i.managedBy && i.managedBy.id === ng.id && i.state !== "terminated");
  db.nodeGroups = db.nodeGroups.filter((n) => n.id !== ng.id);
  writeDB(db);
  nodes.forEach((n) => terminateInstance(n.id));
  res.json({ ok: true });
});

/* ===== Amazon ECR (컨테이너 이미지 저장소) ===== */

router.get("/ecr-repositories", (req, res) => res.json(readDB().ecrRepositories));

router.post("/ecr-repositories", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!/^[a-z0-9][a-z0-9._/-]{1,254}$/.test(name)) return res.status(400).json({ error: "리포지토리 이름은 소문자·숫자·., _, -, / 만 쓸 수 있어요." });
  const db = readDB();
  if (db.ecrRepositories.some((r) => r.name === name)) return res.status(409).json({ error: "같은 이름의 리포지토리가 이미 있어요." });
  const repo = {
    id: makeId("ecr", 8),
    name,
    uri: `${ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/${name}`,
    tagImmutable: !!req.body.tagImmutable,
    scanOnPush: req.body.scanOnPush !== false,
    encryption: req.body.encryption === "KMS" ? "KMS" : "AES256",
    images: [],
    createdAt: now(),
  };
  db.ecrRepositories.push(repo);
  writeDB(db);
  res.status(201).json(repo);
});

// docker push를 흉내: 태그 이름만 받아 이미지 기록을 남김
router.post("/ecr-repositories/:id/images", (req, res) => {
  const db = readDB();
  const repo = db.ecrRepositories.find((r) => r.id === req.params.id);
  if (!repo) return res.status(404).json({ error: "리포지토리를 찾을 수 없어요." });
  const tag = String(req.body.tag || "").trim();
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) return res.status(400).json({ error: "태그 형식이 올바르지 않아요. 예: v1.0.0" });
  const existing = repo.images.find((i) => i.tag === tag);
  if (existing && repo.tagImmutable) return res.status(409).json({ error: `ImageTagAlreadyExistsException: 태그 불변성이 켜져 있어 '${tag}'를 덮어쓸 수 없어요.` });
  const digest = `sha256:${randomHex(64)}`;
  const image = {
    tag,
    digest,
    sizeMb: Number(req.body.sizeMb) || 40 + Math.floor(Math.random() * 180),
    pushedAt: now(),
    scan: repo.scanOnPush ? { status: "IN_PROGRESS" } : null,
  };
  if (existing) Object.assign(existing, image);
  else repo.images.unshift(image);
  writeDB(db);
  if (repo.scanOnPush) {
    setTimeout(() => {
      const d = readDB();
      const r = d.ecrRepositories.find((x) => x.id === repo.id);
      const img = r && r.images.find((x) => x.digest === digest);
      if (img) img.scan = { status: "COMPLETE", critical: Math.random() < 0.2 ? 1 : 0, high: Math.floor(Math.random() * 3), medium: Math.floor(Math.random() * 6) };
      writeDB(d);
    }, 3000);
  }
  res.status(201).json(image);
});

router.delete("/ecr-repositories/:id/images/:tag", (req, res) => {
  const db = readDB();
  const repo = db.ecrRepositories.find((r) => r.id === req.params.id);
  if (!repo) return res.status(404).json({ error: "리포지토리를 찾을 수 없어요." });
  repo.images = repo.images.filter((i) => i.tag !== req.params.tag);
  writeDB(db);
  res.json(repo);
});

router.delete("/ecr-repositories/:id", (req, res) => {
  const db = readDB();
  const repo = db.ecrRepositories.find((r) => r.id === req.params.id);
  if (repo && repo.images.length && !req.query.force) {
    return res.status(409).json({ error: "RepositoryNotEmptyException: 이미지가 남아 있어요. 이미지를 지우거나 강제 삭제하세요." });
  }
  removeItem("ecrRepositories", req.params.id);
  res.json({ ok: true });
});

/* ===== 워크로드: Deployment / Pod ===== */

router.get("/deployments", (req, res) => {
  const db = readDB();
  res.json(
    db.deployments.map((d) => {
      const pods = db.pods.filter((p) => p.deploymentId === d.id && p.state !== "Terminating");
      return { ...d, ready: pods.filter((p) => p.state === "Running").length, total: pods.length };
    })
  );
});

router.post("/deployments", (req, res) => {
  const { clusterId, namespace, name, image, replicas, cpu, memory, containerPort } = req.body;
  const db = readDB();
  const c = db.eksClusters.find((x) => x.id === clusterId);
  if (!c || c.status !== "ACTIVE") return res.status(400).json({ error: "ACTIVE 상태인 클러스터를 선택하세요." });
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name || "")) return res.status(400).json({ error: "이름은 소문자·숫자·하이픈만 쓸 수 있어요 (쿠버네티스 규칙)." });
  const ns = namespace || "default";
  if (db.deployments.some((d) => d.clusterId === clusterId && d.namespace === ns && d.name === name)) {
    return res.status(409).json({ error: `deployments.apps "${name}" already exists` });
  }
  if (!image) return res.status(400).json({ error: "컨테이너 이미지를 입력하세요. 예: nginx:1.27" });
  const dep = {
    id: makeId("deploy", 8),
    clusterId,
    namespace: ns,
    name,
    image,
    replicas: Math.min(Math.max(Number(replicas) || 1, 0), 30),
    cpu: Number(cpu) || 250,
    mem: Number(memory) || 256,
    containerPort: Number(containerPort) || 80,
    revision: 1,
    createdAt: now(),
  };
  db.deployments.push(dep);
  writeDB(db);
  res.status(201).json(dep);
});

router.post("/deployments/:id/scale", (req, res) => {
  const db = readDB();
  const d = db.deployments.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "디플로이먼트를 찾을 수 없어요." });
  d.replicas = Math.min(Math.max(Number(req.body.replicas) || 0, 0), 30);
  writeDB(db);
  res.json(d);
});

// 이미지 변경 → 롤링 업데이트 (새 리비전의 파드로 하나씩 교체)
router.post("/deployments/:id/image", (req, res) => {
  const db = readDB();
  const d = db.deployments.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "디플로이먼트를 찾을 수 없어요." });
  if (!req.body.image) return res.status(400).json({ error: "새 이미지를 입력하세요." });
  d.image = req.body.image;
  d.revision += 1;
  writeDB(db);
  res.json(d);
});

router.delete("/deployments/:id", (req, res) => {
  const db = readDB();
  db.deployments = db.deployments.filter((x) => x.id !== req.params.id);
  db.pods.forEach((p) => {
    if (p.deploymentId === req.params.id) p.state = "Terminating";
  });
  writeDB(db);
  res.json({ ok: true });
});

router.get("/pods", (req, res) => {
  const db = readDB();
  res.json(
    db.pods.map((p) => ({
      ...p,
      nodeName: (db.instances.find((i) => i.id === p.nodeId) || {}).name || null,
      deploymentName: (db.deployments.find((d) => d.id === p.deploymentId) || {}).name || null,
    }))
  );
});

// 파드 하나 삭제 → 디플로이먼트가 곧바로 새 파드를 만들어 개수를 맞춤 (자가 치유)
router.delete("/pods/:id", (req, res) => {
  const db = readDB();
  const p = db.pods.find((x) => x.id === req.params.id);
  if (p) p.state = "Terminating";
  writeDB(db);
  res.json({ ok: true });
});

/* ===== 서비스 (Service) ===== */

router.get("/k8s-services", (req, res) => res.json(readDB().k8sServices));

router.post("/k8s-services", (req, res) => {
  const { clusterId, name, type, deploymentId, port, targetPort } = req.body;
  const db = readDB();
  const c = db.eksClusters.find((x) => x.id === clusterId);
  const dep = db.deployments.find((d) => d.id === deploymentId && d.clusterId === clusterId);
  if (!c) return res.status(400).json({ error: "클러스터를 선택하세요." });
  if (!dep) return res.status(400).json({ error: "이 서비스가 트래픽을 보낼 디플로이먼트(셀렉터)를 선택하세요." });
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name || "")) return res.status(400).json({ error: "이름은 소문자·숫자·하이픈만 쓸 수 있어요." });
  const svcType = ["ClusterIP", "NodePort", "LoadBalancer"].includes(type) ? type : "ClusterIP";
  const svc = {
    id: makeId("svc", 8),
    clusterId,
    namespace: dep.namespace,
    name,
    type: svcType,
    deploymentId,
    port: Number(port) || 80,
    targetPort: Number(targetPort) || dep.containerPort,
    clusterIp: `10.100.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 2}`,
    nodePort: svcType === "ClusterIP" ? null : 30000 + Math.floor(Math.random() * 2767),
    loadBalancerId: null,
    status: svcType === "LoadBalancer" ? "Pending" : "Ready",
    message: "",
    createdAt: now(),
  };
  if (svcType === "LoadBalancer") {
    const publicSubnets = c.subnetIds.filter((id) => isSubnetPublic(db, id));
    if (distinctAzCount(db, publicSubnets) < 2) {
      svc.message = "EXTERNAL-IP <pending>: 클러스터 서브넷 중 서로 다른 AZ의 퍼블릭 서브넷이 2개 이상 있어야 인터넷용 NLB를 만들 수 있어요.";
    } else {
      const tg = {
        id: makeId("tg", 12),
        name: `k8s-${name}-${randomHex(4)}`.slice(0, 32),
        vpcId: c.vpcId,
        vpcCidr: (db.vpcs.find((v) => v.id === c.vpcId) || {}).cidrBlock,
        protocol: "TCP",
        port: svc.targetPort,
        targetType: "ip",
        healthCheckPath: "/",
        targets: [],
        managedBy: { type: "service", id: svc.id, clusterId: c.id, deploymentId },
        createdAt: now(),
      };
      db.targetGroups.push(tg);
      try {
        const lb = createLoadBalancer(db, {
          name: `k8s-${name}-${randomHex(6)}`.slice(0, 32),
          type: "network",
          scheme: "internet-facing",
          subnetIds: publicSubnets,
          listeners: [{ protocol: "TCP", port: svc.port, targetGroupId: tg.id }],
          managedBy: { type: "service", id: svc.id },
        });
        svc.loadBalancerId = lb.id;
        svc.message = "NLB 프로비저닝 중...";
      } catch (e) {
        svc.message = e.message;
      }
    }
  }
  db.k8sServices.push(svc);
  writeDB(db);
  res.status(201).json(svc);
});

router.delete("/k8s-services/:id", (req, res) => {
  const db = readDB();
  if (db.ingresses.some((i) => i.rules.some((r) => r.serviceId === req.params.id))) {
    return res.status(409).json({ error: "이 서비스를 쓰는 인그레스가 있어요. 인그레스를 먼저 지우세요." });
  }
  db.loadBalancers = db.loadBalancers.filter((l) => !(l.managedBy && l.managedBy.id === req.params.id));
  db.targetGroups = db.targetGroups.filter((t) => !(t.managedBy && t.managedBy.id === req.params.id));
  db.k8sServices = db.k8sServices.filter((s) => s.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

/* ===== 인그레스 (Ingress → AWS Load Balancer Controller → ALB) ===== */

router.get("/ingresses", (req, res) => {
  const db = readDB();
  res.json(
    db.ingresses.map((ing) => {
      const lb = db.loadBalancers.find((l) => l.id === ing.loadBalancerId);
      return { ...ing, address: lb && lb.state === "active" ? lb.dnsName : "" };
    })
  );
});

router.post("/ingresses", (req, res) => {
  const { clusterId, name, host, rules } = req.body;
  const db = readDB();
  const c = db.eksClusters.find((x) => x.id === clusterId);
  if (!c) return res.status(400).json({ error: "클러스터를 선택하세요." });
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name || "")) return res.status(400).json({ error: "이름은 소문자·숫자·하이픈만 쓸 수 있어요." });
  const cleanRules = (rules || []).filter((r) => r.path && r.serviceId);
  if (!cleanRules.length) return res.status(400).json({ error: "경로와 백엔드 서비스를 하나 이상 지정하세요." });
  for (const r of cleanRules) {
    const svc = db.k8sServices.find((s) => s.id === r.serviceId && s.clusterId === clusterId);
    if (!svc) return res.status(400).json({ error: "같은 클러스터의 서비스를 선택하세요." });
  }
  const ing = {
    id: makeId("ing", 8),
    clusterId,
    namespace: "default",
    name,
    host: host || "",
    className: "alb",
    rules: cleanRules.map((r) => ({ path: r.path, serviceId: r.serviceId })),
    loadBalancerId: null,
    message: "",
    createdAt: now(),
  };
  const controller = c.addons.find((a) => a.name === "aws-load-balancer-controller" && a.status === "ACTIVE");
  if (!controller) {
    ing.message = "ADDRESS가 비어 있어요: AWS Load Balancer Controller가 설치되지 않아 아무도 이 인그레스를 처리하지 않아요. 클러스터 → 추가 기능에서 설치하세요.";
  } else {
    const publicSubnets = c.subnetIds.filter((id) => isSubnetPublic(db, id));
    if (distinctAzCount(db, publicSubnets) < 2) {
      ing.message = "컨트롤러 오류: 서로 다른 AZ의 퍼블릭 서브넷을 2개 이상 찾지 못해 ALB를 만들 수 없어요.";
    } else {
      // 컨트롤러가 ALB용 보안 그룹과 대상 그룹(IP 타입)을 자동으로 만듦
      const sg = {
        id: `sg-${randomHex(17)}`,
        vpcId: c.vpcId,
        name: `k8s-${name}-alb-sg`,
        description: "AWS Load Balancer Controller가 생성",
        inboundRules: [
          { id: `sgr-${Date.now()}`, protocol: "tcp", port: 80, source: "0.0.0.0/0", description: "HTTP" },
          { id: `sgr-${Date.now() + 1}`, protocol: "tcp", port: 443, source: "0.0.0.0/0", description: "HTTPS" },
        ],
        managedBy: { type: "ingress", id: ing.id },
        createdAt: now(),
      };
      db.securityGroups.push(sg);
      const tgFor = (r) => {
        const svc = db.k8sServices.find((s) => s.id === r.serviceId);
        const tg = {
          id: makeId("tg", 12),
          name: `k8s-${svc.name}-${randomHex(4)}`.slice(0, 32),
          vpcId: c.vpcId,
          vpcCidr: (db.vpcs.find((v) => v.id === c.vpcId) || {}).cidrBlock,
          protocol: "HTTP",
          port: svc.targetPort,
          targetType: "ip",
          healthCheckPath: "/",
          targets: [],
          managedBy: { type: "ingress", id: ing.id, clusterId: c.id, deploymentId: svc.deploymentId },
          createdAt: now(),
        };
        db.targetGroups.push(tg);
        return tg;
      };
      const tgs = cleanRules.map(tgFor);
      try {
        const lb = createLoadBalancer(db, {
          name: `k8s-${name}-${randomHex(6)}`.slice(0, 32),
          type: "application",
          scheme: "internet-facing",
          subnetIds: publicSubnets,
          securityGroupIds: [sg.id],
          listeners: [{ protocol: "HTTP", port: 80, targetGroupId: tgs[0].id, rules: cleanRules.slice(1).map((r, i) => ({ id: makeId("rule", 8), path: r.path, targetGroupId: tgs[i + 1].id })) }],
          managedBy: { type: "ingress", id: ing.id },
        });
        ing.loadBalancerId = lb.id;
        ing.message = "ALB 프로비저닝 중...";
      } catch (e) {
        ing.message = e.message;
      }
    }
  }
  db.ingresses.push(ing);
  writeDB(db);
  res.status(201).json(ing);
});

router.delete("/ingresses/:id", (req, res) => {
  const db = readDB();
  db.loadBalancers = db.loadBalancers.filter((l) => !(l.managedBy && l.managedBy.id === req.params.id));
  db.targetGroups = db.targetGroups.filter((t) => !(t.managedBy && t.managedBy.id === req.params.id));
  db.securityGroups = db.securityGroups.filter((s) => !(s.managedBy && s.managedBy.id === req.params.id));
  db.ingresses = db.ingresses.filter((s) => s.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
module.exports.nodeCapacity = nodeCapacity;
