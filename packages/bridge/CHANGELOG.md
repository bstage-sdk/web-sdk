# @bstage-sdk/bridge

## 0.10.0

격리 프레임이 자기 자신을 다른 URL로 내비게이션한 뒤 새 문서가 브리지를 쓰지 못하게 합니다. 호스트 코드는 바꾸지 않아도 됩니다.

- **프레임 토큰**: 프레임 런타임이 문서마다 128비트 토큰을 만들어 프레임 → 호스트 봉투 최상위 `frame`에 싣습니다. 호스트는 세션을 첫 메시지의 토큰에 묶고, 토큰이 없거나 다른 메시지가 오면 처리하지 않고 즉시 `dispose()`합니다. 같은 `contentWindow`에 새로 뜬 문서의 두 번째 핸드셰이크는 성립하지 않습니다. 토큰은 런타임 클로저에만 있고 호스트 → 프레임 메시지에는 실리지 않습니다. 토큰은 `crypto.getRandomValues`로만 만들며, 없으면 브리지를 열지 않습니다.
- **`frame-unload`**: 부트스트랩이 `pagehide`(bfcache 진입 제외)에서 `evt:frame-unload`를 동기로 보내고, 호스트는 받는 즉시 `dispose()`합니다. 이후 메시지는 무시하고 진행 중 요청의 응답도 보내지 않습니다. 프레임 쪽 대기 요청은 `UNSUPPORTED`로 바로 거절됩니다. 이벤트 이름을 `FRAME_UNLOAD_EVENT`로 공개합니다. 전송 경로는 부트스트랩 때 잡아 둔 참조만 써서 템플릿이 전역을 바꿔도 막지 못합니다.
- **`onDispose(reason)`**: `createBridgeHost`에 선택 옵션을 추가합니다. `reason`은 `'frame-unload' | 'frame-mismatch' | 'manual'`(`BridgeDisposeReason`)이며, 임베더는 이 콜백에서 iframe을 걷어 낼 수 있습니다.
- `host.send`는 핸드셰이크(토큰 묶임) 전에는 프레임에 보내지 않고 init에만 반영합니다.
- **호환성**: `createSrcdoc`와 `createBridgeHost`는 같은 패키지 버전이어야 합니다. 0.9.x의 `createSrcdoc`로 만든 프레임(토큰 없는 옛 부트스트랩)은 0.10.0 호스트에서 첫 메시지에 세션이 끊깁니다. 두 쪽을 함께 올리세요.
- 남는 위험과 재로드·재삽입 시 새 호스트가 필요한 점은 README "세션 수명과 프레임 자기 내비게이션"에 적었습니다.

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
