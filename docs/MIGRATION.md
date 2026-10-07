# 마이그레이션 가이드

`bstage init`으로 만든 프로젝트는 생성 시점의 SDK 버전을 `package.json`에 **고정값으로 박는다**. 따라서 SDK가 올라가도 기존 프로젝트는 자동으로 따라오지 않는다. 이 문서는 **버전 사이에 소비자(템플릿 개발자)가 해야 할 일**을 SDK 쪽에서 누적 관리하는 단일 소스다.

## 이 문서의 소유권과 역할

- **누가 쓰나**: SDK 작성자. 소비자 영향이 있는 변경을 릴리즈하는 **그 시점에** 항목을 추가한다. 마이그레이션할 때 만드는 게 아니라 미리 쌓아둔다.
- **누가 읽나**: 소비자 프로젝트의 마이그레이션 도구(아래)와 사람.
- **어디에 실리나**: `docs/`는 core 패키지 배포물에 포함되므로, 소비자는 `node_modules/@bstage-sdk/core/docs/MIGRATION.md`로 이 파일을 본다. cli도 빌드 시 `dist/MIGRATION.md`로 같은 파일을 복사해 `bstage doctor`가 동일 가이드를 읽는다.
- **파일 배포 버전 ≠ 항목 헤더 버전**: 이 파일이 **실려 나가는** 버전(core)과 각 항목 헤더의 버전은 별개다. 패키지는 완전 독립 버전(cli·core·react·host·design이 서로 다른 버전 라인)이라, 항목 헤더는 그 변경을 **실제로 낸 패키지**의 버전을 가리킨다(대개 cli·react이며 core가 아닐 수 있다). 즉 core를 설치한 소비자도 헤더가 `cli 0.43.0`인 항목을 적용하려면 **cli**를 0.43.0 이상으로 올려야 한다.

## 마이그레이션이 동작하는 방식

마이그레이션은 두 단계로 나뉘고, 각 단계에 맞는 도구가 다르다.

1. **감지 (결정론)** — 설치된 SDK 버전과 최신 버전을 비교하고, 누락된 파일·드리프트를 보고한다. 정답이 하나이므로 도구가 기계적으로 처리한다.
2. **변환 (판단)** — 이 문서의 해당 구간을 읽고, **실제 프로젝트 코드를 보면서** 적용한다. 사용자가 분기시킨 코드를 덮어쓰지 않고 reconcile해야 하므로 AI/사람의 판단이 들어간다.

소비자 프로젝트에서는 AI가 1로 시작 버전을 파악 → 이 문서에서 해당 구간을 읽음 → 프로젝트에 맞춘 작업 계획을 사람에게 제시 → 승인 후 변환을 수행한다.

### 도구

- **감지**: `bstage doctor` (`npx @bstage-sdk/cli@latest doctor`). 버전 드리프트·보일러플레이트 누락·적용 가능한 마이그레이션 항목을 read-only로 보고한다. `--json`으로 구조화 출력.
- **변환**: `bstage-migrate` 스킬 (`.claude/skills/bstage-migrate/SKILL.md`). doctor 출력과 이 문서를 읽고 프로젝트에 맞춰 적용한다.

### 마이그레이션 스킬 부트스트랩

- **새 프로젝트** (이 기능 도입 이후 `bstage init`): `.claude/skills/`에 스킬이 이미 들어 있다. 별도 작업 없음.
- **옛 프로젝트**: `npx @bstage-sdk/cli@latest skills install`로 스킬을 설치한다(`.claude/skills/`에 기록). SDK 버전업 후 다시 실행하면 최신으로 동기화된다. 스킬이 없어도 `bstage doctor` 출력 + 이 문서만으로 AI가 마이그레이션을 진행할 수 있다.

## 항목 작성 규칙

각 항목은 **소비자가 행동해야 하는 변경 하나**를 기술한다. 단순 내부 리팩터링은 적지 않는다(그건 CHANGELOG의 몫).

항목 머리에 두 가지 배지를 단다.

- 적용 난이도: `자동` (충돌 없이 기계적 적용 가능) / `판단` (사용자 코드 이해 필요)
- 필요도: `필수` (안 하면 깨짐) / `선택` (새 기능을 쓸 때만)

각 항목은 다음 소제목을 갖는다.

- **영향** — 어떤 프로젝트가 해당되는지 + 감지 방법(어떤 파일/버전을 보면 아는지)
- **변경 내용** — 무엇이 왜 바뀌었는지 (배경은 한 줄, 상세는 관련 docs 링크)
- **적용** — 단계. 자동 단계와 판단 단계를 구분해서 적는다.

> **`적용` 단계는 옛 프로젝트에서 실제로 따라가 본 뒤 적는다.** 새 `bstage init` 프로젝트에서 되는 것과, 기존 프로젝트가 이 절차만 보고 도달하는 것은 다르다. 따라 했을 때 깨지는 선행 조건이 있으면 **그 조건까지 적는다** — `core 0.44.0` 항목이 그 사례다(스크립트만 넣으면 `@types/node` 부재로 `TS2688`이 난다. 스캐폴드 템플릿을 고쳐 새 프로젝트는 해결됐지만, 먼저 써둔 적용 절차를 되짚지 않아 기존 프로젝트용 지침이 깨진 채 남았다).

> **헤더 규칙**: `## → {패키지} {버전}` 형식으로, 그 변경을 실제로 낸 패키지와 버전을 명시한다(예: `→ cli 0.3.0`, `→ core 0.3.0`). 한 변경이 여러 패키지를 함께 범프시켰으면 소비자가 올려야 할 패키지를 `·`로 나열한다(예: `→ core 0.3.0 · cli 0.3.0`). 소비자는 이 헤더의 패키지를 해당 버전 **이상**으로 올려야 한다. 단순 의존성 재핀(dependency bump)만 된 패키지는 헤더에 적지 않는다.
>
> **정렬**: 릴리즈 **시점 최신이 위**. 패키지가 독립 버전이라 헤더 숫자만으로는 시간순 정렬이 되지 않으므로 릴리즈 순서를 기준으로 한다.

---

## → cli 0.8.3 · ai-toolkit 0.8.3

### sandbox 포털 기본 주소가 공개 주소로 바뀌었다 — `자동`

**영향**

- sandbox 포털에 로그인·배포하는 모든 프로젝트. 할 일은 없다.
- 사외(파트너) 환경에서 `bstage login`이 `ENOTFOUND`로 실패하던 문제가 풀린다.

**변경 내용**

- sandbox 포털 기본 주소: 예전 사내망 전용 주소(사설 IP) → `bstage-portal.sandstage.in`(공개).
- 옛 주소로 저장된 `.bstage/project.json`·로그인 토큰·`BSTAGE_PORTAL_URL`·`--portal` 값은 새 주소로 바꿔 읽는다. 다시 `bstage link`·`bstage login` 하지 않아도 된다. 토큰 파일은 다음 로그인 때 새 주소 키로 합쳐진다.
- 스킴 없이 준 포털 주소(예: `BSTAGE_PORTAL_URL=bstage-portal.sandstage.in`)는 https로 본다. 예전에는 `Invalid URL`로 실패했다.

**적용**

1. (자동) CLI를 올리면 된다. 옛 버전에서 사외 로그인이 필요하면 `npx bstage login --portal https://bstage-portal.sandstage.in` 또는 `BSTAGE_PORTAL_URL=https://bstage-portal.sandstage.in`(스킴 포함)을 쓴다.

### 템플릿 `name`은 폴더명과 같을 필요가 없다(문서 정정) — `자동`

**영향**

- 코드·빌드 동작은 바뀌지 않는다. 문서만 바로잡았다.
- `AGENTS.md`와 `bstage-template` 스킬이 "`createTemplate`의 `name`은 폴더명과 동일해야 한다"고 안내했지만, 빌드는 그런 검사를 하지 않는다. 이 문구를 따라 페이지 폴더명을 `name`에 맞추느라 배포 경로가 의도와 달라질 수 있었다(예: `/todos`로 내보내려던 페이지가 `/garen-todos`로 나감).

**변경 내용**

- `name`은 Custom Element 태그명이다. 소문자로 시작하고 하이픈을 1개 이상 넣고 소문자·숫자·하이픈만 쓴다. 레포 안에서 템플릿마다 달라야 한다(`bstage build`가 검사).
- 배포 경로(페이지)와 슬롯 자리는 폴더 위치가 정한다(`src/pages/{경로}/`). 그래서 `name`은 폴더명과 같을 필요가 없다. 예: 폴더 `src/pages/todos` + `name: 'garen-todos'`.
- **AGENTS.md 관리 영역 v16**: 위 내용으로 템플릿 작성 절을 고쳤다. `bstage-template` 스킬도 같은 내용으로 고쳤다.

**적용**

1. (자동) `npx @bstage-sdk/cli@latest ai update` — 스킬·`AGENTS.md` 관리 영역을 v16으로 갱신한다.

## → cli 0.7.0

### 페이지 배치를 CLI로 만든다 — `bstage placement create` — `자동` · `선택`

**영향**

- 포털 화면에서 페이지(배치)를 만들던 모든 프로젝트. 기존 배치·명령은 그대로라 할 일은 없다.
- 감지: `bstage list`·`bstage deploy`가 배치 0건일 때 `bstage placement create`를 안내한다.

**변경 내용**

- **`bstage placement create --template <산출물 이름> [--path /경로] [--build] [--yes] [--json]`**: 이 레포의 빌드 산출물 하나를 페이지(PAGE) 배치로 만든다. 조직·스테이지·레포·surface는 `.bstage/project.json`(CI는 `BSTAGE_*` 환경변수)을 따른다. `--template`은 sdk는 `src/pages/{이름}`, liquid는 `public/{user|admin}/{이름}`의 `{이름}`이고(liquid는 `user/{이름}`도 받는다), `--path`를 생략하면 `/{이름}`이다.
- **빌드가 없어도 된다.** 포털은 레포를 연결해도 스스로 빌드하지 않는다. 이 레포의 최신 성공 빌드에 그 산출물이 없으면(첫 빌드 전, 새 페이지를 막 push, 산출물 목록이 없는 옛 빌드) push된 기본 브랜치 HEAD로 빌드부터 하고 끝나면 배치를 만든다. `--build`는 성공 빌드가 있어도 새로 빌드한다. 빌드할 때는 `deploy`와 같은 git 사전점검을 한다(`--skip-git-check`).
- **다시 실행해도 안전하다.** 같은 경로에 이 레포·같은 산출물의 배치가 이미 있으면 만들지 않고 성공(`unchanged`)으로 끝난다. 같은 경로를 다른 배치가 쓰고 있으면 종료 코드 4다.
- 만든 배치는 라이브가 아니다 — `bstage deploy`로 적용한다. `--json`은 `deploy`와 같은 요약(`changed`·`unchanged`·`conflicts`·`failed`)에 `placement`·`build`·`next`(다음 명령)를 더한 객체 하나다.
- **토큰 등급은 `deploy`**이고 사용자는 스테이지 관리자 이상이어야 한다(포털 화면에서 배치를 만들 때와 같은 권한). 포털이 이 경로를 아직 열지 않은 환경에서는 종료 코드 3(토큰 등급)으로 멈추고 포털 화면을 안내한다.
- 위젯(SLOT) 배치와 배치 삭제는 여전히 포털 화면 전용이다.
- **AGENTS.md 관리 영역 v15**: 배포 절의 "배치 생성은 포털 화면에서만"을 `bstage placement create` 안내로 바꿨다. `bstage-deploy`·`bstage-onboarding`·`bstage-liquid` 스킬도 같은 흐름(레포 연결만 화면 → `placement create` → `deploy`)으로 바꿨다.

**적용**

1. (자동) `npx @bstage-sdk/cli@latest ai update` — 스킬·`AGENTS.md` 관리 영역을 v15로 갱신한다.
2. (판단) `AGENTS.md` 자유 영역이나 프로젝트 문서에 "배치는 포털 화면에서 만든다"를 적어 두었다면 `bstage placement create`로 바꾼다.

## → cli 0.6.0

### sdk와 liquid 템플릿이 한 레포에 있어도 빌드·배포된다(혼합 레포) — `자동` · `선택`

**영향**

- **단일 종류(sdk만·liquid만) 레포가 할 일은 없다.** 명령·산출물이 그대로다.
- `mixed`(sdk 템플릿 + liquid 템플릿)로 판정돼 `bstage build`·`dev`·`deploy`가 종료 코드 2로 멈추던 레포는 이제 진행한다.
- 감지: `bstage build`가 "liquid 템플릿 N개 … 포털이 … 패키징합니다" 안내를 낸다. `bstage deploy`도 혼합 안내 한 줄을 낸다.

**변경 내용**

- **`bstage build`**: 혼합 레포에서 sdk 엔트리만 번들하고 liquid는 검증만 한다 — `dist/`에 liquid를 넣지 않는다(포털 빌더가 push된 커밋의 `public/{user|admin}/{이름}/`을 sdk 산출물과 함께 패키징한다). 검증은 번들보다 먼저 하고, 오류가 있으면 번들 없이 종료 코드 2다. `--json`은 `{ "kind": "mixed", "issues", "sdk": { "templates", "outputs" }, "liquid": { "templates" } }` 객체 하나를 stdout에 쓰고 진행 로그는 stderr로 보낸다.
- **예약 이름**: 혼합 레포에서 `src/pages/user/…`·`src/pages/admin/…` 페이지는 error다. 산출물이 `dist/{user|admin}/…`로 나가 liquid 자리와 겹치고, 같은 디렉터리에 `template.js`와 `template.liquid`가 함께 있으면 포털이 sdk로만 판정해 liquid가 조용히 사라진다. 포털 빌더도 같은 자리에서 막는다. 위젯(`src/slots`)은 해당 없다.
- **`bstage deploy`**: 혼합 레포를 막지 않는다. 위젯(SLOT) 배치 사전점검은 liquid 전용 레포에서만 하고, 혼합 레포의 항목별 판정(liquid 항목에 SLOT을 걸면 400)은 포털이 한다.
- **`bstage dev --kind <sdk|liquid>`**: 혼합 레포에서 어느 프리뷰를 띄울지 고른다. 기본은 sdk(Vite)이고 시작할 때 liquid 프리뷰 방법을 안내한다. 두 서버를 함께 띄우지 않는다. 단일 종류 레포에서 판정과 어긋난 값은 종료 코드 2다.
- **liquid 검증기**(`bstage build`·`bstage doctor`의 liquid 절)는 sdk와 섞인 것을 더 이상 error로 보고하지 않는다.
- **포털 빌더는 별도로 갱신된다.** 갱신 전 포털은 혼합 레포에서 liquid만 패키징하므로, CLI와 빌더가 모두 반영된 뒤 혼합 레포를 배포한다.

**적용**

1. (자동) 단일 종류 레포는 그대로 둔다 — 올리기만 하면 된다.
2. (판단) 혼합 레포를 만들 때: liquid는 `public/{user|admin}/{이름}/template.liquid`, sdk 페이지는 `src/pages/{이름}/template.tsx`(`user`·`admin` 제외), 위젯은 `src/slots/…`. `bstage build`가 겹치는 자리를 짚어 준다.
3. (자동) 혼합 레포의 liquid 프리뷰는 `bstage dev --kind liquid`.

### AGENTS.md 관리 영역 v14 · 혼합 레포 스킬 세트(`bstage ai install`·`doctor`) — `자동` · `선택`

**영향**

- `bstage init`으로 만든 모든 프로젝트. 관리 영역이 v14보다 낮으면 해당한다(본문 문구 변경 — liquid 본문의 "sdk와 섞지 않는다"가 공존 규칙으로 바뀌었다).
- `mixed`로 판정돼 `bstage ai install`·`update`가 종료 코드 2로 멈추고 `bstage doctor`가 스킬 검사를 건너뛰던 혼합 레포.
- 감지: `bstage ai doctor`가 `AGENTS.md`를 `stale`로 보고한다. 혼합 레포에서는 `bstage-template`·`bstage-liquid` 둘 다 검사 대상이 된다.

**변경 내용**

- `bstage ai install`·`update`·`doctor`가 혼합 레포를 지원한다 — 스킬은 sdk 세트와 liquid 세트의 **합집합**(5종)을 설치하고, `AGENTS.md` 관리 영역은 두 구조와 혼합 규칙(어느 방식으로 만들지 · sdk 페이지 `user`·`admin` 금지 · `bstage build`·`dev --kind` 동작)을 담은 **혼합 본문**이 된다. `mixed`는 판정으로만 나오며 `--kind`로 지정하는 값이 아니다 — 혼합 레포에 `--kind sdk|liquid`를 주면 판정과 어긋나 멈춘다.
- `bstage doctor`는 혼합 레포에서 스킬 검사를 건너뛰지 않고 두 세트를 모두 보며, liquid 검증 결과도 함께 낸다. `--json`의 `skillsSkipped`는 항상 `false`다(필드는 비파괴적으로 남긴다).
- **레포 종류가 바뀐 뒤의 `AGENTS.md`** — sdk 레포에 liquid 템플릿을 더해 혼합이 되면 관리 영역 마커 버전은 그대로라, 예전에는 옛 sdk 본문이 "최신"으로 남았다. 이제 `bstage ai install`·`update`·`doctor`가 본문을 현재 종류의 렌더 결과와 비교해 다르면 갱신(`update`)·`stale`로 본다. 자유 영역은 보존된다.
- **관리 영역이 이 CLI보다 새 버전이면 하향임을 알린다.** 프로젝트에 고정된 옛 CLI로 `ai install`·`update`·`doctor`를 돌리면 새 CLI가 놓은 관리 영역을 옛 본문으로 되돌리게 된다 — 그 사실을 알리고 최신 CLI로 다시 실행하라고 안내한다. 덮어쓰기 자체는 막지 않는다(마커 버전은 파일 안의 자기선언 값이다).
- `bstage-onboarding`·`bstage-liquid` 스킬과 `AGENTS.md`의 "한 레포에 한 방식만" 문구를 공존 규칙(예약 이름 · `dev --kind liquid`)으로 바꿨다.

**적용**

1. (자동) `npx @bstage-sdk/cli@latest ai update` — 스킬·`AGENTS.md` 관리 영역을 v14로 갱신한다. 혼합 레포에서는 없는 스킬도 만들어야 하므로 `ai install`을 쓴다.
2. (판단) 혼합 레포의 `AGENTS.md` 자유 영역에 "한 레포에 한 방식만" 류의 자체 규칙을 적어 두었다면 지운다 — 관리 영역과 어긋난다.

## → cli 0.5.0

### liquid 에셋은 포털 미디어에 올린다 — 레포 상대 경로는 배포 후 깨진다 — `판단` · `필수`

**영향**

- liquid 템플릿 레포 전부. 이미지·영상을 레포에 두고 상대 경로(`images/logo.png`·`/user/home/images/logo.png`)로 참조하는 템플릿이 해당한다.
- 감지: 배포한 화면에서 이미지가 뜨지 않는다(요청이 404). **로컬 프리뷰에서는 정상으로 보이므로 프리뷰로는 감지되지 않는다.**

**변경 내용**

포털은 템플릿 폴더를 그대로 복사하지만, 렌더된 HTML이 스페이스 도메인 페이지 안으로 들어간다. 그래서 상대 경로는 그 도메인 기준으로 풀리고 산출물이 놓인 주소를 가리키지 않는다. 옛 가이드에 있던 "`public`에 두고 상대 경로로 참조" 안내는 신규 포털에서 맞지 않는다.

지금 방법은 포털 화면의 스테이지 > 미디어에 파일을 올리고, 받은 URL을 템플릿에 절대 주소로 넣는 것이다. 이미지와 영상만 올릴 수 있고, 허용 형식·용량 한도는 업로드할 때 화면이 알려 준다.

`bstage ai install`·`update`가 놓는 `AGENTS.md`·`bstage-liquid` 스킬도 같은 내용으로 바뀌었다(관리 영역 v12).

**적용**

1. (판단) 템플릿에서 상대 경로로 참조하는 에셋을 찾는다.
2. (판단) 해당 파일을 포털 미디어에 올리고 받은 URL로 참조를 바꾼다.
3. (자동) `npx @bstage-sdk/cli@latest ai update`로 스킬·`AGENTS.md`를 최신 안내로 갱신한다.

### liquid `data.json` 샘플 키를 플랫폼 계약에 맞춘다 — `판단` · `선택`

**영향**

- liquid 템플릿 레포. `data.json`이 `title`·`heading`·`description` 같은 임의 이름을 쓰고 있으면 해당한다.
- 감지: 로컬 프리뷰에서는 값이 그려지는데 배포하면 그 자리가 빈다.

**변경 내용**

플랫폼이 유저 화면 템플릿에 넣는 최상위 값은 `lounges` · `stories` · `contentSections` · `latestContents` · `shopCategories` 다섯 개다. 그 밖의 이름은 빈 문자열이 된다. 스캐폴드가 만드는 `data.json`과 첫 `template.liquid`가 이 이름을 쓰도록 바뀌었다. 각 항목의 필드는 계약이 아니라 모양을 보기 위한 예시이므로 실제 렌더 결과로 확인한다. 어드민 화면이 받는 값은 확인되지 않았다.

**적용**

1. (판단) `data.json`의 최상위 키를 위 다섯 개 중 쓰는 것으로 바꾸고, 템플릿의 변수 이름도 함께 맞춘다.
2. (자동) 새로 만드는 프로젝트는 `bstage init --kind liquid`가 이미 맞춰 준다.

### `bstage docs`가 문서를 못 찾으면 종료 코드 2 — `자동` · `선택`

**영향**

- `bstage docs`의 종료 코드를 확인하는 스크립트·CI. SDK 의존이 없는 레포(예: `.liquid` 파일만 둔 레포)에서 이 경로를 탄다.

**변경 내용**

예전에는 "문서를 찾을 수 없습니다"를 출력하고도 0으로 끝나서, 종료 코드로 갈래를 잡는 호출자가 문서를 읽은 것으로 착각했다. 이제 2로 끝나고, liquid 레포에서는 `bstage-liquid` 스킬을 보라는 안내가 함께 나온다.

**적용**

1. (자동) 문서 유무를 그냥 확인만 하던 자리라면 종료 코드 2를 허용하도록 고친다.

### `bstage skills install` → `bstage ai install` — `자동` · `선택`

**영향**

- 스크립트·문서·CI에 `bstage skills install`을 적어 둔 프로젝트. 명령 자체는 아직 동작하므로 당장 깨지지는 않는다.
- 감지: 레포에서 `skills install` 문자열을 찾는다. 실행하면 `bstage ai install`로 바뀌었다는 경고가 뜬다.

**변경 내용**

스킬만이 아니라 `AGENTS.md`·`CLAUDE.md`·pre-commit 시크릿 가드까지 다루게 되어 이름이 맞지 않게 됐다. `bstage ai install`(설치·갱신) · `bstage ai update`(있는 파일만 갱신) · `bstage ai doctor`(진단, `--json`, 종료코드 0·2)로 나뉘었고, `bstage skills install`은 deprecated 별칭으로 남아 경고 후 `ai install`을 그대로 수행한다. 별칭은 **다음 릴리즈에서 제거된다.** 설치되는 콘텐츠는 새 패키지 `@bstage-sdk/ai-toolkit`이 들고 있고, cli가 그 패키지를 의존하므로 따로 설치할 필요는 없다.

이 명령들은 **프로젝트 종류(`sdk`·`liquid`)를 판정해 그 종류의 자산만 설치한다.** 판정은 레포의 파일 구조로 한다(포털 빌더와 같은 규칙). 템플릿 파일이 아직 없어 판정이 안 되는 레포에서는 종료 코드 2로 끝나므로 `bstage ai install --kind sdk` 또는 `--kind liquid`로 지정한다. 두 종류가 한 레포에 섞여 있으면 포털이 빌드하지 못하므로 역시 종료 코드 2로 멈춘다.

자세한 내용은 `AI_TOOLKIT.md`를 참고한다.

**적용**

1. (자동) 스크립트·문서의 `bstage skills install`을 `bstage ai install`로 바꾼다.
2. (자동) CI에서 최신 여부만 확인하려면 `bstage ai doctor --json`을 쓴다 — 전부 최신이면 0, 하나라도 어긋나면 2로 끝난다.
3. (판단) 판정이 실패하는 빈 레포에서만 `--kind`를 붙인다. 판정 결과와 다른 값을 주면 덮어쓰지 않고 멈추므로, 어긋나면 옵션을 빼고 다시 실행한다.

### AGENTS.md 관리 영역 갱신 · 스킬 2종 추가(`bstage-onboarding`·`bstage-deploy`) — `자동` · `선택`

**영향**

- `bstage init`으로 만든 모든 프로젝트. 관리 영역이 낡았거나 새 스킬이 없으면 해당한다.
- 감지: `bstage ai doctor`가 해당 항목을 `stale`·`missing`으로 보고한다(`bstage doctor`의 에이전트 스킬 절에도 나온다).

**변경 내용**

- `AGENTS.md`의 SDK 관리 영역에 배포 절이 추가되고, 프로젝트 종류(`sdk`·`liquid`)에 따라 본문이 갈린다. 마커 바깥 자유 영역은 그대로 보존된다.
- 스킬이 둘 늘었다. `bstage-onboarding`(빈손에서 첫 배포까지 안내) · `bstage-deploy`(배포·롤백·게시). 기존 `bstage-template`·`bstage-migrate`는 그대로다.
- 스캐폴드 `package.json`에 `bstage.kind`가 기록된다. **기존 프로젝트는 없어도 동작한다** — 종류 판정은 파일 구조로 하고 이 값은 읽지 않는다. 추가는 선택이다.
- `bstage doctor --json`에 `skillsSkipped` 필드가 생겼다(두 종류가 섞여 스킬 검사를 건너뛴 경우 `true`). 기존 필드는 그대로이므로 비파괴적 추가다.

**적용**

1. (자동) `npx @bstage-sdk/cli@latest ai install` — 없는 스킬을 만들고 관리 영역을 갱신한다. 이미 있는 것만 최신화하려면 `ai update`.
2. (판단) `AGENTS.md`에 관리 영역 마커가 없는 레거시 파일이면 자동 갱신 대상이 아니다. 명령이 레거시로 표시하고 건드리지 않으므로 `bstage-migrate` 스킬로 기존 내용과 reconcile한다.
3. (자동) 다른 종류의 스킬이 남아 있으면 `extra`로 보고되지만 지우지 않는다. 필요 없으면 직접 삭제한다 — 종료 코드에는 영향이 없다.

### liquid 템플릿 레포 지원 — `자동` · `선택`

**영향**

- liquid 템플릿(`public/{user|admin}/{이름}/template.liquid`)으로 포털에 배포하는 레포. 기존 SDK 프로젝트에는 영향이 없다.
- 감지: 레포에 위 경로의 `template.liquid`가 있으면 cli가 liquid 레포로 판정한다.

**변경 내용**

- `bstage init --kind liquid`가 liquid 레포를 스캐폴드한다. React·Vite 없이 cli 하나만 의존한다.
- `bstage dev`가 liquid 레포에서는 liquidjs 로컬 프리뷰를 띄운다(템플릿 목록·데이터 렌더·정적 파일·자동 리로드). 루프백에만 바인딩하고 템플릿 디렉터리 밖을 가리키는 경로는 차단한다. 인증 프록시는 없다.
- `bstage build`는 liquid 레포에서 **검증만** 한다(파스 오류·규약 밖 파일·폴더명·데이터 파일). 오류면 종료 코드 2. 포털이 파일을 그대로 패키징하므로 빌드 산출물은 만들지 않는다.
- `bstage doctor`에 liquid 진단 절이 생겼고, 배포 명령(`deploy`·`list`·`rollback`·`publish`)은 종류와 무관하게 같은 방식으로 동작한다.

**적용**

1. (자동) 기존 liquid 레포에서 `npx @bstage-sdk/cli@latest ai install`을 실행하면 liquid용 스킬과 `AGENTS.md`가 놓인다.
2. (자동) 로컬 확인은 `bstage dev`, 배포 전 검증은 `bstage build`.
3. (판단) SDK 템플릿과 liquid 템플릿을 한 레포에 섞지 않는다 — 포털 빌더가 빌드하지 못하고 cli도 종료 코드 2로 멈춘다.

자세한 내용은 `LIQUID.md`를 참고한다.

---

### liquid 파셜(`{% render %}`·`{% include %}`)은 배포에서 동작하지 않는다 — `판단` · `필수`

**영향**

- liquid 템플릿 레포 중 템플릿을 파셜로 쪼갠 곳. 옛 문서가 "탐색 루트는 `public/`"이라고만 적어 프리뷰에서 되는 것을 배포에서도 되는 것으로 읽게 했다.
- 감지: `bstage build`가 파셜 태그를 경고로 짚는다. 배포 화면에서는 그 자리가 비어 보인다.

**변경 내용**

배포 뷰어의 엔진은 레포의 파일을 찾지 못해 파셜 자리를 빈 문자열로 렌더한다. 문서·`bstage-liquid` 스킬·`AGENTS.md` 관리 영역이 그렇게 안내한다.

**적용**

1. (판단) 파셜 내용을 `template.liquid`에 인라인으로 옮긴다.
2. (자동) `npx @bstage-sdk/cli@latest ai update`로 스킬·`AGENTS.md`를 갱신한다.

### pre-commit 시크릿 가드 보강 — `자동` · `선택`

가드(`.husky/check-secrets.mjs`)가 포털 CLI 토큰 형태를 잡고, 크기 때문에 읽지 못한 파일을 검사 없이 통과시키던 것을 막으며(읽지 못하면 차단), NUL 바이트가 든 파일도 훑고, `.env.{phase}`의 SECRET·TOKEN·PASSWORD 계열 키에 실제 값이 있으면 차단한다. 알림에 값의 앞부분을 드러내지 않는다(길이만). `.env.example` 계열은 값 검사에서 빠지지만 키·토큰 검사는 그대로 받는다. `npx @bstage-sdk/cli@latest ai install`이 갱신한다.

### pre-commit 가드 줄이 정본 자리·정본 형태로 재배치된다 — `자동` · `선택`

가드 줄은 **shebang 다음 첫 줄에 `node .husky/check-secrets.mjs || exit 1`** 형태일 때만 그대로 둔다. 기존 훅의 가드 줄이 함수 본문·조건 블록 안에 있거나, 상태를 전파하지 않거나, `exit` 뒤에 있으면 `bstage ai install`·`update`가 그 줄을 지우고 정본 자리에 다시 넣는다(훅의 나머지 내용은 보존). 셸 제어 흐름을 정규식으로 판정할 수 없어 "애매하면 다시 넣는" 쪽으로 정했다.

### SDK 소유 파일 쓰기가 링크를 따라가지 않는다 — `자동` · `선택`

`ai install`·`update`가 파일을 쓸 때 대상과 경로 중간 디렉터리를 realpath로 검사하고, 여는 순간 심볼릭 링크를 거부하며, 하드 링크가 걸렸거나 일반 파일이 아니면(디렉터리·FIFO) 손대지 않는다. 레포에 커밋된 링크로 프로젝트 밖 파일이 바뀌는 경로를 막는다. 기존 파일의 느슨한 권한도 함께 바로잡는다.

### 손수정한 스킬은 `.bak`으로 남긴다 — `자동` · `선택`

`bstage ai install`·`update`가 손으로 고친 `SKILL.md`를 SDK 본문으로 되돌릴 때 기존 본문을 `SKILL.md.bak`에 남긴다. 프로젝트 고유 규칙은 `AGENTS.md` 자유 영역에 옮긴 뒤 `.bak`은 지운다.

### `bstage build`가 빌드할 것을 못 찾으면 종료 코드 2 — `자동` · `선택`

`src/pages`·`src/slots`에 `template.tsx`가 없거나 `.liquid`가 전부 규약 밖 자리에 있을 때 1로 끝나던 것을 2(사전조건 미충족)로 바꿨다 — liquid 검증 실패·`deploy` 사전점검과 같은 부류다. 종료 코드로 갈래를 잡는 스크립트만 영향받는다. `bstage dev`도 규약 밖 `.liquid`를 시작 전에 경고한다.

### 프로젝트에 고정된 옛 CLI로 실행하면 하향임을 알린다 — `판단` · `선택`

옛 `bstage`로 `doctor`·`ai install`을 돌리면 새 CLI가 놓은 스킬·가드를 "구버전/수정됨"으로만 표시하고 옛 본문으로 덮었다. 이제 설치본의 버전이 더 높으면 **하향**임을 분명히 알리고 최신 CLI로 다시 실행하라고 안내한다. 덮어쓰기 자체는 막지 않는다 — 파일 안의 버전 표기는 누구나 적을 수 있어, 그것으로 덮어쓰기를 막으면 높은 버전을 자칭한 임의 본문이 가드·스킬 자리에 영구히 남는다. 진단·갱신은 항상 `npx @bstage-sdk/cli@latest`로 실행한다.

## → core 0.3.0 · cli 0.3.0

### 앱 키 이름 정리(`appSecret` → `appKey`, `VITE_BSTAGE_APP_SECRET` → `VITE_BSTAGE_APP_KEY`) — `판단` · `선택`

**영향**

- **기존 프로젝트가 반드시 할 일은 없다.** `appSecret`·`VITE_BSTAGE_APP_SECRET`은 deprecated 별칭으로 그대로 동작한다. **별칭 제거는 0.4.0에서 이뤄지지 않았고 다음 버전으로 연기됐다** — 제거 시점은 이 문서에 다시 공지한다. 그래도 새 코드는 `appKey`를 쓰는 것을 권장한다.
- 감지: `src/shared/client.ts`에 `appSecret:`이 있거나, `.env`·`.env.example`에 `VITE_BSTAGE_APP_SECRET`이 있는 경우.

**변경 내용**

- 같은 값을 포털 화면(APP KEY)·포털 API(`appKey`)·게이트웨이 헤더(`X-BSTAGE-APP-KEY`)는 모두 KEY라고 부르는데 SDK만 `secret`이라고 불렀다. 이 값은 `VITE_` 환경변수라 **빌드 결과물에 평문으로 실려 브라우저에서 보이는 값**이고 비밀값이 아니다 — 이름이 사실과 반대여서 "숨겨야 하는 값"으로 오해하게 했다. SDK 이름을 나머지와 맞췄다.
- `BstageConfig.appKey`가 정본이고 `appSecret`은 deprecated 별칭이다(둘 다 주면 `appKey` 우선). 타입 주석도 "앱 시크릿"에서 "앱 키(APP KEY) — 브라우저에 노출되는 값"으로 바꿨다.
- 새 `bstage init` 스캐폴드는 `.env`·`.env.example`·`client.ts`·`vite-env.d.ts`에 새 이름을 쓴다.
- **소스와 `.env`가 다른 이름을 써도 빌드가 이어 붙인다.** `bstage build`(프리셋)와 `bstageDevPlugin`이 `VITE_BSTAGE_APP_KEY`·`VITE_BSTAGE_APP_SECRET` 중 한쪽만 있으면 다른 이름으로도 같은 값이 읽히게 `define`한다. 그래서 옛 `client.ts`(`appSecret: import.meta.env.VITE_BSTAGE_APP_SECRET`)를 둔 채 `.env`만 새 이름으로 바꿔도, 포털의 환경변수 입력이 새 이름으로 들어와도 번들에 값이 실린다. 둘 다 있으면 각자 실제 값이 그대로 쓰인다.
- `bstage build`의 인증 값 점검도 같은 순서로 본다 — 소스가 읽는 이름의 값이 우선, 다른 이름은 폴백. 보고에는 소스가 실제로 읽는 이름을 쓴다.
- 앱 키가 아예 없으면 `X-BSTAGE-APP-KEY` 헤더에 `"undefined"` 문자열을 실던 것을 헤더 생략 + 생성 시 콘솔 경고로 바꿨다. 게이트웨이 응답(401)은 같다.

**적용**

1. (자동) `@bstage-sdk/core`·`@bstage-sdk/cli`를 `0.3.0` 이상으로 올린다.
2. (판단) `src/shared/client.ts`의 `appSecret: import.meta.env.VITE_BSTAGE_APP_SECRET`을 `appKey: import.meta.env.VITE_BSTAGE_APP_KEY`로 바꾼다. 리터럴 키를 박아 둔 옛 프로젝트는 키 이름만 `appSecret` → `appKey`로 바꾼다.
3. (판단) `.env`·`.env.example`의 `VITE_BSTAGE_APP_SECRET=`을 `VITE_BSTAGE_APP_KEY=`로 바꾼다. 값은 그대로다 — 재발급이 아니다.
4. (판단) `src/vite-env.d.ts`의 `readonly VITE_BSTAGE_APP_SECRET: string`을 `readonly VITE_BSTAGE_APP_KEY: string`으로 바꾼다.
5. CI·배포 환경에 `VITE_BSTAGE_APP_SECRET`을 주입하고 있었다면 같은 값을 `VITE_BSTAGE_APP_KEY`로 주입한다. 2~4를 한 번에 못 옮기는 기간에는 위 별칭 덕에 어느 한쪽 이름만 있어도 빌드가 통과한다.

---
