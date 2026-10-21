# @bstage-sdk/bridge

## 0.9.1

- 내부 저장소 스냅샷 동기화

## 0.9.0

첫 공개 릴리즈. 템플릿을 격리된 iframe에서 실행하기 위한 메시지 프로토콜·호스트 정책·프레임 클라이언트입니다. placement 단위 선택 기능이며 기본 배치는 지금과 같은 inline입니다.

- 프로토콜·`createSrcdoc`: 격리 프레임 문서를 만든다(CSP `connect-src 'none'`). img-src·media-src에는 `https:` 와일드카드가 없고, 외부 이미지·미디어는 선택 옵션 `mediaOrigins`(정확한 https origin, 최대 20개)로만 연다. `elementName`은 100자 이하(`MAX_ELEMENT_NAME_LENGTH`)로 선형 시간에 검증한다.
- 호스트 `createBridgeHost`(`@bstage-sdk/bridge/host`): 발신자·세션을 확인하고 목적지·메서드·헤더·본문·응답 크기·레이트 리밋 정책을 적용한다. 목적지는 세 갈래다.
  - 같은 origin `/gw` → `fetchImpl`
  - `partnerOrigins`에 정확히 일치하는 origin → `partnerFetchImpl`
  - 그 밖의 https origin → `externalFetchImpl`(기본: 인증 없는 `globalThis.fetch`, `credentials: 'omit'`·`redirect: 'error'`·`referrerPolicy: 'no-referrer'`). 외부 갈래는 **옵트인**이다 — `policy.allowExternal`(기본 `false`)을 `true`로 둔 호스트만 열리고, 아니면 `FORBIDDEN_DESTINATION`이다. IP 리터럴·단일 레이블·로컬/예약 이름·호스트와 같은 호스트명은 외부 갈래로 보내지 않는다.
  - `externalFetchImpl`에 `fetchImpl`·`partnerFetchImpl`을, `partnerFetchImpl`에 `fetchImpl`을 그대로 넘기면 `TypeError`.
- 게이트웨이 거절 세그먼트 기본값을 `DEFAULT_GATEWAY_DENY_SEGMENTS`(`auth`·`logout`·`mfa`·`token`·`oauth`·`sso`·`debug`·`debugger`·`xdebug`·`withdraw`)로 공개한다. `token`이 들어간 세그먼트는 정책과 무관하게 항상 거절하며, 호스트가 넘긴 세그먼트는 소문자로 정규화해 비교한다.
- `init.surface`는 `'page' | 'slot'`(`BridgeSurface`)이다. `BRIDGE_SURFACES`·`isBridgeSurface`를 공개한다.
- 프레임 `createBridgeClient`·`createBridgeFetch`(`@bstage-sdk/bridge/frame`).
- `typesVersions`로 `moduleResolution: "node"` 소비자도 `/host`·`/frame` 타입을 찾는다.
