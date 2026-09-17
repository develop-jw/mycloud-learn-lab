/* ---- Elastic Load Balancing: 로드 밸런서 / 리스너 / 대상 그룹 ---- */
const express = require("express");
const { readDB, writeDB, later, removeItem } = require("../lib/store");
const { makeId, randomHex } = require("../lib/ids");
const { isSubnetPublic, distinctAzCount } = require("../lib/net");

const router = express.Router();
const now = () => new Date().toISOString();

const WEB_SERVER_RE = /(httpd|nginx|apache|node |npm start|python3? -m http|docker run|java -jar)/i;

// 보안 그룹이 이 포트로 들어오는 트래픽을 허용하는지
function sgAllows(db, sgId, port, allowedSources) {
  const sg = db.securityGroups.find((s) => s.id === sgId);
  if (!sg) return false;
  return sg.inboundRules.some(
    (r) => (String(r.port) === String(port) || r.port === "" || r.port == null || r.protocol === "all") && allowedSources.includes(r.source)
  );
}

// 대상 하나의 상태 확인 결과 (실제 ELB 콘솔의 Health status + 이유)
function targetHealth(db, tg, targetId) {
  if (tg.targetType === "ip") {
    const pod = db.pods.find((p) => p.id === targetId);
    if (!pod) return { state: "unused", reason: "대상이 없어요" };
    return pod.state === "Running" ? { state: "healthy", reason: "" } : { state: "initial", reason: `파드 상태: ${pod.state}` };
  }
  const inst = db.instances.find((i) => i.id === targetId);
  if (!inst || inst.state === "terminated" || inst.state === "shutting-down") return { state: "draining", reason: "인스턴스가 종료되는 중이에요" };
  if (inst.state === "pending") return { state: "initial", reason: "인스턴스가 시작되는 중이에요 (헬스 체크 대기)" };
  if (inst.state !== "running") return { state: "unused", reason: "인스턴스가 실행 중이 아니에요" };
  const lbSgs = db.loadBalancers.filter((l) => l.listeners.some((ls) => ls.targetGroupId === tg.id)).flatMap((l) => l.securityGroupIds || []);
  if (!inst.securityGroupId || !sgAllows(db, inst.securityGroupId, tg.port, ["0.0.0.0/0", tg.vpcCidr, ...lbSgs].filter(Boolean))) {
    return { state: "unhealthy", reason: `헬스 체크 실패: 인스턴스 보안 그룹이 포트 ${tg.port}를 로드 밸런서(또는 0.0.0.0/0)에 열어두지 않았어요` };
  }
  if (inst.managedBy && inst.managedBy.type === "nodegroup") return { state: "healthy", reason: "" };
  if (!WEB_SERVER_RE.test(inst.userData || "")) {
    return { state: "unhealthy", reason: `헬스 체크 실패: ${tg.healthCheckPath}에 응답하는 웹 서버가 없어요 (User Data로 웹 서버 설치 필요)` };
  }
  return { state: "healthy", reason: "" };
}

function tgView(db, tg) {
  return {
    ...tg,
    targetHealth: tg.targets.map((id) => ({ id, ...targetHealth(db, tg, id) })),
    usedBy: db.loadBalancers.filter((l) => l.listeners.some((ls) => ls.targetGroupId === tg.id || (ls.rules || []).some((r) => r.targetGroupId === tg.id))).map((l) => l.name),
  };
}

/* ===== 대상 그룹 ===== */

router.get("/target-groups", (req, res) => {
  const db = readDB();
  res.json(db.targetGroups.map((tg) => tgView(db, tg)));
});

router.post("/target-groups", (req, res) => {
  const { name, vpcId, protocol, port, targetType, healthCheckPath } = req.body;
  const db = readDB();
  const vpc = db.vpcs.find((v) => v.id === vpcId);
  if (!name) return res.status(400).json({ error: "대상 그룹 이름을 입력하세요." });
  if (!vpc) return res.status(400).json({ error: "VPC를 선택하세요." });
  const tg = {
    id: makeId("tg", 12),
    name,
    vpcId,
    vpcCidr: vpc.cidrBlock,
    protocol: protocol || "HTTP",
    port: Number(port) || 80,
    targetType: targetType === "ip" ? "ip" : "instance",
    healthCheckPath: healthCheckPath || "/",
    targets: [],
    managedBy: req.body.managedBy || null,
    createdAt: now(),
  };
  db.targetGroups.push(tg);
  writeDB(db);
  res.status(201).json(tg);
});

router.post("/target-groups/:id/targets", (req, res) => {
  const db = readDB();
  const tg = db.targetGroups.find((t) => t.id === req.params.id);
  if (!tg) return res.status(404).json({ error: "대상 그룹을 찾을 수 없어요." });
  const ids = [].concat(req.body.instanceIds || []);
  for (const id of ids) {
    const inst = db.instances.find((i) => i.id === id);
    if (!inst || inst.vpcId !== tg.vpcId) return res.status(400).json({ error: "대상 그룹과 같은 VPC의 인스턴스만 등록할 수 있어요." });
    if (!tg.targets.includes(id)) tg.targets.push(id);
  }
  writeDB(db);
  res.json(tgView(db, tg));
});

router.delete("/target-groups/:id/targets/:targetId", (req, res) => {
  const db = readDB();
  const tg = db.targetGroups.find((t) => t.id === req.params.id);
  if (!tg) return res.status(404).json({ error: "대상 그룹을 찾을 수 없어요." });
  tg.targets = tg.targets.filter((t) => t !== req.params.targetId);
  writeDB(db);
  res.json(tgView(db, tg));
});

router.delete("/target-groups/:id", (req, res) => {
  const db = readDB();
  const tg = db.targetGroups.find((t) => t.id === req.params.id);
  if (tg && tgView(db, tg).usedBy.length) return res.status(409).json({ error: "ResourceInUse: 리스너가 이 대상 그룹을 쓰고 있어요." });
  if (db.autoScalingGroups.some((a) => a.targetGroupIds.includes(req.params.id))) return res.status(409).json({ error: "Auto Scaling 그룹이 이 대상 그룹을 쓰고 있어요." });
  removeItem("targetGroups", req.params.id);
  res.json({ ok: true });
});

/* ===== 로드 밸런서 ===== */

function createLoadBalancer(db, b) {
  const type = b.type === "network" ? "network" : "application";
  const scheme = b.scheme === "internal" ? "internal" : "internet-facing";
  const subnetIds = b.subnetIds || [];
  if (!b.name) throw new Error("로드 밸런서 이름을 입력하세요.");
  if (db.loadBalancers.some((l) => l.name === b.name)) throw new Error("같은 이름의 로드 밸런서가 이미 있어요.");
  if (distinctAzCount(db, subnetIds) < 2) throw new Error("고가용성을 위해 서로 다른 가용 영역(AZ)의 서브넷을 2개 이상 골라야 해요.");
  if (scheme === "internet-facing" && !subnetIds.every((id) => isSubnetPublic(db, id))) {
    throw new Error("인터넷 연결(internet-facing) 로드 밸런서는 퍼블릭 서브넷에 두어야 해요.");
  }
  if (type === "application" && !(b.securityGroupIds || []).length) throw new Error("ALB는 보안 그룹이 필요해요 (예: 80/443 허용).");
  const vpcId = (db.subnets.find((s) => s.id === subnetIds[0]) || {}).vpcId;
  const lb = {
    id: makeId(type === "network" ? "net" : "app", 12),
    name: b.name,
    type,
    scheme,
    vpcId,
    subnetIds,
    securityGroupIds: type === "application" ? b.securityGroupIds : [],
    dnsName: `${scheme === "internal" ? "internal-" : ""}${b.name}-${randomHex(10)}.ap-northeast-2.elb.amazonaws.com`,
    listeners: [],
    managedBy: b.managedBy || null,
    state: "provisioning",
    createdAt: now(),
  };
  for (const ls of b.listeners || []) lb.listeners.push(makeListener(db, lb, ls));
  db.loadBalancers.push(lb);
  later(5000, "loadBalancers", lb.id, { state: "active" });
  return lb;
}

function makeListener(db, lb, ls) {
  const protocol = ls.protocol || (lb.type === "network" ? "TCP" : "HTTP");
  if (lb.type === "application" && !["HTTP", "HTTPS"].includes(protocol)) throw new Error("ALB 리스너는 HTTP/HTTPS만 가능해요 (L7).");
  if (lb.type === "network" && !["TCP", "UDP", "TLS"].includes(protocol)) throw new Error("NLB 리스너는 TCP/UDP/TLS만 가능해요 (L4).");
  if (protocol === "HTTPS" && !ls.certificate) throw new Error("HTTPS 리스너에는 인증서(ACM)가 필요해요.");
  const tg = db.targetGroups.find((t) => t.id === ls.targetGroupId);
  if (!tg) throw new Error("리스너가 트래픽을 보낼 대상 그룹을 선택하세요.");
  if (tg.vpcId !== lb.vpcId) throw new Error("대상 그룹은 로드 밸런서와 같은 VPC에 있어야 해요.");
  return {
    id: makeId("lsn", 10),
    protocol,
    port: Number(ls.port) || (protocol === "HTTPS" ? 443 : 80),
    certificate: ls.certificate || null,
    targetGroupId: tg.id,
    rules: (ls.rules || []).filter((r) => r.path && r.targetGroupId),
  };
}

router.get("/load-balancers", (req, res) => {
  const db = readDB();
  res.json(
    db.loadBalancers.map((lb) => {
      const tgs = lb.listeners.map((ls) => db.targetGroups.find((t) => t.id === ls.targetGroupId)).filter(Boolean);
      const health = tgs.flatMap((tg) => tg.targets.map((id) => targetHealth(db, tg, id).state));
      return { ...lb, healthy: health.filter((h) => h === "healthy").length, totalTargets: health.length };
    })
  );
});

router.post("/load-balancers", (req, res) => {
  const db = readDB();
  try {
    const lb = createLoadBalancer(db, req.body);
    writeDB(db);
    res.status(201).json(lb);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/load-balancers/:id/listeners", (req, res) => {
  const db = readDB();
  const lb = db.loadBalancers.find((l) => l.id === req.params.id);
  if (!lb) return res.status(404).json({ error: "로드 밸런서를 찾을 수 없어요." });
  try {
    const ls = makeListener(db, lb, req.body);
    if (lb.listeners.some((x) => x.port === ls.port)) throw new Error(`포트 ${ls.port} 리스너가 이미 있어요.`);
    lb.listeners.push(ls);
    writeDB(db);
    res.status(201).json(lb);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/load-balancers/:id/listeners/:lsId/rules", (req, res) => {
  const db = readDB();
  const lb = db.loadBalancers.find((l) => l.id === req.params.id);
  const ls = lb && lb.listeners.find((x) => x.id === req.params.lsId);
  if (!ls) return res.status(404).json({ error: "리스너를 찾을 수 없어요." });
  if (lb.type !== "application") return res.status(400).json({ error: "경로 기반 라우팅 규칙은 ALB(L7)에서만 가능해요." });
  const { path, targetGroupId } = req.body;
  if (!path || !path.startsWith("/")) return res.status(400).json({ error: "경로는 /로 시작해야 해요. 예: /api/*" });
  if (!db.targetGroups.some((t) => t.id === targetGroupId)) return res.status(400).json({ error: "대상 그룹을 선택하세요." });
  ls.rules = ls.rules || [];
  ls.rules.push({ id: makeId("rule", 8), path, targetGroupId });
  writeDB(db);
  res.status(201).json(lb);
});

router.delete("/load-balancers/:id/listeners/:lsId", (req, res) => {
  const db = readDB();
  const lb = db.loadBalancers.find((l) => l.id === req.params.id);
  if (!lb) return res.status(404).json({ error: "로드 밸런서를 찾을 수 없어요." });
  lb.listeners = lb.listeners.filter((x) => x.id !== req.params.lsId);
  writeDB(db);
  res.json(lb);
});

router.delete("/load-balancers/:id", (req, res) => {
  const db = readDB();
  const lb = db.loadBalancers.find((l) => l.id === req.params.id);
  if (!lb) return res.status(404).json({ error: "로드 밸런서를 찾을 수 없어요." });
  if (lb.managedBy && !req.query.force) {
    return res.status(409).json({ error: `쿠버네티스 ${lb.managedBy.type === "ingress" ? "Ingress" : "Service"}가 관리하는 로드 밸런서예요. 해당 리소스를 지우면 함께 삭제돼요.` });
  }
  if (db.cloudfrontDistributions.some((c) => c.originId === lb.id)) return res.status(409).json({ error: "CloudFront 배포가 이 로드 밸런서를 원본으로 쓰고 있어요." });
  removeItem("loadBalancers", lb.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.targetHealth = targetHealth;
module.exports.createLoadBalancer = createLoadBalancer;
