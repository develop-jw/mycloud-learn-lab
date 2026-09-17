/* ---- 주기적으로 돌면서 "살아있는 클라우드"를 흉내내는 작업 ---- */
// 실제 AWS에서는 Auto Scaling, EKS 스케줄러, CloudWatch 경보가 쉬지 않고 돌아요.
// 여기서는 2초마다 한 번씩 아래 작업을 순서대로 처리합니다.
//  1) Auto Scaling 그룹 / EKS 노드 그룹 인원 맞추기
//  2) 디플로이먼트의 파드 개수 맞추기 + 롤링 업데이트
//  3) 대기 중(Pending) 파드를 노드에 배치(스케줄링)하고 이미지 받기
//  4) 로드 밸런서 대상(파드) 동기화
//  5) CloudWatch 경보 평가

const { readDB, writeDB } = require("./store");
const { randomHex, randomPrivateIp, ACCOUNT_ID } = require("./ids");
const { launchInstance, terminateInstance } = require("./compute");
const { subnetEgress } = require("./net");
const metrics = require("./metrics");

const TICK_MS = 2000;
const now = () => new Date().toISOString();

function pushActivity(list, text, max = 20) {
  list.unshift({ t: now(), text });
  if (list.length > max) list.length = max;
}

// 그룹(ASG/노드 그룹) 인원 맞추기 — 부족하면 띄우고, 많으면 최근 것부터 종료
function reconcileGroup(db, group, kind, launchOpts, toTerminate) {
  const members = db.instances.filter((i) => i.managedBy && i.managedBy.id === group.id && !["terminated", "shutting-down"].includes(i.state));
  let changed = false;
  if (members.length < group.desired) {
    const counts = Object.fromEntries(group.subnetIds.map((id) => [id, members.filter((m) => m.subnetId === id).length]));
    const subnetId = group.subnetIds.slice().sort((a, b) => counts[a] - counts[b])[0];
    const inst = launchInstance(db, { ...launchOpts, subnetId, managedBy: { type: kind, id: group.id, clusterId: group.clusterId } });
    if (group.activities) pushActivity(group.activities, `인스턴스 시작 ${inst.id} (${inst.availabilityZone})`);
    changed = true;
  } else if (members.length > group.desired) {
    const victim = members.sort((a, b) => b.launchedAt.localeCompare(a.launchedAt))[0];
    toTerminate.push(victim.id);
    if (group.activities) pushActivity(group.activities, `인스턴스 종료 ${victim.id} (용량 축소)`);
    changed = true;
  }
  return { members, changed };
}

function tickGroups(db, toTerminate) {
  let dirty = false;
  const t = Date.now() / 1000;

  for (const asg of db.autoScalingGroups) {
    const lt = db.launchTemplates.find((l) => l.id === asg.launchTemplateId);
    if (!lt) continue;
    const { members, changed } = reconcileGroup(
      db,
      asg,
      "asg",
      { name: `${asg.name}-instance`, ami: lt.ami, instanceType: lt.instanceType, securityGroupId: lt.securityGroupId, userData: lt.userData, keyName: lt.keyName, iamRole: lt.iamRole },
      toTerminate
    );
    dirty = dirty || changed;

    // 실행 중인 인스턴스를 대상 그룹에 자동 등록
    const runningIds = members.filter((m) => m.state === "running").map((m) => m.id);
    for (const tgId of asg.targetGroupIds) {
      const tg = db.targetGroups.find((x) => x.id === tgId);
      if (!tg) continue;
      for (const id of runningIds) {
        if (!tg.targets.includes(id)) {
          tg.targets.push(id);
          dirty = true;
        }
      }
    }

    // 대상 추적 조정 정책: 평균 CPU를 목표값 근처로 유지
    if (asg.scalingPolicy && runningIds.length && Date.now() - (asg.lastScaledAt || 0) > 20000) {
      const cpu = metrics.asgCpu(asg, runningIds.length, t);
      const target = asg.scalingPolicy.target;
      if (cpu > target * 1.15 && asg.desired < asg.max && members.length === asg.desired) {
        asg.desired += 1;
        asg.lastScaledAt = Date.now();
        pushActivity(asg.activities, `확장(scale-out): 평균 CPU ${cpu}% > 목표 ${target}% → 원하는 용량 ${asg.desired}`);
        db.events.unshift({ t: now(), method: "SIM", path: "/auto-scaling-groups/scale-out", name: asg.name });
        dirty = true;
      } else if (cpu < target * 0.4 && asg.desired > asg.min && members.length === asg.desired && Date.now() - (asg.lastScaledAt || 0) > 45000) {
        asg.desired -= 1;
        asg.lastScaledAt = Date.now();
        pushActivity(asg.activities, `축소(scale-in): 평균 CPU ${cpu}% < ${Math.round(target * 0.4)}% → 원하는 용량 ${asg.desired}`);
        db.events.unshift({ t: now(), method: "SIM", path: "/auto-scaling-groups/scale-in", name: asg.name });
        dirty = true;
      }
    }
  }

  for (const ng of db.nodeGroups) {
    const cluster = db.eksClusters.find((c) => c.id === ng.clusterId);
    if (!cluster || cluster.status !== "ACTIVE" || ng.status === "CREATING") continue;
    const { changed } = reconcileGroup(
      db,
      { ...ng, clusterId: cluster.id },
      "nodegroup",
      {
        name: `${cluster.name}-${ng.name}-node`,
        ami: `ami-eks-optimized-al2023-${cluster.version}`,
        instanceType: ng.instanceType,
        purchasingOption: ng.capacityType === "SPOT" ? "spot" : "on-demand",
        iamRole: ng.nodeRoleName,
        rootVolumeSize: ng.diskSize,
        userData: "#!/bin/bash\n/etc/eks/bootstrap.sh " + cluster.name,
        tags: { [`kubernetes.io/cluster/${cluster.name}`]: "owned", "eks:nodegroup-name": ng.name },
      },
      toTerminate
    );
    dirty = dirty || changed;
  }
  return dirty;
}

/* ---- 쿠버네티스 흉내 ---- */

function nodesOf(db, clusterId) {
  return db.instances.filter((i) => i.managedBy && i.managedBy.type === "nodegroup" && i.managedBy.clusterId === clusterId && i.state === "running");
}

function newPod(dep) {
  const rs = (dep.id.slice(-4) + String(dep.revision)).padEnd(10, "0").slice(0, 10);
  return {
    id: `${dep.name}-${rs}-${randomHex(5)}`,
    deploymentId: dep.id,
    clusterId: dep.clusterId,
    namespace: dep.namespace,
    image: dep.image,
    revision: dep.revision,
    cpu: dep.cpu,
    mem: dep.mem,
    nodeId: null,
    podIp: null,
    state: "Pending",
    reason: "스케줄링 대기 중",
    restarts: 0,
    since: Date.now(),
    createdAt: now(),
  };
}

// 이미지를 받을 수 있는지 확인 (ECR 권한, 인터넷 경로)
function imagePullCheck(db, pod, node) {
  const egress = subnetEgress(db, node.subnetId);
  const ecrPrefix = `${ACCOUNT_ID}.dkr.ecr.ap-northeast-2.amazonaws.com/`;
  if (pod.image.startsWith(ecrPrefix)) {
    const [repoName, tag = "latest"] = pod.image.slice(ecrPrefix.length).split(":");
    const repo = db.ecrRepositories.find((r) => r.name === repoName);
    if (!repo) return `ErrImagePull: ECR 리포지토리 '${repoName}'가 없어요.`;
    if (!repo.images.some((i) => i.tag === tag)) return `ErrImagePull: '${repoName}:${tag}' 이미지가 아직 푸시되지 않았어요.`;
    const role = db.iamRoles.find((r) => r.name === node.iamRole);
    if (!role || !role.attachedPolicies.includes("AmazonEC2ContainerRegistryReadOnly")) {
      return "ErrImagePull: 403 Forbidden — 노드 IAM 역할에 AmazonEC2ContainerRegistryReadOnly 정책이 없어요.";
    }
    if (egress === "none") return "ErrImagePull: 노드 서브넷에서 ECR로 나갈 경로(NAT 게이트웨이 또는 VPC 엔드포인트)가 없어요.";
    return null;
  }
  if (egress === "none") return "ErrImagePull: 노드가 프라이빗 서브넷에 있고 NAT 게이트웨이가 없어 외부 레지스트리(Docker Hub 등)에 접근할 수 없어요.";
  if (!/^[a-z0-9./_-]+(:[\w.-]+)?$/i.test(pod.image)) return "InvalidImageName: 이미지 이름 형식이 올바르지 않아요.";
  return null;
}

function tickKubernetes(db) {
  let dirty = false;
  const nowMs = Date.now();

  // 0) 종료 중인 파드 정리, 죽은 노드 위의 파드 제거
  const before = db.pods.length;
  db.pods = db.pods.filter((p) => {
    if (p.state === "Terminating") return nowMs - (p.terminatingSince || nowMs) < 2000 || !p.terminatingSince;
    if (p.nodeId) {
      const node = db.instances.find((i) => i.id === p.nodeId);
      if (!node || node.state !== "running") return false; // 노드가 사라지면 파드도 사라짐 → 디플로이먼트가 다시 만듦
    }
    return true;
  });
  db.pods.forEach((p) => {
    if (p.state === "Terminating" && !p.terminatingSince) {
      p.terminatingSince = nowMs;
      dirty = true;
    }
  });
  if (db.pods.length !== before) dirty = true;

  // 1) 디플로이먼트: 원하는 개수 맞추기 + 롤링 업데이트 (maxSurge 1, maxUnavailable 0)
  for (const dep of db.deployments) {
    const live = db.pods.filter((p) => p.deploymentId === dep.id && p.state !== "Terminating");
    const oldPods = live.filter((p) => p.revision < dep.revision);
    const newPods = live.filter((p) => p.revision === dep.revision);
    if (dep.replicas === 0) {
      live.forEach((p) => (p.state = "Terminating"));
      if (live.length) dirty = true;
    } else if (oldPods.length) {
      // 롤링 업데이트: 파드 수를 replicas+1 이하로 유지하면서 옛 파드를 새 파드로 교체
      const newReady = newPods.filter((p) => p.state === "Running").length;
      const byUnready = oldPods.slice().sort((a, b) => (a.state === "Running") - (b.state === "Running"));
      if (live.length > dep.replicas + 1) {
        byUnready.slice(0, live.length - (dep.replicas + 1)).forEach((p) => (p.state = "Terminating"));
        dirty = true;
      } else if (live.length > dep.replicas && oldPods.length + newReady > dep.replicas) {
        byUnready[0].state = "Terminating";
        dirty = true;
      } else if (newPods.length < dep.replicas && live.length < dep.replicas + 1) {
        db.pods.push(newPod(dep));
        dirty = true;
      }
    } else if (live.length < dep.replicas) {
      // ReplicaSet처럼 부족한 개수를 한 번에 만듦
      for (let k = live.length; k < dep.replicas; k++) db.pods.push(newPod(dep));
      dirty = true;
    } else if (live.length > dep.replicas) {
      live
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, live.length - dep.replicas)
        .forEach((p) => (p.state = "Terminating"));
      dirty = true;
    }
  }
  // 주인 없는 파드(디플로이먼트 삭제됨)는 종료
  db.pods.forEach((p) => {
    if (p.state !== "Terminating" && !db.deployments.some((d) => d.id === p.deploymentId)) {
      p.state = "Terminating";
      dirty = true;
    }
  });

  // 2) 스케줄링: Pending 파드를 여유 있는 노드에 배치
  const capacityOf = require("../routes/eks").nodeCapacity;
  for (const pod of db.pods.filter((p) => p.state === "Pending")) {
    const nodes = nodesOf(db, pod.clusterId);
    if (!nodes.length) {
      if (pod.reason !== "0/0 nodes are available: 노드 그룹이 없거나 노드가 아직 준비되지 않았어요.") {
        pod.reason = "0/0 nodes are available: 노드 그룹이 없거나 노드가 아직 준비되지 않았어요.";
        dirty = true;
      }
      continue;
    }
    const fits = nodes
      .map((n) => {
        const cap = capacityOf(n.instanceType);
        const onNode = db.pods.filter((p) => p.nodeId === n.id && p.state !== "Terminating");
        const used = { cpu: onNode.reduce((s, p) => s + p.cpu, 0), mem: onNode.reduce((s, p) => s + p.mem, 0), pods: onNode.length };
        return { n, cap, used };
      })
      .filter(({ cap, used }) => used.cpu + pod.cpu <= cap.cpu && used.mem + pod.mem <= cap.mem && used.pods + 1 <= cap.pods)
      .sort((a, b) => a.used.cpu / a.cap.cpu - b.used.cpu / b.cap.cpu);
    if (!fits.length) {
      const msg = `0/${nodes.length} nodes are available: Insufficient cpu/memory 또는 노드당 최대 파드 수(VPC CNI IP 한도) 초과. 노드를 늘리거나 requests를 줄이세요.`;
      if (pod.reason !== msg) {
        pod.reason = msg;
        dirty = true;
      }
      continue;
    }
    const node = fits[0].n;
    const subnet = db.subnets.find((s) => s.id === node.subnetId);
    Object.assign(pod, { nodeId: node.id, podIp: randomPrivateIp(subnet && subnet.cidrBlock), state: "ContainerCreating", reason: "이미지 받는 중", since: nowMs });
    dirty = true;
  }

  // 3) 컨테이너 시작 / 이미지 받기 실패 → 재시도(ImagePullBackOff)
  for (const pod of db.pods) {
    const retryDue = pod.state === "ImagePullBackOff" && nowMs - pod.since > 8000;
    if ((pod.state === "ContainerCreating" && nowMs - pod.since > 2500) || retryDue) {
      const node = db.instances.find((i) => i.id === pod.nodeId);
      const err = node ? imagePullCheck(db, pod, node) : "노드 없음";
      if (err) {
        Object.assign(pod, { state: "ImagePullBackOff", reason: err, since: nowMs, restarts: pod.restarts + (retryDue ? 1 : 0) });
      } else {
        Object.assign(pod, { state: "Running", reason: "", since: nowMs, startedAt: now() });
      }
      dirty = true;
    }
  }

  // 4) 서비스/인그레스가 만든 대상 그룹(IP 타입)에 Running 파드 반영
  for (const tg of db.targetGroups) {
    if (!tg.managedBy || !tg.managedBy.deploymentId) continue;
    const ids = db.pods.filter((p) => p.deploymentId === tg.managedBy.deploymentId && p.state === "Running").map((p) => p.id);
    if (ids.join() !== tg.targets.join()) {
      tg.targets = ids;
      dirty = true;
    }
  }
  for (const svc of db.k8sServices) {
    const lb = db.loadBalancers.find((l) => l.id === svc.loadBalancerId);
    if (lb && lb.state === "active" && svc.status !== "Ready") {
      svc.status = "Ready";
      svc.message = "";
      dirty = true;
    }
  }
  for (const ing of db.ingresses) {
    const lb = db.loadBalancers.find((l) => l.id === ing.loadBalancerId);
    if (lb && lb.state === "active" && ing.message) {
      ing.message = "";
      dirty = true;
    }
  }
  return dirty;
}

/* ---- CloudWatch 경보 ---- */

function tickAlarms(db) {
  let dirty = false;
  const m = metrics.current(db);
  const labels = { cpu: "CPU 사용률", mem: "메모리 사용률", rps: "초당 요청 수" };
  for (const a of db.alarms) {
    let state;
    let reason;
    if (!m.hasCompute) {
      state = "INSUFFICIENT_DATA";
      reason = "실행 중인 컴퓨팅 리소스가 없어 데이터가 없어요";
    } else {
      const v = m[a.metric];
      const breach = a.comparison === "gt" ? v > a.threshold : v < a.threshold;
      state = breach ? "ALARM" : "OK";
      reason = `${labels[a.metric]} ${v} ${a.comparison === "gt" ? ">" : "<"} ${a.threshold} ${breach ? "→ 임계값 위반" : "조건 미충족"}`;
    }
    if (state !== a.state) {
      a.history.unshift({ t: now(), from: a.state, to: state, reason });
      if (a.history.length > 20) a.history.length = 20;
      if (state === "ALARM") db.events.unshift({ t: now(), method: "SIM", path: "/alarms/alarm", name: a.name });
      a.state = state;
      dirty = true;
    }
    a.stateReason = reason;
  }
  return dirty;
}

function tick() {
  try {
    const db = readDB();
    const toTerminate = [];
    const d1 = tickGroups(db, toTerminate);
    const d2 = tickKubernetes(db);
    const d3 = tickAlarms(db);
    if (db.events.length > 150) db.events.length = 150;
    if (d1 || d2 || d3 || db.alarms.length) writeDB(db);
    toTerminate.forEach((id) => terminateInstance(id));
  } catch (e) {
    console.error("[sim] tick 실패:", e.message);
  }
}

function start() {
  setInterval(tick, TICK_MS);
}

module.exports = { start, tick };
