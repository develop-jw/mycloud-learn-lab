/* ---- AWS 콘솔 실습실 서버 ---- */
// Docker 필요 없이 `node server.js` 하나로 실행됩니다.
const express = require("express");
const path = require("path");
const fs = require("fs");

const { readDB } = require("./lib/store");
const vpcRoutes = require("./routes/vpc");
const ec2Routes = require("./routes/ec2");
const s3Routes = require("./routes/s3");
const rdsRoutes = require("./routes/rds");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 업로드한 S3 객체를 브라우저에서 볼 수 있게 서빙합니다. 단, 실제 S3처럼
// 버킷의 "퍼블릭 액세스 차단"이 켜져 있으면 직접 URL 접근을 403으로 막아요.
app.get("/s3-objects/:bucket/:key", (req, res) => {
  const db = readDB();
  const bucket = db.buckets.find((b) => b.name === req.params.bucket);
  if (!bucket) return res.status(404).send("Not Found");
  if (bucket.blockPublicAccess) {
    return res
      .status(403)
      .send("AccessDenied: 이 버킷은 퍼블릭 액세스가 차단되어 있어요. 버킷 설정에서 차단을 해제해보세요.");
  }
  const filePath = path.join(__dirname, "uploads", req.params.bucket, req.params.key);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not Found");
  res.sendFile(filePath);
});

app.use("/api", vpcRoutes);
app.use("/api", ec2Routes);
app.use("/api", s3Routes);
app.use("/api", rdsRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`AWS 콘솔 실습실 실행 중: http://localhost:${PORT}`);
});
