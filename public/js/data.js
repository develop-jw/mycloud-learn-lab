/* ---- 데이터베이스 화면: RDS · ElastiCache ---- */

const DataPages = {
  rds: {
    list: (o) =>
      pageHead({ icon: "rds", title: "RDS 데이터베이스", desc: "백업·패치·장애 조치를 AWS가 대신 해 주는 관리형 관계형 DB예요. 보통 프라이빗 서브넷에 두고, 웹/앱 서버의 보안 그룹만 접근을 허용해요.", actions: `<a class="btn primary" href="${newHref("db", "rds")}">데이터베이스 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "식별자", render: (d) => `<span class="cell-title">${svc("rds", "sm")}${esc(d.identifier)}</span>` },
            { label: "엔진", render: (d) => `${esc(d.engine)} ${esc(d.engineVersion || "")}` },
            { label: "클래스", render: (d) => esc(d.instanceClass) },
            { label: "가용성", render: (d) => (d.multiAz ? `${tag("Multi-AZ", "green")}<span class="cell-sub">기본 ${esc(d.primaryAz)} · 대기 ${esc(d.standbyAz)}</span>` : `${tag("단일 AZ", "gray")}<span class="cell-sub">${esc(d.primaryAz)}</span>`) },
            { label: "상태", render: (d) => badge(d.state) },
            { label: "엔드포인트", render: (d) => (d.endpoint ? `<span class="small" style="word-break:break-all">${esc(d.endpoint)}:${d.port}</span>` : "-") },
          ],
          o.dbs,
          { empty: "데이터베이스가 없어요.", rowHref: (d) => detailHref("db", "rds", d.id) }
        )
      ),
    form: (o) =>
      pageHead({ icon: "rds", title: "데이터베이스 생성" }) +
      needVpc(o) +
      errorBox() +
      section(
        "1. 엔진",
        choiceCards(
          "engine",
          [
            { value: "postgres", label: "PostgreSQL", icon: "rds", desc: "포트 5432 · v17.4" },
            { value: "mysql", label: "MySQL", icon: "rds", desc: "포트 3306 · v8.4" },
            { value: "mariadb", label: "MariaDB", icon: "rds", desc: "포트 3306 · v11.4" },
          ],
          "postgres"
        )
      ) +
      section(
        "2. 템플릿 · 가용성",
        choiceCards(
          "tpl",
          [
            { value: "prod", label: "프로덕션", desc: "Multi-AZ · 삭제 방지 · 백업 7일" },
            { value: "dev", label: "개발/테스트", desc: "단일 AZ · 비용 절감" },
            { value: "free", label: "프리 티어", desc: "db.t3.micro · 단일 AZ", badge: "무료" },
          ],
          "dev"
        ) + checkbox("f-multi", "Multi-AZ 배포 (다른 AZ에 동기식 대기 인스턴스)", false, "기본 인스턴스에 장애가 나면 1~2분 안에 대기 인스턴스로 자동 전환돼요. 비용은 약 2배.")
      ) +
      section(
        "3. 설정",
        field("DB 식별자", input("f-id", { placeholder: "web-db" })) +
          field("마스터 사용자 이름", input("f-user", { value: "admin" })) +
          field("마스터 암호", input("f-pass", { type: "password", placeholder: "8자 이상" }), "생성 후에는 다시 볼 수 없어요. 실무에선 Secrets Manager에 보관해요.") +
          field("인스턴스 클래스", select("f-class", ["db.t3.micro", "db.t3.small", "db.m5.large"])) +
          field("스토리지 (GiB)", input("f-storage", { type: "number", value: 20 })) +
          field("백업 보존 기간 (일)", input("f-backup", { type: "number", value: 7 }))
      ) +
      section(
        "4. 연결",
        field("VPC", select("f-vpc", vpcOptions(o))) +
          field("DB 보안 그룹", `<select id="f-sg"></select>`, "웹 서버 보안 그룹을 소스로 3306/5432를 연 그룹 (체이닝)") +
          `<div class="full"><span class="f-label">DB 서브넷 그룹 — 서로 다른 AZ 2개 이상</span><div id="db-subnets" style="margin-top:6px"></div></div>` +
          checkbox("f-public", "퍼블릭 액세스", false, "끄는 게 권장이에요. 켜려면 퍼블릭 서브넷이 필요해요.") +
          checkbox("f-enc", "스토리지 암호화", true) +
          checkbox("f-protect", "삭제 방지", false)
      ) +
      formActions(listHref("db", "rds"), "데이터베이스 생성"),
    bind: (o, p) => {
      if (!p.get("new") || !byId("f-vpc")) return;
      const fill = () => {
        const v = val("f-vpc");
        byId("f-sg").innerHTML = `<option value="">(기본)</option>` + o.sgs.filter((s) => s.vpcId === v).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
        const subs = o.subnets.filter((s) => s.vpcId === v);
        byId("db-subnets").innerHTML = checkList("db-subnets", subs.map((s) => ({ value: s.id, label: esc(subnetLabel(s)) })), subs.filter((s) => s.egress !== "igw").map((s) => s.id));
      };
      fill();
      byId("f-vpc").addEventListener("change", fill);
      document.querySelector('[data-choice="tpl"]').addEventListener("change", (e) => {
        byId("f-multi").checked = e.detail === "prod";
        byId("f-protect").checked = e.detail === "prod";
        if (e.detail === "free") byId("f-class").value = "db.t3.micro";
      });
    },
    submit: async () => {
      const d = await api.post("/api/db-instances", {
        identifier: val("f-id"),
        engine: choiceValue("engine"),
        masterUsername: val("f-user"),
        masterPassword: byId("f-pass").value,
        instanceClass: val("f-class"),
        allocatedStorage: val("f-storage"),
        backupRetentionDays: val("f-backup"),
        vpcId: val("f-vpc"),
        securityGroupId: val("f-sg"),
        subnetIds: checkedValues("db-subnets"),
        publiclyAccessible: isChecked("f-public"),
        multiAz: isChecked("f-multi"),
        encrypted: isChecked("f-enc"),
        deletionProtection: isChecked("f-protect"),
      });
      toast("데이터베이스를 만드는 중이에요 (creating).");
      location.hash = detailHref("db", "rds", d.id);
    },
    detail: (o, id) => {
      const d = o.dbs.find((x) => x.id === id);
      if (!d) return info("데이터베이스를 찾을 수 없어요.", "error");
      const ready = d.state === "available";
      return (
        pageHead({
          icon: "rds",
          title: d.identifier,
          desc: `${esc(d.engine)} ${esc(d.engineVersion)} · ${badge(d.state)}`,
          actions: `${btn("장애 조치 테스트", "failover", d.id, { disabled: !ready || !d.multiAz })}${btn("스냅샷", "snap", d.id, { disabled: !ready })}${btn("삭제", "del-db", d.id, { tone: "danger" })}`,
        }) +
        `<div class="grid-2">` +
        card(
          "연결 · 보안",
          kv([
            ["엔드포인트", d.endpoint ? `${mono(d.endpoint)}` : "생성 중..."],
            ["포트", d.port],
            ["마스터 사용자", esc(d.masterUsername)],
            ["VPC", esc(vpcName(o, d.vpcId))],
            ["보안 그룹", esc((o.sgs.find((s) => s.id === d.securityGroupId) || {}).name || "기본")],
            ["퍼블릭 액세스", d.publiclyAccessible ? tag("예", "red") : tag("아니요", "green")],
            ["암호화", d.encrypted ? "예 (KMS)" : "아니요"],
          ])
        ) +
        card(
          "가용성 · 백업",
          `<div class="pipeline" style="margin-bottom:12px">
            <span class="pnode">${svc("rds", "xs")}기본 · ${esc(d.primaryAz)}</span>
            ${d.multiAz ? `${glyph("arrow", "arrow")}<span class="pnode">${svc("rds", "xs")}대기 · ${esc(d.standbyAz)} (동기 복제)</span>` : `<span class="pnode off">대기 인스턴스 없음</span>`}
          </div>` +
            kv([
              ["Multi-AZ", d.multiAz ? "예" : "아니요"],
              ["백업 보존", `${d.backupRetentionDays}일`],
              ["삭제 방지", d.deletionProtection ? "켜짐" : "꺼짐"],
              ["스토리지", `${d.allocatedStorage} GiB ${esc(d.storageType || "gp3")}`],
            ])
        ) +
        `</div>` +
        card(
          "수정",
          `<div class="inline-form">
            ${field("Multi-AZ", select("m-multi", [{ value: "1", label: "켜기" }, { value: "0", label: "끄기" }], d.multiAz ? "1" : "0"))}
            ${field("인스턴스 클래스", select("m-class", ["db.t3.micro", "db.t3.small", "db.m5.large"], d.instanceClass))}
            ${field("스토리지 (늘리기만)", input("m-storage", { type: "number", value: d.allocatedStorage }))}
            ${field("삭제 방지", select("m-protect", [{ value: "1", label: "켜기" }, { value: "0", label: "끄기" }], d.deletionProtection ? "1" : "0"))}
            <button class="btn blue" data-act="modify" data-id="${d.id}" ${ready ? "" : "disabled"}>수정 적용</button>
          </div>`
        ) +
        card("스냅샷", table([{ label: "스냅샷", render: (s) => mono(s.id) }, { label: "크기", render: (s) => `${s.sizeGb} GiB` }, { label: "생성", render: (s) => timeAgo(s.createdAt) }], d.snapshots || [], { empty: "수동 스냅샷이 없어요. (자동 백업은 보존 기간 동안 매일 만들어져요)" })) +
        card("이벤트", `<ul class="feed">${(d.events || []).map((e) => `<li><span class="dot ${/장애/.test(e.text) ? "orange" : "blue"}"></span><div><div class="feed-text">${esc(e.text)}</div><div class="feed-time">${timeAgo(e.t)}</div></div></li>`).join("")}</ul>`)
      );
    },
    wire: {
      failover: async (id) => {
        if (!(await modal({ title: "장애 조치(failover) 테스트", body: "<p>'장애 조치로 재부팅'을 실행해 대기 인스턴스가 기본이 되게 해요. 엔드포인트 주소(DNS)는 그대로라 애플리케이션 설정을 바꿀 필요가 없어요.</p>", okLabel: "실행" }))) return;
        await act(api.post(`/api/db-instances/${id}/failover`), "장애 조치를 시작했어요.");
      },
      snap: (id) => act(api.post(`/api/db-instances/${id}/snapshot`), "스냅샷을 만들었어요."),
      modify: (id) => act(api.post(`/api/db-instances/${id}/modify`, { multiAz: val("m-multi") === "1", instanceClass: val("m-class"), allocatedStorage: val("m-storage"), deletionProtection: val("m-protect") === "1" }), "수정을 적용하는 중이에요 (modifying)."),
      "del-db": async (id) => {
        if (!(await confirmBox("데이터베이스 삭제", "<p>삭제 방지가 켜져 있으면 먼저 수정에서 꺼야 해요.</p>"))) return;
        await api.del(`/api/db-instances/${id}`);
        location.hash = listHref("db", "rds");
      },
    },
  },

  cache: {
    list: (o) =>
      pageHead({ icon: "cache", title: "ElastiCache", desc: "메모리 기반 캐시예요. 자주 읽는 DB 결과나 세션을 저장해 응답을 밀리초 이하로 줄이고 DB 부하를 낮춰요.", actions: `<a class="btn primary" href="${newHref("db", "cache")}">캐시 클러스터 생성</a>` }) +
      card(
        "",
        table(
          [
            { label: "이름", render: (c) => `<span class="cell-title">${svc("cache", "sm")}${esc(c.name)}</span>` },
            { label: "엔진", render: (c) => esc(c.engine) },
            { label: "노드", render: (c) => `${esc(c.nodeType)} × ${c.numNodes}` },
            { label: "Multi-AZ", render: (c) => (c.multiAz ? tag("자동 장애 조치", "green") : tag("없음", "gray")) },
            { label: "엔드포인트", render: (c) => (c.endpoint ? `<span class="small">${esc(c.endpoint)}:${c.port}</span>` : "-") },
            { label: "상태", render: (c) => badge(c.state) },
            { label: "", render: (c) => btn("삭제", "del", c.id, { tone: "danger" }) },
          ],
          o.caches,
          { empty: "캐시 클러스터가 없어요." }
        )
      ),
    wire: { del: (id) => act(api.del(`/api/cache-clusters/${id}`), "삭제하는 중이에요.") },
    form: (o) =>
      pageHead({ icon: "cache", title: "캐시 클러스터 생성" }) +
      needVpc(o) +
      errorBox() +
      section(
        "설정",
        field("엔진", select("f-engine", [{ value: "valkey", label: "Valkey (Redis 호환 오픈소스)" }, { value: "redis", label: "Redis OSS" }, { value: "memcached", label: "Memcached (단순 캐시, 복제 없음)" }])) +
          field("이름", input("f-name", { value: "session-cache" })) +
          field("노드 유형", select("f-type", ["cache.t3.micro", "cache.t3.small", "cache.m5.large"])) +
          field("노드 수 (기본 + 복제본)", input("f-num", { type: "number", value: 2 })) +
          field("보안 그룹", select("f-sg", [{ value: "", label: "(기본)" }, ...o.sgs.map((s) => ({ value: s.id, label: s.name }))])) +
          checkbox("f-multi", "Multi-AZ 자동 장애 조치", true, "노드 2개 이상 + 서로 다른 AZ 서브넷 필요") +
          checkbox("f-tls", "전송 중 암호화 (TLS)", true) +
          `<div class="full"><span class="f-label">캐시 서브넷 그룹</span>${checkList("cache-subnets", o.subnets.map((s) => ({ value: s.id, label: esc(subnetLabel(s)) })), o.subnets.filter((s) => s.egress !== "igw").map((s) => s.id))}</div>`
      ) +
      formActions(listHref("db", "cache"), "생성"),
    submit: async () => {
      await api.post("/api/cache-clusters", { engine: val("f-engine"), name: val("f-name"), nodeType: val("f-type"), numNodes: val("f-num"), securityGroupId: val("f-sg"), multiAz: isChecked("f-multi"), transitEncryption: isChecked("f-tls"), subnetIds: checkedValues("cache-subnets") });
      toast("캐시 클러스터를 만드는 중이에요.");
      location.hash = listHref("db", "cache");
    },
  },
};

App.route("/db", (p) => renderSection(DataPages, "db", "rds", p), sectionMeta("db", "rds"));
