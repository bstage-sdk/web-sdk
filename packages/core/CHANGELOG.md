# @bstage-sdk/core

## 0.4.0

- 내부 저장소 스냅샷 동기화

## 0.3.0

- **앱 키 이름 정리 — `BstageConfig.appKey` 추가, `appSecret`은 deprecated 별칭.** 포털 화면(APP KEY)·게이트웨이 헤더(`X-BSTAGE-APP-KEY`)와 같은 값을 SDK만 secret이라 불렀다. 이 값은 `VITE_` 환경변수로 번들에 평문으로 실려 브라우저에서 보이는 값이고 비밀값이 아니다. 둘 다 주면 `appKey`가 우선하고, **별칭은 0.4.0에서 제거된다.** 타입 주석도 "앱 시크릿"에서 "앱 키(APP KEY) — 브라우저에 노출되는 값"으로 바꿨다.
- 앱 키가 없으면 `X-BSTAGE-APP-KEY` 헤더에 `"undefined"` 문자열을 실는 대신 헤더를 생략하고 생성 시 콘솔 경고를 낸다. 게이트웨이 응답(401)은 같다.
- 옮기는 방법은 `docs/MIGRATION.md`의 `core 0.3.0 · cli 0.3.0` 항목 참고.

## 0.2.0

- 내부 저장소 스냅샷 동기화

