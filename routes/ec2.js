/* ---- EC2 서비스: 인스턴스 / EBS 볼륨 / 시작 템플릿 / Auto Scaling 그룹 ---- */
const express = require("express");
const { readDB, writeDB, patchItem, removeItem } = require("../lib/store");
const { newVolumeId, newSnapshotId, makeId } = require("../lib/ids");
const {
  INSTANCE_TYPES,
  typeSpec,
  launchInstance,
  stopInstance,
  startInstance,
  rebootInstance,
  terminateInstance,
} = require("../lib/compute");
const { asgCpu } = require("../lib/metrics");

const router = express.Router();
const now = () => new Date().toISOString();

router.get("/instance-types", (req, res) => res.json(INSTANCE_TYPES));

/* ===== 인스턴스 ===== */

router.get("/instances", (req, res) => {
  const db = readDB();
  res.json(db.instances.map((i) => ({ ...i, spec: typeSpec(i.instanceType) })));
});

router.post("/instances", (req, res) => {
  const b = req.body;
  const db = readDB();
  if (!db.vpcs.find((v) => v.id === b.vpcId)) return res.status(400).json({ error: "존재하지 않는 VPC입니다." });
  const subnet = db.subnets.find((s) => s.id === b.subnetId);
  if (!subnet || subnet.vpcId !== b.vpcId) return res.status(400).json({ error: "선택한 VPC 안의 서브넷을 골라주세요." });
  if (b.securityGroupId) {
    const sg = db.securityGroups.find((s) => s.id === b.securityGroupId);
    if (!sg || sg.vpcId !== b.vpcId) return res.status(400).json({ error: "보안 그룹은 인스턴스와 같은 VPC의 것이어야 해요." });
  }
  if (b.iamRole) {
    const role = db.iamRoles.find((r) => r.name === b.iamRole);
    if (!role || role.trustedService !== "ec2") return res.status(400).json({ error: "EC2가 사용할 수 있는(신뢰 관계가 ec2인) IAM 역할을 골라주세요." });
  }
  const count = Math.min(Math.max(Number(b.count) || 1, 1), 5);
  const created = [];
  for (let n = 0; n < count; n++) {
    created.push(launchInstance(db, { ...b, name: count > 1 ? `${b.name || "instance"}-${n + 1}` : b.name }));
  }
  writeDB(db);
  res.status(201).json(count > 1 ? created : created[0]);
});

router.post("/instances/:id/stop", (req, res) => {
  if (stopInstance(req.params.id) === "instance-store") {
    return res.status(400).json({ error: "인스턴스 스토어 기반 인스턴스는 중지할 수 없어요 (재부팅·종료만 가능). 중지하면 데이터가 사라지기 때문이에요." });
  }
  res.json({ ok: true });
});
router.post("/instances/:id/start", (req, res) => {
  startInstance(req.params.id);
  res.json({ ok: true });
});
router.post("/instances/:id/reboot", (req, res) => {
  rebootInstance(req.params.id);
  res.json({ ok: true });
});
router.delete("/instances/:id", (req, res) => {
  const db = readDB();
  const inst = db.instances.find((i) => i.id === req.params.id);
  if (inst && inst.managedBy) {
    // ASG/노드 그룹이 관리하는 인스턴스는 지워도 다시 채워진다는 걸 알려줌
    inst.tags = { ...inst.tags, "terminated-by-user": "true" };
    writeDB(db);
  }
  terminateInstance(req.params.id);
  res.json({ ok: true, note: inst && inst.managedBy ? "그룹이 관리하는 인스턴스라 원하는 용량을 맞추기 위해 새 인스턴스가 다시 시작돼요." : undefined });
});

router.post("/instances/:id/tags", (req, res) => {
  const item = patchItem("instances", req.params.id, (i) => ({ tags: { ...i.tags, [req.body.key]: req.body.value } }));
  if (!item) return res.status(404).json({ error: "인스턴스를 찾을 수 없어요." });
  res.json(item);
});

// AMI 만들기 (골든 이미지)
router.post("/instances/:id/create-image", (req, res) => {
  const db = readDB();
  const inst = db.instances.find((i) => i.id === req.params.id);
  if (!inst) return res.status(404).json({ error: "인스턴스를 찾을 수 없어요." });
  db.customAmis = db.customAmis || [];
  const ami = { id: makeId("ami"), name: req.body.name || `${inst.name}-image`, sourceInstanceId: inst.id, baseAmi: inst.ami, createdAt: now() };
  db.customAmis.push(ami);
  writeDB(db);
  res.status(201).json(ami);
});
router.get("/amis", (req, res) => res.json(readDB().customAmis || []));

/* ===== EBS 볼륨 ===== */

router.get("/volumes", (req, res) => res.json(readDB().volumes));

router.post("/volumes", (req, res) => {
  const { name, size, type, availabilityZone, encrypted, iops, snapshotId } = req.body;
  const db = readDB();
  const volume = {
    id: newVolumeId(),
    name: name || "(이름 없음)",
    size: Number(size) || 20,
    type: type || "gp3",
    iops: Number(iops) || (type === "io2" ? 3000 : type === "gp3" ? 3000 : null),
    encrypted: !!encrypted,
    fromSnapshot: snapshotId || null,
    availabilityZone: availabilityZone || "ap-northeast-2a",
    state: "available",
    isRoot: false,
    attachedInstanceId: null,
    createdAt: now(),
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
  if (!instance || instance.state === "terminated") return res.status(400).json({ error: "존재하지 않는 인스턴스입니다." });
  if (instance.availabilityZone !== volume.availabilityZone) {
    return res.status(400).json({
      error: `같은 가용 영역(AZ)끼리만 연결할 수 있어요. 볼륨은 ${volume.availabilityZone}, 인스턴스는 ${instance.availabilityZone}에 있어요. 스냅샷으로 복사해 옮기세요.`,
    });
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

router.post("/volumes/:id/modify", (req, res) => {
  const db = readDB();
  const volume = db.volumes.find((v) => v.id === req.params.id);
  if (!volume) return res.status(404).json({ error: "볼륨을 찾을 수 없습니다." });
  const size = Number(req.body.size);
  if (size && size < volume.size) return res.status(400).json({ error: "EBS 볼륨은 크기를 줄일 수 없어요. 늘리기만 가능해요." });
  if (size) volume.size = size;
  if (req.body.type) volume.type = req.body.type;
  writeDB(db);
  res.json(volume);
});

router.post("/volumes/:id/snapshot", (req, res) => {
  const db = readDB();
  const volume = db.volumes.find((v) => v.id === req.params.id);
  if (!volume) return res.status(404).json({ error: "볼륨을 찾을 수 없습니다." });
  volume.snapshots = volume.snapshots || [];
  const snap = { id: newSnapshotId(), description: req.body.description || "", size: volume.size, encrypted: !!volume.encrypted, createdAt: now() };
  volume.snapshots.push(snap);
  writeDB(db);
  res.status(201).json(snap);
});

router.get("/snapshots", (req, res) => {
  const db = readDB();
  res.json(db.volumes.flatMap((v) => (v.snapshots || []).map((s) => ({ ...s, volumeId: v.id, volumeName: v.name }))));
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

/* ===== 시작 템플릿 (Launch Template) ===== */

router.get("/launch-templates", (req, res) => res.json(readDB().launchTemplates));

router.post("/launch-templates", (req, res) => {
  const { name, ami, instanceType, securityGroupId, userData, keyName, iamRole } = req.body;
  if (!name) return res.status(400).json({ error: "템플릿 이름을 입력하세요." });
  const db = readDB();
  const lt = {
    id: makeId("lt"),
    name,
    version: 1,
    ami: ami || "ami-amazon-linux-2023",
    instanceType: instanceType || "t3.micro",
    securityGroupId: securityGroupId || null,
    userData: userData || "",
    keyName: keyName || "",
    iamRole: iamRole || null,
    createdAt: now(),
  };
  db.launchTemplates.push(lt);
  writeDB(db);
  res.status(201).json(lt);
});

router.delete("/launch-templates/:id", (req, res) => {
  const db = readDB();
  if (db.autoScalingGroups.some((a) => a.launchTemplateId === req.params.id)) {
    return res.status(409).json({ error: "이 템플릿을 쓰는 Auto Scaling 그룹이 있어요." });
  }
  removeItem("launchTemplates", req.params.id);
  res.json({ ok: true });
});

/* ===== Auto Scaling 그룹 ===== */
// 원하는 용량(desired)을 정해두면 부족한 만큼 인스턴스를 띄우고, 남으면 줄입니다.
// 실제 조정 작업은 lib/sim.js의 주기 작업이 담당해요.

router.get("/auto-scaling-groups", (req, res) => {
  const db = readDB();
  res.json(
    db.autoScalingGroups.map((a) => {
      const members = db.instances.filter((i) => i.managedBy && i.managedBy.id === a.id && i.state !== "terminated");
      const running = members.filter((i) => i.state === "running").length;
      return { ...a, instanceIds: members.map((i) => i.id), running, cpu: asgCpu(a, running) };
    })
  );
});

router.post("/auto-scaling-groups", (req, res) => {
  const { name, launchTemplateId, subnetIds, min, desired, max, targetGroupIds, targetCpu, healthCheckType } = req.body;
  const db = readDB();
  if (!name) return res.status(400).json({ error: "그룹 이름을 입력하세요." });
  if (!db.launchTemplates.some((l) => l.id === launchTemplateId)) return res.status(400).json({ error: "시작 템플릿을 선택하세요." });
  if (!subnetIds || !subnetIds.length) return res.status(400).json({ error: "인스턴스를 배치할 서브넷을 하나 이상 고르세요 (여러 AZ 권장)." });
  const mn = Number(min) || 0;
  const mx = Number(max) || 1;
  const ds = Number(desired) || mn;
  if (!(mn <= ds && ds <= mx)) return res.status(400).json({ error: "최소 ≤ 원하는 용량 ≤ 최대 순서가 되어야 해요." });
  const vpcId = (db.subnets.find((s) => s.id === subnetIds[0]) || {}).vpcId;
  const asg = {
    id: makeId("asg", 8),
    name,
    launchTemplateId,
    vpcId,
    subnetIds,
    min: mn,
    desired: ds,
    max: mx,
    targetGroupIds: targetGroupIds || [],
    healthCheckType: healthCheckType === "ELB" ? "ELB" : "EC2",
    scalingPolicy: targetCpu ? { type: "target-tracking", metric: "CPU", target: Number(targetCpu) } : null,
    lastScaledAt: Date.now(), // 새 인스턴스 워밍업 동안은 조정 정책을 적용하지 않음
    activities: [{ t: now(), text: `그룹 생성 · 원하는 용량 ${ds}` }],
    createdAt: now(),
  };
  db.autoScalingGroups.push(asg);
  writeDB(db);
  res.status(201).json(asg);
});

router.post("/auto-scaling-groups/:id/capacity", (req, res) => {
  const db = readDB();
  const asg = db.autoScalingGroups.find((a) => a.id === req.params.id);
  if (!asg) return res.status(404).json({ error: "그룹을 찾을 수 없어요." });
  const mn = req.body.min !== undefined ? Number(req.body.min) : asg.min;
  const mx = req.body.max !== undefined ? Number(req.body.max) : asg.max;
  const ds = req.body.desired !== undefined ? Number(req.body.desired) : asg.desired;
  if (!(mn <= ds && ds <= mx)) return res.status(400).json({ error: "최소 ≤ 원하는 용량 ≤ 최대 순서가 되어야 해요." });
  Object.assign(asg, { min: mn, max: mx, desired: ds, lastScaledAt: Date.now() });
  asg.activities.unshift({ t: now(), text: `수동 변경 · 최소 ${mn} / 원하는 ${ds} / 최대 ${mx}` });
  writeDB(db);
  res.json(asg);
});

router.post("/auto-scaling-groups/:id/policy", (req, res) => {
  const db = readDB();
  const asg = db.autoScalingGroups.find((a) => a.id === req.params.id);
  if (!asg) return res.status(404).json({ error: "그룹을 찾을 수 없어요." });
  asg.scalingPolicy = req.body.targetCpu ? { type: "target-tracking", metric: "CPU", target: Number(req.body.targetCpu) } : null;
  writeDB(db);
  res.json(asg);
});

router.delete("/auto-scaling-groups/:id", (req, res) => {
  const db = readDB();
  const members = db.instances.filter((i) => i.managedBy && i.managedBy.id === req.params.id && i.state !== "terminated");
  db.autoScalingGroups = db.autoScalingGroups.filter((a) => a.id !== req.params.id);
  writeDB(db);
  members.forEach((m) => terminateInstance(m.id));
  res.json({ ok: true, terminated: members.length });
});

module.exports = router;
