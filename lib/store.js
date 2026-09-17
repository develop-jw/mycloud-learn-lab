/* ---- 아주 단순한 파일 기반 저장소 ---- */
// 진짜 AWS는 리소스 정보를 자기네 내부 DB에 저장하죠. 우리는 그걸
// data/db.json 이라는 파일 하나에 저장합니다. 실습용이라 이 정도면 충분해요.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

// 리소스 종류별 빈 목록 (새 서비스를 추가하면 여기에도 한 줄 추가)
const EMPTY_DB = {
  // 네트워크
  vpcs: [],
  subnets: [],
  routeTables: [],
  internetGateways: [],
  natGateways: [],
  elasticIps: [],
  securityGroups: [],
  nacls: [],
  vpnGateways: [],
  customerGateways: [],
  vpnConnections: [],
  dxConnections: [],
  // 컴퓨팅
  instances: [],
  volumes: [],
  launchTemplates: [],
  customAmis: [],
  autoScalingGroups: [],
  // 로드 밸런싱 / 엣지
  loadBalancers: [],
  targetGroups: [],
  cloudfrontDistributions: [],
  hostedZones: [],
  // 컨테이너
  eksClusters: [],
  nodeGroups: [],
  ecrRepositories: [],
  deployments: [],
  pods: [],
  k8sServices: [],
  ingresses: [],
  // 스토리지 / 데이터
  buckets: [],
  objectMeta: {},
  efsFileSystems: [],
  dbInstances: [],
  cacheClusters: [],
  // 보안 / 운영
  iamUsers: [],
  iamRoles: [],
  iamPolicies: [],
  alarms: [],
  budget: null,
  events: [],
};

function emptyDb() {
  return JSON.parse(JSON.stringify(EMPTY_DB));
}

// 처음 실행하면 data/db.json이 없으니 빈 구조로 만들어 둡니다 (Git에는 올리지 않는 파일)
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(emptyDb(), null, 2));
}

function readDB() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  // 예전 버전에서 만든 db.json에 새 항목이 없어도 동작하도록 채워 넣기
  const base = emptyDb();
  for (const key of Object.keys(base)) {
    if (db[key] === undefined) db[key] = base[key];
  }
  return db;
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// 한 리소스의 값만 바꾸고 싶을 때 (시간이 지나 상태가 바뀌는 경우 등)
function patchItem(collection, id, patch) {
  const db = readDB();
  const item = (db[collection] || []).find((x) => x.id === id);
  if (!item) return null;
  Object.assign(item, typeof patch === "function" ? patch(item, db) : patch);
  writeDB(db);
  return item;
}

// ms 뒤에 상태 바꾸기 — "생성 중 → 사용 가능" 같은 흐름을 흉내낼 때 사용
function later(ms, collection, id, patch) {
  setTimeout(() => patchItem(collection, id, patch), ms);
}

function removeItem(collection, id) {
  const db = readDB();
  db[collection] = db[collection].filter((x) => x.id !== id);
  writeDB(db);
}

module.exports = { readDB, writeDB, patchItem, later, removeItem, emptyDb };
