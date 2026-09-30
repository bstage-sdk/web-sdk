# @bstage-sdk/cli

## 0.6.0

- **sdk 템플릿과 liquid 템플릿이 한 레포에 있는 혼합 레포를 지원한다.** 전에는 두 종류의 템플릿 파일이 함께 있으면 `bstage build`·`dev`·`deploy`·`ai install`이 종료 코드 2로 멈췄다. 이제 포털이 sdk 템플릿을 빌드한 뒤 liquid 템플릿을 함께 패키징하고, 산출물 항목마다 종류를 따로 보므로 한 레포에서 둘을 함께 배포할 수 있다.
- **`bstage build`(혼합 레포)** — sdk 엔트리만 번들하고 liquid는 검증만 한다. `dist/`에 liquid는 들어가지 않는다(포털이 push된 커밋의 `public/{user|admin}/`에서 그대로 패키징한다). 검증 오류가 있으면 번들하지 않고 종료 코드 2. `--json`은 `{ "kind": "mixed", "issues", "sdk": { "templates", "outputs" }, "liquid": { "templates" } }` 객체 하나를 stdout에 쓰고 진행 로그는 stderr로 보낸다.
- **예약 이름** — 혼합 레포에서 `src/pages/user/…`·`src/pages/admin/…` 페이지는 만들 수 없다(대소문자 무시 — `User`도 같다). 산출물이 `dist/{user|admin}/…`로 나가 liquid 산출물 자리와 겹치고, 같은 디렉터리에 `template.js`와 `template.liquid`가 함께 있으면 포털이 sdk로만 판정해 liquid가 조용히 사라지기 때문이다. `bstage build`와 포털 빌더가 모두 여기서 막는다. 위젯(`src/slots`)은 해당 없다.
- **`bstage deploy`(혼합 레포)** — 막지 않고 안내 한 줄을 낸다. 위젯(SLOT) 배치 사전점검은 liquid 전용 레포에서만 하고, 혼합 레포의 항목별 판정(liquid 항목에 SLOT을 걸면 400)은 포털이 한다.
- **`bstage dev --kind <sdk|liquid>`** — 혼합 레포에서 어느 프리뷰를 띄울지 고른다. 기본은 sdk(Vite)이고 시작할 때 liquid 프리뷰 방법을 안내한다. 두 서버를 함께 띄우지 않는다. 단일 종류 레포에서 판정과 어긋난 값은 종료 코드 2.
- **liquid 검증기**(`bstage build`·`bstage doctor`의 liquid 절)는 sdk와 섞인 것을 더 이상 error로 보고하지 않는다.
- **`bstage build`(sdk 레포)** — `public/User/…`처럼 규약 밖 자리의 `.liquid`가 있으면 경고를 낸다. 포털이 그 파일을 패키징하지 않는다는 사실이 배포 뒤가 아니라 빌드 시점에 드러난다.
- **`bstage ai install`·`update`·`doctor`(혼합 레포)** — 스킬은 sdk 세트와 liquid 세트의 합집합(`bstage-template`·`bstage-liquid`·`bstage-onboarding`·`bstage-deploy`·`bstage-migrate`)을 설치하고, `AGENTS.md` 관리 영역은 두 구조와 혼합 규칙(어느 방식으로 만들지 · 예약 이름 · `bstage build`·`dev --kind` 동작)을 담은 **혼합 본문**이 된다. `mixed`는 판정으로만 나오고 `--kind`로 지정하는 값이 아니다 — 혼합 레포에 `--kind sdk|liquid`를 주면 판정과 어긋나 멈춘다.
- **`AGENTS.md` 관리 영역 v14** — liquid 본문의 "sdk와 섞지 않는다"가 공존 규칙으로 바뀌었다. `bstage-onboarding`·`bstage-liquid` 스킬의 "한 레포에 한 방식만" 문구도 같은 규칙(예약 이름 · `dev --kind liquid`)으로 바뀌었다. `npx @bstage-sdk/cli@latest ai update`로 갱신한다.
- **`bstage doctor`(혼합 레포)** — 스킬 검사를 건너뛰지 않고 두 세트를 모두 보며, liquid 검증 결과도 함께 낸다. `--json`의 `skillsSkipped`는 항상 `false`다(필드는 비파괴적으로 남긴다). 레거시·구버전 `AGENTS.md`에 대해 돌려주는 관리 블록은 레포 종류(sdk·liquid·혼합)의 본문으로 렌더한다 — 전에는 liquid 레포에도 sdk 본문이 나갔다.
- **`bstage doctor`의 `AGENTS.md` 정체성 값 정제** — 기존 파일에서 읽은 스페이스·레포 이름을 `bstage ai install`과 같은 규칙으로 정제한다. 훼손된 파일이 관리 영역 마커를 품은 값으로 관리 블록을 오염시키는 경로를 닫았다.
- **포털 빌더도 함께 갱신된다.** 갱신 전 포털은 혼합 레포에서 liquid만 패키징하므로, 포털 반영 공지 뒤에 혼합 레포를 배포한다. 옛 CLI(이 버전 미만)로는 혼합 레포의 `bstage build`가 종료 코드 2로 끝나며 포털 빌드 로그가 그 사실을 안내한다.

## 0.5.0

- **`bstage ai install|update|doctor` 추가, `bstage skills install`은 deprecated 별칭.** 스킬만이 아니라 `AGENTS.md`·`CLAUDE.md`·pre-commit 시크릿 가드까지 다루게 되어 이름을 바꿨다. 별칭은 경고 후 `ai install`을 그대로 수행하며 다음 릴리즈에서 제거된다. 설치되는 콘텐츠는 새 패키지 `@bstage-sdk/ai-toolkit`이 들고 있다.
- **프로젝트 종류(`sdk`·`liquid`) 판정.** 레포의 파일 구조로 판정해(포털 빌더와 같은 규칙) 그 종류의 자산만 설치한다. 판정이 안 되는 빈 레포에서는 `--kind sdk`·`--kind liquid`로 지정한다. 두 종류가 섞여 있으면 포털이 빌드하지 못하므로 종료 코드 2로 멈춘다.
- **`bstage init --kind liquid`** — liquid 템플릿 레포를 스캐폴드한다. React·Vite 없이 cli 하나만 의존한다.
- **`bstage dev`가 liquid 레포를 지원한다** — Vite 대신 liquidjs 로컬 프리뷰(템플릿 목록·데이터 렌더·정적 파일·자동 리로드). 루프백에만 바인딩하고 템플릿 디렉터리 밖을 가리키는 경로는 차단한다. 규약 밖 `.liquid` 파일이 있으면 시작 전에 경고한다.
- **`bstage build`가 liquid 레포에서는 검증만 수행한다** — 파스 오류·규약 밖 파일·폴더명·데이터 파일을 확인하고, 오류가 있으면 종료 코드 2. 포털이 파일을 그대로 패키징하므로 빌드 산출물은 만들지 않는다. 빌드할 대상을 찾지 못할 때도 종료 코드 2다(이전에는 1).
- **`bstage doctor`에 liquid 진단 절과 스킬 설치 상태 점검이 추가됐다.** `--json` 출력에 `skillsSkipped` 필드가 붙었다(비파괴적 추가).
- **liquid 에셋 안내 정정.** 레포에 두고 상대 경로로 참조하라는 안내를 걷어냈다. 렌더된 HTML이 스페이스 도메인 페이지에 주입되므로 상대 경로는 배포 후 깨진다(로컬 프리뷰는 반대로 동작한다). 포털 미디어에 올려 받은 URL을 절대 주소로 쓴다.
- **liquid 파셜(`{% render %}`·`{% include %}`)은 배포에서 동작하지 않는다.** 배포 뷰어의 엔진이 레포의 파일을 찾지 못해 그 자리를 빈 문자열로 렌더한다(로컬 프리뷰는 반대로 동작한다). 문서·스킬·`AGENTS.md`가 그렇게 안내하고 `bstage build`가 파셜 태그를 경고로 짚는다.
- **liquid 데이터 계약 명시.** 플랫폼이 유저 화면에 넣는 최상위 값 다섯 개(`lounges`·`stories`·`contentSections`·`latestContents`·`shopCategories`)를 스킬·`AGENTS.md`·문서에 적고, 스캐폴드 `data.json`과 첫 템플릿도 그 이름을 쓴다. 어드민 스캐폴드는 계약이 확인되지 않아 빈 샘플로 둔다.
- **pre-commit 시크릿 가드 보강.** 포털 CLI 토큰 형태를 잡고, 크기 때문에 읽지 못한 파일을 검사 없이 통과시키던 것을 막으며(읽지 못하면 차단), NUL 바이트가 든 파일도 훑고, `.env.{phase}`의 SECRET·TOKEN·PASSWORD 계열 키에 실제 값이 있으면 차단한다. 알림에 값의 앞부분을 드러내지 않는다(길이만). `.env.example` 계열은 값 검사에서 제외하되 키·토큰 검사는 그대로 받는다.
- **가드 줄은 정본 자리·정본 형태만 인정한다.** shebang 다음 첫 줄의 `node .husky/check-secrets.mjs || exit 1` 이 아니면 `ai install`·`update`가 그 줄을 지우고 정본 자리에 다시 넣는다(훅의 나머지 내용은 보존). 셸 제어 흐름은 정규식으로 판정할 수 없어 "애매하면 다시 넣는" 쪽으로 정했다.
- **SDK 소유 파일 쓰기·권한 변경이 링크를 따라가지 않는다.** 대상과 경로 중간 디렉터리를 realpath로 검사하고, 여는 순간 `O_NOFOLLOW`로 심볼릭 링크를 거부하며, 하드 링크가 걸렸거나 일반 파일이 아니면(디렉터리·FIFO) 손대지 않는다. 기존 파일의 느슨한 권한도 함께 바로잡는다.
- **손으로 고친 `SKILL.md`는 `.bak`으로 남기고 되돌린다.** 프로젝트 고유 규칙은 `AGENTS.md` 자유 영역에 적는다.
- **프로젝트에 고정된 옛 CLI로 실행하면 하향임을 알린다.** 설치본이 더 새 버전이면 그 사실을 분명히 알리고 최신 CLI로 다시 실행하라고 안내한다. 파일 안의 버전 표기로 덮어쓰기를 막지는 않는다 — 그 값은 누구나 적을 수 있어 가드·스킬을 영구히 바꿔치기하는 데 쓰일 수 있다.
- `bstage docs`는 문서를 못 찾으면 종료 코드 2로 끝난다(이전에는 0).
- liquid 파일이 전부 규약 밖 경로에 있을 때 sdk 기준 오류가 나던 것을 실재 파일을 짚는 메시지로 바꿨다.
- `bstage ai doctor`의 레거시 `AGENTS.md` 안내가 빠져나갈 수 없는 문구였던 것을 reconcile 경로로 바꿨다.
- `bstage link`가 저장된 토큰의 스테이지 스코프로 후보를 좁힌다. 조직 전체 토큰이거나 스코프 정보가 없으면 예전처럼 전부 보여 준다.
- 스캐폴드 README의 배포 절을 포털 빌드·`bstage deploy` 흐름으로 고쳤다(옛 워크플로 트리거 안내 제거).
- 문서: `AI_TOOLKIT.md`·`LIQUID.md` 신설.

## 0.4.1

- `@bstage-sdk/core` 0.4.1 재핀. 0.4.0 배포물의 슬롯 카탈로그 누락 수정에 따른 의존 갱신이며 이 패키지의 코드 변경은 없다.

## 0.4.0

- `@bstage-sdk/core` 버전업 반영(어드민 목록 화면 v2 슬롯 자리 추가) — cli 자체 변경 없음

## 0.3.0

- **앱 키 이름 정리 — `appSecret` → `appKey`, `VITE_BSTAGE_APP_SECRET` → `VITE_BSTAGE_APP_KEY`.** 포털 화면(APP KEY)·게이트웨이 헤더(`X-BSTAGE-APP-KEY`)와 같은 값을 SDK만 secret이라 불렀다. 이 값은 `VITE_` 환경변수로 번들에 평문으로 실려 브라우저에서 보이는 값이고 비밀값이 아니다.
  - `BstageConfig.appKey`가 정본. `appSecret`은 deprecated 별칭으로 그대로 동작한다(둘 다 주면 `appKey` 우선). **별칭은 0.4.0에서 제거된다.**
  - `bstage init` 스캐폴드(`.env`·`.env.example`·`client.ts`·`vite-env.d.ts`)는 새 이름을 쓴다.
  - `bstage build`와 `bstageDevPlugin`이 `VITE_BSTAGE_APP_KEY`·`VITE_BSTAGE_APP_SECRET` 중 한쪽만 있으면 다른 이름으로도 같은 값이 읽히게 이어 붙인다 — 기존 `client.ts`를 고치지 않아도 `.env`만 새 이름으로 바꿀 수 있고, 반대도 된다.
  - 빌드 시 인증 값 점검도 두 이름을 한 값으로 본다(소스가 읽는 이름의 값 우선).
  - 앱 키가 없으면 `X-BSTAGE-APP-KEY` 헤더에 `"undefined"` 문자열을 실는 대신 헤더를 생략하고 콘솔 경고를 낸다.
  - 옮기는 방법은 `docs/MIGRATION.md`의 `core 0.3.0 · cli 0.3.0` 항목 참고.

## 0.2.0

- 포털 명령 추가: `bstage login`(브라우저 승인 코드 방식) · `logout` · `whoami` · `link` · `list` · `logs` · `deploy` · `rollback` · `publish`. 포털에서 발급한 개인 토큰으로 인증하며, 토큰은 포털 주소·조직별로 사용자 설정 디렉터리에 저장된다. 자세한 사용법은 `docs/GETTING_STARTED.md` 9절.
- CI 용도로 `BSTAGE_TOKEN` 환경변수와 `--json`/`--yes` 옵션을 지원한다.

