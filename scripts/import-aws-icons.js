/* ---- 공식 AWS 아키텍처 아이콘 가져오기 ----
 * AWS가 배포하는 "AWS Architecture Icons" 에셋 패키지에서 이 사이트가 쓰는 아이콘만 골라
 * public/aws-icons/<키>.svg 로 복사합니다. (이 폴더는 .gitignore 되어 있어 저장소에 올라가지 않아요)
 *
 * 1) https://aws.amazon.com/architecture/icons/ 에서 Asset Package(zip)를 내려받기
 * 2) npm run icons -- ~/Downloads/Asset-Package_XXXX.zip   (압축을 푼 폴더 경로도 가능)
 * 3) 서버를 다시 시작하면 자체 아이콘 대신 공식 아이콘이 보여요.
 *
 * 패키지 버전마다 파일 이름이 조금씩 달라서, 이름을 느슨하게 비교해 가장 알맞은 파일을 고릅니다.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "..", "public", "aws-icons");

// 키 → 후보 이름 (앞에 있을수록 우선). 파일 이름에서 영숫자만 남긴 소문자와 비교해요.
const WANTED = {
  ec2: ["archamazonec2"],
  asg: ["archamazonec2autoscaling", "autoscalinggroup"],
  lt: ["resamazonec2amis", "resamazonec2ami"],
  volume: ["archamazonelasticblockstore", "resamazonelasticblockstorevolume"],
  snapshot: ["resamazonelasticblockstoresnapshot"],
  vpc: ["archamazonvirtualprivatecloud", "archamazonvpc", "virtualprivatecloudvpc"],
  subnet: ["privatesubnet", "publicsubnet"],
  igw: ["resamazonvpcinternetgateway"],
  nat: ["resamazonvpcnatgateway"],
  eip: ["resamazonec2elasticipaddress"],
  route: ["resamazonvpcrouter", "resamazonroute53routetable"],
  nacl: ["resamazonvpcnetworkaccesscontrollist"],
  vpn: ["archawssitetositevpn", "resamazonvpcvpngateway", "archawsclientvpn"],
  dx: ["archawsdirectconnect"],
  sg: ["archawsnetworkfirewall", "archawsshield"],
  shield: ["archawsshield"],
  elb: ["archelasticloadbalancing"],
  tg: ["reselasticloadbalancingapplicationloadbalancer"],
  route53: ["archamazonroute53"],
  cloudfront: ["archamazoncloudfront"],
  s3: ["archamazonsimplestorageservice"],
  efs: ["archamazonefs", "archamazonelasticfilesystem"],
  rds: ["archamazonrds"],
  cache: ["archamazonelasticache"],
  eks: ["archamazonelastickubernetesservice", "archamazoneks"],
  ecr: ["archamazonelasticcontainerregistry"],
  iam: ["archawsidentityandaccessmanagement", "archawsiamidentitycenter"],
  cloudwatch: ["archamazoncloudwatch"],
  alarm: ["resamazoncloudwatchalarm"],
  cost: ["archawscostexplorer", "archawsbudgets"],
  users: ["resusers", "users"],
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__MACOSX") walk(p, out);
    } else out.push(p);
  }
  return out;
}

function unzip(file, dest) {
  fs.mkdirSync(dest, { recursive: true });
  execFileSync("unzip", ["-q", "-o", file, "-d", dest], { stdio: "inherit" });
}

// 파일 점수: 48px · 라이트 테마 · 아키텍처 아이콘 우선
function score(file) {
  const base = path.basename(file);
  let s = 0;
  if (/_48(\.|_)/.test(base) || /\/48\//.test(file)) s += 4;
  else if (/_32(\.|_)/.test(base)) s += 2;
  if (/dark/i.test(base)) s -= 5;
  if (/light/i.test(base)) s += 1;
  return s;
}
const norm = (f) => path.basename(f, ".svg").replace(/_(16|32|48|64)$/i, "").replace(/_(light|dark)$/i, "").replace(/_(16|32|48|64)$/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function main() {
  const src = process.argv[2];
  if (!src || !fs.existsSync(src)) {
    console.log("사용법: npm run icons -- <에셋 패키지 zip 또는 압축 푼 폴더>");
    console.log("내려받기: https://aws.amazon.com/architecture/icons/");
    process.exit(1);
  }
  let root = src;
  if (src.endsWith(".zip")) {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aws-icons-"));
    unzip(src, root);
  }
  // 패키지 안에 zip이 또 들어 있는 버전도 있어요
  walk(root)
    .filter((f) => f.endsWith(".zip"))
    .forEach((z) => unzip(z, z.replace(/\.zip$/, "")));

  const svgs = walk(root).filter((f) => f.toLowerCase().endsWith(".svg"));
  if (!svgs.length) {
    console.log("SVG 파일을 찾지 못했어요. 경로를 확인하세요.");
    process.exit(1);
  }
  const index = new Map();
  svgs.forEach((f) => {
    const k = norm(f);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(f);
  });

  fs.mkdirSync(OUT, { recursive: true });
  const found = [];
  const missing = [];
  for (const [key, candidates] of Object.entries(WANTED)) {
    let pick = null;
    for (const c of candidates) {
      const list = index.get(c) || [];
      if (list.length) {
        pick = list.sort((a, b) => score(b) - score(a))[0];
        break;
      }
    }
    if (pick) {
      fs.copyFileSync(pick, path.join(OUT, `${key}.svg`));
      found.push(`${key.padEnd(11)} ← ${path.basename(pick)}`);
    } else missing.push(key);
  }
  console.log(`\n공식 아이콘 ${found.length}개를 public/aws-icons/ 에 복사했어요.`);
  found.forEach((l) => console.log("  " + l));
  if (missing.length) console.log(`\n찾지 못한 키 (자체 아이콘으로 표시): ${missing.join(", ")}`);
  console.log("\n서버를 다시 시작하면 적용돼요. (npm start)");
}

main();
