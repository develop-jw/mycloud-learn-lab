/* ---- 스토리지 화면: S3 (객체·속성·권한·관리) · EFS ---- */

const STORAGE_CLASSES = [
  { value: "STANDARD", label: "S3 Standard — 자주 쓰는 데이터" },
  { value: "INTELLIGENT_TIERING", label: "Intelligent-Tiering — 접근 패턴에 따라 자동 이동" },
  { value: "STANDARD_IA", label: "Standard-IA — 가끔 읽음, 저장비 저렴·조회비 있음" },
  { value: "ONEZONE_IA", label: "One Zone-IA — 한 AZ에만 저장 (재생성 가능한 데이터)" },
  { value: "GLACIER_IR", label: "Glacier Instant Retrieval — 분기 1회 조회, 즉시 복원" },
  { value: "GLACIER", label: "Glacier Flexible Retrieval — 복원에 분~시간" },
  { value: "DEEP_ARCHIVE", label: "Glacier Deep Archive — 최저가, 복원 12시간+" },
];

const BUCKET_TABS = [
  { key: "objects", label: "객체" },
  { key: "properties", label: "속성" },
  { key: "permissions", label: "권한" },
  { key: "management", label: "관리" },
];

function publicPolicy(name) {
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [{ Sid: "PublicReadGetObject", Effect: "Allow", Principal: "*", Action: "s3:GetObject", Resource: `arn:aws:s3:::${name}/*` }],
    },
    null,
    2
  );
}

const StoragePages = {
  s3: {
    list: () => `${pageHead({ icon: "s3", title: "S3 버킷", desc: "용량 제한 없는 객체 스토리지예요. 99.999999999%(11 9s) 내구성. 여기 올린 파일은 실제로 저장되고, 정적 웹사이트로 서비스할 수도 있어요.", actions: `<a class="btn primary" href="${newHref("storage", "s3")}">버킷 만들기</a>` })}<div id="s3-slot"></div>`,
    after: async (o, p) => {
      if (p.get("new")) return;
      const buckets = await api.get("/api/buckets");
      const name = p.get("id");
      if (name) return StoragePages.s3.renderBucket(buckets.find((b) => b.name === name), p);
      byId("s3-slot").innerHTML = card(
        "",
        table(
          [
            { label: "이름", render: (b) => `<span class="cell-title">${svc("s3", "sm")}${esc(b.name)}</span>` },
            { label: "리전", render: (b) => esc(b.region) },
            { label: "액세스", render: (b) => (b.publicRead ? tag("퍼블릭", "red") : b.blockPublicAccess ? tag("퍼블릭 차단", "green") : tag("비공개", "gray")) },
            { label: "버전 관리", render: (b) => (b.versioning === "Enabled" ? tag("활성", "green") : b.versioning === "Suspended" ? tag("일시 중지", "orange") : tag("비활성", "gray")) },
            { label: "암호화", render: (b) => esc(b.encryption.type) },
            { label: "웹사이트", render: (b) => (b.website ? tag("호스팅 중", "blue") : "-") },
            { label: "크기", render: (b) => fmtBytes(b.sizeBytes) },
          ],
          buckets,
          { empty: "버킷이 없어요.", rowHref: (b) => detailHref("storage", "s3", b.name) }
        )
      );
    },
    form: () =>
      pageHead({ icon: "s3", title: "버킷 만들기" }) +
      errorBox() +
      section(
        "일반 구성",
        field("버킷 이름", input("f-name", { placeholder: "mycloud-static-site" }), "소문자·숫자·하이픈 3~63자 · 전 세계에서 고유해야 해요") +
          field("AWS 리전", select("f-region", [{ value: "ap-northeast-2", label: "아시아 태평양(서울) ap-northeast-2" }]))
      ) +
      section(
        "객체 소유권 · 퍼블릭 액세스",
        field("객체 소유권", select("f-own", [{ value: "BucketOwnerEnforced", label: "ACL 비활성화 (권장) — 버킷 소유자가 모든 객체 소유" }, { value: "ObjectWriter", label: "ACL 활성화" }])) +
          checkbox("f-block", "모든 퍼블릭 액세스 차단 (권장)", true, "정적 웹사이트로 쓸 때만 해제하고 버킷 정책으로 읽기 권한을 줘요.")
      ) +
      section("버전 관리 · 암호화", checkbox("f-ver", "버전 관리 활성화", false, "덮어쓰거나 삭제해도 이전 버전을 복원할 수 있어요.") + field("기본 암호화", select("f-enc", [{ value: "SSE-S3", label: "SSE-S3 (Amazon S3 관리형 키)" }, { value: "SSE-KMS", label: "SSE-KMS (AWS KMS 키)" }]), "2023년부터 모든 새 객체는 기본으로 암호화돼요.")) +
      formActions(listHref("storage", "s3"), "버킷 만들기"),
    submit: async () => {
      await api.post("/api/buckets", { name: val("f-name"), region: val("f-region"), objectOwnership: val("f-own"), blockPublicAccess: isChecked("f-block"), versioning: isChecked("f-ver"), encryption: { type: val("f-enc") } });
      toast("버킷을 만들었어요.");
      location.hash = detailHref("storage", "s3", val("f-name"));
    },
    renderBucket: async (b, p) => {
      if (!b) {
        byId("content").innerHTML = info("버킷을 찾을 수 없어요.", "error");
        return;
      }
      const sub = p.get("sub") || "objects";
      const href = (k) => `${detailHref("storage", "s3", b.name)}&sub=${k}`;
      let body = "";
      if (sub === "objects") {
        const { objects, deleted } = await api.get(`/api/buckets/${encodeURIComponent(b.name)}/objects`);
        body =
          card(
            "업로드",
            `<div class="inline-form">
              <input type="file" id="up-file" style="min-width:240px" />
              ${field("스토리지 클래스", select("up-class", STORAGE_CLASSES))}
              <button class="btn primary" data-act="upload" data-id="${esc(b.name)}">업로드</button>
            </div>`,
            { sub: b.website ? "정적 웹사이트라면 index.html, error.html 을 올려 보세요." : "파일은 서버 디스크에 실제로 저장돼요." }
          ) +
          card(
            `객체 (${objects.length})`,
            objects.length || deleted.length
              ? `<div class="gallery">${objects
                  .map(
                    (x) => `<div class="obj">
                <div class="obj-thumb">${/\.(png|jpe?g|gif|webp|svg)$/i.test(x.key) ? `<img src="${x.consoleUrl}" alt="${esc(x.key)}" loading="lazy" />` : svc("s3", "lg")}</div>
                <div class="obj-body">
                  <b>${esc(x.key)}</b>
                  <span class="muted">${fmtBytes(x.size)} · ${timeAgo(x.lastModified)}</span>
                  <span>${tag(x.storageClass, "blue")} ${x.versionCount ? tag(`이전 버전 ${x.versionCount}`, "gray") : ""}</span>
                  ${x.lifecycle.length ? `<span class="small muted">${esc(x.lifecycle.join(" / "))}</span>` : ""}
                  <div class="btn-row" style="margin-top:auto">
                    <a class="btn sm" href="${x.consoleUrl}" target="_blank" rel="noopener">열기</a>
                    <a class="btn sm" href="${x.publicUrl}" target="_blank" rel="noopener" title="퍼블릭 URL — 차단/정책에 따라 403">퍼블릭 URL</a>
                    ${btn("버전", "versions", x.key)}
                    ${btn("삭제", "del-obj", x.key, { tone: "danger" })}
                  </div>
                </div>
              </div>`
                  )
                  .concat(
                    deleted.map(
                      (x) => `<div class="obj deleted"><div class="obj-thumb">${svc("trash", "lg")}</div><div class="obj-body"><b>${esc(x.key)}</b><span>${tag("삭제 마커", "orange")}</span><span class="muted small">버전 관리 덕분에 이전 버전 ${x.versionCount}개가 남아 있어요.</span><div class="btn-row" style="margin-top:auto">${btn("버전 보기 · 복원", "versions", x.key, { tone: "blue" })}</div></div></div>`
                    )
                  )
                  .join("")}</div>`
              : `<div class="empty"><p>아직 객체가 없어요.</p></div>`,
            { sub: "'열기'는 콘솔 권한으로 보는 것이라 항상 열리고, '퍼블릭 URL'은 인터넷의 익명 사용자 입장에서 열어보는 거예요." }
          );
      } else if (sub === "properties") {
        body =
          card(
            "버전 관리",
            `<p>현재: <b>${b.versioning === "Enabled" ? "활성화" : b.versioning === "Suspended" ? "일시 중지" : "비활성화"}</b></p>
            <div class="btn-row">${btn("활성화", "versioning", "Enabled", { tone: "blue", disabled: b.versioning === "Enabled" })}${btn("일시 중지", "versioning", "Suspended", { disabled: b.versioning !== "Enabled" })}</div>
            <p class="muted small">한 번 켠 버전 관리는 '비활성화'로 되돌릴 수 없고 '일시 중지'만 가능해요.</p>`
          ) +
          card(
            "기본 암호화",
            `<div class="inline-form">${field("암호화 유형", select("enc-type", [{ value: "SSE-S3", label: "SSE-S3 (S3 관리형 키)" }, { value: "SSE-KMS", label: "SSE-KMS (KMS 키 · 사용 기록 감사 가능)" }, { value: "DSSE-KMS", label: "DSSE-KMS (이중 계층 암호화)" }], b.encryption.type))}${field("KMS 키 별칭", input("enc-key", { value: b.encryption.kmsKey || "aws/s3" }))}<button class="btn blue" data-act="encryption" data-id="x">저장</button></div>
            <p class="muted small">저장 중 암호화(at-rest)예요. 전송 중 암호화는 HTTPS(TLS)로 해요.</p>`
          ) +
          card(
            "정적 웹사이트 호스팅",
            `${b.website ? `${info(`호스팅 중 · 엔드포인트 <b>${esc(b.websiteEndpoint)}</b><br/>이 실습실에서 열기: <a href="${b.websiteLocalUrl}" target="_blank" rel="noopener">${esc(b.websiteLocalUrl)}</a>`, "ok")}` : ""}
            <div class="inline-form">${field("인덱스 문서", input("web-index", { value: b.website ? b.website.indexDocument : "index.html" }))}${field("오류 문서", input("web-error", { value: b.website ? b.website.errorDocument || "" : "error.html" }))}<button class="btn blue" data-act="website-on" data-id="x">${b.website ? "저장" : "활성화"}</button>${b.website ? btn("비활성화", "website-off", "x") : ""}</div>
            <p class="muted small">Lab 2 순서: ① 퍼블릭 액세스 차단 해제 → ② 버킷 정책으로 s3:GetObject 허용 → ③ index.html 업로드 → ④ 웹사이트 호스팅 활성화</p>`
          );
      } else if (sub === "permissions") {
        body =
          card(
            "퍼블릭 액세스 차단 (버킷 설정)",
            `<p>현재: ${b.blockPublicAccess ? tag("모두 차단", "green") : tag("차단 해제됨", "red")}</p>
            <div class="btn-row">${b.blockPublicAccess ? btn("차단 해제", "bpa", "off", { tone: "danger" }) : btn("모두 차단", "bpa", "on", { tone: "blue" })}</div>
            <p class="muted small">켜져 있으면 버킷 정책으로 퍼블릭 읽기를 주는 것 자체가 거부돼요 (BlockPublicPolicy).</p>`
          ) +
          card(
            "버킷 정책",
            `${textarea("policy", { value: b.policy ? JSON.stringify(b.policy, null, 2) : "", rows: 12, mono: true, placeholder: "JSON 정책 문서를 입력하세요" })}
            <div class="btn-row" style="margin-top:10px"><button class="btn sm" data-act="policy-sample" data-id="x">퍼블릭 읽기 예시 넣기</button><button class="btn blue" data-act="policy-save" data-id="x">정책 저장</button>${b.policy ? btn("정책 삭제", "policy-del", "x", { tone: "danger" }) : ""}</div>
            <div id="pol-result"></div>`,
            { sub: `Resource는 이 버킷의 ARN(arn:aws:s3:::${esc(b.name)}/*)이어야 해요.` }
          ) +
          card(
            "지금 이 버킷을 인터넷에서 읽을 수 있을까?",
            b.publicRead
              ? info("<b>예</b> — 퍼블릭 액세스 차단이 꺼져 있고, 버킷 정책이 누구에게나 s3:GetObject를 허용해요.", "warn")
              : info(`<b>아니요</b> — ${b.blockPublicAccess ? "퍼블릭 액세스 차단이 켜져 있어요." : "버킷 정책에 퍼블릭 읽기 허용이 없어요."}`, "ok")
          );
      } else {
        body =
          card(
            "수명 주기 규칙",
            table(
              [
                { label: "규칙", render: (r) => `<b>${esc(r.id)}</b><span class="cell-sub">접두사: ${esc(r.prefix || "(전체)")}</span>` },
                { label: "전환", render: (r) => r.transitions.map((t) => `${t.days}일 → ${t.storageClass}`).join("<br/>") || "-" },
                { label: "만료", render: (r) => (r.expirationDays ? `${r.expirationDays}일 후 삭제` : "-") },
                { label: "이전 버전 만료", render: (r) => (r.noncurrentExpirationDays ? `${r.noncurrentExpirationDays}일` : "-") },
                { label: "", render: (r) => btn("삭제", "lc-del", r.id, { tone: "danger" }) },
              ],
              b.lifecycleRules,
              { empty: "수명 주기 규칙이 없어요." }
            ) +
              `<div class="inline-form">
              ${field("규칙 이름", input("lc-id", { value: "archive-logs" }))}
              ${field("접두사", input("lc-prefix", { placeholder: "logs/ (비우면 전체)" }))}
              ${field("Standard-IA 전환(일)", input("lc-ia", { type: "number", value: 30 }))}
              ${field("Glacier 전환(일)", input("lc-gl", { type: "number", value: 90 }))}
              ${field("만료(일)", input("lc-exp", { type: "number", value: 365 }))}
              ${field("이전 버전 만료(일)", input("lc-nc", { type: "number", placeholder: "선택" }))}
              <button class="btn blue" data-act="lc-add" data-id="x">규칙 저장</button>
            </div>`,
            { sub: "시간이 지나 덜 쓰는 데이터를 더 싼 스토리지 클래스로 옮기고, 필요 없어지면 자동 삭제해요. IA 계열 전환은 최소 30일 이후부터 가능해요." }
          ) +
          card(
            "스토리지 클래스 한눈에 보기",
            table(
              [
                { label: "클래스", render: (r) => `<b>${r[0]}</b>` },
                { label: "가용 영역", render: (r) => r[1] },
                { label: "최소 보관", render: (r) => r[2] },
                { label: "조회", render: (r) => r[3] },
              ],
              [
                ["Standard", "3개 이상", "-", "즉시"],
                ["Intelligent-Tiering", "3개 이상", "-", "즉시 (자동 계층 이동)"],
                ["Standard-IA", "3개 이상", "30일", "즉시 · 조회 요금"],
                ["One Zone-IA", "1개", "30일", "즉시 · 조회 요금"],
                ["Glacier Instant Retrieval", "3개 이상", "90일", "밀리초"],
                ["Glacier Flexible Retrieval", "3개 이상", "90일", "분 ~ 시간"],
                ["Glacier Deep Archive", "3개 이상", "180일", "12 ~ 48시간"],
              ]
            )
          );
      }
      byId("content").innerHTML =
        pageHead({
          icon: "s3",
          title: b.name,
          desc: `${esc(b.region)} · ${fmtBytes(b.sizeBytes)} · ${b.publicRead ? tag("퍼블릭 읽기 가능", "red") : tag("비공개", "green")} ${b.website ? tag("웹사이트 호스팅", "blue") : ""}`,
          actions: btn("버킷 삭제", "del-bucket", b.name, { tone: "danger" }),
        }) +
        tabsBar(BUCKET_TABS, sub, href) +
        body;
      const base = `/api/buckets/${encodeURIComponent(b.name)}`;
      StoragePages.s3.bucketWire = {
        upload: async () => {
          const f = byId("up-file").files[0];
          if (!f) return toast("파일을 선택하세요.", true);
          const fd = new FormData();
          fd.append("file", f);
          fd.append("storageClass", val("up-class"));
          await act(api.req("POST", `${base}/objects`, fd), `${f.name} 업로드 완료${b.versioning === "Enabled" ? " (버전이 하나 늘었어요)" : ""}`);
        },
        "del-obj": async (key) => {
          const perm = b.versioning === "Disabled";
          if (!(await confirmBox("객체 삭제", perm ? "<p>버전 관리가 꺼져 있어 영구 삭제돼요.</p>" : "<p>버전 관리 중이라 실제로 지우지 않고 '삭제 마커'만 남겨요. 나중에 복원할 수 있어요.</p>"))) return;
          await act(api.del(`${base}/objects/${encodeURIComponent(key)}`), perm ? "영구 삭제했어요." : "삭제 마커를 남겼어요.");
        },
        versions: async (key) => {
          const vers = await api.get(`${base}/objects/${encodeURIComponent(key)}/versions`);
          const list = vers.filter((v) => !v.deleteMarker && !v.latest);
          const r = await modal({
            title: `${key} 버전 기록`,
            body: `<div class="table-wrap"><table><thead><tr><th>버전 ID</th><th>종류</th><th>시각</th></tr></thead><tbody>${vers.map((v) => `<tr><td class="small">${esc(String(v.versionId).slice(0, 12))}…</td><td>${v.deleteMarker ? tag("삭제 마커", "orange") : v.latest ? tag("현재", "green") : tag("이전 버전", "gray")}</td><td class="small">${timeAgo(v.lastModified)}</td></tr>`).join("")}</tbody></table></div>`,
            fields: list.length ? [{ id: "m-ver", label: "복원할 버전", options: list.map((v) => ({ value: v.versionId, label: `${String(v.versionId).slice(0, 12)}… · ${timeAgo(v.lastModified)}` })) }] : [],
            okLabel: list.length ? "이 버전으로 복원" : "닫기",
          });
          if (r && r["m-ver"]) await act(api.post(`${base}/objects/${encodeURIComponent(key)}/restore`, { versionId: r["m-ver"] }), "이전 버전으로 복원했어요.");
        },
        versioning: (status) => act(api.post(`${base}/versioning`, { status }), "버전 관리 설정을 바꿨어요."),
        encryption: () => act(api.post(`${base}/encryption`, { type: val("enc-type"), kmsKey: val("enc-key") }), "기본 암호화를 저장했어요."),
        "website-on": () => act(api.post(`${base}/website`, { indexDocument: val("web-index"), errorDocument: val("web-error") }), "정적 웹사이트 호스팅을 설정했어요."),
        "website-off": () => act(api.post(`${base}/website`, { enabled: false }), "호스팅을 껐어요."),
        bpa: (v) => act(api.post(`${base}/public-access-block`, { blockPublicAccess: v === "on" }), v === "on" ? "퍼블릭 액세스를 모두 차단했어요." : "차단을 해제했어요. 이제 버킷 정책으로 권한을 줄 수 있어요."),
        "policy-sample": () => (byId("policy").value = publicPolicy(b.name)),
        "policy-save": async () => {
          try {
            await api.post(`${base}/policy`, { policy: byId("policy").value });
            toast("버킷 정책을 저장했어요.");
            App.refresh();
          } catch (e) {
            byId("pol-result").innerHTML = info(esc(e.message), "error");
          }
        },
        "policy-del": () => act(api.del(`${base}/policy`), "정책을 삭제했어요."),
        "lc-add": () =>
          act(
            api.post(`${base}/lifecycle`, {
              id: val("lc-id"),
              prefix: val("lc-prefix"),
              transitions: [
                { days: val("lc-ia"), storageClass: "STANDARD_IA" },
                { days: val("lc-gl"), storageClass: "GLACIER" },
              ],
              expirationDays: val("lc-exp"),
              noncurrentExpirationDays: val("lc-nc"),
            }),
            "수명 주기 규칙을 저장했어요."
          ),
        "lc-del": (id) => act(api.del(`${base}/lifecycle/${encodeURIComponent(id)}`), "규칙을 삭제했어요."),
        "del-bucket": async (name) => {
          if (!(await confirmBox("버킷 삭제", "<p>버킷이 비어 있어야(이전 버전 포함) 삭제할 수 있어요.</p>"))) return;
          await api.del(`/api/buckets/${encodeURIComponent(name)}`);
          location.hash = listHref("storage", "s3");
        },
      };
      StoragePages.s3.wire = StoragePages.s3.bucketWire;
    },
    wire: {},
  },

  efs: {
    list: (o) =>
      pageHead({ icon: "efs", title: "EFS 파일 시스템", desc: "여러 EC2·파드가 동시에 마운트하는 공유 파일 시스템(NFS)이에요. 쓴 만큼만 과금되고 용량이 자동으로 늘어나요. AZ마다 탑재 대상을 하나씩 만들어요.", actions: `<a class="btn primary" href="${newHref("storage", "efs")}">파일 시스템 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (f) => `<span class="cell-title">${svc("efs", "sm")}${esc(f.name)}</span>` },
            { label: "ID", render: (f) => mono(f.id) },
            { label: "성능 · 처리량", render: (f) => `${f.performanceMode === "maxIO" ? "최대 I/O" : "범용"} · ${esc(f.throughputMode)}` },
            { label: "탑재 대상", render: (f) => `${f.mountTargets.length}개 AZ` },
            { label: "크기", render: (f) => `${f.sizeGb} GiB` },
            { label: "상태", render: (f) => badge(f.state) },
          ],
          o.efs,
          { empty: "파일 시스템이 없어요.", rowHref: (f) => detailHref("storage", "efs", f.id) }
        )
      ) +
      card(
        "EBS vs EFS vs S3",
        table(
          [
            { label: "", render: (r) => `<b>${r[0]}</b>` },
            { label: "EBS (블록)", render: (r) => r[1] },
            { label: "EFS (파일)", render: (r) => r[2] },
            { label: "S3 (객체)", render: (r) => r[3] },
          ],
          [
            ["연결", "인스턴스 1대 (같은 AZ)", "여러 대 동시 (여러 AZ)", "HTTP API로 어디서나"],
            ["용도", "OS 디스크, DB", "공유 콘텐츠, 홈 디렉터리", "정적 파일, 백업, 데이터 레이크"],
            ["크기", "미리 정함 (늘리기 가능)", "자동 확장", "무제한"],
            ["쿠버네티스", "ReadWriteOnce PV", "ReadWriteMany PV", "애플리케이션에서 SDK로"],
          ]
        )
      ),
    form: (o) =>
      pageHead({ icon: "efs", title: "EFS 파일 시스템 생성" }) +
      needVpc(o) +
      errorBox() +
      section(
        "설정",
        field("이름", input("f-name", { value: "shared-fs" })) +
          field("VPC", select("f-vpc", vpcOptions(o))) +
          field("성능 모드", select("f-perf", [{ value: "generalPurpose", label: "범용 (대부분)" }, { value: "maxIO", label: "최대 I/O (대규모 병렬)" }])) +
          field("처리량 모드", select("f-thr", [{ value: "elastic", label: "Elastic (자동)" }, { value: "bursting", label: "버스트" }, { value: "provisioned", label: "프로비저닝" }])) +
          field("IA로 전환 (일)", input("f-ia", { type: "number", value: 30 }), "오래 안 읽은 파일을 저렴한 스토리지로") +
          checkbox("f-enc", "저장 데이터 암호화", true)
      ) +
      formActions(listHref("storage", "efs"), "생성"),
    submit: async () => {
      const f = await api.post("/api/efs", { name: val("f-name"), vpcId: val("f-vpc"), performanceMode: val("f-perf"), throughputMode: val("f-thr"), transitionToIaDays: val("f-ia"), encrypted: isChecked("f-enc") });
      location.hash = detailHref("storage", "efs", f.id);
    },
    detail: (o, id) => {
      const f = o.efs.find((x) => x.id === id);
      if (!f) return info("파일 시스템을 찾을 수 없어요.", "error");
      const subnets = o.subnets.filter((s) => s.vpcId === f.vpcId);
      return (
        pageHead({ icon: "efs", title: f.name, desc: `${mono(f.id)} · ${badge(f.state)}`, actions: btn("삭제", "del-efs", f.id, { tone: "danger" }) }) +
        card(
          "개요",
          kv([
            ["DNS 이름", mono(f.dnsName)],
            ["VPC", esc(vpcName(o, f.vpcId))],
            ["크기", `${f.sizeGb} GiB`],
            ["암호화", f.encrypted ? "예" : "아니요"],
            ["수명 주기", f.transitionToIaDays ? `${f.transitionToIaDays}일 후 IA` : "없음"],
          ]) + `<div class="inline-form"><button class="btn" data-act="write" data-id="${f.id}">파일 5GiB 쓰기 (시뮬레이션)</button></div>`
        ) +
        card(
          "탑재 대상 (AZ당 1개)",
          table(
            [
              { label: "AZ", render: (m) => esc(m.availabilityZone) },
              { label: "서브넷", render: (m) => esc((o.subnets.find((s) => s.id === m.subnetId) || {}).name || m.subnetId) },
              { label: "IP", render: (m) => esc(m.ipAddress) },
              { label: "보안 그룹", render: (m) => `${esc((o.sgs.find((s) => s.id === m.securityGroupId) || {}).name || "-")}${m.warning ? `<span class="cell-sub" style="color:#b45309">${esc(m.warning)}</span>` : ""}` },
              { label: "", render: (m) => btn("삭제", "del-mt", m.id, { tone: "danger" }) },
            ],
            f.mountTargets,
            { empty: "탑재 대상이 없어요. 인스턴스가 있는 AZ마다 하나씩 만드세요." }
          ) +
            `<div class="inline-form">${field("서브넷", select("mt-subnet", subnets.map((s) => ({ value: s.id, label: subnetLabel(s) }))))}${field("보안 그룹", select("mt-sg", o.sgs.filter((s) => s.vpcId === f.vpcId).map((s) => ({ value: s.id, label: s.name }))))}<button class="btn blue" data-act="add-mt" data-id="${f.id}">탑재 대상 추가</button></div>
            <pre class="code-block">sudo mount -t efs ${esc(f.id)}:/ /mnt/efs</pre>`,
          { sub: "보안 그룹에 NFS(2049) 인바운드가 있어야 인스턴스가 탑재할 수 있어요." }
        )
      );
    },
    wire: {
      "add-mt": (id) => act(api.post(`/api/efs/${id}/mount-targets`, { subnetId: val("mt-subnet"), securityGroupId: val("mt-sg") }), "탑재 대상을 추가했어요."),
      "del-mt": (mid) => act(api.del(`/api/efs/${App.parse().params.get("id")}/mount-targets/${mid}`), "탑재 대상을 삭제했어요."),
      write: (id) => act(api.post(`/api/efs/${id}/write`, { gb: 5 }), "5GiB를 썼어요 (용량·비용이 늘어나요)."),
      "del-efs": async (id) => {
        await api.del(`/api/efs/${id}`);
        location.hash = listHref("storage", "efs");
      },
    },
  },
};

App.route("/storage", (p) => renderSection(StoragePages, "storage", "s3", p), sectionMeta("storage", "s3"));
