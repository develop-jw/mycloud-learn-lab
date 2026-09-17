/* ---- RDS 서비스: 데이터베이스 인스턴스 ---- */
const express = require("express");
const { readDB, writeDB } = require("../lib/store");
const { newDbInstanceId } = require("../lib/ids");

const router = express.Router();

const CREATING_MS = 5000;
const DELETING_MS = 3000;

function updateDbInstance(id, patch) {
  const db = readDB();
  const inst = db.dbInstances.find((i) => i.id === id);
  if (!inst) return;
  Object.assign(inst, patch);
  writeDB(db);
}

router.get("/db-instances", (req, res) => {
  // 비밀번호는 목록 응답에서 절대 내려주지 않음 (실제 AWS도 마스터 비번은 다시 못 봄)
  const list = readDB().dbInstances.map(({ masterPassword, ...rest }) => rest);
  res.json(list);
});

router.post("/db-instances", (req, res) => {
  const {
    identifier,
    engine,
    instanceClass,
    allocatedStorage,
    masterUsername,
    masterPassword,
    vpcId,
    publiclyAccessible,
  } = req.body;

  const db = readDB();
  if (!identifier || !masterUsername || !masterPassword) {
    return res.status(400).json({ error: "DB 식별자, 마스터 사용자명, 비밀번호는 필수입니다." });
  }
  if (db.dbInstances.find((i) => i.identifier === identifier)) {
    return res.status(409).json({ error: "이미 존재하는 DB 인스턴스 식별자입니다." });
  }

  const dbInstance = {
    id: newDbInstanceId(),
    identifier,
    engine: engine || "postgres",
    instanceClass: instanceClass || "db.t3.micro",
    allocatedStorage: allocatedStorage || 20,
    masterUsername,
    masterPassword, // 저장은 하되 목록 조회 시엔 절대 안 내려줌
    vpcId,
    publiclyAccessible: !!publiclyAccessible,
    state: "creating",
    endpoint: null,
    port: engine === "mysql" ? 3306 : 5432,
    createdAt: new Date().toISOString(),
  };
  db.dbInstances.push(dbInstance);
  writeDB(db);

  setTimeout(() => {
    const rand = Math.random().toString(16).slice(2, 13);
    updateDbInstance(dbInstance.id, {
      state: "available",
      endpoint: `${identifier}.${rand}.ap-northeast-2.rds.amazonaws.com`,
    });
  }, CREATING_MS);

  const { masterPassword: _pw, ...safe } = dbInstance;
  res.status(201).json(safe);
});

router.delete("/db-instances/:id", (req, res) => {
  updateDbInstance(req.params.id, { state: "deleting" });
  setTimeout(() => {
    const db = readDB();
    db.dbInstances = db.dbInstances.filter((i) => i.id !== req.params.id);
    writeDB(db);
  }, DELETING_MS);
  res.json({ ok: true });
});

module.exports = router;
