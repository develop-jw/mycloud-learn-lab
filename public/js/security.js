/* ---- 보안(IAM) 화면: 사용자 · 역할 · 정책 · 정책 시뮬레이터 ---- */

let IAM_META = null;
async function iamMeta() {
  if (!IAM_META) IAM_META = await api.get("/api/iam/meta");
  return IAM_META;
}
function policyOptions(o, meta) {
  return [...meta.managedPolicies.map((p) => ({ value: p.name, label: `AWS 관리형 · ${p.name}` })), ...o.iam.policies.map((p) => ({ value: p.name, label: `고객 관리형 · ${p.name}` }))];
}
function policyChips(list) {
  return list.length ? list.map((p) => tag(p, "blue")).join(" ") : tag("정책 없음", "gray");
}

const SAMPLE_POLICY = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [
      { Sid: "ReadSiteBucket", Effect: "Allow", Action: ["s3:GetObject", "s3:ListBucket"], Resource: ["arn:aws:s3:::mycloud-static-site", "arn:aws:s3:::mycloud-static-site/*"] },
      { Sid: "NoDelete", Effect: "Deny", Action: "s3:DeleteObject", Resource: "*" },
    ],
  },
  null,
  2
);

const IamPages = {
  users: {
    list: (o) =>
      pageHead({ icon: "iam", title: "IAM 사용자", desc: "사람(또는 외부 프로그램)에게 주는 장기 자격 증명이에요. 루트 계정은 쓰지 말고, 최소 권한 사용자 + MFA를 쓰는 게 원칙이에요.", actions: `<button class="btn primary" data-act="new-user">사용자 생성</button>` }) +
      card(
        "",
        table(
          [
            { label: "사용자", render: (u) => `<span class="cell-title">${svc("iam", "sm")}${esc(u.name)}</span>` },
            { label: "콘솔 접근", render: (u) => (u.consoleAccess ? (u.mfaEnabled ? tag("MFA 사용", "green") : tag("MFA 없음", "red")) : tag("프로그래밍 전용", "gray")) },
            { label: "액세스 키", render: (u) => (u.accessKeys.length ? u.accessKeys.map((k) => `<span class="cell-sub">${esc(k.id)} ${badge(k.status)}</span>`).join("") : "-") },
            { label: "정책", render: (u) => policyChips(u.attachedPolicies) },
          ],
          o.iam.users,
          { empty: "IAM 사용자가 없어요.", rowHref: (u) => detailHref("iam", "users", u.id) }
        )
      ),
    detail: (o, id) => {
      const u = o.iam.users.find((x) => x.id === id);
      if (!u) return info("사용자를 찾을 수 없어요.", "error");
      return (
        pageHead({ icon: "iam", title: u.name, desc: mono(u.arn), actions: btn("사용자 삭제", "del-user", u.id, { tone: "danger" }) }) +
        `<div class="grid-2">` +
        card(
          "보안 자격 증명",
          kv([
            ["콘솔 로그인", u.consoleAccess ? "허용" : "없음"],
            ["MFA", u.mfaEnabled ? tag("사용 중", "green") : tag("미사용", "red")],
          ]) + `<div class="btn-row" style="margin-top:10px">${btn(u.mfaEnabled ? "MFA 해제" : "가상 MFA 디바이스 등록", "mfa", u.id, { tone: u.mfaEnabled ? "" : "blue" })}</div>`
        ) +
        card(
          "액세스 키",
          table(
            [
              { label: "키 ID", render: (k) => mono(k.id) },
              { label: "상태", render: (k) => badge(k.status) },
              { label: "생성", render: (k) => timeAgo(k.createdAt) },
              { label: "", render: (k) => `<div class="btn-row">${btn(k.status === "Active" ? "비활성화" : "활성화", "key-toggle", k.id)}${btn("삭제", "key-del", k.id, { tone: "danger" })}</div>` },
            ],
            u.accessKeys,
            { empty: "액세스 키가 없어요." }
          ) + `<div class="btn-row" style="margin-top:10px">${btn("액세스 키 만들기", "key-new", u.id, { tone: "blue" })}</div>`,
          { sub: "키 교체는 새 키 생성 → 앱에 적용 → 옛 키 비활성화 → 삭제 순서로. EC2에서는 키 대신 IAM 역할을 쓰세요." }
        ) +
        `</div>` +
        IamPages.policyCard(o, "users", u)
      );
    },
    wire: {
      "new-user": async () => {
        const meta = await iamMeta();
        const o = await load.overview();
        const r = await modal({
          title: "IAM 사용자 생성",
          fields: [
            { id: "m-name", label: "사용자 이름", value: "developer-jw" },
            { id: "m-console", label: "콘솔 접근", options: [{ value: "1", label: "허용 (사람)" }, { value: "0", label: "없음 (프로그램용)" }], value: "1" },
            { id: "m-policy", label: "처음 연결할 정책", options: [{ value: "", label: "(나중에)" }, ...policyOptions(o, meta)] },
          ],
          okLabel: "생성",
        });
        if (r) await act(api.post("/api/iam/users", { name: r["m-name"], consoleAccess: r["m-console"] === "1", policies: r["m-policy"] ? [r["m-policy"]] : [] }), "사용자를 만들었어요.");
      },
      mfa: (id) => act(api.post(`/api/iam/users/${id}/mfa`), "MFA 설정을 바꿨어요."),
      "key-new": async (id) => {
        const k = await api.post(`/api/iam/users/${id}/access-keys`);
        await modal({
          title: "액세스 키가 생성됐어요",
          body: `<div class="alert warn">비밀 액세스 키는 <b>지금 한 번만</b> 보여줘요. 다시 볼 수 없으니 안전한 곳에 보관하세요. (실습용 가짜 값이에요)</div><pre class="code-block">AWS_ACCESS_KEY_ID=${esc(k.id)}\nAWS_SECRET_ACCESS_KEY=${esc(k.secretAccessKey)}</pre>`,
          okLabel: "확인했어요",
        });
        App.refresh();
      },
      "key-toggle": (kid) => act(api.post(`/api/iam/users/${App.parse().params.get("id")}/access-keys/${kid}/toggle`), "키 상태를 바꿨어요."),
      "key-del": (kid) => act(api.del(`/api/iam/users/${App.parse().params.get("id")}/access-keys/${kid}`), "키를 삭제했어요."),
      "del-user": async (id) => {
        if (!(await confirmBox("사용자 삭제", "<p>액세스 키가 남아 있으면 먼저 삭제해야 해요.</p>"))) return;
        await api.del(`/api/iam/users/${id}`);
        location.hash = listHref("iam", "users");
      },
      "attach": (kindId) => {
        const [kind, id] = kindId.split(":");
        return act(api.post(`/api/iam/${kind}/${id}/policies`, { policy: val("attach-policy") }), "정책을 연결했어요.");
      },
      "detach": (payload) => {
        const [kind, id, policy] = payload.split(":");
        return act(api.post(`/api/iam/${kind}/${id}/policies`, { policy, detach: true }), "정책을 분리했어요.");
      },
    },
  },

  // 사용자·역할 공용 정책 카드 (정책 옵션은 after에서 채움)
  policyCard: (o, kind, target) =>
    card(
      "권한 정책",
      table(
        [
          { label: "정책", render: (p) => `<b>${esc(p)}</b>` },
          { label: "유형", render: (p) => (o.iam.policies.some((c) => c.name === p) ? "고객 관리형" : "AWS 관리형") },
          { label: "", render: (p) => btn("분리", "detach", `${kind}:${target.id}:${p}`) },
        ],
        target.attachedPolicies,
        { empty: "연결된 정책이 없어요 → 아무것도 할 수 없어요 (기본 거부)." }
      ) + `<div class="inline-form">${field("정책 연결", `<select id="attach-policy"></select>`)}<button class="btn blue" data-act="attach" data-id="${kind}:${target.id}">연결</button></div>`,
      { sub: "IAM은 기본이 '거부'예요. 정책으로 명시적으로 허용한 작업만 할 수 있고, 명시적 Deny는 어떤 Allow보다 우선해요." }
    ),

  roles: {
    list: (o) =>
      pageHead({ icon: "iam", title: "IAM 역할", desc: "AWS 서비스(EC2, EKS, 파드 등)가 잠깐 빌려 쓰는 권한이에요. 비밀 키 없이 임시 자격 증명(STS)을 받아서, 서버에 키를 저장하지 않아도 돼요.", actions: `<button class="btn primary" data-act="new-role">역할 생성</button>` }) +
      card(
        "",
        table(
          [
            { label: "역할", render: (r) => `<span class="cell-title">${svc("iam", "sm")}${esc(r.name)}</span><span class="cell-sub">${esc(r.description || "")}</span>` },
            { label: "신뢰할 수 있는 엔터티", render: (r) => tag(r.trustedService, "orange") },
            { label: "정책", render: (r) => policyChips(r.attachedPolicies) },
          ],
          o.iam.roles,
          { empty: "역할이 없어요. EKS 클러스터를 만들 때 자동으로 생기기도 해요.", rowHref: (r) => detailHref("iam", "roles", r.id) }
        )
      ),
    detail: (o, id) => {
      const r = o.iam.roles.find((x) => x.id === id);
      if (!r) return info("역할을 찾을 수 없어요.", "error");
      const usedBy = [
        ...o.instances.filter((i) => i.iamRole === r.name && i.state !== "terminated").map((i) => `EC2 · ${i.name}`),
        ...o.clusters.filter((c) => c.roleName === r.name).map((c) => `EKS 클러스터 · ${c.name}`),
        ...o.nodeGroups.filter((n) => n.nodeRoleName === r.name).map((n) => `노드 그룹 · ${n.name}`),
      ];
      return (
        pageHead({ icon: "iam", title: r.name, desc: mono(r.arn || r.id), actions: btn("역할 삭제", "del-role", r.id, { tone: "danger" }) }) +
        `<div class="grid-2">` +
        card(
          "신뢰 정책 (누가 이 역할을 맡을 수 있나)",
          `<pre class="code-block">${esc(
            JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: `${r.trustedService.replace("-", "")}.amazonaws.com` }, Action: r.trustedService === "pods.eks" ? ["sts:AssumeRole", "sts:TagSession"] : "sts:AssumeRole" }] }, null, 2)
          )}</pre>`
        ) +
        card("사용 중인 곳", usedBy.length ? usedBy.map((x) => `<div>${esc(x)}</div>`).join("") : `<p class="muted">아직 아무 리소스도 이 역할을 쓰지 않아요.</p>`) +
        `</div>` +
        IamPages.policyCard(o, "roles", r)
      );
    },
    wire: {
      "new-role": async () => {
        const meta = await iamMeta();
        const o = await load.overview();
        const r = await modal({
          title: "IAM 역할 생성",
          fields: [
            { id: "m-svc", label: "이 역할을 사용할 서비스", options: Object.entries(meta.trustedServices).map(([k, v]) => ({ value: k, label: `${k} — ${v}` })), value: "ec2" },
            { id: "m-name", label: "역할 이름", value: "web-server-role" },
            { id: "m-policy", label: "권한 정책", options: [{ value: "", label: "(나중에)" }, ...policyOptions(o, meta)], value: "AmazonSSMManagedInstanceCore" },
            { id: "m-desc", label: "설명", value: "" },
          ],
          okLabel: "생성",
        });
        if (r) await act(api.post("/api/iam/roles", { name: r["m-name"], trustedService: r["m-svc"], policies: r["m-policy"] ? [r["m-policy"]] : [], description: r["m-desc"] }), "역할을 만들었어요.");
      },
      "del-role": async (id) => {
        await api.del(`/api/iam/roles/${id}`);
        location.hash = listHref("iam", "roles");
      },
    },
  },

  policies: {
    list: (o) => `${pageHead({ icon: "iam", title: "IAM 정책", desc: "무엇을(Action) 어디에(Resource) 허용/거부(Effect)할지 적은 JSON 문서예요.", actions: `<a class="btn primary" href="${newHref("iam", "policies")}">정책 생성</a>` })}<div id="pol-slot"></div>`,
    after: async (o, p) => {
      if (p.get("new")) return;
      const meta = await iamMeta();
      const usage = (name) => [...o.iam.users, ...o.iam.roles].filter((x) => x.attachedPolicies.includes(name)).length;
      byId("pol-slot").innerHTML =
        card(
          "고객 관리형 정책",
          table(
            [
              { label: "이름", render: (x) => `<b>${esc(x.name)}</b><span class="cell-sub">${esc(x.description)}</span>` },
              { label: "문장 수", render: (x) => x.document.Statement.length },
              { label: "연결", render: (x) => `${usage(x.name)}곳` },
              { label: "", render: (x) => `<div class="btn-row">${btn("JSON 보기", "view", x.name)}${btn("삭제", "del-pol", x.id, { tone: "danger" })}</div>` },
            ],
            o.iam.policies,
            { empty: "직접 만든 정책이 없어요." }
          )
        ) +
        card(
          "AWS 관리형 정책 (자주 쓰는 것)",
          table(
            [
              { label: "이름", render: (x) => `<b>${esc(x.name)}</b>` },
              { label: "설명", render: (x) => esc(x.description) },
              { label: "연결", render: (x) => `${usage(x.name)}곳` },
              { label: "", render: (x) => btn("JSON 보기", "view", x.name) },
            ],
            meta.managedPolicies
          )
        );
      IamPages.policies.docs = Object.fromEntries([...meta.managedPolicies.map((m) => [m.name, { Version: "2012-10-17", Statement: m.statements }]), ...o.iam.policies.map((x) => [x.name, x.document])]);
    },
    form: () =>
      pageHead({ icon: "iam", title: "정책 생성" }) +
      errorBox() +
      section(
        "정책 문서 (JSON)",
        field("이름", input("f-name", { value: "SiteBucketReadOnly" })) +
          field("설명", input("f-desc", { value: "정적 사이트 버킷 읽기 전용, 삭제 금지" })) +
          field("정책 편집기", textarea("f-doc", { value: SAMPLE_POLICY, rows: 16, mono: true }), "Version은 반드시 \"2012-10-17\". Statement마다 Effect · Action · Resource가 필요해요.", { full: true })
      ) +
      formActions(listHref("iam", "policies"), "정책 생성"),
    submit: async () => {
      await api.post("/api/iam/policies", { name: val("f-name"), description: val("f-desc"), document: byId("f-doc").value });
      toast("정책을 만들었어요. 사용자나 역할에 연결하세요.");
      location.hash = listHref("iam", "policies");
    },
    wire: {
      view: (name) => modal({ title: name, body: `<pre class="code-block">${esc(JSON.stringify(IamPages.policies.docs[name], null, 2))}</pre>`, okLabel: "닫기" }),
      "del-pol": (id) => act(api.del(`/api/iam/policies/${id}`), "정책을 삭제했어요."),
    },
  },

  simulator: {
    list: (o) => {
      const principals = [...o.iam.users.map((u) => ({ value: `users:${u.id}`, label: `사용자 · ${u.name}` })), ...o.iam.roles.map((r) => ({ value: `roles:${r.id}`, label: `역할 · ${r.name}` }))];
      return (
        pageHead({ icon: "shield", title: "정책 시뮬레이터", desc: "'이 사용자가 이 작업을 할 수 있을까?'를 실제로 실행하지 않고 미리 확인해요. 평가 순서: 명시적 Deny → 명시적 Allow → 기본(암묵적) Deny." }) +
        (principals.length ? "" : info(`먼저 <a href="${listHref("iam", "users")}">사용자</a>나 <a href="${listHref("iam", "roles")}">역할</a>을 만드세요.`, "warn")) +
        card(
          "",
          `<div class="inline-form">
            ${field("주체", select("sim-who", principals))}
            ${field("작업 (Action)", select("sim-action", ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "ec2:RunInstances", "ec2:DescribeInstances", "ec2:TerminateInstances", "rds:DeleteDBInstance", "iam:CreateUser", "ecr:BatchGetImage", "eks:DescribeCluster", "cloudwatch:PutMetricData"]))}
            ${field("리소스 (ARN)", input("sim-res", { value: "arn:aws:s3:::mycloud-static-site/index.html" }))}
            <button class="btn blue" data-act="simulate" data-id="x">시뮬레이션</button>
          </div>
          <div id="sim-out"></div>`
        )
      );
    },
    wire: {
      simulate: async () => {
        const [kind, id] = val("sim-who").split(":");
        const r = await api.post("/api/iam/simulate", { kind, id, action: val("sim-action"), resource: val("sim-res") });
        const map = {
          allowed: ["ok", `<b>허용(allowed)</b> — 정책 <b>${esc(r.by)}</b>의 Allow 문장과 일치해요.`],
          explicitDeny: ["error", `<b>명시적 거부(explicitDeny)</b> — 정책 <b>${esc(r.by)}</b>의 Deny 문장이 다른 모든 Allow보다 우선해요.`],
          implicitDeny: ["warn", "<b>암묵적 거부(implicitDeny)</b> — 이 작업을 허용하는 정책이 하나도 없어요. IAM의 기본값은 거부예요."],
        }[r.decision];
        byId("sim-out").innerHTML = info(`${esc(r.principal)} · ${esc(r.action)} · ${esc(r.resource)}<br/>${map[1]}`, map[0]);
      },
    },
  },
};

async function renderIam(p) {
  await renderSection(IamPages, "iam", "users", p);
  const sel = byId("attach-policy");
  if (sel) {
    const [meta, o] = await Promise.all([iamMeta(), load.overview()]);
    sel.innerHTML = policyOptions(o, meta)
      .map((x) => `<option value="${esc(x.value)}">${esc(x.label)}</option>`)
      .join("");
  }
}

App.route("/iam", renderIam, sectionMeta("iam", "users"));
