/* ---- 아주 단순한 파일 기반 저장소 ---- */
// 진짜 AWS는 리소스 정보를 자기네 내부 DB에 저장하죠. 우리는 그걸
// data/db.json 이라는 파일 하나에 저장합니다. 실습용이라 이 정도면 충분해요.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

const EMPTY_DB = {
  vpcs: [],
  subnets: [],
  securityGroups: [],
  instances: [],
  buckets: [],
  dbInstances: [],
  internetGateways: [],
  routeTables: [],
  nacls: [],
  volumes: [],
  objectMeta: {},
};

// 처음 실행하면 data/db.json이 없으니 빈 구조로 만들어 둡니다 (Git에는 올리지 않는 파일)
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY_DB, null, 2));
}

function readDB() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

module.exports = { readDB, writeDB };
