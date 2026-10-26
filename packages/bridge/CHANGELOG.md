# @bstage-sdk/bridge

## 0.13.0

- 내부 저장소 스냅샷 동기화

## 0.12.0

- 격리 프레임이 템플릿 브라우저 에러를 호스트에 알린다 — 새 요청 타입 `report`와 호스트 옵션 `onTemplateReport`.
  - 프레임 부트스트랩이 엔트리보다 먼저 `window`의 `error`·`unhandledrejection`과 엔트리 스크립트 로드 실패(kind `load`)를 잡아 `report`로 보낸다. 같은 에러는 첫 발생 뒤 1초(`REPORT_FLUSH_DELAY_MS`) 동안 묶어 한 번 보내고, 서로 다른 에러 5건에 닿으면 리스너를 뗀다. 프레임은 자르기만 하고 마스킹은 하지 않는다 — 받는 호스트가 지운다.
  - `validateReport`가 형식을 강제한다: `kind` `error|rejection|load`, `message` 300자 이하, `frames` 10개 이하·각 200자 이하(빈 칸 없는 문자열 배열), `count` 정수 1..100. 어기면 `BAD_REQUEST`. 스택 프레임은 V8 `at …`, Firefox·Safari `f@url:l:c`, URL만 있는 줄만 프레임으로 본다.
  - 호스트(`CreateBridgeHostOptions.onTemplateReport`)는 프레임 세션당 5건까지 콜백을 부른다. 기존 `log`와 달리 운영(real)에서도 전달한다. 콜백은 `{ kind, message, frames, count }`만 받는다 — 귀속은 호스트가 아는 템플릿 URL로 한다.
- `createSrcdoc`에 `crossOrigin?: 'anonymous'` — 엔트리 `<script>`에 `crossorigin`을 붙여 교차 origin 번들의 에러가 `"Script error."`로 가려지지 않게 한다. 격리 프레임은 opaque origin이라 요청이 `Origin: null`로 나가므로 CDN이 `Access-Control-Allow-Origin: *`이어야 한다. 주지 않으면 종전과 같다.

## 0.11.0

격리 프레임의 네트워크 규칙을 바꿉니다. **토큰이 필요한 API만 브리지**로 보내고, **그 밖의 https API는 템플릿이 프레임 안에서 직접** 부릅니다. 호스트 옵션은 없습니다 — 패키지를 올리면 `createSrcdoc`로 만든 모든 프레임(미리보기 프레임 포함)이 바로 이 규칙으로 동작합니다.

- **CSP**: `createSrcdoc`·`buildFrameCsp`의 `connect-src`가 `'none'`에서 `https: wss:`로 바뀝니다. 평문 `http:`·`ws:`는 열지 않으며, 나머지 지시어(`img-src`·`media-src`·`font-src`·`frame-src 'none'`·`form-action 'none'`·`base-uri 'none'`)는 그대로입니다.
- **`__bstage_fetch__` 라우터**: 부트스트랩이 템플릿 코드보다 먼저 `globalThis.__bstage_fetch__`(쓰기 불가)를 설치합니다. 입력을 `new URL(input, hostOrigin)`으로 정규화한 뒤 갈래를 나눕니다.

  | 목적지                                                                | 갈래                                                                                                                 |
  | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
  | hostOrigin + 경로가 init `gatewayPrefixes` 안                         | 브리지 fetch(호스트가 다시 판정하고 토큰을 붙입니다)                                                                 |
  | origin이 init `partnerOrigins`와 정확히 일치                          | 브리지 fetch(`partnerFetchImpl`)                                                                                     |
  | 그 밖의 https                                                         | 부트스트랩 때 잡은 프레임 `fetch`로 직접 호출, `credentials: 'omit'`·`referrerPolicy: 'no-referrer'`, 인증 헤더 없음 |
  | hostOrigin의 게이트웨이 밖 경로, https가 아닌 스킴(http·data·blob 등) | `TypeError`                                                                                                          |

  판정에 쓰는 전역(`fetch`·`URL` 등)과 init의 라우팅 목록은 부트스트랩 때 잡아 두므로, 템플릿이 나중에 전역이나 `getInit()` 객체를 바꿔도 갈래는 바뀌지 않습니다.

- **`installDirectFetch`**: 라우터를 `@bstage-sdk/bridge/frame`에서 공개합니다.
- **`BridgeInit.gatewayPrefixes`**: init에 호스트 `policy.gatewayPrefixes`를 싣습니다. 판정의 정본은 여전히 호스트 정책이고, 프레임 라우터는 보낼 길만 고릅니다. 필드가 없는 옛 호스트면 hostOrigin 요청은 경로와 무관하게 브리지로 갑니다.
- 브리지 fetch(`__bstage_bridge__.fetch`)와 호스트의 external 갈래(`allowExternal`)는 호환을 위해 그대로 동작합니다. core `BstageClient`는 프레임 안에서 계속 브리지 fetch를 씁니다(기본 목적지가 토큰이 필요한 게이트웨이입니다).
- **보안상 맞바꾼 것**: 직접 호출에는 브리지의 목적지 검사(사설 IP·IP 리터럴·로컬/내부 이름 거절)·요청 수 상한·요청/응답 본문 상한이 적용되지 않고, 요청은 `Origin: null`(sandbox opaque origin)로 나갑니다. 직접 부를 API는 CORS에서 `*` 또는 `null`을 허용해야 응답을 읽을 수 있습니다. 토큰(팬 토큰·쿠키)은 여전히 프레임에 들어가지 않고 브리지 요청에만 붙습니다. CSP `https:`는 hostOrigin도 포함하므로 템플릿은 전역 `fetch`·`sendBeacon` 등으로 hostOrigin에 직접 요청을 보낼 수 있으며, 이 요청은 브리지 거절 규칙을 거치지 않습니다.
- **호스트 권장 조치**: 프레임을 띄우는 호스트는 ① 호스트 origin 쿠키를 `SameSite=Lax`/`Strict`로 두고(`SameSite=None` 쿠키는 템플릿이 hostOrigin에 직접 보내는 요청에 실립니다) ② CORS에 `null` origin을 허용하지 않으며 ③ 쿠키로 인증하는 상태 변경 엔드포인트에 CSRF 방어를 유지하세요. 자세한 내용은 README "프레임 네트워크 (항상 적용)"에 있습니다.

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
