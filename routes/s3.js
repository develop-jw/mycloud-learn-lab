/* ---- S3 서비스: 버킷 / 객체(파일) ---- */
// 여기는 흉내가 아니라 "진짜로" 동작합니다. 업로드한 파일이 서버 디스크의
// uploads/<버킷이름>/ 폴더에 실제로 저장되고, 다시 다운로드할 수 있어요.
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { readDB, writeDB } = require("../lib/store");

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");

const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const STORAGE_CLASSES = ["STANDARD", "INTELLIGENT_TIERING", "STANDARD_IA", "GLACIER", "DEEP_ARCHIVE"];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, req.params.name);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

function objectMetaKey(bucket, key) {
  return `${bucket}::${key}`;
}

/* ===== 버킷 ===== */

router.get("/buckets", (req, res) => {
  res.json(readDB().buckets);
});

router.post("/buckets", (req, res) => {
  const { name, region, blockPublicAccess, versioning } = req.body;
  const db = readDB();

  // 실제 S3처럼 버킷 이름 규칙을 흉내냅니다 (소문자/숫자/하이픈, 3~63자)
  if (!BUCKET_NAME_RE.test(name || "")) {
    return res.status(400).json({
      error: "버킷 이름은 소문자, 숫자, 하이픈만 사용해 3~63자로 지어주세요.",
    });
  }
  if (db.buckets.find((b) => b.name === name)) {
    return res.status(409).json({ error: "이미 존재하는 버킷 이름입니다. (S3 버킷 이름은 전역에서 고유해야 해요)" });
  }

  const bucket = {
    name,
    region: region || "ap-northeast-2",
    blockPublicAccess: blockPublicAccess !== false,
    versioning: !!versioning,
    createdAt: new Date().toISOString(),
  };
  db.buckets.push(bucket);
  writeDB(db);
  fs.mkdirSync(path.join(UPLOAD_ROOT, name), { recursive: true });
  res.status(201).json(bucket);
});

router.post("/buckets/:name/public-access-block", (req, res) => {
  const { blockPublicAccess } = req.body;
  const db = readDB();
  const bucket = db.buckets.find((b) => b.name === req.params.name);
  if (!bucket) return res.status(404).json({ error: "버킷을 찾을 수 없습니다." });
  bucket.blockPublicAccess = !!blockPublicAccess;
  writeDB(db);
  res.json(bucket);
});

router.delete("/buckets/:name", (req, res) => {
  const dir = path.join(UPLOAD_ROOT, req.params.name);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  if (files.length > 0) {
    return res.status(409).json({ error: "버킷 안에 객체가 남아있어 삭제할 수 없습니다. 먼저 비워주세요." });
  }
  const db = readDB();
  db.buckets = db.buckets.filter((b) => b.name !== req.params.name);
  writeDB(db);
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

/* ===== 객체(파일) ===== */

router.get("/buckets/:name/objects", (req, res) => {
  const dir = path.join(UPLOAD_ROOT, req.params.name);
  if (!fs.existsSync(dir)) return res.json([]);
  const db = readDB();
  const objects = fs.readdirSync(dir).map((key) => {
    const stat = fs.statSync(path.join(dir, key));
    const meta = db.objectMeta && db.objectMeta[objectMetaKey(req.params.name, key)];
    return {
      key,
      size: stat.size,
      lastModified: stat.mtime,
      storageClass: (meta && meta.storageClass) || "STANDARD",
      url: `/s3-objects/${encodeURIComponent(req.params.name)}/${encodeURIComponent(key)}`,
    };
  });
  res.json(objects);
});

router.post("/buckets/:name/objects", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "업로드할 파일이 없습니다." });
  const storageClass = STORAGE_CLASSES.includes(req.body.storageClass) ? req.body.storageClass : "STANDARD";
  const db = readDB();
  db.objectMeta = db.objectMeta || {};
  db.objectMeta[objectMetaKey(req.params.name, req.file.originalname)] = {
    storageClass,
    uploadedAt: new Date().toISOString(),
  };
  writeDB(db);
  res.status(201).json({ key: req.file.originalname, size: req.file.size, storageClass });
});

router.delete("/buckets/:name/objects/:key", (req, res) => {
  const filePath = path.join(UPLOAD_ROOT, req.params.name, req.params.key);
  fs.rmSync(filePath, { force: true });
  const db = readDB();
  if (db.objectMeta) delete db.objectMeta[objectMetaKey(req.params.name, req.params.key)];
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
