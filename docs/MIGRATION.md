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
- **옛 프로젝트**: `npx @bstage-sdk/cli@latest ai install`로 스킬과 `AGENTS.md` 관리 영역을 설치한다. SDK 버전업 후 다시 실행하면 최신으로 동기화된다. 스킬이 없어도 `bstage doctor` 출력 + 이 문서만으로 AI가 마이그레이션을 진행할 수 있다. (`skills install`은 `ai install`의 deprecated 별칭이다 — cli 0.5.0 항목 참고.)

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
