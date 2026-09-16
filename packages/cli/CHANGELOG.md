# @bstage-sdk/cli

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

