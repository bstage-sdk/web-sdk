# @bstage-sdk/core

## 0.4.1

- **0.4.0 배포물 재빌드.** 0.4.0으로 배포된 `dist/`는 0.3.0 빌드 산출물을 그대로 실은 것이어서 0.4.0에 추가된 어드민 슬롯 두 개(`admin.contents-list.list:before` · `admin.community-board-list.list:before`)가 카탈로그에 없었다. 소스는 0.4.0 시점에 이미 맞았고 산출물만 잘못됐다. 이 버전은 같은 소스를 다시 빌드해 배포한 것이며 코드 변경은 없다.
- 0.4.0 카탈로그로 새 슬롯 id를 쓰면 `bstage build`가 알 수 없는 슬롯으로 거절한다. 새 어드민 슬롯을 쓰려면 core·cli를 0.4.1 이상으로 올린다.

## 0.4.0

- 어드민 목록 화면 v2 슬롯 자리 추가
  - 콘텐츠 목록: `admin.contents-list.list:before` — context 없음. 목록 위
  - 커뮤니티 보드 목록: `admin.community-board-list.list:before` — context 없음. 목록 위

## 0.3.0

- **앱 키 이름 정리 — `BstageConfig.appKey` 추가, `appSecret`은 deprecated 별칭.** 포털 화면(APP KEY)·게이트웨이 헤더(`X-BSTAGE-APP-KEY`)와 같은 값을 SDK만 secret이라 불렀다. 이 값은 `VITE_` 환경변수로 번들에 평문으로 실려 브라우저에서 보이는 값이고 비밀값이 아니다. 둘 다 주면 `appKey`가 우선하고, **별칭은 0.4.0에서 제거된다.** 타입 주석도 "앱 시크릿"에서 "앱 키(APP KEY) — 브라우저에 노출되는 값"으로 바꿨다.
- 앱 키가 없으면 `X-BSTAGE-APP-KEY` 헤더에 `"undefined"` 문자열을 실는 대신 헤더를 생략하고 생성 시 콘솔 경고를 낸다. 게이트웨이 응답(401)은 같다.
- 옮기는 방법은 `docs/MIGRATION.md`의 `core 0.3.0 · cli 0.3.0` 항목 참고.

## 0.2.0

- 내부 저장소 스냅샷 동기화

