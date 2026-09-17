/* ---- 데이터 계층: RDS / ElastiCache / EFS ---- */
const express = require("express");
const { readDB, writeDB, patchItem, later, removeItem } = require("../lib/store");
const { newDbInstanceId, makeId, randomHex, randomPrivateIp } = require("../lib/ids");
const { isSubnetPublic, distinctAzCount } = require("../lib/net");

const router = express.Router();
const now = () => new Date().toISOString();

const CREATING_MS = 6000;
const DELETING_MS = 3000;
const ENGINE_VERSIONS = { postgres: ["17.4", "16.8"], mysql: ["8.4.4", "8.0.41"], mariadb: ["11.4.5"] };
const DEFAULT_PORT = { postgres: 5432, mysql: 3306, mariadb: 3306 };

function safeDb(d) {
  const { masterPassword, ...rest } = d; // 비밀번호는 목록 응답에서 절대 내려주지 않음
  return rest;
}

/* ===== RDS ===== */

router.get("/db-instances", (req, res) => res.json(readDB().dbInstances.map(safeDb)));

router.post("/db-instances", (req, res) => {
  const b = req.body;
  const db = readDB();
  if (!b.identifier || !b.masterUsername || !b.masterPassword) {
    return res.status(400).json({ error: "DB 식별자, 마스터 사용자명, 비밀번호는 필수입니다." });
  }
  if (!/^[a-zA-Z][a-zA-Z0-9-]{0,62}$/.test(b.identifier)) return res.status(400).json({ error: "식별자는 영문자로 시작하고 영문·숫자·하이픈만 쓸 수 있어요." });
  if (String(b.masterPassword).length < 8) return res.status(400).json({ error: "마스터 비밀번호는 8자 이상이어야 해요." });
  if (db.dbInstances.find((i) => i.identifier === b.identifier)) {
    return res.status(409).json({ error: "DBInstanceAlreadyExists: 이미 존재하는 DB 인스턴스 식별자입니다." });
  }
  const engine = ENGINE_VERSIONS[b.engine] ? b.engine : "postgres";
  const subnetIds = b.subnetIds || [];
  // DB 서브넷 그룹: 최소 2개 AZ에 걸친 서브넷이 필요 (Multi-AZ가 아니어도 AWS 요구사항)
  if (b.vpcId && distinctAzCount(db, subnetIds) < 2) {
    return res.status(400).json({ error: "DB 서브넷 그룹에는 서로 다른 가용 영역의 서브넷이 최소 2개 필요해요." });
  }
  if (b.publiclyAccessible && !subnetIds.some((id) => isSubnetPublic(db, id))) {
    return res.status(400).json({ error: "퍼블릭 액세스를 켜려면 서브넷 그룹에 퍼블릭 서브넷이 있어야 해요. 보통 DB는 프라이빗에 두고 퍼블릭 액세스를 끄는 걸 권장해요." });
  }
  const azs = [...new Set(subnetIds.map((id) => (db.subnets.find((s) => s.id === id) || {}).availabilityZone).filter(Boolean))].sort();
  const dbInstance = {
    id: newDbInstanceId(),
    identifier: b.identifier,
    engine,
    engineVersion: ENGINE_VERSIONS[engine].includes(b.engineVersion) ? b.engineVersion : ENGINE_VERSIONS[engine][0],
    instanceClass: b.instanceClass || "db.t3.micro",
    allocatedStorage: Number(b.allocatedStorage) || 20,
    storageType: b.storageType || "gp3",
    masterUsername: b.masterUsername,
    masterPassword: b.masterPassword, // 저장은 하되 목록 조회 시엔 절대 안 내려줌
    vpcId: b.vpcId || null,
    subnetIds,
    securityGroupId: b.securityGroupId || null,
    publiclyAccessible: !!b.publiclyAccessible,
    multiAz: !!b.multiAz,
    primaryAz: azs[0] || "ap-northeast-2a",
    standbyAz: b.multiAz ? azs[1] || "ap-northeast-2c" : null,
    backupRetentionDays: Number(b.backupRetentionDays) >= 0 ? Number(b.backupRetentionDays) : 7,
    encrypted: b.encrypted !== false,
    deletionProtection: !!b.deletionProtection,
    state: "creating",
    endpoint: null,
    port: DEFAULT_PORT[engine],
    events: [{ t: now(), text: "DB 인스턴스 생성 시작" }],
    createdAt: now(),
  };
  db.dbInstances.push(dbInstance);
  writeDB(db);
  later(CREATING_MS, "dbInstances", dbInstance.id, (d) => ({
    state: "available",
    endpoint: `${d.identifier}.${randomHex(12)}.ap-northeast-2.rds.amazonaws.com`,
    events: [{ t: now(), text: "DB 인스턴스 사용 가능" }, ...d.events],
  }));
  res.status(201).json(safeDb(dbInstance));
});

router.post("/db-instances/:id/modify", (req, res) => {
  const db = readDB();
  const d = db.dbInstances.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "DB 인스턴스를 찾을 수 없어요." });
  if (d.state !== "available") return res.status(409).json({ error: "사용 가능(available) 상태에서만 수정할 수 있어요." });
  const patch = {};
  if (req.body.multiAz !== undefined) {
    patch.multiAz = !!req.body.multiAz;
    const azs = [...new Set(d.subnetIds.map((id) => (db.subnets.find((s) => s.id === id) || {}).availabilityZone).filter(Boolean))].sort();
    patch.standbyAz = patch.multiAz ? azs.find((a) => a !== d.primaryAz) || "ap-northeast-2c" : null;
  }
  if (req.body.instanceClass) patch.instanceClass = req.body.instanceClass;
  if (req.body.allocatedStorage) {
    if (Number(req.body.allocatedStorage) < d.allocatedStorage) return res.status(400).json({ error: "스토리지는 늘리기만 가능해요." });
    patch.allocatedStorage = Number(req.body.allocatedStorage);
  }
  if (req.body.deletionProtection !== undefined) patch.deletionProtection = !!req.body.deletionProtection;
  d.state = "modifying";
  d.events.unshift({ t: now(), text: `수정 시작: ${Object.keys(patch).join(", ")}` });
  writeDB(db);
  later(4000, "dbInstances", d.id, (x) => ({ ...patch, state: "available", events: [{ t: now(), text: "수정 완료" }, ...x.events] }));
  res.json({ ok: true });
});

// 장애 조치 테스트: 재부팅하면서 스탠바이 AZ로 넘어감 (엔드포인트 주소는 그대로)
router.post("/db-instances/:id/failover", (req, res) => {
  const db = readDB();
  const d = db.dbInstances.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "DB 인스턴스를 찾을 수 없어요." });
  if (!d.multiAz) return res.status(400).json({ error: "Multi-AZ가 아닌 인스턴스는 장애 조치(failover)할 스탠바이가 없어요." });
  if (d.state !== "available") return res.status(409).json({ error: "사용 가능 상태에서만 할 수 있어요." });
  d.state = "rebooting";
  d.events.unshift({ t: now(), text: `장애 조치 시작: ${d.primaryAz} → ${d.standbyAz}` });
  writeDB(db);
  later(3500, "dbInstances", d.id, (x) => ({
    state: "available",
    primaryAz: x.standbyAz,
    standbyAz: x.primaryAz,
    events: [{ t: now(), text: `장애 조치 완료: 이제 ${x.standbyAz}가 기본(primary)이에요. 엔드포인트는 그대로예요.` }, ...x.events],
  }));
  res.json({ ok: true });
});

router.post("/db-instances/:id/snapshot", (req, res) => {
  const db = readDB();
  const d = db.dbInstances.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "DB 인스턴스를 찾을 수 없어요." });
  d.snapshots = d.snapshots || [];
  d.snapshots.unshift({ id: `rds:${d.identifier}-${Date.now()}`, createdAt: now(), sizeGb: d.allocatedStorage });
  d.events.unshift({ t: now(), text: "수동 스냅샷 생성" });
  writeDB(db);
  res.status(201).json(safeDb(d));
});

router.delete("/db-instances/:id", (req, res) => {
  const d = readDB().dbInstances.find((x) => x.id === req.params.id);
  if (d && d.deletionProtection) return res.status(409).json({ error: "삭제 방지(Deletion protection)가 켜져 있어요. 먼저 수정에서 끄세요." });
  patchItem("dbInstances", req.params.id, { state: "deleting" });
  setTimeout(() => removeItem("dbInstances", req.params.id), DELETING_MS);
  res.json({ ok: true });
});

/* ===== ElastiCache ===== */

router.get("/cache-clusters", (req, res) => res.json(readDB().cacheClusters));

router.post("/cache-clusters", (req, res) => {
  const { name, engine, nodeType, numNodes, subnetIds, multiAz, securityGroupId, transitEncryption } = req.body;
  const db = readDB();
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name || "")) return res.status(400).json({ error: "이름은 소문자로 시작하고 소문자·숫자·하이픈만 쓸 수 있어요." });
  if (!(subnetIds || []).length) return res.status(400).json({ error: "캐시 서브넷 그룹에 넣을 서브넷을 고르세요." });
  const eng = ["valkey", "redis", "memcached"].includes(engine) ? engine : "valkey";
  const n = Math.min(Math.max(Number(numNodes) || 1, 1), 6);
  if (multiAz && eng !== "memcached" && n < 2) return res.status(400).json({ error: "Multi-AZ 자동 장애 조치에는 복제본을 포함해 노드가 2개 이상 필요해요." });
  if (multiAz && distinctAzCount(db, subnetIds) < 2) return res.status(400).json({ error: "Multi-AZ에는 서로 다른 AZ의 서브넷이 2개 이상 필요해요." });
  const cc = {
    id: makeId("cache", 8),
    name,
    engine: eng,
    nodeType: nodeType || "cache.t3.micro",
    numNodes: n,
    vpcId: (db.subnets.find((s) => s.id === subnetIds[0]) || {}).vpcId,
    subnetIds,
    securityGroupId: securityGroupId || null,
    multiAz: !!multiAz && eng !== "memcached",
    transitEncryption: transitEncryption !== false,
    port: eng === "memcached" ? 11211 : 6379,
    endpoint: null,
    state: "creating",
    createdAt: now(),
  };
  db.cacheClusters.push(cc);
  writeDB(db);
  later(6000, "cacheClusters", cc.id, { state: "available", endpoint: `${name}.${randomHex(6)}.apn2.cache.amazonaws.com` });
  res.status(201).json(cc);
});

router.delete("/cache-clusters/:id", (req, res) => {
  patchItem("cacheClusters", req.params.id, { state: "deleting" });
  setTimeout(() => removeItem("cacheClusters", req.params.id), DELETING_MS);
  res.json({ ok: true });
});

/* ===== EFS (여러 인스턴스·파드가 동시에 쓰는 공유 파일 시스템) ===== */

router.get("/efs", (req, res) => res.json(readDB().efsFileSystems));

router.post("/efs", (req, res) => {
  const { name, vpcId, performanceMode, throughputMode, encrypted, transitionToIaDays } = req.body;
  const db = readDB();
  if (!db.vpcs.some((v) => v.id === vpcId)) return res.status(400).json({ error: "VPC를 선택하세요." });
  const fsItem = {
    id: makeId("fs", 17),
    name: name || "shared-fs",
    vpcId,
    performanceMode: performanceMode === "maxIO" ? "maxIO" : "generalPurpose",
    throughputMode: ["bursting", "elastic", "provisioned"].includes(throughputMode) ? throughputMode : "elastic",
    encrypted: encrypted !== false,
    transitionToIaDays: Number(transitionToIaDays) || null,
    sizeGb: 0,
    mountTargets: [],
    state: "creating",
    createdAt: now(),
  };
  fsItem.dnsName = `${fsItem.id}.efs.ap-northeast-2.amazonaws.com`;
  db.efsFileSystems.push(fsItem);
  writeDB(db);
  later(3000, "efsFileSystems", fsItem.id, { state: "available" });
  res.status(201).json(fsItem);
});

router.post("/efs/:id/mount-targets", (req, res) => {
  const db = readDB();
  const f = db.efsFileSystems.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "파일 시스템을 찾을 수 없어요." });
  const subnet = db.subnets.find((s) => s.id === req.body.subnetId);
  if (!subnet || subnet.vpcId !== f.vpcId) return res.status(400).json({ error: "파일 시스템과 같은 VPC의 서브넷을 고르세요." });
  if (f.mountTargets.some((m) => m.availabilityZone === subnet.availabilityZone)) {
    return res.status(409).json({ error: "MountTargetConflict: 가용 영역 하나에는 탑재 대상을 하나만 만들 수 있어요." });
  }
  const sg = db.securityGroups.find((s) => s.id === req.body.securityGroupId);
  const nfsOpen = sg && sg.inboundRules.some((r) => String(r.port) === "2049");
  f.mountTargets.push({
    id: makeId("fsmt", 17),
    subnetId: subnet.id,
    availabilityZone: subnet.availabilityZone,
    ipAddress: randomPrivateIp(subnet.cidrBlock),
    securityGroupId: sg ? sg.id : null,
    warning: nfsOpen ? "" : "보안 그룹에 NFS(2049) 인바운드 규칙이 없어 인스턴스가 탑재하지 못해요.",
    state: "available",
  });
  writeDB(db);
  res.status(201).json(f);
});

router.delete("/efs/:id/mount-targets/:mtId", (req, res) => {
  const db = readDB();
  const f = db.efsFileSystems.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "파일 시스템을 찾을 수 없어요." });
  f.mountTargets = f.mountTargets.filter((m) => m.id !== req.params.mtId);
  writeDB(db);
  res.json(f);
});

// 파일 쓰기 흉내: 용량만 늘려서 비용·용량 변화를 볼 수 있게
router.post("/efs/:id/write", (req, res) => {
  const f = patchItem("efsFileSystems", req.params.id, (x) => ({ sizeGb: Math.round((x.sizeGb + (Number(req.body.gb) || 1)) * 10) / 10 }));
  if (!f) return res.status(404).json({ error: "파일 시스템을 찾을 수 없어요." });
  res.json(f);
});

router.delete("/efs/:id", (req, res) => {
  const db = readDB();
  const f = db.efsFileSystems.find((x) => x.id === req.params.id);
  if (f && f.mountTargets.length) return res.status(409).json({ error: "FileSystemInUse: 탑재 대상을 먼저 모두 삭제하세요." });
  removeItem("efsFileSystems", req.params.id);
  res.json({ ok: true });
});

router.get("/rds/meta", (req, res) => res.json({ engineVersions: ENGINE_VERSIONS }));

module.exports = router;
