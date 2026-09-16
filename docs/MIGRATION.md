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
