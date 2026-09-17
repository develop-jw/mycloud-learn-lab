/* ---- 네트워크 판정 도우미 ---- */
// 서브넷이 퍼블릭인지, 인터넷으로 나가는 길이 있는지를 "라우팅 테이블"을 보고 계산합니다.
// 실제 AWS에도 '퍼블릭 서브넷' 체크박스는 없어요. 라우트가 전부 결정합니다.

function routeTableOf(db, subnetId) {
  return db.routeTables.find((rt) => rt.subnetIds.includes(subnetId)) || null;
}

// 라우트 타깃이 실제로 살아있는지 (지워진 NAT 등을 가리키면 blackhole)
function routeTargetAlive(db, target) {
  if (target === "local") return true;
  if (target.startsWith("igw-")) return db.internetGateways.some((g) => g.id === target && g.state === "attached");
  if (target.startsWith("nat-")) return db.natGateways.some((n) => n.id === target && n.state === "available");
  if (target.startsWith("vgw-")) return db.vpnGateways.some((v) => v.id === target && v.vpcId);
  return false;
}

function hasDefaultRouteTo(db, subnetId, prefix) {
  const rt = routeTableOf(db, subnetId);
  if (!rt) return false;
  return rt.routes.some((r) => r.destination === "0.0.0.0/0" && r.target.startsWith(prefix) && routeTargetAlive(db, r.target));
}

function isSubnetPublic(db, subnetId) {
  return hasDefaultRouteTo(db, subnetId, "igw-");
}

// 'igw' = 인터넷 양방향 / 'nat' = 나가는 것만 가능 / 'none' = 외부 통신 불가
function subnetEgress(db, subnetId) {
  if (isSubnetPublic(db, subnetId)) return "igw";
  if (hasDefaultRouteTo(db, subnetId, "nat-")) return "nat";
  return "none";
}

// 서브넷 CIDR에서 실제로 쓸 수 있는 IP 개수 (AWS가 서브넷마다 5개를 예약)
function usableIps(cidr) {
  const bits = Number(String(cidr).split("/")[1]);
  if (!bits || bits > 28 || bits < 16) return null;
  return 2 ** (32 - bits) - 5;
}

function subnetView(db, s) {
  return {
    ...s,
    isPublic: isSubnetPublic(db, s.id),
    egress: subnetEgress(db, s.id),
    usableIps: usableIps(s.cidrBlock),
    routeTableId: (routeTableOf(db, s.id) || {}).id || null,
  };
}

// 여러 서브넷이 서로 다른 가용 영역에 걸쳐 있는지 (ALB, EKS 등의 필수 조건)
function distinctAzCount(db, subnetIds) {
  const azs = new Set(
    (subnetIds || []).map((id) => (db.subnets.find((s) => s.id === id) || {}).availabilityZone).filter(Boolean)
  );
  return azs.size;
}

module.exports = { routeTableOf, routeTargetAlive, isSubnetPublic, subnetEgress, usableIps, subnetView, distinctAzCount };
