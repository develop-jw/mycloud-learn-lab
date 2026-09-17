/* ---- S3 서비스: 버킷 / 객체 / 정적 웹사이트 / 버킷 정책 / 수명 주기 / 암호화 / 버전 관리 ---- */
// 여기는 흉내가 아니라 "진짜로" 동작합니다. 업로드한 파일이 서버 디스크의
// uploads/<버킷이름>/ 폴더에 실제로 저장되고, 다시 내려받을 수 있어요.
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { readDB, writeDB } = require("../lib/store");
const { randomHex } = require("../lib/ids");

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");
const VERSION_ROOT = path.join(UPLOAD_ROOT, ".versions");

const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const STORAGE_CLASSES = ["STANDARD", "INTELLIGENT_TIERING", "STANDARD_IA", "ONEZONE_IA", "GLACIER_IR", "GLACIER", "DEEP_ARCHIVE"];
const now = () => new Date().toISOString();

// 파일 이름을 안전하게 (경로 조작 방지)
function safeKey(key) {
  return path.basename(String(key || ""));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, safeKey(req.params.name));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // 버전 관리가 켜져 있으면 기존 파일을 버전 보관함으로 옮긴 뒤 새 파일 저장
    const key = safeKey(Buffer.from(file.originalname, "latin1").toString("utf8"));
    const bucketName = safeKey(req.params.name);
    const current = path.join(UPLOAD_ROOT, bucketName, key);
    const db = readDB();
    const bucket = db.buckets.find((b) => b.name === bucketName);
    if (bucket && bucket.versioning === "Enabled" && fs.existsSync(current)) {
      archiveVersion(db, bucketName, key, false);
      writeDB(db);
    }
    cb(null, key);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

function metaKey(bucket, key) {
  return `${bucket}::${key}`;
}

// 현재 객체를 이전 버전으로 보관 (deleteMarker=true면 삭제 표시만 남김)
function archiveVersion(db, bucketName, key, deleteMarker) {
  const current = path.join(UPLOAD_ROOT, bucketName, key);
  const meta = db.objectMeta[metaKey(bucketName, key)] || {};
  const versionId = meta.versionId || randomHex(32);
  const dir = path.join(VERSION_ROOT, bucketName, key);
  fs.mkdirSync(dir, { recursive: true });
  let size = 0;
  if (fs.existsSync(current)) {
    size = fs.statSync(current).size;
    fs.renameSync(current, path.join(dir, versionId));
  }
  meta.versions = meta.versions || [];
  meta.versions.unshift({ versionId, size, storageClass: meta.storageClass || "STANDARD", lastModified: meta.uploadedAt || now() });
  if (deleteMarker) meta.versions.unshift({ versionId: randomHex(32), deleteMarker: true, lastModified: now() });
  delete meta.versionId;
  db.objectMeta[metaKey(bucketName, key)] = meta;
}

function bucketSize(name) {
  const dir = path.join(UPLOAD_ROOT, safeKey(name));
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
}

// 버킷 정책이 누구에게나(Principal "*") 객체 읽기를 허용하는지
function policyAllowsPublicRead(policy) {
  if (!policy) return false;
  return (policy.Statement || []).some((st) => {
    const principalAll = st.Principal === "*" || (st.Principal && st.Principal.AWS === "*");
    const actions = [].concat(st.Action || []);
    const readAction = actions.some((a) => a === "s3:GetObject" || a === "s3:*" || a === "*");
    return st.Effect === "Allow" && principalAll && readAction;
  });
}

// 외부(퍼블릭 URL)에서 이 버킷의 객체를 읽을 수 있는지 + 안 되면 이유
function publicReadDecision(bucket) {
  if (!bucket) return { ok: false, code: 404, reason: "NoSuchBucket" };
  if (bucket.blockPublicAccess) return { ok: false, code: 403, reason: "AccessDenied: 퍼블릭 액세스 차단(Block Public Access)이 켜져 있어요." };
  if (!policyAllowsPublicRead(bucket.policy)) return { ok: false, code: 403, reason: "AccessDenied: 버킷 정책에 누구나 s3:GetObject를 허용하는 문장이 없어요." };
  return { ok: true };
}

function bucketView(b) {
  return {
    ...b,
    sizeBytes: bucketSize(b.name),
    publicRead: publicReadDecision(b).ok,
    websiteEndpoint: b.website ? `http://${b.name}.s3-website.ap-northeast-2.amazonaws.com` : null,
    websiteLocalUrl: b.website ? `/s3-website/${encodeURIComponent(b.name)}/` : null,
  };
}

/* ===== 버킷 ===== */

router.get("/buckets", (req, res) => res.json(readDB().buckets.map(bucketView)));

router.post("/buckets", (req, res) => {
  const { name, region, blockPublicAccess, versioning, encryption, objectOwnership } = req.body;
  const db = readDB();
  if (!BUCKET_NAME_RE.test(name || "") || /\.\./.test(name) || /^\d+\.\d+\.\d+\.\d+$/.test(name)) {
    return res.status(400).json({ error: "버킷 이름은 소문자, 숫자, 하이픈(.)만 사용해 3~63자로 지어주세요. IP 주소 형태는 안 돼요." });
  }
  if (db.buckets.find((b) => b.name === name)) {
    return res.status(409).json({ error: "BucketAlreadyExists: 이미 존재하는 버킷 이름입니다. (S3 버킷 이름은 전 세계에서 고유해야 해요)" });
  }
  const bucket = {
    name,
    region: region || "ap-northeast-2",
    blockPublicAccess: blockPublicAccess !== false,
    objectOwnership: objectOwnership === "ObjectWriter" ? "ObjectWriter" : "BucketOwnerEnforced",
    versioning: versioning ? "Enabled" : "Disabled",
    // 2023년부터 모든 새 버킷은 기본으로 SSE-S3 암호화가 켜져 있어요
    encryption: encryption && encryption.type === "SSE-KMS" ? { type: "SSE-KMS", kmsKey: encryption.kmsKey || "aws/s3", bucketKey: true } : { type: "SSE-S3" },
    policy: null,
    website: null,
    lifecycleRules: [],
    createdAt: now(),
  };
  db.buckets.push(bucket);
  writeDB(db);
  fs.mkdirSync(path.join(UPLOAD_ROOT, name), { recursive: true });
  res.status(201).json(bucketView(bucket));
});

function withBucket(req, res, fn) {
  const db = readDB();
  const bucket = db.buckets.find((b) => b.name === req.params.name);
  if (!bucket) return res.status(404).json({ error: "NoSuchBucket: 버킷을 찾을 수 없습니다." });
  const result = fn(db, bucket);
  if (result && result.error) return res.status(result.status || 400).json({ error: result.error });
  writeDB(db);
  res.json(bucketView(bucket));
}

router.post("/buckets/:name/public-access-block", (req, res) =>
  withBucket(req, res, (db, b) => {
    b.blockPublicAccess = !!req.body.blockPublicAccess;
  })
);

router.post("/buckets/:name/versioning", (req, res) =>
  withBucket(req, res, (db, b) => {
    const status = req.body.status;
    if (!["Enabled", "Suspended"].includes(status)) return { error: "Enabled 또는 Suspended만 가능해요." };
    // 한 번 켠 버전 관리는 '비활성화'로 되돌릴 수 없고 '일시 중지'만 가능 (실제 S3와 동일)
    b.versioning = status;
  })
);

router.post("/buckets/:name/encryption", (req, res) =>
  withBucket(req, res, (db, b) => {
    const { type, kmsKey, bucketKey } = req.body;
    if (type === "SSE-KMS") b.encryption = { type, kmsKey: kmsKey || "aws/s3", bucketKey: bucketKey !== false };
    else if (type === "DSSE-KMS") b.encryption = { type, kmsKey: kmsKey || "aws/s3", bucketKey: false };
    else b.encryption = { type: "SSE-S3" };
  })
);

router.post("/buckets/:name/policy", (req, res) =>
  withBucket(req, res, (db, b) => {
    let policy;
    try {
      policy = typeof req.body.policy === "string" ? JSON.parse(req.body.policy) : req.body.policy;
    } catch (e) {
      return { error: `MalformedPolicy: JSON 문법 오류 — ${e.message}` };
    }
    if (!policy || !Array.isArray(policy.Statement) || !policy.Statement.length) {
      return { error: "MalformedPolicy: Statement 배열이 필요해요." };
    }
    for (const st of policy.Statement) {
      if (!["Allow", "Deny"].includes(st.Effect)) return { error: "MalformedPolicy: Effect는 Allow 또는 Deny여야 해요." };
      if (!st.Action) return { error: "MalformedPolicy: Action이 없어요." };
      if (!st.Resource) return { error: "MalformedPolicy: Resource가 없어요." };
      const resources = [].concat(st.Resource);
      if (!resources.every((r) => r.startsWith(`arn:aws:s3:::${b.name}`))) {
        return { error: `MalformedPolicy: Resource는 이 버킷의 ARN(arn:aws:s3:::${b.name}/*)이어야 해요.` };
      }
    }
    if (b.blockPublicAccess && policyAllowsPublicRead(policy)) {
      return { status: 403, error: "AccessDenied: 퍼블릭 액세스 차단(BlockPublicPolicy)이 켜져 있어 퍼블릭 정책을 저장할 수 없어요. 먼저 차단을 해제하세요." };
    }
    b.policy = policy;
  })
);

router.delete("/buckets/:name/policy", (req, res) =>
  withBucket(req, res, (db, b) => {
    b.policy = null;
  })
);

router.post("/buckets/:name/website", (req, res) =>
  withBucket(req, res, (db, b) => {
    if (req.body.enabled === false) {
      b.website = null;
      return;
    }
    const index = safeKey(req.body.indexDocument || "index.html");
    if (!index) return { error: "인덱스 문서 이름을 입력하세요 (예: index.html)." };
    b.website = { indexDocument: index, errorDocument: safeKey(req.body.errorDocument || "") || null };
  })
);

router.post("/buckets/:name/lifecycle", (req, res) =>
  withBucket(req, res, (db, b) => {
    const r = req.body;
    if (!r.id) return { error: "규칙 이름을 입력하세요." };
    const transitions = (r.transitions || []).filter((t) => t.days && t.storageClass);
    // 최소 보관 기간 규칙: Standard-IA/One Zone-IA 전환은 생성 후 30일 이상
    for (const t of transitions) {
      if (["STANDARD_IA", "ONEZONE_IA"].includes(t.storageClass) && Number(t.days) < 30) {
        return { error: "Standard-IA / One Zone-IA로의 전환은 객체 생성 후 최소 30일이 지나야 해요." };
      }
    }
    if (r.expirationDays && transitions.some((t) => Number(t.days) >= Number(r.expirationDays))) {
      return { error: "만료 일수는 전환 일수보다 커야 해요." };
    }
    b.lifecycleRules = b.lifecycleRules.filter((x) => x.id !== r.id);
    b.lifecycleRules.push({
      id: r.id,
      prefix: r.prefix || "",
      transitions: transitions.map((t) => ({ days: Number(t.days), storageClass: t.storageClass })),
      expirationDays: r.expirationDays ? Number(r.expirationDays) : null,
      noncurrentExpirationDays: r.noncurrentExpirationDays ? Number(r.noncurrentExpirationDays) : null,
      enabled: true,
    });
  })
);

router.delete("/buckets/:name/lifecycle/:ruleId", (req, res) =>
  withBucket(req, res, (db, b) => {
    b.lifecycleRules = b.lifecycleRules.filter((x) => x.id !== req.params.ruleId);
  })
);

router.delete("/buckets/:name", (req, res) => {
  const name = safeKey(req.params.name);
  const dir = path.join(UPLOAD_ROOT, name);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const versionsDir = path.join(VERSION_ROOT, name);
  const hasVersions = fs.existsSync(versionsDir) && fs.readdirSync(versionsDir).length > 0;
  if (files.length > 0 || hasVersions) {
    return res.status(409).json({ error: "BucketNotEmpty: 버킷 안에 객체(또는 이전 버전)가 남아있어 삭제할 수 없습니다. 먼저 비워주세요." });
  }
  const db = readDB();
  if (db.cloudfrontDistributions.some((c) => c.originType === "s3" && c.originId === name)) {
    return res.status(409).json({ error: "CloudFront 배포가 이 버킷을 원본으로 쓰고 있어요." });
  }
  db.buckets = db.buckets.filter((b) => b.name !== name);
  Object.keys(db.objectMeta).forEach((k) => {
    if (k.startsWith(`${name}::`)) delete db.objectMeta[k];
  });
  writeDB(db);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(versionsDir, { recursive: true, force: true });
  res.json({ ok: true });
});

/* ===== 객체(파일) ===== */

// 수명 주기 규칙을 적용했을 때 이 객체가 어떻게 될지 (학습용 미리보기)
function lifecyclePreview(bucket, key) {
  const rules = (bucket.lifecycleRules || []).filter((r) => r.enabled && key.startsWith(r.prefix));
  return rules.map((r) => {
    const steps = r.transitions.map((t) => `${t.days}일 후 ${t.storageClass}`);
    if (r.expirationDays) steps.push(`${r.expirationDays}일 후 삭제`);
    return `${r.id}: ${steps.join(" → ")}`;
  });
}

router.get("/buckets/:name/objects", (req, res) => {
  const name = safeKey(req.params.name);
  const dir = path.join(UPLOAD_ROOT, name);
  const db = readDB();
  const bucket = db.buckets.find((b) => b.name === name);
  if (!bucket) return res.status(404).json({ error: "NoSuchBucket" });
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const objects = files.map((key) => {
    const stat = fs.statSync(path.join(dir, key));
    const meta = db.objectMeta[metaKey(name, key)] || {};
    return {
      key,
      size: stat.size,
      lastModified: stat.mtime,
      storageClass: meta.storageClass || "STANDARD",
      versionId: meta.versionId || null,
      versionCount: (meta.versions || []).filter((v) => !v.deleteMarker).length,
      encryption: bucket.encryption.type,
      lifecycle: lifecyclePreview(bucket, key),
      consoleUrl: `/api/buckets/${encodeURIComponent(name)}/objects/${encodeURIComponent(key)}/download`,
      publicUrl: `/s3-objects/${encodeURIComponent(name)}/${encodeURIComponent(key)}`,
    };
  });
  // 버전 관리 중 삭제된 객체(삭제 마커)도 보여주기
  const deleted = Object.entries(db.objectMeta)
    .filter(([k, m]) => k.startsWith(`${name}::`) && m.versions && m.versions[0] && m.versions[0].deleteMarker && !files.includes(k.split("::")[1]))
    .map(([k, m]) => ({ key: k.split("::")[1], deleteMarker: true, versionCount: m.versions.filter((v) => !v.deleteMarker).length, lastModified: m.versions[0].lastModified }));
  res.json({ objects, deleted });
});

router.post("/buckets/:name/objects", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "업로드할 파일이 없습니다." });
  const name = safeKey(req.params.name);
  const storageClass = STORAGE_CLASSES.includes(req.body.storageClass) ? req.body.storageClass : "STANDARD";
  const db = readDB();
  const bucket = db.buckets.find((b) => b.name === name);
  const mk = metaKey(name, req.file.filename);
  const meta = db.objectMeta[mk] || {};
  meta.storageClass = storageClass;
  meta.uploadedAt = now();
  meta.versionId = bucket && bucket.versioning === "Enabled" ? randomHex(32) : null;
  meta.contentType = req.file.mimetype;
  if (meta.versions && meta.versions[0] && meta.versions[0].deleteMarker) meta.versions.shift();
  db.objectMeta[mk] = meta;
  writeDB(db);
  res.status(201).json({ key: req.file.filename, size: req.file.size, storageClass, versionId: meta.versionId });
});

// 콘솔에서 보기 — 콘솔은 로그인한 계정 권한으로 여니까 퍼블릭 차단과 무관하게 열림
router.get("/buckets/:name/objects/:key/download", (req, res) => {
  const filePath = path.join(UPLOAD_ROOT, safeKey(req.params.name), safeKey(req.params.key));
  if (!fs.existsSync(filePath)) return res.status(404).send("NoSuchKey");
  res.sendFile(filePath);
});

router.get("/buckets/:name/objects/:key/versions", (req, res) => {
  const db = readDB();
  const meta = db.objectMeta[metaKey(safeKey(req.params.name), safeKey(req.params.key))] || {};
  const list = [];
  if (meta.uploadedAt && fs.existsSync(path.join(UPLOAD_ROOT, safeKey(req.params.name), safeKey(req.params.key)))) {
    list.push({ versionId: meta.versionId || "null", latest: true, storageClass: meta.storageClass, lastModified: meta.uploadedAt });
  }
  (meta.versions || []).forEach((v, i) => list.push({ ...v, latest: !list.length && i === 0 }));
  res.json(list);
});

// 이전 버전 복원: 선택한 버전을 현재 객체로 되돌림
router.post("/buckets/:name/objects/:key/restore", (req, res) => {
  const name = safeKey(req.params.name);
  const key = safeKey(req.params.key);
  const db = readDB();
  const meta = db.objectMeta[metaKey(name, key)];
  const v = meta && (meta.versions || []).find((x) => x.versionId === req.body.versionId && !x.deleteMarker);
  if (!v) return res.status(404).json({ error: "해당 버전을 찾을 수 없어요." });
  const current = path.join(UPLOAD_ROOT, name, key);
  if (fs.existsSync(current)) archiveVersion(db, name, key, false);
  const m = db.objectMeta[metaKey(name, key)];
  if (m.versions[0] && m.versions[0].deleteMarker) m.versions.shift();
  fs.mkdirSync(path.join(UPLOAD_ROOT, name), { recursive: true });
  fs.copyFileSync(path.join(VERSION_ROOT, name, key, v.versionId), current);
  m.versionId = randomHex(32);
  m.uploadedAt = now();
  m.storageClass = v.storageClass;
  writeDB(db);
  res.json({ ok: true });
});

router.delete("/buckets/:name/objects/:key", (req, res) => {
  const name = safeKey(req.params.name);
  const key = safeKey(req.params.key);
  const db = readDB();
  const bucket = db.buckets.find((b) => b.name === name);
  if (bucket && bucket.versioning !== "Disabled" && !req.query.permanent) {
    // 버전 관리 중이면 실제로 지우지 않고 '삭제 마커'만 남김 → 복원 가능
    archiveVersion(db, name, key, true);
    writeDB(db);
    return res.json({ ok: true, deleteMarker: true });
  }
  fs.rmSync(path.join(UPLOAD_ROOT, name, key), { force: true });
  fs.rmSync(path.join(VERSION_ROOT, name, key), { recursive: true, force: true });
  delete db.objectMeta[metaKey(name, key)];
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
module.exports.publicReadDecision = publicReadDecision;
module.exports.bucketSize = bucketSize;
module.exports.UPLOAD_ROOT = UPLOAD_ROOT;
module.exports.safeKey = safeKey;
