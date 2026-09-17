/* ---- 엣지 & DNS: CloudFront / Route 53 ---- */
const express = require("express");
const { readDB, writeDB, later, removeItem } = require("../lib/store");
const { makeId, randomHex, randomPublicIp } = require("../lib/ids");

const router = express.Router();
const now = () => new Date().toISOString();

/* ===== CloudFront 배포 ===== */
// 전 세계 엣지 로케이션에 콘텐츠를 캐싱하는 CDN. 원본(Origin)은 S3 버킷이나 로드 밸런서.

function originLabel(db, d) {
  if (d.originType === "s3") return `${d.originId}.s3.ap-northeast-2.amazonaws.com`;
  const lb = db.loadBalancers.find((l) => l.id === d.originId);
  return lb ? lb.dnsName : "(삭제된 원본)";
}

router.get("/cloudfront", (req, res) => {
  const db = readDB();
  res.json(db.cloudfrontDistributions.map((d) => ({ ...d, originDomain: originLabel(db, d) })));
});

router.post("/cloudfront", (req, res) => {
  const { originType, originId, priceClass, viewerProtocol, defaultTtl, wafEnabled, comment, useOac } = req.body;
  const db = readDB();
  if (originType === "s3") {
    const bucket = db.buckets.find((b) => b.name === originId);
    if (!bucket) return res.status(400).json({ error: "원본으로 쓸 S3 버킷을 선택하세요." });
  } else if (originType === "elb") {
    const lb = db.loadBalancers.find((l) => l.id === originId);
    if (!lb) return res.status(400).json({ error: "원본으로 쓸 로드 밸런서를 선택하세요." });
    if (lb.scheme === "internal") return res.status(400).json({ error: "CloudFront는 인터넷에서 접근 가능한(internet-facing) 로드 밸런서만 원본으로 쓸 수 있어요." });
  } else {
    return res.status(400).json({ error: "원본 유형을 선택하세요 (S3 또는 로드 밸런서)." });
  }
  const dist = {
    id: `E${randomHex(13).toUpperCase()}`,
    comment: comment || "",
    domainName: `d${randomHex(13)}.cloudfront.net`,
    originType,
    originId,
    useOac: originType === "s3" ? useOac !== false : false,
    priceClass: priceClass || "PriceClass_All",
    viewerProtocol: viewerProtocol || "redirect-to-https",
    defaultTtl: Number(defaultTtl) || 86400,
    wafEnabled: !!wafEnabled,
    enabled: true,
    status: "InProgress",
    invalidations: [],
    createdAt: now(),
  };
  db.cloudfrontDistributions.push(dist);
  writeDB(db);
  // 전 세계 엣지에 배포되는 데 실제로는 수 분 걸림
  later(7000, "cloudfrontDistributions", dist.id, { status: "Deployed" });
  res.status(201).json(dist);
});

router.post("/cloudfront/:id/toggle", (req, res) => {
  const db = readDB();
  const d = db.cloudfrontDistributions.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "배포를 찾을 수 없어요." });
  d.enabled = !d.enabled;
  d.status = "InProgress";
  writeDB(db);
  later(4000, "cloudfrontDistributions", d.id, { status: "Deployed" });
  res.json(d);
});

router.post("/cloudfront/:id/invalidations", (req, res) => {
  const db = readDB();
  const d = db.cloudfrontDistributions.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "배포를 찾을 수 없어요." });
  const paths = String(req.body.paths || "/*").split(/[\s,]+/).filter(Boolean);
  const inv = { id: `I${randomHex(12).toUpperCase()}`, paths, status: "InProgress", createdAt: now() };
  d.invalidations.unshift(inv);
  writeDB(db);
  setTimeout(() => {
    const d2 = readDB();
    const dist = d2.cloudfrontDistributions.find((x) => x.id === d.id);
    const i = dist && dist.invalidations.find((x) => x.id === inv.id);
    if (i) i.status = "Completed";
    writeDB(d2);
  }, 3000);
  res.status(201).json(inv);
});

router.delete("/cloudfront/:id", (req, res) => {
  const db = readDB();
  const d = db.cloudfrontDistributions.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "배포를 찾을 수 없어요." });
  if (d.enabled) return res.status(409).json({ error: "DistributionNotDisabled: 먼저 배포를 비활성화한 뒤 삭제할 수 있어요." });
  if (d.status !== "Deployed") return res.status(409).json({ error: "배포 상태 변경이 끝난 뒤(Deployed) 삭제할 수 있어요." });
  if (db.hostedZones.some((z) => z.records.some((r) => r.alias && r.alias.targetId === d.id))) {
    return res.status(409).json({ error: "Route 53 레코드가 이 배포를 가리키고 있어요. 레코드를 먼저 지우세요." });
  }
  removeItem("cloudfrontDistributions", d.id);
  res.json({ ok: true });
});

/* ===== Route 53 호스팅 영역 & 레코드 ===== */

router.get("/hosted-zones", (req, res) => res.json(readDB().hostedZones));

router.post("/hosted-zones", (req, res) => {
  const domain = String(req.body.domain || "").trim().replace(/\.$/, "").toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return res.status(400).json({ error: "도메인 형식이 올바르지 않아요. 예: myservice.com" });
  const db = readDB();
  if (db.hostedZones.some((z) => z.domain === domain)) return res.status(409).json({ error: "이미 같은 도메인의 호스팅 영역이 있어요." });
  const isPrivate = req.body.type === "private";
  if (isPrivate && !db.vpcs.some((v) => v.id === req.body.vpcId)) return res.status(400).json({ error: "프라이빗 호스팅 영역은 연결할 VPC가 필요해요." });
  const ns = ["ns-" + randomHex(3) + ".awsdns-" + randomHex(2) + ".com", "ns-" + randomHex(3) + ".awsdns-" + randomHex(2) + ".net"];
  const zone = {
    id: `Z${randomHex(20).toUpperCase()}`,
    domain,
    type: isPrivate ? "private" : "public",
    vpcId: isPrivate ? req.body.vpcId : null,
    records: [
      { id: makeId("rr", 8), name: domain, type: "NS", ttl: 172800, values: ns, system: true },
      { id: makeId("rr", 8), name: domain, type: "SOA", ttl: 900, values: [`${ns[0]}. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400`], system: true },
    ],
    createdAt: now(),
  };
  db.hostedZones.push(zone);
  writeDB(db);
  res.status(201).json(zone);
});

function aliasTarget(db, alias) {
  if (!alias) return null;
  if (alias.targetType === "elb") {
    const lb = db.loadBalancers.find((l) => l.id === alias.targetId);
    return lb ? { label: lb.dnsName, ok: true } : null;
  }
  if (alias.targetType === "cloudfront") {
    const d = db.cloudfrontDistributions.find((x) => x.id === alias.targetId);
    return d ? { label: d.domainName, ok: true } : null;
  }
  if (alias.targetType === "s3website") {
    const b = db.buckets.find((x) => x.name === alias.targetId);
    return b && b.website ? { label: `${b.name}.s3-website.ap-northeast-2.amazonaws.com`, ok: true } : null;
  }
  return null;
}

router.post("/hosted-zones/:id/records", (req, res) => {
  const db = readDB();
  const zone = db.hostedZones.find((z) => z.id === req.params.id);
  if (!zone) return res.status(404).json({ error: "호스팅 영역을 찾을 수 없어요." });
  const { name, type, value, ttl, alias, routingPolicy, weight, failoverRole } = req.body;
  const sub = String(name || "").trim().replace(/\.$/, "");
  const fqdn = sub ? (sub.endsWith(zone.domain) ? sub : `${sub}.${zone.domain}`) : zone.domain;
  const recType = type || "A";
  if (!["A", "AAAA", "CNAME", "TXT", "MX"].includes(recType)) return res.status(400).json({ error: "지원하는 레코드 유형: A, AAAA, CNAME, TXT, MX" });
  if (recType === "CNAME" && fqdn === zone.domain) return res.status(400).json({ error: "루트 도메인(zone apex)에는 CNAME을 쓸 수 없어요. 별칭(Alias) A 레코드를 쓰세요." });
  let record;
  if (alias && alias.targetId) {
    const target = aliasTarget(db, alias);
    if (!target) return res.status(400).json({ error: "별칭 대상을 찾을 수 없어요 (S3 대상은 정적 웹사이트 호스팅이 켜져 있어야 해요)." });
    record = { name: fqdn, type: "A", alias: { targetType: alias.targetType, targetId: alias.targetId, dnsName: target.label } };
  } else {
    if (!value) return res.status(400).json({ error: "값을 입력하세요 (예: A 레코드면 IP 주소)." });
    if (recType === "A" && !/^\d+\.\d+\.\d+\.\d+$/.test(value)) return res.status(400).json({ error: "A 레코드 값은 IPv4 주소여야 해요." });
    record = { name: fqdn, type: recType, ttl: Number(ttl) || 300, values: [value] };
  }
  const policy = ["weighted", "failover", "latency"].includes(routingPolicy) ? routingPolicy : "simple";
  if (policy === "simple" && zone.records.some((r) => r.name === record.name && r.type === record.type && !r.system)) {
    return res.status(409).json({ error: "같은 이름·유형의 단순 라우팅 레코드가 이미 있어요. 가중치/장애 조치 정책을 쓰거나 기존 레코드를 수정하세요." });
  }
  Object.assign(record, {
    id: makeId("rr", 8),
    routingPolicy: policy,
    weight: policy === "weighted" ? Number(weight) || 50 : null,
    failoverRole: policy === "failover" ? (failoverRole === "SECONDARY" ? "SECONDARY" : "PRIMARY") : null,
  });
  zone.records.push(record);
  writeDB(db);
  res.status(201).json(zone);
});

router.delete("/hosted-zones/:id/records/:recordId", (req, res) => {
  const db = readDB();
  const zone = db.hostedZones.find((z) => z.id === req.params.id);
  if (!zone) return res.status(404).json({ error: "호스팅 영역을 찾을 수 없어요." });
  const rec = zone.records.find((r) => r.id === req.params.recordId);
  if (rec && rec.system) return res.status(400).json({ error: "기본 NS/SOA 레코드는 삭제할 수 없어요." });
  zone.records = zone.records.filter((r) => r.id !== req.params.recordId);
  writeDB(db);
  res.json(zone);
});

// DNS 조회 흉내: 이름 → 최종 목적지
router.get("/dns-lookup", (req, res) => {
  const db = readDB();
  const q = String(req.query.name || "").toLowerCase().replace(/\.$/, "");
  for (const z of db.hostedZones) {
    const recs = z.records.filter((r) => r.name === q && !r.system);
    if (recs.length) {
      return res.json({
        zone: z.domain,
        answers: recs.map((r) => ({ type: r.type, routingPolicy: r.routingPolicy, answer: r.alias ? (aliasTarget(db, r.alias) || {}).label || "(대상 없음)" : r.values.join(", "), alias: !!r.alias })),
        resolvedIp: randomPublicIp(),
      });
    }
  }
  res.status(404).json({ error: `NXDOMAIN: ${q} 레코드를 찾을 수 없어요.` });
});

router.delete("/hosted-zones/:id", (req, res) => {
  const db = readDB();
  const zone = db.hostedZones.find((z) => z.id === req.params.id);
  if (zone && zone.records.some((r) => !r.system)) return res.status(409).json({ error: "HostedZoneNotEmpty: 기본 NS/SOA 외의 레코드를 먼저 삭제하세요." });
  removeItem("hostedZones", req.params.id);
  res.json({ ok: true });
});

module.exports = router;
