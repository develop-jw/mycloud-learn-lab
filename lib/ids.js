/* ---- AWS 스타일 리소스 ID 생성기 ---- */
// 실제 AWS도 "vpc-0a1b2c3d4e5f6a7b8" 처럼 접두사 + 랜덤 16진수 문자열로
// 리소스 ID를 만듭니다. 여기서도 똑같은 모양으로 만들어서 진짜처럼 보이게 해요.

function randomHex(length) {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function makeId(prefix) {
  return `${prefix}-${randomHex(17)}`;
}

const newVpcId = () => makeId("vpc");
const newSubnetId = () => makeId("subnet");
const newSgId = () => makeId("sg");
const newInstanceId = () => makeId("i");
const newDbInstanceId = () => `mydb-${randomHex(8)}`;
const newIgwId = () => makeId("igw");
const newRouteTableId = () => makeId("rtb");
const newNaclId = () => makeId("acl");
const newVolumeId = () => makeId("vol");
const newSnapshotId = () => makeId("snap");

// 가짜 퍼블릭 IP (실제처럼 보이는 랜덤 IP)
function randomPublicIp() {
  const oct = () => Math.floor(Math.random() * 200) + 20;
  return `${oct()}.${oct()}.${oct()}.${oct()}`;
}

module.exports = {
  newVpcId,
  newSubnetId,
  newSgId,
  newInstanceId,
  newDbInstanceId,
  newIgwId,
  newRouteTableId,
  newNaclId,
  newVolumeId,
  newSnapshotId,
  randomPublicIp,
};
