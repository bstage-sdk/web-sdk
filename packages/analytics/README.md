# @bstage-sdk/analytics

웹 사이트의 행동 로그(페이지 뷰·클릭·노출·스크롤 깊이·커스텀 이벤트)를 수집해 **호스트가 지정한 수집 서버**로 전송하는 브라우저 SDK입니다.

- 클릭·노출·커스텀 이벤트는 **DOM 속성(`data-log-*`)만으로** 동작합니다. 호출하는 API는 `init`·`identify`·`setConsent`·`destroy` 네 개가 기본입니다.
- 이 패키지는 **클라이언트 라이브러리**입니다. 수집 서버·저장·보관은 포함하지 않으며, 사용하는 쪽이 구축합니다.
- 동의(consent) 획득과 사용자 ID 부여는 **호스트 앱의 책임**입니다.

## 설치

```bash
npm i @bstage-sdk/analytics
```

## 빠른 시작

호스트 앱에서 한 번만 초기화합니다.

```ts
import { identify, init, setConsent } from '@bstage-sdk/analytics'

identify('user-123') // 로그인 사용자가 있을 때만
setConsent(true) // 사용자가 동의했을 때만 true
init({ key: 'YOUR_SPACE_KEY', endpoint: 'https://collector.example.com' })
```

### 호출 순서: `identify → setConsent → init`

이 순서를 지킵니다.

- `init()`은 **첫 `page_view`를 즉시 발화**합니다. 동의 상태와 사용자 ID가 그 전에 정해져 있어야 첫 이벤트에 반영됩니다.
- `identify`를 `setConsent`보다 먼저 부르는 이유: 비동의(`setConsent(false)`)는 그때까지 주입된 사용자 정보를 버립니다. 순서를 뒤집으면 동의한 사용자의 ID가 사라지거나 비동의 사용자의 ID가 남는 상황을 만들기 쉽습니다.
- `init()`은 **멱등**합니다. 이미 시작했다면 즉시 반환하므로 동의·로그인 상태가 바뀌어 다시 호출되어도 인스턴스는 하나입니다.

### Next.js App Router 예시

루트 레이아웃에 클라이언트 컴포넌트 하나를 두는 구성입니다.

```tsx
// app/analytics.tsx
'use client'

import { useEffect } from 'react'
import { destroy, identify, init, setConsent } from '@bstage-sdk/analytics'

interface Props {
  userId?: string
  consent: boolean
}

export function Analytics({ userId, consent }: Props) {
  useEffect(() => {
    if (userId) identify(userId)
    setConsent(consent)
    init({ key: 'YOUR_SPACE_KEY', endpoint: 'https://collector.example.com' })
  }, [userId, consent])

  useEffect(() => destroy, [])

  return null
}
```

```tsx
// app/layout.tsx
import type { ReactNode } from 'react'
import { Analytics } from './analytics'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Analytics consent={false} />
        {children}
      </body>
    </html>
  )
}
```

- ⛔ **`destroy()`를 위 init effect의 cleanup으로 두지 않습니다.** deps(`[userId, consent]`)가 바뀔 때마다 정지 후 재시작이 돌아 `page_view`가 추가로 발화합니다. 위처럼 **unmount 전용 effect**(`deps: []`)에 둡니다.
- `init()`은 **클라이언트에서만** 호출합니다(`'use client'` + `useEffect`). 모듈을 import하는 것은 서버 렌더링에서도 안전하지만 `init()`은 브라우저 API를 사용합니다.
- 사이트 전체가 수집 대상이면 라우트 경계마다 `destroy()`/`init()`을 반복할 필요가 없습니다. 루트 레이아웃에서 `init()` 1회로 충분합니다.
- ⚠️ **개발 모드(React StrictMode)에서는 첫 `page_view`가 2건 나갑니다.** StrictMode가 effect를 mount → cleanup → mount로 돌리면서 사이 cleanup에서 `destroy()`가 실행되고, 정지된 인스턴스의 두 번째 `init()`이 새 `page_view`를 발화합니다(두 이벤트의 `evtId`·`viewId`는 서로 다릅니다). **프로덕션 빌드에서는 1건입니다.** 개발 중 수집 요청을 확인할 때 혼동하지 않도록 알아 둡니다.

## 설정(`InitConfig`)

```ts
init({
  key: 'YOUR_SPACE_KEY',
  endpoint: 'https://collector.example.com',
  path: '/collect',
  impression: { threshold: 0.5, duration: 2000, rootMargin: '0px' },
})
```

| 필드         | 필수   | 설명                                                                                 |
| ------------ | ------ | ------------------------------------------------------------------------------------ |
| `key`        | 예     | 문자열 그대로 모든 배치에 실립니다. 의미(스페이스 식별 등)는 수집 서버가 해석합니다. |
| `endpoint`   | 예     | 수집 서버 오리진(`https://…`) 또는 같은 오리진의 상대 경로.                          |
| `path`       | 아니오 | `endpoint` 뒤에 붙는 수집 경로. 생략하면 기본 경로를 씁니다.                         |
| `impression` | 아니오 | 노출 판정 임계값 덮어쓰기. 지정한 키만 기본값을 대체합니다.                          |

### 최종 전송 URL = `endpoint` + `path`

| 설정                                                            | 전송 URL                                              |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| `endpoint: 'https://collector.example.com'`                     | `https://collector.example.com/api/v2/logs/analytics` |
| `endpoint: 'https://collector.example.com'`, `path: '/collect'` | `https://collector.example.com/collect`               |
| `endpoint: 'https://collector.example.com/in'`, `path: ''`      | `https://collector.example.com/in`                    |

- `path`를 생략하면 기본 경로 `/api/v2/logs/analytics`가 붙습니다(`LOG_PATH`로도 export됩니다).
- `path: ''`이면 `endpoint`에서 끝 슬래시만 뗀 값이 그대로 전송 URL입니다.
- `path`는 pathname에만 대입되므로 오리진을 바꿀 수 없습니다.
- **스킴이 없는 `endpoint`(상대 경로)는 현재 페이지와 같은 오리진이어야 합니다.** 다른 오리진으로 보내려면 `https://`·`http://`를 직접 적습니다. `//host` 형태는 거부됩니다.
- 전송은 `Content-Type: text/plain`·커스텀 헤더 없음으로 나가므로 cross-origin이어도 CORS preflight가 없습니다. SDK는 **응답을 읽지 않습니다** — 서버 오류도 SDK가 관측하지 못합니다.

### 설정 오류 코드

설정이 잘못되면 SDK는 콘솔에 경고를 남기고 **수집을 시작하지 않습니다**(`…; analytics did not start`). 호스트 앱에는 예외를 던지지 않습니다.

| 코드                           | 조건                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| `E_KEY_MISSING`                | `key`가 없다                                                     |
| `E_ENDPOINT_MISSING`           | `endpoint`가 없다                                                |
| `E_ENDPOINT_EMPTY`             | `endpoint`가 빈 값이다                                           |
| `E_ENDPOINT_ILLEGAL_CHAR`      | 제어문자 또는 역슬래시가 있다                                    |
| `E_ENDPOINT_QUERY_OR_FRAGMENT` | 쿼리 또는 프래그먼트가 들어 있다                                 |
| `E_ENDPOINT_UNPARSABLE`        | URL로 해석할 수 없다                                             |
| `E_ENDPOINT_SCHEME`            | http(s)가 아닌 스킴이다                                          |
| `E_ENDPOINT_USERINFO`          | userinfo(사용자·비밀번호)가 들어 있다                            |
| `E_ENDPOINT_CROSS_ORIGIN`      | 상대 경로가 다른 오리진으로 해석된다                             |
| `E_PATH_ILLEGAL_CHAR`          | `path`에 제어문자 또는 역슬래시가 있다                           |
| `E_PATH_QUERY_OR_FRAGMENT`     | `path`에 쿼리 또는 프래그먼트가 들어 있다                        |
| `E_PATH_NOT_ABSOLUTE`          | 빈 값이 아닌 `path`가 `/`로 시작하지 않는다                      |
| `E_PATH_ENCODED`               | `path`에 인코딩된 구분자·퍼센트(`%2F`·`%5C`·`%25`)가 있다        |
| `E_PATH_DOT_SEGMENT`           | `path`에 `.`·`..` 세그먼트가 있다(`%2e` 같은 퍼센트 인코딩 포함) |

## 자동으로 수집되는 이벤트

| 이벤트         | 발화 시점                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------- |
| `page_view`    | `init()` 직후 1건, 이후 `history` 기반 라우트 전환마다 1건                                   |
| `click`        | `a`·`button`·`data-log-click`·`data-log-event`가 붙은 요소의 클릭                            |
| `impression`   | `data-log-item`이 붙은 요소가 임계 면적을 임계 시간 동안 보였을 때(페이지 뷰마다 요소당 1회) |
| `scroll_depth` | 스크롤이 페이지 높이의 50%·90%에 처음 도달했을 때(페이지 뷰마다 초기화)                      |

`page_view`·`click`·`impression`·`scroll_depth`·`runtime_error`는 **예약 이름**이라 직접 보낼 수 없습니다.

### 라우트 전환 `page_view`

- 전환 `page_view`의 `params.loadType`은 `navigate`이고, 뒤로·앞으로 가기는 `back_forward`입니다. 같은 URL로의 `replaceState`는 새 `page_view`를 만들지 않습니다.
- **전환 `page_view`는 이중 `requestAnimationFrame` 뒤에 생성됩니다**(약 16~33ms 지연, 숨은 탭은 최대 100ms). 라우터가 `pushState` 직후 렌더 커밋에서 `<title>`을 바꾸는 경우에도 `page.title`이 **새 화면의 제목**이 되게 하기 위함입니다.
  - 그 사이의 클릭은 이전 화면에 귀속됩니다.
  - 그 사이에 페이지를 떠나면 해당 `page_view`는 유실됩니다.
  - ⚠️ `generateMetadata`처럼 두 프레임보다 늦게 제목이 바뀌는 페이지는 이전 제목이 실릴 수 있습니다.
- Next.js(App Router·Pages Router)에서 `Link`·`router.push`·뒤로가기를 사용한 전환이 전환 1회당 `page_view` 1건으로 집계됩니다.

## DOM 속성 계약

마크업에 속성만 붙이면 됩니다. 코드 호출은 필요 없습니다.

| 속성                  | 용도                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `data-log-section`    | 섹션 이름. 가장 가까운 조상에서 읽어 `click`·`impression`의 `params.section`에 실립니다. 같은 키라 조인해 CTR을 계산할 수 있습니다.  |
| `data-log-click`      | `a`·`button`이 아닌 요소의 클릭도 `click`으로 수집하려고 붙입니다.                                                                   |
| `data-log-item`       | 노출 측정 대상. **값이 `itemId`**이며 이 속성이 있어야 `impression`이 발화합니다.                                                    |
| `data-log-item-name`  | 노출 대상의 이름(`itemName`, 선택).                                                                                                  |
| `data-log-item-index` | 노출 대상의 순번(`itemIndex`, 선택, 0 이상의 정수). 명시했을 때만 실립니다.                                                          |
| `data-log-event`      | 커스텀 이벤트 이름. 클릭 시 `click`에 **더해** 이 이름의 이벤트가 추가로 발화합니다.                                                 |
| `data-log-param-*`    | 커스텀 이벤트에 함께 실을 값. 접두어 뒤가 `params` 키가 되며 kebab-case는 camelCase로 바뀝니다(`data-log-param-item-id` → `itemId`). |

```html
<section data-log-section="hero">
  <button data-log-event="signup_click" data-log-param-plan="pro">시작하기</button>
</section>

<ul data-log-section="recommend">
  <li data-log-item="p-1001" data-log-item-name="상품 A" data-log-item-index="0">…</li>
</ul>
```

- 이벤트 이름은 소문자로 시작하는 `snake_case`, 40자 이하여야 합니다. 규칙을 어기거나 예약 이름이면 이벤트가 버려지고 콘솔 경고(`E_NAME_INVALID`·`E_NAME_RESERVED`)가 남습니다.
- `params` 키는 소문자로 시작하고 영문·숫자·`_`만 쓸 수 있습니다(40자 이하, 요소당 최대 25개). 규칙에 맞지 않는 키는 버려집니다. 값은 마스킹 후 200자에서 잘립니다.
- 노출 임계값 기본값은 `threshold: 0.5`(면적 50%)·`duration: 2000`(ms)·`rootMargin: '0px'`이며 `init({ impression })`으로 덮어씁니다. 적용값은 배치마다 `impressionOpt`로 실려 전송됩니다.

### 코드로 커스텀 이벤트 보내기

```ts
import { send } from '@bstage-sdk/analytics'

send('purchase_done', { orderId: 'o-1', amount: 12000 })
```

`params` JSON 크기는 16KB(`EVENT_MAX`)를 넘으면 이벤트가 버려집니다. 키 25개 초과·키 40자 초과·문자열 값 500자 초과는 경고만 남깁니다.

## 동의와 사용자 식별

- **동의 기본값은 비동의입니다.** `setConsent(true)`를 부르기 전에는 동의하지 않은 것으로 취급합니다.
- **비동의(익명) 모드에서도 수집은 계속됩니다.** 다만 다음이 달라집니다.
  - 브라우저 ID(`bId`)·세션 ID(`sId`)를 발급·저장하지 않고, 이미 있던 쿠키(`_bsa_bid`·`_bsa_sid`)는 삭제합니다.
  - `identify()`로 주입한 사용자 정보는 버려집니다.
  - 전송에 실패한 이벤트를 브라우저에 영속 보관하지 않습니다.
  - 모든 배치에 `consent.analytics: false`가 실려, 수집 서버가 익명 트래픽을 구분할 수 있습니다.
- **동의를 어떻게 받고 언제 `setConsent(true)`를 부를지는 호스트 앱이 책임집니다.** SDK는 동의 UI를 제공하지 않습니다.
- 동의한 경우에만 1st-party 쿠키 `_bsa_bid`(브라우저 ID, 365일)와 `_bsa_sid`(세션 ID, 30분 슬라이딩)를 씁니다. 쿠키는 **host-only**라 호스트 도메인에만 생깁니다.
- `identify(userId, props?)`는 호스트가 가진 사용자 ID를 이벤트에 싣습니다. 호출하지 않으면 비로그인으로 취급합니다.

## 제약

- **`isTrusted` 클릭만 수집합니다.** `element.click()`이나 `dispatchEvent`로 만든 프로그램적 클릭·스크롤은 수집하지 않습니다.
- **`history` 기반 SPA 전환만 집계합니다.** `pushState`·`replaceState`·`popstate`를 따라가며, 그 밖의 방식으로 화면만 바뀌는 경우(URL이 바뀌지 않는 상태 전환)는 `page_view`가 되지 않습니다.
- **`init()`은 클라이언트에서만** 호출합니다. 서버 렌더링 중 호출하면 아무 일도 하지 않습니다.
- **앱 번들에 SDK 인스턴스는 하나만 있어야 합니다.** 같은 앱에 SDK가 두 번 들어가 둘 다 `init()`하면 모든 자동 이벤트가 2배로 집계됩니다. 하위 패키지가 SDK를 중복 번들하지 않도록 의존성을 점검합니다.
- 배치는 최대 20건 또는 5초마다 전송되며, 탭이 숨겨지거나 페이지를 떠날 때(`visibilitychange`·`pagehide`) 즉시 비웁니다. 배치 본문은 최대 48KB(`BODY_MAX`)입니다.
- 전송은 `sendBeacon`(실패 시 `fetch` keepalive)입니다. `sendBeacon`은 쿠키를 포함해 요청하므로 **수집 서버 도메인의 쿠키가 요청에 붙을 수 있고**, `Referer`가 함께 나갑니다(cross-origin이면 오리진만).
- 페이지 언로드 도중의 전송은 중복될 수 있습니다. 수집 서버는 `evts[].evtId`로 중복을 제거해야 합니다(at-least-once).

## 개인정보(PII) 주의

- URL·클릭 텍스트·`data-log-param-*` 값의 **토큰류**(`token`·`password`·`code` 등의 쿼리 값, `Bearer` 토큰, JWT, URL 내 인증 정보)는 마스킹합니다.
- ⛔ **이메일·전화번호는 마스킹되지 않습니다.** 마스킹은 best-effort입니다. 버튼 텍스트·`href`·`data-log-*` 값에 개인정보가 들어가지 않게 마크업을 관리합니다.
- ⛔ **커스텀 이벤트 `params`에 개인정보를 넣지 않습니다.** `send()`의 `params`와 `identify()`의 `props`는 가공 없이 그대로 전송됩니다.
- 수집되는 값: 페이지 URL·제목·`referrer`·UTM, User-Agent 원문, 화면·뷰포트 크기, 언어·시간대, 클릭 요소의 태그·id·텍스트(50자)·`href`·좌표, `identify`로 주입한 사용자 정보. 수집 서버 구축·저장·보관 정책은 사용하는 쪽의 책임입니다.

## 전송 스키마

수집 서버는 요청 본문으로 `LogBatch` 객체 하나를 받습니다(`POST {endpoint}{path}`, `Content-Type: text/plain`, 본문은 JSON). 타입 정의는 패키지가 내보내는 `LogBatch`·`Event`·`Page`·`Env`·`Consent`·`ImpressionOpt`(`dist/index.d.ts`)가 정본입니다.

## 기타 API

| 함수                  | 설명                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `send(name, params?)` | 커스텀 이벤트 전송                                                 |
| `flush()`             | 배치를 즉시 전송                                                   |
| `ids()`               | 현재 식별자 스냅샷(`bId`·`sId`·`tabSId`·`consent`)                 |
| `destroy()`           | 수집 중단과 리스너 해제. 이후 `init()`으로 다시 시작할 수 있습니다 |
