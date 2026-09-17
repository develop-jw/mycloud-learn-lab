/* ---- 시뮬레이션 지표 (CloudWatch 흉내) ---- */
// 실제 서버가 없으니, "지금 떠 있는 리소스가 많을수록 부하가 높다"는 규칙으로
// 시간에 따라 부드럽게 출렁이는 값을 계산합니다. 같은 시각을 넣으면 항상 같은 값이
// 나오기 때문에, 차트와 알람이 서로 같은 숫자를 봅니다.

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// 정수 → -1 ~ 1 사이의 고정된 난수 (같은 입력이면 같은 출력)
function hashNoise(n) {
  let x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

// 부드러운 노이즈: 인접한 두 칸 사이를 보간
function smoothNoise(t, step) {
  const k = Math.floor(t / step);
  const f = t / step - k;
  const a = hashNoise(k);
  const b = hashNoise(k + 1);
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

// 현재 리소스 상태로부터 기준 부하 계산
function baseline(db) {
  const running = db.instances.filter((i) => i.state === "running");
  const pods = db.pods.filter((p) => p.state === "Running").length;
  const activeLbs = db.loadBalancers.filter((l) => l.state === "active").length;
  const cdn = db.cloudfrontDistributions.filter((c) => c.status === "Deployed" && c.enabled !== false).length;
  const hasCompute = running.length > 0;
  return {
    hasCompute,
    running: running.length,
    pods,
    cpu: hasCompute ? clamp(16 + pods * 3.5 + activeLbs * 9 + running.length * 1.5, 6, 82) : 0,
    mem: hasCompute ? clamp(28 + pods * 2.8 + running.length * 1.2, 12, 88) : 0,
    rps: hasCompute ? (activeLbs ? 140 + pods * 22 + cdn * 90 : 4 + pods * 2) : 0,
  };
}

// t(초)에서의 지표값
// step = 차트 한 칸의 간격(초). 칸보다 짧은 주기의 출렁임은 줄여서(표본화 잡음 방지)
// 1시간 차트는 잔물결까지, 24시간 · 7일 차트는 하루 주기의 큰 흐름 위주로 보여줘요.
function sampleAt(base, t, step = 2) {
  if (!base.hasCompute) return { cpu: 0, mem: 0, rps: 0 };
  const a = (period) => clamp(period / (step * 8) - 0.25, 0, 1);
  const day = Math.sin((2 * Math.PI * t) / 86400 - 1.9); // 낮에 높고 새벽에 낮은 하루 주기
  const slow = smoothNoise(t, 3600);
  const wave =
    0.35 * day + 0.25 * slow +
    a(4400) * 0.3 * Math.sin(t / 700) + a(710) * 0.18 * Math.sin(t / 113 + 1.3) + a(60) * 0.22 * smoothNoise(t, 17);
  const wave2 = 0.25 * day + 0.2 * smoothNoise(t + 77, 5400) + a(8100) * 0.3 * Math.sin(t / 1300 + 2) + a(80) * 0.3 * smoothNoise(t + 999, 23);
  const wave3 = 0.45 * day + 0.25 * smoothNoise(t + 31, 2700) + a(3400) * 0.3 * Math.sin(t / 540 + 0.7) + a(40) * 0.25 * smoothNoise(t + 4242, 11);
  return {
    cpu: Math.round(clamp(base.cpu + base.cpu * 0.3 * wave, 1, 99) * 10) / 10,
    mem: Math.round(clamp(base.mem + base.mem * 0.2 * wave2, 1, 99) * 10) / 10,
    rps: Math.round(Math.max(0, base.rps + base.rps * 0.35 * wave3)),
  };
}

const RANGES = {
  "1h": { seconds: 3600, points: 60 },
  "6h": { seconds: 6 * 3600, points: 72 },
  "24h": { seconds: 24 * 3600, points: 96 },
  "7d": { seconds: 7 * 24 * 3600, points: 84 },
};

function history(db, range) {
  const r = RANGES[range] || RANGES["1h"];
  const base = baseline(db);
  const now = Date.now() / 1000;
  const step = r.seconds / (r.points - 1);
  const points = [];
  for (let i = 0; i < r.points; i++) {
    const t = now - r.seconds + i * step;
    points.push({ t: Math.round(t * 1000), ...sampleAt(base, t, step) });
  }
  return { range, stepSeconds: step, points, hasCompute: base.hasCompute };
}

function current(db, range) {
  const base = baseline(db);
  const t = Date.now() / 1000;
  const r = RANGES[range];
  const step = r ? r.seconds / (r.points - 1) : 2;
  return { t: Date.now(), ...sampleAt(base, t, step), hasCompute: base.hasCompute, running: base.running, pods: base.pods };
}

// Auto Scaling 그룹 한 개의 평균 CPU — 인스턴스가 많을수록 한 대당 부하가 줄어듦
function asgCpu(asg, runningCount, t = Date.now() / 1000) {
  if (!runningCount) return 0;
  const load = 70 + 45 * Math.sin(t / 240 + asg.id.length) + 12 * smoothNoise(t + asg.id.length * 31, 13);
  return Math.round(clamp(load / runningCount, 2, 99) * 10) / 10;
}

module.exports = { baseline, current, history, asgCpu, RANGES };
