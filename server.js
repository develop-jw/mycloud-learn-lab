/* ---- MyCloud Learn Lab 서버 ---- */
// Docker 필요 없이 `node server.js` 하나로 실행됩니다.
const express = require("express");
const path = require("path");
const fs = require("fs");

const { readDB, writeDB } = require("./lib/store");
const sim = require("./lib/sim");
const s3Routes = require("./routes/s3");
const { publicReadDecision, UPLOAD_ROOT, safeKey } = s3Routes;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ---- 활동 기록: 성공한 생성/변경/삭제 요청을 자동으로 남김 ---- */
const SKIP_EVENT_PATHS = [/^\/iam\/simulate/, /^\/cost\/budget/];
app.use("/api", (req, res, next) => {
  if (!["POST", "DELETE"].includes(req.method) || SKIP_EVENT_PATHS.some((re) => re.test(req.path))) return next();
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    try {
      const db = readDB();
      const b = req.body || {};
      db.events.unshift({
        t: new Date().toISOString(),
        method: req.method,
        path: req.path,
        name: b.name || b.identifier || b.domain || b.tag || b.id || null,
      });
      if (db.events.length > 150) db.events.length = 150;
      writeDB(db);
    } catch (e) {
      /* 기록 실패는 무시 */
    }
  });
  next();
});

/* ---- 퍼블릭 URL로 S3 객체 읽기 (퍼블릭 액세스 차단 + 버킷 정책을 실제처럼 검사) ---- */
app.get("/s3-objects/:bucket/:key", (req, res) => {
  const db = readDB();
  const bucket = db.buckets.find((b) => b.name === req.params.bucket);
  const decision = publicReadDecision(bucket);
  if (!decision.ok) return res.status(decision.code).type("text/plain; charset=utf-8").send(decision.reason);
  const filePath = path.join(UPLOAD_ROOT, safeKey(req.params.bucket), safeKey(req.params.key));
  if (!fs.existsSync(filePath)) return res.status(404).type("text/plain").send("NoSuchKey");
  res.sendFile(filePath);
});

/* ---- S3 정적 웹사이트 엔드포인트 흉내: /s3-website/<버킷>/경로 ---- */
app.get(["/s3-website/:bucket", "/s3-website/:bucket/*"], (req, res) => {
  const db = readDB();
  const bucket = db.buckets.find((b) => b.name === req.params.bucket);
  if (!bucket || !bucket.website) {
    return res.status(404).type("text/html; charset=utf-8").send("<h1>404 Not Found</h1><p>NoSuchWebsiteConfiguration: 이 버킷은 정적 웹사이트 호스팅이 꺼져 있어요.</p>");
  }
  if (!req.params[0] && !req.path.endsWith("/")) return res.redirect(req.path + "/");
  const decision = publicReadDecision(bucket);
  if (!decision.ok) {
    return res.status(403).type("text/html; charset=utf-8").send(`<h1>403 Forbidden</h1><p>${decision.reason}</p>`);
  }
  const key = safeKey(req.params[0] || bucket.website.indexDocument) || bucket.website.indexDocument;
  const dir = path.join(UPLOAD_ROOT, safeKey(bucket.name));
  const filePath = path.join(dir, key);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  const errDoc = bucket.website.errorDocument && path.join(dir, bucket.website.errorDocument);
  if (errDoc && fs.existsSync(errDoc)) return res.status(404).sendFile(errDoc);
  res.status(404).type("text/html; charset=utf-8").send(`<h1>404 Not Found</h1><p>NoSuchKey: ${key}</p>`);
});

/* ---- 공식 AWS 아키텍처 아이콘이 있으면 목록 알려주기 (public/aws-icons/*.svg) ---- */
app.get("/api/aws-icons", (req, res) => {
  const dir = path.join(__dirname, "public", "aws-icons");
  if (!fs.existsSync(dir)) return res.json([]);
  res.json(fs.readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.replace(/\.svg$/, "")));
});

/* ---- API 라우트 ---- */
app.use("/api", require("./routes/vpc"));
app.use("/api", require("./routes/network"));
app.use("/api", require("./routes/ec2"));
app.use("/api", require("./routes/elb"));
app.use("/api", require("./routes/edge"));
app.use("/api", require("./routes/eks"));
app.use("/api", s3Routes);
app.use("/api", require("./routes/rds"));
app.use("/api", require("./routes/ops"));

// 데모/초기화: 모든 리소스 지우기 (실습 처음부터 다시 하기)
app.post("/api/reset", (req, res) => {
  const { emptyDb } = require("./lib/store");
  writeDB(emptyDb());
  fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true });
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_ROOT, ".gitkeep"), "");
  res.json({ ok: true });
});

app.use("/api", (req, res) => res.status(404).json({ error: `API를 찾을 수 없어요: ${req.method} ${req.path}` }));

sim.start();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MyCloud Learn Lab 실행 중: http://localhost:${PORT}`);
});
