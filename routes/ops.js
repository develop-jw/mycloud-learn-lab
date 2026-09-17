/* ---- 보안 · 운영: IAM / CloudWatch / 비용 / 활동 기록 / 대시보드 요약 ---- */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { readDB, writeDB, removeItem } = require("../lib/store");
const { makeId, randomHex, ACCOUNT_ID } = require("../lib/ids");
const { subnetView } = require("../lib/net");
const { typeSpec } = require("../lib/compute");
const metrics = require("../lib/metrics");
const { estimateCost } = require("../lib/pricing");
const { targetHealth } = require("./elb");
const { publicReadDecision, bucketSize } = require("./s3");

const router = express.Router();
const now = () => new Date().toISOString();

/* ===== IAM ===== */

// AWS 관리형 정책 (실제 정책을 학습용으로 단순화한 버전)
const MANAGED_POLICIES = {
  AdministratorAccess: { description: "모든 서비스의 모든 작업 허용", statements: [{ Effect: "Allow", Action: ["*"], Resource: ["*"] }] },
  ReadOnlyAccess: { description: "모든 서비스 조회만 허용", statements: [{ Effect: "Allow", Action: ["*:Get*", "*:List*", "*:Describe*"], Resource: ["*"] }] },
  AmazonEC2FullAccess: { description: "EC2 · ELB · Auto Scaling 전체", statements: [{ Effect: "Allow", Action: ["ec2:*", "elasticloadbalancing:*", "autoscaling:*", "cloudwatch:*"], Resource: ["*"] }] },
  AmazonEC2ReadOnlyAccess: { description: "EC2 조회만", statements: [{ Effect: "Allow", Action: ["ec2:Describe*", "elasticloadbalancing:Describe*"], Resource: ["*"] }] },
  AmazonS3FullAccess: { description: "S3 전체", statements: [{ Effect: "Allow", Action: ["s3:*"], Resource: ["*"] }] },
  AmazonS3ReadOnlyAccess: { description: "S3 읽기만", statements: [{ Effect: "Allow", Action: ["s3:Get*", "s3:List*"], Resource: ["*"] }] },
  AmazonRDSFullAccess: { description: "RDS 전체", statements: [{ Effect: "Allow", Action: ["rds:*"], Resource: ["*"] }] },
  IAMFullAccess: { description: "IAM 전체 (권한 상승 위험, 신중히)", statements: [{ Effect: "Allow", Action: ["iam:*"], Resource: ["*"] }] },
  AmazonEKSClusterPolicy: { description: "EKS 컨트롤 플레인이 ENI·로드 밸런서를 관리", statements: [{ Effect: "Allow", Action: ["ec2:CreateNetworkInterface", "ec2:Describe*", "elasticloadbalancing:*"], Resource: ["*"] }] },
  AmazonEKSWorkerNodePolicy: { description: "워커 노드가 클러스터에 참여", statements: [{ Effect: "Allow", Action: ["ec2:Describe*", "eks:DescribeCluster"], Resource: ["*"] }] },
  AmazonEKS_CNI_Policy: { description: "VPC CNI가 파드에 VPC IP 할당", statements: [{ Effect: "Allow", Action: ["ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:Describe*"], Resource: ["*"] }] },
  AmazonEC2ContainerRegistryReadOnly: { description: "ECR 이미지 내려받기", statements: [{ Effect: "Allow", Action: ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:Describe*", "ecr:List*"], Resource: ["*"] }] },
  AmazonSSMManagedInstanceCore: { description: "Session Manager로 키 없이 접속", statements: [{ Effect: "Allow", Action: ["ssm:*", "ssmmessages:*", "ec2messages:*"], Resource: ["*"] }] },
  CloudWatchAgentServerPolicy: { description: "CloudWatch 에이전트가 지표·로그 전송", statements: [{ Effect: "Allow", Action: ["cloudwatch:PutMetricData", "logs:*"], Resource: ["*"] }] },
};

const TRUSTED_SERVICES = {
  ec2: "ec2.amazonaws.com",
  eks: "eks.amazonaws.com",
  "pods.eks": "pods.eks.amazonaws.com (EKS Pod Identity)",
  lambda: "lambda.amazonaws.com",
  "ecs-tasks": "ecs-tasks.amazonaws.com",
};

function policyDoc(db, name) {
  if (MANAGED_POLICIES[name]) return MANAGED_POLICIES[name].statements;
  const custom = db.iamPolicies.find((p) => p.name === name);
  return custom ? custom.document.Statement : [];
}

function wildcardMatch(pattern, value) {
  const re = new RegExp("^" + String(pattern).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  return re.test(value);
}

// 권한 평가 순서: 명시적 Deny > 명시적 Allow > (아무것도 없으면) 암묵적 Deny
function evaluate(db, policies, action, resource) {
  const matches = [];
  for (const pName of policies) {
    for (const st of policyDoc(db, pName)) {
      const actions = [].concat(st.Action || []);
      const resources = [].concat(st.Resource || []);
      if (actions.some((a) => wildcardMatch(a, action)) && resources.some((r) => wildcardMatch(r, resource))) {
        matches.push({ policy: pName, effect: st.Effect });
      }
    }
  }
  const deny = matches.find((m) => m.effect === "Deny");
  if (deny) return { decision: "explicitDeny", by: deny.policy };
  const allow = matches.find((m) => m.effect === "Allow");
  if (allow) return { decision: "allowed", by: allow.policy };
  return { decision: "implicitDeny", by: null };
}

router.get("/iam/meta", (req, res) =>
  res.json({
    managedPolicies: Object.entries(MANAGED_POLICIES).map(([name, p]) => ({ name, description: p.description, statements: p.statements })),
    trustedServices: TRUSTED_SERVICES,
    accountId: ACCOUNT_ID,
  })
);

router.get("/iam/users", (req, res) => res.json(readDB().iamUsers));
router.get("/iam/roles", (req, res) => res.json(readDB().iamRoles));
router.get("/iam/policies", (req, res) => res.json(readDB().iamPolicies));

router.post("/iam/users", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!/^[\w+=,.@-]{1,64}$/.test(name)) return res.status(400).json({ error: "사용자 이름 형식이 올바르지 않아요." });
  const db = readDB();
  if (db.iamUsers.some((u) => u.name === name)) return res.status(409).json({ error: "EntityAlreadyExists: 같은 이름의 사용자가 있어요." });
  const user = {
    id: `AIDA${randomHex(16).toUpperCase()}`,
    name,
    arn: `arn:aws:iam::${ACCOUNT_ID}:user/${name}`,
    consoleAccess: !!req.body.consoleAccess,
    mfaEnabled: false,
    attachedPolicies: [].concat(req.body.policies || []).filter((p) => MANAGED_POLICIES[p] || db.iamPolicies.some((c) => c.name === p)),
    accessKeys: [],
    createdAt: now(),
  };
  db.iamUsers.push(user);
  writeDB(db);
  res.status(201).json(user);
});

router.post("/iam/users/:id/access-keys", (req, res) => {
  const db = readDB();
  const u = db.iamUsers.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: "사용자를 찾을 수 없어요." });
  if (u.accessKeys.length >= 2) return res.status(409).json({ error: "LimitExceeded: 사용자당 액세스 키는 최대 2개예요. 교체할 때만 2개를 두세요." });
  const key = { id: `AKIA${randomHex(16).toUpperCase()}`, status: "Active", createdAt: now() };
  u.accessKeys.push(key);
  writeDB(db);
  // 비밀 키는 지금 딱 한 번만 보여줌 (저장하지 않음) — 실제 AWS와 같은 방식
  res.status(201).json({ ...key, secretAccessKey: `${randomHex(20)}${randomHex(20)}`.slice(0, 40) });
});

router.post("/iam/users/:id/access-keys/:keyId/toggle", (req, res) => {
  const db = readDB();
  const u = db.iamUsers.find((x) => x.id === req.params.id);
  const k = u && u.accessKeys.find((x) => x.id === req.params.keyId);
  if (!k) return res.status(404).json({ error: "키를 찾을 수 없어요." });
  k.status = k.status === "Active" ? "Inactive" : "Active";
  writeDB(db);
  res.json(u);
});

router.delete("/iam/users/:id/access-keys/:keyId", (req, res) => {
  const db = readDB();
  const u = db.iamUsers.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: "사용자를 찾을 수 없어요." });
  u.accessKeys = u.accessKeys.filter((k) => k.id !== req.params.keyId);
  writeDB(db);
  res.json(u);
});

router.post("/iam/users/:id/mfa", (req, res) => {
  const db = readDB();
  const u = db.iamUsers.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: "사용자를 찾을 수 없어요." });
  u.mfaEnabled = !u.mfaEnabled;
  writeDB(db);
  res.json(u);
});

router.delete("/iam/users/:id", (req, res) => {
  const db = readDB();
  const u = db.iamUsers.find((x) => x.id === req.params.id);
  if (u && u.accessKeys.length) return res.status(409).json({ error: "DeleteConflict: 액세스 키를 먼저 삭제하세요." });
  removeItem("iamUsers", req.params.id);
  res.json({ ok: true });
});

router.post("/iam/roles", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!/^[\w+=,.@-]{1,64}$/.test(name)) return res.status(400).json({ error: "역할 이름 형식이 올바르지 않아요." });
  if (!TRUSTED_SERVICES[req.body.trustedService]) return res.status(400).json({ error: "이 역할을 맡을(assume) 서비스를 고르세요." });
  const db = readDB();
  if (db.iamRoles.some((r) => r.name === name)) return res.status(409).json({ error: "EntityAlreadyExists: 같은 이름의 역할이 있어요." });
  const role = {
    id: `AROA${randomHex(16).toUpperCase()}`,
    name,
    arn: `arn:aws:iam::${ACCOUNT_ID}:role/${name}`,
    trustedService: req.body.trustedService,
    attachedPolicies: [].concat(req.body.policies || []).filter((p) => MANAGED_POLICIES[p] || db.iamPolicies.some((c) => c.name === p)),
    description: req.body.description || "",
    createdAt: now(),
  };
  db.iamRoles.push(role);
  writeDB(db);
  res.status(201).json(role);
});

router.delete("/iam/roles/:id", (req, res) => {
  const db = readDB();
  const r = db.iamRoles.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "역할을 찾을 수 없어요." });
  const inUse =
    db.instances.some((i) => i.iamRole === r.name && i.state !== "terminated") ||
    db.eksClusters.some((c) => c.roleName === r.name) ||
    db.nodeGroups.some((n) => n.nodeRoleName === r.name);
  if (inUse) return res.status(409).json({ error: "DeleteConflict: 인스턴스·EKS 클러스터·노드 그룹이 이 역할을 쓰고 있어요." });
  removeItem("iamRoles", r.id);
  res.json({ ok: true });
});

// 사용자/역할에 정책 연결·해제
router.post("/iam/:kind/:id/policies", (req, res) => {
  const coll = req.params.kind === "users" ? "iamUsers" : req.params.kind === "roles" ? "iamRoles" : null;
  if (!coll) return res.status(400).json({ error: "잘못된 대상이에요." });
  const db = readDB();
  const target = db[coll].find((x) => x.id === req.params.id);
  if (!target) return res.status(404).json({ error: "대상을 찾을 수 없어요." });
  const p = req.body.policy;
  if (!MANAGED_POLICIES[p] && !db.iamPolicies.some((c) => c.name === p)) return res.status(400).json({ error: "정책을 선택하세요." });
  if (req.body.detach) target.attachedPolicies = target.attachedPolicies.filter((x) => x !== p);
  else if (!target.attachedPolicies.includes(p)) {
    if (target.attachedPolicies.length >= 10) return res.status(409).json({ error: "LimitExceeded: 관리형 정책은 최대 10개까지 연결할 수 있어요." });
    target.attachedPolicies.push(p);
  }
  writeDB(db);
  res.json(target);
});

router.post("/iam/policies", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!/^[\w+=,.@-]{1,128}$/.test(name)) return res.status(400).json({ error: "정책 이름 형식이 올바르지 않아요." });
  let doc;
  try {
    doc = typeof req.body.document === "string" ? JSON.parse(req.body.document) : req.body.document;
  } catch (e) {
    return res.status(400).json({ error: `MalformedPolicyDocument: JSON 문법 오류 — ${e.message}` });
  }
  if (!doc || doc.Version !== "2012-10-17") return res.status(400).json({ error: 'MalformedPolicyDocument: "Version": "2012-10-17"이 필요해요.' });
  if (!Array.isArray(doc.Statement) || !doc.Statement.length) return res.status(400).json({ error: "MalformedPolicyDocument: Statement 배열이 필요해요." });
  for (const st of doc.Statement) {
    if (!["Allow", "Deny"].includes(st.Effect) || !st.Action || !st.Resource) {
      return res.status(400).json({ error: "MalformedPolicyDocument: 각 문장에는 Effect(Allow/Deny), Action, Resource가 있어야 해요." });
    }
  }
  const db = readDB();
  if (MANAGED_POLICIES[name] || db.iamPolicies.some((p) => p.name === name)) return res.status(409).json({ error: "같은 이름의 정책이 있어요." });
  const pol = { id: `ANPA${randomHex(16).toUpperCase()}`, name, arn: `arn:aws:iam::${ACCOUNT_ID}:policy/${name}`, description: req.body.description || "", document: doc, createdAt: now() };
  db.iamPolicies.push(pol);
  writeDB(db);
  res.status(201).json(pol);
});

router.delete("/iam/policies/:id", (req, res) => {
  const db = readDB();
  const p = db.iamPolicies.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "정책을 찾을 수 없어요." });
  if ([...db.iamUsers, ...db.iamRoles].some((x) => x.attachedPolicies.includes(p.name))) {
    return res.status(409).json({ error: "DeleteConflict: 이 정책이 연결된 사용자/역할이 있어요. 먼저 분리하세요." });
  }
  removeItem("iamPolicies", p.id);
  res.json({ ok: true });
});

// 정책 시뮬레이터: 이 사용자/역할이 이 작업을 할 수 있을까?
router.post("/iam/simulate", (req, res) => {
  const db = readDB();
  const { kind, id, action, resource } = req.body;
  const target = (kind === "roles" ? db.iamRoles : db.iamUsers).find((x) => x.id === id);
  if (!target) return res.status(400).json({ error: "사용자 또는 역할을 선택하세요." });
  if (!/^[a-z0-9-]+:[A-Za-z*]+$/.test(action || "")) return res.status(400).json({ error: "작업은 서비스:작업 형식이에요. 예: s3:GetObject" });
  res.json({ ...evaluate(db, target.attachedPolicies, action, resource || "*"), principal: target.name, action, resource: resource || "*" });
});

/* ===== CloudWatch: 지표 & 경보 ===== */

router.get("/metrics/current", (req, res) => res.json(metrics.current(readDB(), req.query.range)));
router.get("/metrics/history", (req, res) => res.json(metrics.history(readDB(), req.query.range)));

router.get("/alarms", (req, res) => res.json(readDB().alarms));

router.post("/alarms", (req, res) => {
  const { name, metric, comparison, threshold, periodMinutes, notifyEmail } = req.body;
  if (!name) return res.status(400).json({ error: "경보 이름을 입력하세요." });
  if (!["cpu", "mem", "rps"].includes(metric)) return res.status(400).json({ error: "지표를 선택하세요." });
  if (Number.isNaN(Number(threshold)) || threshold === "") return res.status(400).json({ error: "임계값을 숫자로 입력하세요." });
  const db = readDB();
  const alarm = {
    id: makeId("alarm", 8),
    name,
    metric,
    comparison: comparison === "lt" ? "lt" : "gt",
    threshold: Number(threshold),
    periodMinutes: Number(periodMinutes) || 5,
    notifyEmail: notifyEmail || "",
    state: "INSUFFICIENT_DATA",
    stateReason: "아직 평가 전이에요",
    history: [],
    createdAt: now(),
  };
  db.alarms.push(alarm);
  writeDB(db);
  res.status(201).json(alarm);
});

router.delete("/alarms/:id", (req, res) => {
  removeItem("alarms", req.params.id);
  res.json({ ok: true });
});

// 리소스별로 자동으로 생기는 로그 그룹 목록 (실제 콘솔에서 자주 보는 이름들)
router.get("/log-groups", (req, res) => {
  const db = readDB();
  const groups = [
    ...db.eksClusters.map((c) => ({ name: `/aws/eks/${c.name}/cluster`, source: "EKS 컨트롤 플레인" })),
    ...db.eksClusters
      .filter((c) => c.addons.some((a) => a.name === "amazon-cloudwatch-observability"))
      .map((c) => ({ name: `/aws/containerinsights/${c.name}/application`, source: "Container Insights" })),
    ...db.dbInstances.map((d) => ({ name: `/aws/rds/instance/${d.identifier}/${d.engine === "postgres" ? "postgresql" : "error"}`, source: "RDS" })),
    ...db.instances
      .filter((i) => i.state === "running" && i.iamRole && (db.iamRoles.find((r) => r.name === i.iamRole) || { attachedPolicies: [] }).attachedPolicies.includes("CloudWatchAgentServerPolicy"))
      .map((i) => ({ name: `/ec2/${i.name}/messages`, source: "CloudWatch 에이전트" })),
  ];
  res.json(groups);
});

/* ===== 비용 ===== */

router.get("/cost", (req, res) => {
  const db = readDB();
  db.buckets.forEach((b) => (b.sizeBytes = bucketSize(b.name)));
  const cost = estimateCost(db);
  res.json({ ...cost, budget: db.budget });
});

router.post("/cost/budget", (req, res) => {
  const db = readDB();
  const limit = Number(req.body.monthlyLimit);
  db.budget = limit > 0 ? { monthlyLimit: limit, alertPercent: Number(req.body.alertPercent) || 80 } : null;
  writeDB(db);
  res.json(db.budget);
});

/* ===== 활동 기록 ===== */

router.get("/events", (req, res) => res.json(readDB().events.slice(0, Number(req.query.limit) || 50)));

/* ===== 대시보드 요약 (한 번의 요청으로 전체 현황) ===== */

router.get("/overview", (req, res) => {
  const db = readDB();
  db.buckets.forEach((b) => (b.sizeBytes = bucketSize(b.name)));
  const lbs = db.loadBalancers.map((lb) => {
    const tgs = lb.listeners
      .flatMap((ls) => [ls.targetGroupId, ...(ls.rules || []).map((r) => r.targetGroupId)])
      .map((id) => db.targetGroups.find((t) => t.id === id))
      .filter(Boolean);
    const states = tgs.flatMap((tg) => tg.targets.map((id) => targetHealth(db, tg, id).state));
    return { ...lb, healthy: states.filter((s) => s === "healthy").length, totalTargets: states.length };
  });
  res.json({
    vpcs: db.vpcs,
    subnets: db.subnets.map((s) => subnetView(db, s)),
    routeTables: db.routeTables,
    igws: db.internetGateways,
    nats: db.natGateways,
    eips: db.elasticIps,
    sgs: db.securityGroups,
    nacls: db.nacls,
    vgws: db.vpnGateways,
    vpns: db.vpnConnections,
    dxs: db.dxConnections,
    instances: db.instances.map((i) => ({ ...i, spec: typeSpec(i.instanceType) })),
    volumes: db.volumes,
    launchTemplates: db.launchTemplates,
    asgs: db.autoScalingGroups,
    lbs,
    tgs: db.targetGroups,
    cloudfront: db.cloudfrontDistributions,
    zones: db.hostedZones,
    clusters: db.eksClusters,
    nodeGroups: db.nodeGroups,
    ecr: db.ecrRepositories,
    deployments: db.deployments,
    pods: db.pods,
    services: db.k8sServices,
    ingresses: db.ingresses,
    buckets: db.buckets.map((b) => ({ ...b, publicRead: publicReadDecision(b).ok, objectCount: countObjects(b.name) })),
    efs: db.efsFileSystems,
    dbs: db.dbInstances.map(({ masterPassword: pw, ...rest }) => rest),
    caches: db.cacheClusters,
    iam: { users: db.iamUsers, roles: db.iamRoles, policies: db.iamPolicies },
    alarms: db.alarms,
    cost: estimateCost(db),
    budget: db.budget,
    metrics: metrics.current(db),
    events: db.events.slice(0, 40),
  });
});

function countObjects(name) {
  const dir = path.join(__dirname, "..", "uploads", path.basename(name));
  return fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
}

module.exports = router;
module.exports.evaluate = evaluate;
