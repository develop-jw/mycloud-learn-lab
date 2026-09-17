/* ---- EC2 서비스: 인스턴스 시작/중지/종료 + EBS 볼륨 ---- */
const express = require("express");
const { readDB, writeDB } = require("../lib/store");
const { newInstanceId, newVolumeId, newSnapshotId, randomPublicIp } = require("../lib/ids");

const router = express.Router();

// 실제 EC2도 인스턴스를 시작하면 바로 running이 아니라
// pending 상태를 잠깐 거칩니다. 그 느낌을 살리려고 몇 초 지연을 둡니다.
const PENDING_MS = 4000;
const STOPPING_MS = 2000;
const TERMINATING_MS = 3000;

function updateInstance(id, patch) {
  const db = readDB();
  const inst = db.instances.find((i) => i.id === id);
  if (!inst) return;
  Object.assign(inst, patch);
  writeDB(db);
}

/* ===== 인스턴스 ===== */

router.get("/instances", (req, res) => {
  res.json(readDB().instances);
});

router.post("/instances", (req, res) => {
  const {
    name,
    ami,
    instanceType,
    keyName,
    vpcId,
    subnetId,
    securityGroupId,
    purchasingOption,
    imdsv2Required,
    userData,
    rootVolumeSize,
    rootVolumeType,
  } = req.body;
  const db = readDB();

  if (!db.vpcs.find((v) => v.id === vpcId)) {
    return res.status(400).json({ error: "존재하지 않는 VPC입니다." });
  }
  if (!db.subnets.find((s) => s.id === subnetId)) {
    return res.status(400).json({ error: "존재하지 않는 서브넷입니다." });
  }

  const instance = {
    id: newInstanceId(),
    name: name || "(이름 없음)",
    ami: ami || "ami-amazon-linux-2023",
    instanceType: instanceType || "t2.micro",
    keyName: keyName || "(없음)",
    vpcId,
    subnetId,
    securityGroupId,
    purchasingOption: purchasingOption === "spot" ? "spot" : "on-demand",
    imdsv2Required: !!imdsv2Required,
    userData: userData || "",
    state: "pending",
    publicIp: null,
    launchedAt: new Date().toISOString(),
  };
  db.instances.push(instance);

  // 실제 AWS처럼: 인스턴스를 시작하면 루트 EBS 볼륨이 함께 프로비저닝됩니다.
  db.volumes.push({
    id: newVolumeId(),
    name: `${instance.name}-root`,
    size: Number(rootVolumeSize) || 8,
    type: rootVolumeType || "gp3",
    availabilityZone: (db.subnets.find((s) => s.id === subnetId) || {}).availabilityZone || "ap-northeast-2a",
    state: "in-use",
    isRoot: true,
    attachedInstanceId: instance.id,
    createdAt: new Date().toISOString(),
  });

  writeDB(db);

  // 실제 AWS처럼: pending → running 으로 잠시 후 전환
  setTimeout(() => {
    updateInstance(instance.id, { state: "running", publicIp: randomPublicIp() });
  }, PENDING_MS);

  res.status(201).json(instance);
});

router.post("/instances/:id/stop", (req, res) => {
  updateInstance(req.params.id, { state: "stopping" });
  setTimeout(() => updateInstance(req.params.id, { state: "stopped", publicIp: null }), STOPPING_MS);
  res.json({ ok: true });
});

router.post("/instances/:id/start", (req, res) => {
  updateInstance(req.params.id, { state: "pending" });
  setTimeout(() => updateInstance(req.params.id, { state: "running", publicIp: randomPublicIp() }), PENDING_MS);
  res.json({ ok: true });
});

router.delete("/instances/:id", (req, res) => {
  updateInstance(req.params.id, { state: "shutting-down" });
  setTimeout(() => {
    updateInstance(req.params.id, { state: "terminated", publicIp: null });
    // 루트 볼륨은 기본적으로 인스턴스 종료 시 함께 삭제됩니다 (delete-on-termination 기본값).
    const db = readDB();
    db.volumes = db.volumes.filter((v) => !(v.attachedInstanceId === req.params.id && v.isRoot));
    db.volumes.forEach((v) => {
      if (v.attachedInstanceId === req.params.id) {
        v.attachedInstanceId = null;
        v.state = "available";
      }
    });
    writeDB(db);
  }, TERMINATING_MS);
  res.json({ ok: true });
});

/* ===== EBS 볼륨 ===== */

router.get("/volumes", (req, res) => {
  res.json(readDB().volumes);
});

router.post("/volumes", (req, res) => {
  const { name, size, type, availabilityZone } = req.body;
  const db = readDB();
  const volume = {
    id: newVolumeId(),
    name: name || "(이름 없음)",
    size: Number(size) || 20,
    type: type || "gp3",
    availabilityZone: availabilityZone || "ap-northeast-2a",
    state: "available",
    isRoot: false,
    attachedInstanceId: null,
    createdAt: new Date().toISOString(),
  };
  db.volumes.push(volume);
  writeDB(db);
  res.status(201).json(volume);
});

router.post("/volumes/:id/attach", (req, res) => {
  const { instanceId } = req.body;
  const db = readDB();
  const volume = db.volumes.find((v) => v.id === req.params.id);
  const instance = db.instances.find((i) => i.id === instanceId);
  if (!volume) return res.status(404).json({ error: "볼륨을 찾을 수 없습니다." });
  if (!instance) return res.status(400).json({ error: "존재하지 않는 인스턴스입니다." });
  const subnet = db.subnets.find((s) => s.id === instance.subnetId);
  if (subnet && subnet.availabilityZone !== volume.availabilityZone) {
    return res.status(400).json({ error: "같은 가용 영역(AZ)에 있는 볼륨과 인스턴스만 연결할 수 있습니다." });
  }
  volume.attachedInstanceId = instanceId;
  volume.state = "in-use";
  writeDB(db);
  res.json(volume);
});

router.post("/volumes/:id/detach", (req, res) => {
  const db = readDB();
  const volume = db.volumes.find((v) => v.id === req.params.id);
  if (!volume) return res.status(404).json({ error: "볼륨을 찾을 수 없습니다." });
  if (volume.isRoot) return res.status(409).json({ error: "루트 볼륨은 분리할 수 없습니다." });
  volume.attachedInstanceId = null;
  volume.state = "available";
  writeDB(db);
  res.json(volume);
});

router.post("/volumes/:id/snapshot", (req, res) => {
  const { description } = req.body;
  const db = readDB();
  const volume = db.volumes.find((v) => v.id === req.params.id);
  if (!volume) return res.status(404).json({ error: "볼륨을 찾을 수 없습니다." });
  volume.snapshots = volume.snapshots || [];
  const snap = { id: newSnapshotId(), description: description || "", size: volume.size, createdAt: new Date().toISOString() };
  volume.snapshots.push(snap);
  writeDB(db);
  res.status(201).json(snap);
});

router.delete("/volumes/:id", (req, res) => {
  const db = readDB();
  const volume = db.volumes.find((v) => v.id === req.params.id);
  if (volume && volume.state === "in-use") {
    return res.status(409).json({ error: "사용 중(in-use)인 볼륨은 삭제할 수 없습니다. 먼저 분리하세요." });
  }
  db.volumes = db.volumes.filter((v) => v.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
