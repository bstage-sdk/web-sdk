# @bstage-sdk/cli

## 0.5.0

- **liquid 에셋 안내 정정.** 레포에 두고 상대 경로로 참조하라는 안내를 걷어냈다. 렌더된 HTML이 스페이스 도메인 페이지에 주입되므로 상대 경로는 배포 후 깨진다(로컬 프리뷰는 반대로 동작한다). 포털 미디어에 올려 받은 URL을 절대 주소로 쓴다.
- **liquid 데이터 계약 명시.** 플랫폼이 유저 화면에 넣는 최상위 값 다섯 개(`lounges`·`stories`·`contentSections`·`latestContents`·`shopCategories`)를 스킬·`AGENTS.md`·문서에 적고, 스캐폴드 `data.json`과 첫 템플릿도 그 이름을 쓴다. 어드민 스캐폴드는 계약이 확인되지 않아 빈 샘플로 둔다.
- `bstage docs`는 문서를 못 찾으면 종료 코드 2로 끝난다(이전에는 0).
- liquid 파일이 전부 규약 밖 경로에 있을 때 sdk 기준 오류가 나던 것을 실재 파일을 짚는 메시지로 바꿨다.
- `bstage ai doctor`의 레거시 `AGENTS.md` 안내가 빠져나갈 수 없는 문구였던 것을 reconcile 경로로 바꿨다.
- `bstage link`가 저장된 토큰의 스테이지 스코프로 후보를 좁힌다. 조직 전체 토큰이거나 스코프 정보가 없으면 예전처럼 전부 보여 준다.
- **`bstage ai install|update|doctor` 추가, `bstage skills install`은 deprecated 별칭.** 스킬만이 아니라 `AGENTS.md`·`CLAUDE.md`·pre-commit 시크릿 가드까지 다루게 되어 이름을 바꿨다. 별칭은 경고 후 `ai install`을 그대로 수행하며 다음 릴리즈에서 제거된다. 설치되는 콘텐츠는 새 패키지 `@bstage-sdk/ai-toolkit`이 들고 있다.
- **프로젝트 종류(`sdk`·`liquid`) 판정.** 레포의 파일 구조로 판정해(포털 빌더와 같은 규칙) 그 종류의 자산만 설치한다. 판정이 안 되는 빈 레포에서는 `--kind sdk`·`--kind liquid`로 지정한다. 두 종류가 섞여 있으면 포털이 빌드하지 못하므로 종료 코드 2로 멈춘다.
- **`bstage init --kind liquid`** — liquid 템플릿 레포를 스캐폴드한다. React·Vite 없이 cli 하나만 의존한다.
- **`bstage dev`가 liquid 레포를 지원한다** — Vite 대신 liquidjs 로컬 프리뷰(템플릿 목록·데이터 렌더·정적 파일·자동 리로드). 루프백에만 바인딩하고 템플릿 디렉터리 밖을 가리키는 경로는 차단한다.
- **`bstage build`가 liquid 레포에서는 검증만 수행한다** — 파스 오류·규약 밖 파일·폴더명·데이터 파일을 확인하고, 오류가 있으면 종료 코드 2. 포털이 파일을 그대로 패키징하므로 빌드 산출물은 만들지 않는다.
- **`bstage doctor`에 liquid 진단 절과 스킬 설치 상태 점검이 추가됐다.** `--json` 출력에 `skillsSkipped` 필드가 붙었다(비파괴적 추가).
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

