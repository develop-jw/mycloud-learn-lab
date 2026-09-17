/* ---- 예상 비용 계산 (학습용 근사치) ---- */
// 실제 요금은 리전·시점·할인에 따라 달라요. 여기 숫자는 "어떤 리소스가 돈이 드는지"
// 감을 잡기 위한 대략적인 서울 리전 온디맨드 기준값입니다.

const { typeSpec } = require("./compute");

const HOURS_PER_MONTH = 730;

const PRICE = {
  ebsGp3PerGb: 0.0912, // 월
  ebsIo2PerGb: 0.1428,
  ebsHddPerGb: 0.051,
  publicIpv4: 0.005, // 시간당 (퍼블릭 IPv4 / 탄력적 IP 공통)
  natGateway: 0.059,
  alb: 0.0225,
  nlb: 0.0225,
  eksCluster: 0.1,
  vpnConnection: 0.05,
  dxPort: { "1Gbps": 0.3, "10Gbps": 2.25 },
  rds: { "db.t3.micro": 0.026, "db.t3.small": 0.052, "db.m5.large": 0.236 },
  rdsStoragePerGb: 0.131,
  cache: { "cache.t3.micro": 0.025, "cache.t3.small": 0.05, "cache.m5.large": 0.201 },
  efsPerGb: 0.33,
  s3PerGb: 0.025,
  hostedZone: 0.5, // 월
  cloudfrontBase: 1.0, // 월 (소량 트래픽 가정)
  ecrPerGb: 0.1,
  spotDiscount: 0.3, // 스팟은 온디맨드의 약 30% 가격으로 가정
};

function volumePerGb(type) {
  if (type === "io2") return PRICE.ebsIo2PerGb;
  if (type === "st1" || type === "sc1") return PRICE.ebsHddPerGb;
  return PRICE.ebsGp3PerGb;
}

// 리소스 한 줄 = { service, name, monthly, note }
function estimateCost(db) {
  const items = [];
  const add = (service, name, monthly, note) => items.push({ service, name, monthly: Math.round(monthly * 100) / 100, note });

  db.instances
    .filter((i) => ["running", "pending", "rebooting"].includes(i.state))
    .forEach((i) => {
      const spec = typeSpec(i.instanceType);
      const hourly = spec.price * (i.purchasingOption === "spot" ? PRICE.spotDiscount : 1);
      add("EC2", i.name, hourly * HOURS_PER_MONTH, `${i.instanceType}${i.purchasingOption === "spot" ? " · 스팟" : ""}`);
      if (i.publicIp) add("VPC", `${i.name} 퍼블릭 IPv4`, PRICE.publicIpv4 * HOURS_PER_MONTH, "퍼블릭 IPv4 주소도 시간당 과금");
    });

  db.volumes.forEach((v) => add("EBS", v.name, v.size * volumePerGb(v.type), `${v.size}GiB ${v.type}${v.state === "available" ? " · 미연결" : ""}`));

  db.elasticIps
    .filter((e) => !e.instanceId && !e.natGatewayId)
    .forEach((e) => add("VPC", `탄력적 IP ${e.publicIp}`, PRICE.publicIpv4 * HOURS_PER_MONTH, "연결 안 된 탄력적 IP"));

  db.natGateways
    .filter((n) => n.state !== "deleted")
    .forEach((n) => add("VPC", n.name, PRICE.natGateway * HOURS_PER_MONTH, "NAT 게이트웨이 (데이터 처리 요금 별도)"));

  db.loadBalancers.forEach((lb) =>
    add("ELB", lb.name, (lb.type === "network" ? PRICE.nlb : PRICE.alb) * HOURS_PER_MONTH, lb.type === "network" ? "NLB" : "ALB")
  );

  db.eksClusters.forEach((c) => add("EKS", c.name, PRICE.eksCluster * HOURS_PER_MONTH, "컨트롤 플레인 (워커 노드는 EC2로 별도)"));

  db.vpnConnections.forEach((v) => add("VPN", v.name, PRICE.vpnConnection * HOURS_PER_MONTH, "Site-to-Site VPN 연결"));
  db.dxConnections.forEach((d) => add("Direct Connect", d.name, (PRICE.dxPort[d.bandwidth] || 0.3) * HOURS_PER_MONTH, `${d.bandwidth} 포트`));

  db.dbInstances
    .filter((d) => d.state !== "deleting")
    .forEach((d) => {
      const hourly = (PRICE.rds[d.instanceClass] || 0.1) * (d.multiAz ? 2 : 1);
      add("RDS", d.identifier, hourly * HOURS_PER_MONTH + d.allocatedStorage * PRICE.rdsStoragePerGb * (d.multiAz ? 2 : 1), `${d.instanceClass}${d.multiAz ? " · Multi-AZ(×2)" : ""}`);
    });

  db.cacheClusters.forEach((c) => add("ElastiCache", c.name, (PRICE.cache[c.nodeType] || 0.05) * c.numNodes * HOURS_PER_MONTH, `${c.nodeType} × ${c.numNodes}`));

  db.efsFileSystems.forEach((f) => add("EFS", f.name, Math.max(1, f.sizeGb || 1) * PRICE.efsPerGb, "저장한 용량만큼"));

  db.buckets.forEach((b) => add("S3", b.name, Math.max(0.01, (b.sizeBytes || 0) / 1e9) * PRICE.s3PerGb, "저장 용량 + 요청 수"));

  db.hostedZones.forEach((z) => add("Route 53", z.domain, PRICE.hostedZone, "호스팅 영역"));
  db.cloudfrontDistributions.forEach((c) => add("CloudFront", c.domainName || c.id, PRICE.cloudfrontBase, "전송량 기준 (소량 가정)"));
  db.ecrRepositories.forEach((r) => add("ECR", r.name, Math.max(0.05, r.images.length * 0.15) * PRICE.ecrPerGb, `이미지 ${r.images.length}개`));

  const total = items.reduce((s, i) => s + i.monthly, 0);

  // Well-Architected '비용 최적화' 관점의 절약 팁
  const tips = [];
  const idleEips = db.elasticIps.filter((e) => !e.instanceId && !e.natGatewayId).length;
  if (idleEips) tips.push(`연결되지 않은 탄력적 IP ${idleEips}개를 해제하면 절약할 수 있어요.`);
  const idleVols = db.volumes.filter((v) => v.state === "available").length;
  if (idleVols) tips.push(`어디에도 연결되지 않은 EBS 볼륨 ${idleVols}개가 있어요. 스냅샷을 남기고 삭제를 검토하세요.`);
  const onDemand = db.instances.filter((i) => i.state === "running" && i.purchasingOption !== "spot").length;
  if (onDemand >= 3) tips.push("중단돼도 괜찮은 작업이면 스팟 인스턴스로 최대 70~90%까지 줄일 수 있어요.");
  if (db.natGateways.length > 1) tips.push("NAT 게이트웨이는 AZ마다 두면 안정적이지만 비용도 그만큼 늘어요. 개발 환경이면 1개로 충분할 수 있어요.");
  const stopped = db.instances.filter((i) => i.state === "stopped").length;
  if (stopped) tips.push(`중지된 인스턴스 ${stopped}대는 EC2 요금은 안 나가지만 EBS 볼륨 요금은 계속 나가요.`);

  return { items, total: Math.round(total * 100) / 100, tips, hoursPerMonth: HOURS_PER_MONTH };
}

module.exports = { estimateCost, PRICE };
