/* ---- VPC 서비스: VPC / 서브넷 / 라우팅 테이블 / 보안 그룹 / 네트워크 ACL / 인터넷 게이트웨이 ---- */
// 실제 AWS 콘솔에서도 이 여섯 가지는 전부 "VPC" 서비스 메뉴 밑에 같이 있어요.
const express = require("express");
const { readDB, writeDB } = require("../lib/store");
const { newVpcId, newSubnetId, newSgId, newIgwId, newRouteTableId, newNaclId } = require("../lib/ids");
const { subnetView } = require("../lib/net");

const router = express.Router();

/* ===== VPC ===== */

router.get("/vpcs", (req, res) => {
  res.json(readDB().vpcs);
});

router.post("/vpcs", (req, res) => {
  const { name, cidrBlock } = req.body;
  if (!name || !cidrBlock) {
    return res.status(400).json({ error: "name과 cidrBlock은 필수입니다." });
  }
  const db = readDB();
  const vpc = {
    id: newVpcId(),
    name,
    cidrBlock,
    state: "available",
    createdAt: new Date().toISOString(),
  };
  db.vpcs.push(vpc);

  // 실제 AWS처럼: VPC를 만들면 "메인 라우팅 테이블"이 로컬 라우트와 함께 자동 생성됩니다.
  db.routeTables.push({
    id: newRouteTableId(),
    vpcId: vpc.id,
    name: `${name}-main-rtb`,
    isMain: true,
    subnetIds: [],
    routes: [{ id: `rt-${Date.now()}`, destination: cidrBlock, target: "local" }],
    createdAt: new Date().toISOString(),
  });

  writeDB(db);
  res.status(201).json(vpc);
});

router.delete("/vpcs/:id", (req, res) => {
  const db = readDB();
  const { id } = req.params;

  const dependents = [
    ...db.subnets.filter((s) => s.vpcId === id),
    ...db.securityGroups.filter((sg) => sg.vpcId === id),
    ...db.instances.filter((i) => i.vpcId === id && i.state !== "terminated"),
    ...db.internetGateways.filter((g) => g.vpcId === id && g.state === "attached"),
    ...db.natGateways.filter((n) => n.vpcId === id),
    ...db.loadBalancers.filter((l) => l.vpcId === id),
    ...db.eksClusters.filter((c) => c.vpcId === id),
    ...db.vpnGateways.filter((v) => v.vpcId === id),
    ...db.dbInstances.filter((d) => d.vpcId === id),
  ];
  if (dependents.length > 0) {
    return res.status(409).json({
      error: `DependencyViolation: 이 VPC를 사용 중인 리소스 ${dependents.length}개(서브넷·보안 그룹·인스턴스·게이트웨이·로드 밸런서 등)가 남아있어 삭제할 수 없습니다.`,
    });
  }

  db.vpcs = db.vpcs.filter((v) => v.id !== id);
  db.routeTables = db.routeTables.filter((rt) => rt.vpcId !== id);
  db.nacls = db.nacls.filter((n) => n.vpcId !== id);
  writeDB(db);
  res.json({ ok: true });
});

/* ===== 서브넷 ===== */

router.get("/subnets", (req, res) => {
  const db = readDB();
  const { vpcId } = req.query;
  const subnets = vpcId ? db.subnets.filter((s) => s.vpcId === vpcId) : db.subnets;
  res.json(subnets.map((s) => subnetView(db, s)));
});

router.post("/subnets", (req, res) => {
  const { vpcId, name, cidrBlock, availabilityZone } = req.body;
  const db = readDB();
  const vpc = db.vpcs.find((v) => v.id === vpcId);
  if (!vpc) {
    return res.status(400).json({ error: "존재하지 않는 VPC입니다." });
  }
  if (!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(cidrBlock || "")) {
    return res.status(400).json({ error: "CIDR 형식이 올바르지 않아요. 예: 10.0.1.0/24" });
  }
  const bits = Number(cidrBlock.split("/")[1]);
  if (bits < 16 || bits > 28) {
    return res.status(400).json({ error: "서브넷 크기는 /16 ~ /28 사이여야 해요 (AWS 제한)." });
  }
  if (db.subnets.some((s) => s.vpcId === vpcId && s.cidrBlock === cidrBlock)) {
    return res.status(409).json({ error: "같은 VPC 안에 이미 같은 CIDR의 서브넷이 있어요 (CIDR 충돌)." });
  }
  const subnet = {
    id: newSubnetId(),
    vpcId,
    name,
    cidrBlock,
    availabilityZone: availabilityZone || "ap-northeast-2a",
    state: "available",
    createdAt: new Date().toISOString(),
  };
  db.subnets.push(subnet);

  // 실제 AWS처럼: 새 서브넷은 별도로 연결하지 않으면 VPC의 메인 라우팅 테이블에 자동 연결됩니다.
  const mainRt = db.routeTables.find((rt) => rt.vpcId === vpcId && rt.isMain);
  if (mainRt) mainRt.subnetIds.push(subnet.id);

  writeDB(db);
  res.status(201).json(subnet);
});

router.delete("/subnets/:id", (req, res) => {
  const db = readDB();
  const id = req.params.id;
  const inUse =
    db.instances.some((i) => i.subnetId === id && i.state !== "terminated") ||
    db.natGateways.some((n) => n.subnetId === id) ||
    db.loadBalancers.some((l) => l.subnetIds.includes(id)) ||
    db.efsFileSystems.some((f) => f.mountTargets.some((m) => m.subnetId === id));
  if (inUse) {
    return res.status(409).json({ error: "DependencyViolation: 이 서브넷에 인스턴스·NAT·로드 밸런서·EFS 탑재 대상이 남아 있어요." });
  }
  db.subnets = db.subnets.filter((s) => s.id !== req.params.id);
  db.routeTables.forEach((rt) => (rt.subnetIds = rt.subnetIds.filter((id) => id !== req.params.id)));
  db.nacls.forEach((n) => (n.subnetIds = n.subnetIds.filter((id) => id !== req.params.id)));
  writeDB(db);
  res.json({ ok: true });
});


/* ===== 인터넷 게이트웨이 ===== */

router.get("/internet-gateways", (req, res) => {
  const db = readDB();
  const { vpcId } = req.query;
  const list = vpcId ? db.internetGateways.filter((g) => g.vpcId === vpcId) : db.internetGateways;
  res.json(list);
});

router.post("/internet-gateways", (req, res) => {
  const { name } = req.body;
  const db = readDB();
  const igw = { id: newIgwId(), name: name || "igw", vpcId: null, state: "detached", createdAt: new Date().toISOString() };
  db.internetGateways.push(igw);
  writeDB(db);
  res.status(201).json(igw);
});

router.post("/internet-gateways/:id/attach", (req, res) => {
  const { vpcId } = req.body;
  const db = readDB();
  const igw = db.internetGateways.find((g) => g.id === req.params.id);
  if (!igw) return res.status(404).json({ error: "게이트웨이를 찾을 수 없습니다." });
  if (!db.vpcs.find((v) => v.id === vpcId)) return res.status(400).json({ error: "존재하지 않는 VPC입니다." });
  if (db.internetGateways.find((g) => g.vpcId === vpcId && g.state === "attached")) {
    return res.status(409).json({ error: "이 VPC에는 이미 연결된 인터넷 게이트웨이가 있습니다 (VPC당 1개 제한)." });
  }
  igw.vpcId = vpcId;
  igw.state = "attached";
  writeDB(db);
  res.json(igw);
});

router.post("/internet-gateways/:id/detach", (req, res) => {
  const db = readDB();
  const igw = db.internetGateways.find((g) => g.id === req.params.id);
  if (!igw) return res.status(404).json({ error: "게이트웨이를 찾을 수 없습니다." });
  igw.vpcId = null;
  igw.state = "detached";
  writeDB(db);
  res.json(igw);
});

router.delete("/internet-gateways/:id", (req, res) => {
  const db = readDB();
  const igw = db.internetGateways.find((g) => g.id === req.params.id);
  if (igw && igw.state === "attached") {
    return res.status(409).json({ error: "먼저 VPC에서 분리(detach)해야 삭제할 수 있습니다." });
  }
  db.internetGateways = db.internetGateways.filter((g) => g.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

/* ===== 라우팅 테이블 ===== */

router.get("/route-tables", (req, res) => {
  const db = readDB();
  const { vpcId } = req.query;
  res.json(vpcId ? db.routeTables.filter((rt) => rt.vpcId === vpcId) : db.routeTables);
});

router.post("/route-tables", (req, res) => {
  const { vpcId, name } = req.body;
  const db = readDB();
  const vpc = db.vpcs.find((v) => v.id === vpcId);
  if (!vpc) return res.status(400).json({ error: "존재하지 않는 VPC입니다." });
  const rt = {
    id: newRouteTableId(),
    vpcId,
    name,
    isMain: false,
    subnetIds: [],
    routes: [{ id: `rt-${Date.now()}`, destination: vpc.cidrBlock, target: "local" }],
    createdAt: new Date().toISOString(),
  };
  db.routeTables.push(rt);
  writeDB(db);
  res.status(201).json(rt);
});

router.post("/route-tables/:id/routes", (req, res) => {
  const { destination, target } = req.body;
  const db = readDB();
  const rt = db.routeTables.find((r) => r.id === req.params.id);
  if (!rt) return res.status(404).json({ error: "라우팅 테이블을 찾을 수 없습니다." });
  if (!destination || !target) return res.status(400).json({ error: "대상 CIDR과 타깃을 모두 입력하세요." });
  if (rt.routes.some((r) => r.destination === destination)) {
    return res.status(409).json({ error: `이미 ${destination} 라우트가 있어요. 같은 대상은 하나만 둘 수 있어요.` });
  }
  const exists =
    (target.startsWith("igw-") && db.internetGateways.some((g) => g.id === target && g.vpcId === rt.vpcId)) ||
    (target.startsWith("nat-") && db.natGateways.some((n) => n.id === target && n.vpcId === rt.vpcId)) ||
    (target.startsWith("vgw-") && db.vpnGateways.some((v) => v.id === target && v.vpcId === rt.vpcId));
  if (!exists) return res.status(400).json({ error: "이 VPC에 연결된 게이트웨이만 타깃으로 쓸 수 있어요." });
  rt.routes.push({ id: `rt-${Date.now()}`, destination, target });
  writeDB(db);
  res.status(201).json(rt);
});

router.delete("/route-tables/:id/routes/:routeId", (req, res) => {
  const db = readDB();
  const rt = db.routeTables.find((r) => r.id === req.params.id);
  if (!rt) return res.status(404).json({ error: "라우팅 테이블을 찾을 수 없습니다." });
  rt.routes = rt.routes.filter((r) => r.id !== req.params.routeId || r.target === "local");
  writeDB(db);
  res.json(rt);
});

router.post("/route-tables/:id/associate", (req, res) => {
  const { subnetId } = req.body;
  const db = readDB();
  const rt = db.routeTables.find((r) => r.id === req.params.id);
  if (!rt) return res.status(404).json({ error: "라우팅 테이블을 찾을 수 없습니다." });
  // 서브넷 하나는 동시에 하나의 라우팅 테이블에만 연결됩니다.
  db.routeTables.forEach((other) => (other.subnetIds = other.subnetIds.filter((id) => id !== subnetId)));
  rt.subnetIds.push(subnetId);
  writeDB(db);
  res.json(rt);
});

router.delete("/route-tables/:id", (req, res) => {
  const db = readDB();
  const rt = db.routeTables.find((r) => r.id === req.params.id);
  if (rt && rt.subnetIds.length > 0) {
    return res.status(409).json({ error: "이 라우팅 테이블에 연결된 서브넷이 있어 삭제할 수 없습니다." });
  }
  if (rt && rt.isMain) {
    return res.status(409).json({ error: "메인 라우팅 테이블은 삭제할 수 없습니다." });
  }
  db.routeTables = db.routeTables.filter((r) => r.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

/* ===== 보안 그룹 (인스턴스 레벨, Stateful) ===== */

router.get("/security-groups", (req, res) => {
  const db = readDB();
  const { vpcId } = req.query;
  res.json(vpcId ? db.securityGroups.filter((sg) => sg.vpcId === vpcId) : db.securityGroups);
});

router.post("/security-groups", (req, res) => {
  const { vpcId, name, description } = req.body;
  const db = readDB();
  if (!db.vpcs.find((v) => v.id === vpcId)) {
    return res.status(400).json({ error: "존재하지 않는 VPC입니다." });
  }
  const sg = {
    id: newSgId(),
    vpcId,
    name,
    description: description || "",
    inboundRules: [],
    createdAt: new Date().toISOString(),
  };
  db.securityGroups.push(sg);
  writeDB(db);
  res.status(201).json(sg);
});

router.post("/security-groups/:id/rules", (req, res) => {
  const { protocol, port, source } = req.body;
  const db = readDB();
  const sg = db.securityGroups.find((s) => s.id === req.params.id);
  if (!sg) return res.status(404).json({ error: "보안 그룹을 찾을 수 없습니다." });
  const src = source || "0.0.0.0/0";
  // 보안 그룹 체이닝: 소스에 IP 대역 대신 다른 보안 그룹 ID를 넣을 수 있음
  if (src.startsWith("sg-")) {
    const ref = db.securityGroups.find((x) => x.id === src);
    if (!ref) return res.status(400).json({ error: "소스로 지정한 보안 그룹이 없어요." });
    if (ref.vpcId !== sg.vpcId) return res.status(400).json({ error: "같은 VPC의 보안 그룹만 소스로 참조할 수 있어요." });
  } else if (!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(src)) {
    return res.status(400).json({ error: "소스는 CIDR(예: 0.0.0.0/0) 또는 보안 그룹 ID(sg-...)여야 해요." });
  }
  sg.inboundRules.push({
    id: `sgr-${Date.now()}`,
    protocol: protocol || "tcp",
    port,
    source: src,
    description: req.body.description || "",
  });
  writeDB(db);
  res.status(201).json(sg);
});

router.delete("/security-groups/:id/rules/:ruleId", (req, res) => {
  const db = readDB();
  const sg = db.securityGroups.find((s) => s.id === req.params.id);
  if (!sg) return res.status(404).json({ error: "보안 그룹을 찾을 수 없습니다." });
  sg.inboundRules = sg.inboundRules.filter((r) => r.id !== req.params.ruleId);
  writeDB(db);
  res.json(sg);
});

router.delete("/security-groups/:id", (req, res) => {
  const db = readDB();
  const id = req.params.id;
  const referencedBy = db.securityGroups.filter((x) => x.id !== id && x.inboundRules.some((r) => r.source === id));
  if (referencedBy.length) {
    return res.status(409).json({ error: `DependencyViolation: 보안 그룹 ${referencedBy.map((x) => x.name).join(", ")}의 규칙이 이 그룹을 참조하고 있어요.` });
  }
  const used =
    db.instances.some((i) => i.securityGroupId === id && i.state !== "terminated") ||
    db.loadBalancers.some((l) => (l.securityGroupIds || []).includes(id));
  if (used) return res.status(409).json({ error: "DependencyViolation: 이 보안 그룹을 쓰는 인스턴스나 로드 밸런서가 있어요." });
  db.securityGroups = db.securityGroups.filter((s) => s.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

/* ===== 네트워크 ACL (서브넷 경계 레벨, Stateless) ===== */

router.get("/nacls", (req, res) => {
  const db = readDB();
  const { vpcId } = req.query;
  res.json(vpcId ? db.nacls.filter((n) => n.vpcId === vpcId) : db.nacls);
});

router.post("/nacls", (req, res) => {
  const { vpcId, name } = req.body;
  const db = readDB();
  if (!db.vpcs.find((v) => v.id === vpcId)) {
    return res.status(400).json({ error: "존재하지 않는 VPC입니다." });
  }
  const nacl = {
    id: newNaclId(),
    vpcId,
    name,
    subnetIds: [],
    rules: [],
    createdAt: new Date().toISOString(),
  };
  db.nacls.push(nacl);
  writeDB(db);
  res.status(201).json(nacl);
});

router.post("/nacls/:id/rules", (req, res) => {
  const { ruleNumber, direction, protocol, port, cidr, action } = req.body;
  const db = readDB();
  const nacl = db.nacls.find((n) => n.id === req.params.id);
  if (!nacl) return res.status(404).json({ error: "네트워크 ACL을 찾을 수 없습니다." });
  nacl.rules.push({
    id: `nr-${Date.now()}`,
    ruleNumber: Number(ruleNumber) || 100,
    direction: direction === "outbound" ? "outbound" : "inbound",
    protocol: protocol || "tcp",
    port,
    cidr: cidr || "0.0.0.0/0",
    action: action === "deny" ? "deny" : "allow",
  });
  nacl.rules.sort((a, b) => a.ruleNumber - b.ruleNumber);
  writeDB(db);
  res.status(201).json(nacl);
});

router.delete("/nacls/:id/rules/:ruleId", (req, res) => {
  const db = readDB();
  const nacl = db.nacls.find((n) => n.id === req.params.id);
  if (!nacl) return res.status(404).json({ error: "네트워크 ACL을 찾을 수 없습니다." });
  nacl.rules = nacl.rules.filter((r) => r.id !== req.params.ruleId);
  writeDB(db);
  res.json(nacl);
});

router.post("/nacls/:id/associate", (req, res) => {
  const { subnetId } = req.body;
  const db = readDB();
  const nacl = db.nacls.find((n) => n.id === req.params.id);
  if (!nacl) return res.status(404).json({ error: "네트워크 ACL을 찾을 수 없습니다." });
  db.nacls.forEach((other) => (other.subnetIds = other.subnetIds.filter((id) => id !== subnetId)));
  nacl.subnetIds.push(subnetId);
  writeDB(db);
  res.json(nacl);
});

router.delete("/nacls/:id", (req, res) => {
  const db = readDB();
  const nacl = db.nacls.find((n) => n.id === req.params.id);
  if (nacl && nacl.subnetIds.length > 0) {
    return res.status(409).json({ error: "이 네트워크 ACL에 연결된 서브넷이 있어 삭제할 수 없습니다." });
  }
  db.nacls = db.nacls.filter((n) => n.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
