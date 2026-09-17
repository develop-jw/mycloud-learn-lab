/* ---- EC2 인스턴스 공통 로직 ---- */
// 직접 시작한 인스턴스, Auto Scaling 그룹이 띄운 인스턴스, EKS 워커 노드가
// 모두 같은 방식으로 만들어지도록 한 곳에 모아 둡니다.

const { readDB, writeDB, patchItem } = require("./store");
const { newInstanceId, newVolumeId, randomPublicIp, randomPrivateIp } = require("./ids");
const { isSubnetPublic } = require("./net");

const PENDING_MS = 4000;
const STOPPING_MS = 2000;
const TERMINATING_MS = 3000;

// 인스턴스 유형 사양 (vCPU / 메모리 GiB / 대략적인 서울 리전 온디맨드 시간당 USD)
const INSTANCE_TYPES = {
  "t2.micro": { vcpu: 1, mem: 1, price: 0.0144, family: "general" },
  "t3.micro": { vcpu: 2, mem: 1, price: 0.013, family: "general" },
  "t3.small": { vcpu: 2, mem: 2, price: 0.026, family: "general" },
  "t3.medium": { vcpu: 2, mem: 4, price: 0.052, family: "general" },
  "m5.large": { vcpu: 2, mem: 8, price: 0.118, family: "general" },
  "m6i.large": { vcpu: 2, mem: 8, price: 0.118, family: "general" },
  "c5.large": { vcpu: 2, mem: 4, price: 0.096, family: "compute" },
  "c6i.large": { vcpu: 2, mem: 4, price: 0.096, family: "compute" },
  "c7g.large": { vcpu: 2, mem: 4, price: 0.0816, family: "compute" },
  "r5.large": { vcpu: 2, mem: 16, price: 0.152, family: "memory" },
  "r6g.large": { vcpu: 2, mem: 16, price: 0.122, family: "memory" },
  "x1e.xlarge": { vcpu: 4, mem: 122, price: 1.0, family: "memory" },
  "i3.large": { vcpu: 2, mem: 15.25, price: 0.187, family: "storage" },
  "d2.xlarge": { vcpu: 4, mem: 30.5, price: 0.84, family: "storage" },
  "g4dn.xlarge": { vcpu: 4, mem: 16, price: 0.647, family: "gpu" },
  "p4d.24xlarge": { vcpu: 96, mem: 1152, price: 40.97, family: "gpu" },
};

function typeSpec(type) {
  return INSTANCE_TYPES[type] || { vcpu: 2, mem: 4, price: 0.1, family: "general" };
}

// db 안에 인스턴스 1대를 추가하고, 잠시 뒤 running으로 바꾸는 예약까지 걸어 둡니다.
function launchInstance(db, opts) {
  const subnet = db.subnets.find((s) => s.id === opts.subnetId);
  const now = new Date().toISOString();
  const instance = {
    id: newInstanceId(),
    name: opts.name || "(이름 없음)",
    ami: opts.ami || "ami-amazon-linux-2023",
    instanceType: opts.instanceType || "t3.micro",
    keyName: opts.keyName || "(없음)",
    vpcId: opts.vpcId || (subnet && subnet.vpcId),
    subnetId: opts.subnetId,
    availabilityZone: subnet ? subnet.availabilityZone : "ap-northeast-2a",
    privateIp: randomPrivateIp(subnet && subnet.cidrBlock),
    securityGroupId: opts.securityGroupId || null,
    iamRole: opts.iamRole || null,
    purchasingOption: opts.purchasingOption === "spot" ? "spot" : "on-demand",
    imdsv2Required: opts.imdsv2Required !== false,
    userData: opts.userData || "",
    rootDeviceType: opts.rootDeviceType === "instance-store" ? "instance-store" : "ebs",
    tags: opts.tags || {},
    managedBy: opts.managedBy || null, // { type: 'asg' | 'nodegroup', id }
    elasticIp: null,
    state: "pending",
    publicIp: null,
    launchedAt: now,
  };
  db.instances.push(instance);

  // EBS 기반 AMI면 루트 EBS 볼륨이 함께 만들어짐 (인스턴스 스토어 기반이면 휘발성 디스크)
  if (instance.rootDeviceType === "ebs") {
    db.volumes.push({
      id: newVolumeId(),
      name: `${instance.name}-root`,
      size: Number(opts.rootVolumeSize) || 8,
      type: opts.rootVolumeType || "gp3",
      encrypted: !!opts.rootVolumeEncrypted,
      availabilityZone: instance.availabilityZone,
      state: "in-use",
      isRoot: true,
      deleteOnTermination: true,
      attachedInstanceId: instance.id,
      createdAt: now,
    });
  }

  const wantsPublicIp = opts.associatePublicIp !== false && subnet && isSubnetPublic(db, subnet.id);
  setTimeout(() => {
    patchItem("instances", instance.id, (inst) =>
      inst.state === "pending" ? { state: "running", publicIp: inst.elasticIp || (wantsPublicIp ? randomPublicIp() : null) } : {}
    );
  }, PENDING_MS);

  return instance;
}

function stopInstance(id) {
  const inst = patchItem("instances", id, { state: "stopping" });
  if (!inst) return;
  if (inst.rootDeviceType === "instance-store") {
    // 인스턴스 스토어 기반은 '중지'가 불가능 — 실제 AWS와 같은 제약
    patchItem("instances", id, { state: "running" });
    return "instance-store";
  }
  setTimeout(() => patchItem("instances", id, (i) => ({ state: "stopped", publicIp: i.elasticIp || null })), STOPPING_MS);
}

function startInstance(id) {
  patchItem("instances", id, { state: "pending" });
  setTimeout(
    () =>
      patchItem("instances", id, (i, db) => ({
        state: "running",
        publicIp: i.elasticIp || (isSubnetPublic(db, i.subnetId) ? randomPublicIp() : null),
      })),
    PENDING_MS
  );
}

function rebootInstance(id) {
  patchItem("instances", id, { state: "rebooting" });
  setTimeout(() => patchItem("instances", id, { state: "running" }), 2500);
}

function terminateInstance(id) {
  patchItem("instances", id, { state: "shutting-down" });
  setTimeout(() => {
    const db = readDB();
    const inst = db.instances.find((i) => i.id === id);
    if (!inst) return;
    inst.state = "terminated";
    inst.publicIp = null;
    // 탄력적 IP는 연결만 해제되고 계정에 남음 (그래서 비용이 계속 나감)
    db.elasticIps.forEach((e) => {
      if (e.instanceId === id) e.instanceId = null;
    });
    inst.elasticIp = null;
    // 루트 볼륨은 delete-on-termination 기본값에 따라 삭제, 추가 볼륨은 분리만
    db.volumes = db.volumes.filter((v) => !(v.attachedInstanceId === id && v.isRoot && v.deleteOnTermination !== false));
    db.volumes.forEach((v) => {
      if (v.attachedInstanceId === id) {
        v.attachedInstanceId = null;
        v.state = "available";
      }
    });
    // 대상 그룹에서도 빠짐
    db.targetGroups.forEach((tg) => (tg.targets = tg.targets.filter((t) => t !== id)));
    writeDB(db);
  }, TERMINATING_MS);
}

module.exports = {
  INSTANCE_TYPES,
  typeSpec,
  launchInstance,
  stopInstance,
  startInstance,
  rebootInstance,
  terminateInstance,
  PENDING_MS,
};
