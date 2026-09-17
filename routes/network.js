/* ---- VPC 심화: 탄력적 IP / NAT 게이트웨이 / VPN / Direct Connect ---- */
const express = require("express");
const { readDB, writeDB, later, removeItem } = require("../lib/store");
const { makeId, randomPublicIp, randomHex } = require("../lib/ids");
const { isSubnetPublic } = require("../lib/net");

const router = express.Router();
const now = () => new Date().toISOString();

/* ===== 탄력적 IP (Elastic IP) ===== */
// 인스턴스를 껐다 켜도 바뀌지 않는 고정 퍼블릭 IP. 연결 안 한 채로 두면 비용이 나가요.

router.get("/elastic-ips", (req, res) => res.json(readDB().elasticIps));

router.post("/elastic-ips", (req, res) => {
  const db = readDB();
  const eip = {
    id: makeId("eipalloc"),
    name: req.body.name || "",
    publicIp: randomPublicIp(),
    instanceId: null,
    natGatewayId: null,
    createdAt: now(),
  };
  db.elasticIps.push(eip);
  writeDB(db);
  res.status(201).json(eip);
});

router.post("/elastic-ips/:id/associate", (req, res) => {
  const db = readDB();
  const eip = db.elasticIps.find((e) => e.id === req.params.id);
  const inst = db.instances.find((i) => i.id === req.body.instanceId);
  if (!eip) return res.status(404).json({ error: "탄력적 IP를 찾을 수 없어요." });
  if (eip.natGatewayId) return res.status(409).json({ error: "NAT 게이트웨이가 사용 중인 IP예요." });
  if (!inst || inst.state === "terminated") return res.status(400).json({ error: "연결할 인스턴스를 선택하세요." });
  if (!isSubnetPublic(db, inst.subnetId)) {
    return res.status(400).json({ error: "퍼블릭 서브넷(IGW 라우트가 있는 서브넷)의 인스턴스에만 연결해야 인터넷에서 접근할 수 있어요." });
  }
  // 기존 연결 정리 후 새로 연결
  db.elasticIps.forEach((e) => {
    if (e.instanceId === inst.id) e.instanceId = null;
  });
  eip.instanceId = inst.id;
  inst.elasticIp = eip.publicIp;
  if (inst.state === "running") inst.publicIp = eip.publicIp;
  writeDB(db);
  res.json(eip);
});

router.post("/elastic-ips/:id/disassociate", (req, res) => {
  const db = readDB();
  const eip = db.elasticIps.find((e) => e.id === req.params.id);
  if (!eip) return res.status(404).json({ error: "탄력적 IP를 찾을 수 없어요." });
  const inst = db.instances.find((i) => i.id === eip.instanceId);
  if (inst) {
    inst.elasticIp = null;
    inst.publicIp = inst.state === "running" ? randomPublicIp() : null;
  }
  eip.instanceId = null;
  writeDB(db);
  res.json(eip);
});

router.delete("/elastic-ips/:id", (req, res) => {
  const db = readDB();
  const eip = db.elasticIps.find((e) => e.id === req.params.id);
  if (eip && (eip.instanceId || eip.natGatewayId)) {
    return res.status(409).json({ error: "연결된 상태에서는 해제(릴리스)할 수 없어요. 먼저 연결을 끊으세요." });
  }
  removeItem("elasticIps", req.params.id);
  res.json({ ok: true });
});

/* ===== NAT 게이트웨이 ===== */
// 프라이빗 서브넷의 서버가 "나가는" 인터넷 통신만 할 수 있게 해 주는 관문.
// 퍼블릭 서브넷에 만들고, 프라이빗 서브넷의 라우팅 테이블에 0.0.0.0/0 → nat 라우트를 넣어요.

router.get("/nat-gateways", (req, res) => res.json(readDB().natGateways));

router.post("/nat-gateways", (req, res) => {
  const { name, subnetId, connectivity } = req.body;
  const db = readDB();
  const subnet = db.subnets.find((s) => s.id === subnetId);
  if (!subnet) return res.status(400).json({ error: "NAT 게이트웨이를 둘 서브넷을 선택하세요." });
  const isPublicType = connectivity !== "private";
  if (isPublicType && !isSubnetPublic(db, subnetId)) {
    return res.status(400).json({
      error: "퍼블릭 NAT 게이트웨이는 퍼블릭 서브넷(IGW 라우트가 있는 서브넷)에 만들어야 인터넷으로 나갈 수 있어요.",
    });
  }
  const nat = {
    id: makeId("nat"),
    name: name || "nat-gateway",
    vpcId: subnet.vpcId,
    subnetId,
    availabilityZone: subnet.availabilityZone,
    connectivity: isPublicType ? "public" : "private",
    elasticIpId: null,
    publicIp: null,
    state: "pending",
    createdAt: now(),
  };
  if (isPublicType) {
    const eip = { id: makeId("eipalloc"), name: `${nat.name}-eip`, publicIp: randomPublicIp(), instanceId: null, natGatewayId: nat.id, createdAt: now() };
    db.elasticIps.push(eip);
    nat.elasticIpId = eip.id;
    nat.publicIp = eip.publicIp;
  }
  db.natGateways.push(nat);
  writeDB(db);
  later(5000, "natGateways", nat.id, { state: "available" });
  res.status(201).json(nat);
});

router.delete("/nat-gateways/:id", (req, res) => {
  const db = readDB();
  const nat = db.natGateways.find((n) => n.id === req.params.id);
  if (!nat) return res.status(404).json({ error: "NAT 게이트웨이를 찾을 수 없어요." });
  nat.state = "deleting";
  writeDB(db);
  setTimeout(() => {
    const d = readDB();
    // 탄력적 IP는 계정에 남음 (직접 해제해야 과금이 멈춤)
    d.elasticIps.forEach((e) => {
      if (e.natGatewayId === nat.id) e.natGatewayId = null;
    });
    d.natGateways = d.natGateways.filter((n) => n.id !== nat.id);
    writeDB(d);
  }, 3000);
  res.json({ ok: true, note: "이 NAT를 가리키던 라우트는 blackhole 상태가 됩니다." });
});

/* ===== 하이브리드 연결: 가상 프라이빗 게이트웨이 / 고객 게이트웨이 / Site-to-Site VPN ===== */

router.get("/vpn-gateways", (req, res) => res.json(readDB().vpnGateways));

router.post("/vpn-gateways", (req, res) => {
  const db = readDB();
  const vgw = { id: makeId("vgw"), name: req.body.name || "vgw", asn: Number(req.body.asn) || 64512, vpcId: null, state: "detached", createdAt: now() };
  db.vpnGateways.push(vgw);
  writeDB(db);
  res.status(201).json(vgw);
});

router.post("/vpn-gateways/:id/attach", (req, res) => {
  const db = readDB();
  const vgw = db.vpnGateways.find((v) => v.id === req.params.id);
  if (!vgw) return res.status(404).json({ error: "가상 프라이빗 게이트웨이를 찾을 수 없어요." });
  if (!db.vpcs.some((v) => v.id === req.body.vpcId)) return res.status(400).json({ error: "VPC를 선택하세요." });
  if (db.vpnGateways.some((v) => v.vpcId === req.body.vpcId)) return res.status(409).json({ error: "이 VPC에는 이미 VGW가 연결돼 있어요 (VPC당 1개)." });
  vgw.vpcId = req.body.vpcId;
  vgw.state = "attached";
  writeDB(db);
  res.json(vgw);
});

router.post("/vpn-gateways/:id/detach", (req, res) => {
  const db = readDB();
  const vgw = db.vpnGateways.find((v) => v.id === req.params.id);
  if (!vgw) return res.status(404).json({ error: "가상 프라이빗 게이트웨이를 찾을 수 없어요." });
  if (db.vpnConnections.some((c) => c.vgwId === vgw.id)) return res.status(409).json({ error: "이 VGW를 쓰는 VPN 연결을 먼저 삭제하세요." });
  vgw.vpcId = null;
  vgw.state = "detached";
  writeDB(db);
  res.json(vgw);
});

router.delete("/vpn-gateways/:id", (req, res) => {
  const db = readDB();
  const vgw = db.vpnGateways.find((v) => v.id === req.params.id);
  if (vgw && vgw.vpcId) return res.status(409).json({ error: "먼저 VPC에서 분리하세요." });
  removeItem("vpnGateways", req.params.id);
  res.json({ ok: true });
});

router.get("/customer-gateways", (req, res) => res.json(readDB().customerGateways));

router.post("/customer-gateways", (req, res) => {
  const { name, ipAddress, bgpAsn } = req.body;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ipAddress || "")) return res.status(400).json({ error: "온프레미스 장비의 퍼블릭 IP를 입력하세요. 예: 203.0.113.10" });
  const db = readDB();
  const cgw = { id: makeId("cgw"), name: name || "on-prem-router", ipAddress, bgpAsn: Number(bgpAsn) || 65000, state: "available", createdAt: now() };
  db.customerGateways.push(cgw);
  writeDB(db);
  res.status(201).json(cgw);
});

router.delete("/customer-gateways/:id", (req, res) => {
  const db = readDB();
  if (db.vpnConnections.some((c) => c.cgwId === req.params.id)) return res.status(409).json({ error: "이 고객 게이트웨이를 쓰는 VPN 연결이 있어요." });
  removeItem("customerGateways", req.params.id);
  res.json({ ok: true });
});

router.get("/vpn-connections", (req, res) => res.json(readDB().vpnConnections));

router.post("/vpn-connections", (req, res) => {
  const { name, vgwId, cgwId, onPremCidr } = req.body;
  const db = readDB();
  const vgw = db.vpnGateways.find((v) => v.id === vgwId);
  if (!vgw || !vgw.vpcId) return res.status(400).json({ error: "VPC에 연결된 가상 프라이빗 게이트웨이를 선택하세요." });
  if (!db.customerGateways.some((c) => c.id === cgwId)) return res.status(400).json({ error: "고객 게이트웨이를 선택하세요." });
  const conn = {
    id: makeId("vpn"),
    name: name || "site-to-site-vpn",
    vgwId,
    cgwId,
    vpcId: vgw.vpcId,
    onPremCidr: onPremCidr || "192.168.0.0/16",
    // 가용성을 위해 터널은 항상 2개
    tunnels: [
      { outsideIp: randomPublicIp(), status: "DOWN" },
      { outsideIp: randomPublicIp(), status: "DOWN" },
    ],
    state: "pending",
    createdAt: now(),
  };
  db.vpnConnections.push(conn);
  writeDB(db);
  later(6000, "vpnConnections", conn.id, (c) => ({ state: "available", tunnels: c.tunnels.map((t) => ({ ...t, status: "UP" })) }));
  res.status(201).json(conn);
});

router.delete("/vpn-connections/:id", (req, res) => {
  removeItem("vpnConnections", req.params.id);
  res.json({ ok: true });
});

/* ===== AWS Direct Connect (전용선) ===== */

router.get("/dx-connections", (req, res) => res.json(readDB().dxConnections));

router.post("/dx-connections", (req, res) => {
  const { name, location, bandwidth } = req.body;
  const db = readDB();
  const dx = {
    id: `dxcon-${randomHex(8)}`,
    name: name || "dx-connection",
    location: location || "KINX 가산 (Seoul)",
    bandwidth: bandwidth === "10Gbps" ? "10Gbps" : "1Gbps",
    state: "ordering",
    createdAt: now(),
  };
  db.dxConnections.push(dx);
  writeDB(db);
  // 실제로는 수 주가 걸리는 물리 회선 작업 — 여기선 몇 초로 단축
  later(4000, "dxConnections", dx.id, { state: "pending" });
  later(9000, "dxConnections", dx.id, { state: "available" });
  res.status(201).json(dx);
});

router.delete("/dx-connections/:id", (req, res) => {
  removeItem("dxConnections", req.params.id);
  res.json({ ok: true });
});

module.exports = router;
