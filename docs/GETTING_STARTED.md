# 빠른 시작

b.stage 3rd-party 템플릿을 개발하고 배포하는 전체 흐름을 안내합니다. 프로젝트 생성부터 로컬 개발, API 호출, 배포까지 이 문서 하나로 시작할 수 있습니다.

## 사전 준비

- **Node.js** v20 이상
- **npm** 또는 **pnpm**
- **BstageClient 인증 정보** (선택) — API 호출에 필요한 `appId`, `appSecret`을 파트너 콘솔에서 발급받아 두면 프로젝트 생성 시 자동으로 설정됩니다.

---

## 개요

b.stage 3rd-party 템플릿은 **Web Component** 기반으로 동작합니다. SDK가 개발자의 컴포넌트를 Custom Element로 변환하여, b.stage 플랫폼 내에서 독립적으로 실행합니다.

**핵심 특징:**

- **Shadow DOM 격리**: 템플릿의 스타일이 플랫폼과 충돌하지 않습니다
- **IIFE 번들**: 별도의 모듈 로더 없이 `<script>` 태그로 로드됩니다
- **이벤트 기반 통신**: 플랫폼과 CustomEvent를 통해 통신합니다
- **프레임워크 자유**: React, Vanilla JS를 지원하며, Vue/Svelte도 지원 예정입니다

설계 원리와 내부 동작은 [SDK_ARCHITECTURE.md](./SDK_ARCHITECTURE.md)를 참고하세요.

---

## 1. 프로젝트 생성

```bash
npx @bstage-sdk/cli@latest init
```

인터랙티브 프롬프트가 시작됩니다.

| 질문          | 예시        | 설명                                                                                              |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| Space ID      | `bmf`       | 레포명 `{space}-custom-templates-{phase}`, BstageClient의 tenantId로 사용                         |
| Phase         | `dev`       | `dev` / `qa` / `real` / `sandbox` — 레포가 환경별로 분리됨. `.env`의 `VITE_BSTAGE_PHASE`로도 주입 |
| 템플릿 이름   | `bmf-hello` | `src/pages/{name}/template.tsx` 생성. Custom Element 태그로 쓰이므로 **하이픈 필수**              |
| 패키지 매니저 | `npm`       | npm 또는 pnpm                                                                                     |

API 키는 나중에 설정해도 됩니다. "API 키가 있으신가요?" 질문에 `No`를 선택하면 자리표시자(`YOUR_APP_ID` 등)로 `src/shared/client.ts`가 생성됩니다.

완료되면 SDK 최신 버전 조회 → 파일 생성 → git 초기화 → 의존성 설치가 자동으로 실행됩니다. `.npmrc`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, 에이전트용 `AGENTS.md` / `CLAUDE.md` 등 모든 보일러플레이트가 자동 생성됩니다. CI 워크플로우는 관리도구가 별도 구성합니다 — init은 `.github/workflows/` 파일을 만들지 않습니다. 상세 내용은 [INIT.md](./INIT.md)를 참고하세요.

> 프롬프트 없이 실행하려면 `--yes` 플래그를 사용하세요.
>
> ```bash
> npx @bstage-sdk/cli@latest init --yes --space bmf --phase dev
> ```

---

## 2. 로컬 개발 서버 실행

```bash
cd bmf-custom-templates-dev
npm run dev
```

브라우저에서 `http://localhost:5173`을 열면 템플릿 목록이 나타납니다. `bmf-hello`를 클릭하면 첫 번째 템플릿이 렌더링됩니다.

파일시스템 기반 라우팅으로 템플릿을 자동 감지합니다:

- `http://localhost:5173` → 템플릿 목록 (picker UI)
- `http://localhost:5173/bmf-hello` → `templates/bmf-hello/template.tsx`

새 템플릿 폴더를 추가하면 설정 변경 없이 자동으로 인식됩니다.

---

## 3. 프로젝트 구조

```
{space}-custom-templates-{phase}/
├── .env                                # VITE_BSTAGE_PHASE (환경 설정)
├── .npmrc                              # GitHub Packages 인증
├── .gitignore
├── AGENTS.md                           # Codex 등 에이전트 가이드
├── CLAUDE.md                           # Claude Code 가이드
├── README.md
├── eslint.config.js
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
└── src/
    ├── main.tsx                        # App 마운트만 (자동 생성, 수정 불필요)
    ├── App.tsx                         # 개발용 목록·라우팅 (자동 생성, 수정 불필요)
    ├── index.css
    ├── vite-env.d.ts
    ├── shared/
    │   └── client.ts                   # BstageClient 인스턴스
    ├── pages/                          # 페이지 — 폴더 구조가 곧 배포 경로
    │   ├── {space}-hello/
    │   │   └── template.tsx
    │   └── settings/custom/
    │       └── template.tsx
    └── slots/                          # 위젯 — 자리는 slot 옵션이 정함
        └── curation-banner/
            └── template.tsx
```

> `.github/workflows/`는 생성되지 않습니다. CI 워크플로우는 관리도구가 별도 구성합니다.

- 파일명은 반드시 `template.tsx`여야 합니다. 빌드 CLI와 로컬 라우팅이 이 패턴으로 템플릿을 자동 탐색합니다.
- **페이지**는 `src/pages/{경로}/template.tsx` — 폴더 구조가 곧 배포 경로가 됩니다.
- **위젯**은 `src/slots/{아무 이름}/template.tsx` — 어느 자리에 붙을지는 `createTemplate`의 `slot` 옵션이 정합니다.

---

## 4. 템플릿 작성

### createTemplate

각 템플릿은 React 컴포넌트를 작성한 후, `createTemplate()`을 호출하여 Web Component로 등록합니다.

```tsx
// src/pages/hello/template.tsx
import { createTemplate } from '@bstage-sdk/react'

export default function BmfHelloTemplate() {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Hello, b.stage!</h1>
    </div>
  )
}

createTemplate(BmfHelloTemplate, {
  name: 'bmf-hello',
})
```

파일을 저장하면 HMR로 브라우저에 즉시 반영됩니다.

**`createTemplate` 옵션:**

| 옵션     | 타입       | 필수 | 설명                                                                                                           |
| -------- | ---------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| `name`   | `string`   | O    | Custom Element 태그명. **소문자 시작 + 하이픈 1개 이상 + 소문자/숫자/하이픈**만 허용. 템플릿마다 달라야 합니다 |
| `slot`   | `SlotIdV2` |      | **위젯 전용.** 이 위젯이 들어갈 자리. `src/slots/` 아래는 필수, `src/pages/` 아래에는 쓸 수 없습니다           |
| `type`   | `string`   |      | 관리도구에서 사용하는 템플릿 타입 식별자                                                                       |
| `shadow` | `boolean`  |      | Shadow DOM 사용 여부 (기본값: `true`)                                                                          |

> 배치는 소스 위치가 정합니다 — 페이지는 `src/pages/` 폴더 구조, 위젯은 `slot` 옵션. 풀페이지 레이아웃(topBar/bottomBar)은 관리도구가 소유하므로 템플릿 코드에서 선언하지 않습니다. 자세한 내용은 [BUILD_SYSTEM.md](./BUILD_SYSTEM.md)·[SLOT_CATALOG_V2.md](./SLOT_CATALOG_V2.md)를 참고하세요.

> - 컴포넌트는 반드시 `export default`로 내보내야 합니다
> - `createTemplate()`은 반드시 모듈 최상위 레벨에서 호출해야 합니다. 함수 내부에서 호출하면 빌드 시 메타데이터를 추출할 수 없습니다.
> - `name`은 Custom Element 스펙상 하이픈 포함 필수 — 위반 시 런타임 에러. 관례적으로 `{space}-{suffix}` 형태를 권장합니다.

호출 시 `<name>` 그대로가 Custom Element 태그로 등록됩니다. 예를 들어 위 코드는 `<bmf-hello>` 요소를 등록합니다.

### 새 템플릿 추가

폴더를 만들고 `template.tsx`를 작성하면 자동으로 인식됩니다. **폴더 이름의 뜻이 페이지와 위젯에서 다릅니다.**

페이지는 폴더 구조가 곧 배포 경로입니다. `/profile`에 붙일 페이지라면:

```bash
mkdir -p src/pages/profile
```

```tsx
// src/pages/profile/template.tsx
import { createTemplate } from '@bstage-sdk/react'

export default function BmfProfileTemplate() {
  return <div>Profile</div>
}

createTemplate(BmfProfileTemplate, {
  name: 'bmf-profile',
})
```

위젯은 폴더 이름이 자유입니다. 어느 자리에 붙을지는 `slot` 옵션만 정합니다.

```bash
mkdir -p src/slots/curation-banner
```

```tsx
// src/slots/curation-banner/template.tsx
import { createTemplate } from '@bstage-sdk/react'

export default function CurationBanner() {
  return <div>Banner</div>
}

createTemplate(CurationBanner, {
  name: 'bmf-curation-banner',
  slot: 'user.contents-home.curation:after',
})
```

`slot`에 넣을 수 있는 값은 편집기 자동완성으로 볼 수 있고, 전체 목록은 [SLOT_CATALOG_V2.md](./SLOT_CATALOG_V2.md)에 있습니다. 오타가 있으면 `bstage build`가 후보와 함께 막아줍니다.

> 동적 경로(`src/pages/artist/[id]/`)는 아직 지원하지 않습니다.

---

## 5. 스타일링

템플릿은 Shadow DOM 내부에서 렌더링되므로 **바깥 CSS가 적용되지 않습니다.** CSS를 Shadow DOM 안으로 넣는 방법은 두 가지입니다. 둘 다 CSS를 **문자열로** 가져와야 하므로 `?inline` 쿼리를 씁니다.

**방법 1 — `createTemplate`의 `styles` 옵션** (템플릿 전체 스타일에 권장)

```tsx
import css from '../../styles/home.css?inline'

function HomeTemplate() {
  return <div className="container">...</div>
}

createTemplate(HomeTemplate, { name: 'my-space-home', styles: css })
```

**방법 2 — 컴포넌트 안 `<style>`** (조건부·컴포넌트 단위로 넣을 때)

```tsx
import cssText from '../../styles/home.css?inline'

function HomeTemplate() {
  return (
    <>
      <style>{cssText}</style>
      <div className="container">...</div>
    </>
  )
}
```

> ⚠️ **`import './home.css'`(문자열이 아닌 부수효과 import)는 배포 산출물에서 사라집니다.**
>
> 빌드가 CSS를 별도 `.css` 에셋으로 내는데 산출물에는 `template.js`만 실리기 때문입니다. **로컬 `npm run dev` 화면에서는 적용되므로** 눈치채기 어렵고, 배포한 뒤에야 "스타일이 통째로 빠졌다"로 드러납니다. CSS 파일로 관리하고 싶다면 반드시 `?inline`을 붙여 위 두 방법 중 하나로 넘기세요.
>
> 반대로 **`styles` 옵션은 로컬 개발 화면에서 안 보입니다** — 개발 화면은 템플릿을 Shadow DOM 없이 그냥 렌더하기 때문입니다. 최종 모습은 `npx bstage build` 산출물로 확인하세요.

**주의사항:**

- 글로벌 CSS (`body`, `*` 등)는 Shadow DOM 외부에 영향을 주지 않습니다
- 외부 CDN 폰트나 스타일시트는 Shadow DOM 내부에서 직접 로드해야 합니다

---

## 6. API 호출

### 6.1 BstageClient 설정

`src/shared/client.ts`에서 BstageClient 인스턴스를 설정합니다. `bstage init` 시 API 키를 입력했다면 자동으로 채워져 있습니다.

```ts
// src/shared/client.ts
import { BstageClient } from '@bstage-sdk/core'

export const client = new BstageClient({
  appId: 'bsa_xxxxx',
  appSecret: 'bsp_xxxxx',
  tenantId: 'myspace',
})
```

- 게이트웨이 base URL은 클라이언트가 임베드된 **페이지의 origin**(`location.origin + /gw`)으로 자동 결정됩니다. `{tenant}.sandstage.in`에 배포되면 그 환경의 게이트웨이로 가므로, 환경별로 다시 빌드·설정할 필요가 없습니다.
- 로컬 개발에서는 **dev 서버**가 `.env`의 `VITE_BSTAGE_PHASE`(→ `vite.config.ts`의 `bstageDevPlugin`)를 보고 해당 phase 게이트웨이로 프록시합니다. 이 phase는 **dev 서버 설정**이지 `BstageClient`의 옵션이 아닙니다.
- 특정 게이트웨이를 직접 지정하려면 `baseUrl` 옵션을 사용합니다(예: 플랫폼 임베드가 아닌 standalone 앱).

### 6.2 로그인

인증이 필요한 API를 호출하려면 먼저 로그인합니다.

1. `http://localhost:5173/__bstage__/login`에 접속
2. b.stage 계정으로 로그인

로그인 후 쿠키 기반 인증이 자동으로 처리됩니다.

### 6.3 요청 예시

**호출할 경로와 응답 모양은 게이트웨이 API Reference Doc을 보고 정합니다.** SDK는 경로 목록을 들고 있지 않으므로 자동완성이 뜨지 않고, 응답 타입도 제네릭으로 직접 지정합니다. 생략하면 `unknown`이라 필드를 읽을 때 타입 오류가 납니다.

```ts
import { client } from '../shared/client'

// 응답에서 쓸 필드만 선언해두면 충분합니다
interface BoardList {
  boards: Array<{ id: string; name: string }>
}

// GET 요청
const res = await client.get<BoardList>('/content/v1/boards')
res.data.boards.forEach((b) => console.log(b.name))

// Path parameter — 경로의 {boardId} 자리에 값이 들어갑니다
const posts = await client.get<PostList>('/content/v1/boards/{boardId}/posts', {
  path: { boardId: 'board-1' },
  params: { pageSize: 20 },
})

// POST 요청
const created = await client.post<Post>('/content/v1/boards/{boardId}/posts', {
  path: { boardId: 'board-1' },
  body: { title: 'Hello', content: '...' },
})
```

**사용 가능한 HTTP 메서드:**

```ts
client.get<T>(url, { path, params, headers, timeout })
client.post<T>(url, { path, body, headers, timeout })
client.put<T>(url, { path, body, headers, timeout })
client.patch<T>(url, { path, body, headers, timeout })
client.delete<T>(url, { path, headers, timeout })
```

모든 메서드는 `Promise<HttpResponse<T>>`를 반환합니다.

```ts
interface HttpResponse<T = unknown> {
  status: number
  headers: Headers
  data: T
}
```

### 6.4 컴포넌트 안에서 호출

컴포넌트에서는 `shared/client.ts`의 인스턴스를 import해서 그대로 사용합니다. `BstageClient`는 인증 fetch(`__bstage_fetch__`)와 게이트웨이 base URL을 스스로 해석하므로 `createTemplate`에 배선하거나 hook으로 꺼낼 필요가 없습니다.

```tsx
import { createTemplate } from '@bstage-sdk/react'
import { client } from '../../shared/client'

export default function HelloTemplate() {
  const handleClick = async () => {
    const menu = await client.get('/home/v1/menu')
    console.log(menu)
  }

  return <button onClick={handleClick}>API 호출</button>
}

createTemplate(HelloTemplate, {
  name: 'bmf-hello',
})
```

### 6.5 에러 처리

```ts
import { HttpError, HttpTimeoutError } from '@bstage-sdk/core'

try {
  const res = await client.get('/content/v1/boards')
} catch (e) {
  if (e instanceof HttpTimeoutError) {
    // 타임아웃 — e.timeout, e.url
  } else if (e instanceof HttpError) {
    // HTTP 에러 — e.status, e.data
  }
}
```

`HttpError.message`는 `HTTP 404`처럼 상태 코드만 담습니다. 원인을 분기할 정보는 `e.status`·`e.data`에 있습니다. **`e.data`를 화면에 그대로 띄우지 마세요** — 서버 응답 원문이라 내부 정보가 섞일 수 있습니다. 사용자에게 보여줄 문구는 `e.status`로 갈라 직접 정하세요.

### 6.6 파일 업로드 — presigned URL

이미지·동영상 업로드는 **4단계**입니다. 중간 단계를 건너뛰면 업로드는 성공한 것처럼 보이는데 나중에 404가 나므로, 순서를 지켜야 합니다.

| 단계         | 호출                                               | 받는 것                                           |
| ------------ | -------------------------------------------------- | ------------------------------------------------- |
| 1. 발급      | `GET /space/v1/presigned-url`                      | `uploadId` · 업로드용 S3 `url` · **`cdnUrl`**     |
| 2. 업로드    | 1번의 `url`로 **직접 `PUT`**                       | —                                                 |
| 3. 완료      | `POST /space/v1/presigned-url/{uploadId}/complete` | 업로드 상태를 완료로 전환                         |
| 4. 준비 확인 | `GET /space/v1/presigned-url/status`               | `exists`(서빙 준비 여부) · `cdnUrl` · 미준비 사유 |

```ts
interface IssuedUpload {
  uploadId: string
  url: string
  cdnUrl: string
}

// 1. 발급 — 파라미터는 평탄화해서 넘깁니다
const issued = await client.get<IssuedUpload>('/space/v1/presigned-url', {
  params: {
    imageType: 'VIDEO', // AVATAR · CONTENT_IMAGE · LOGO · VIDEO 등 리소스 종류
    contentType: file.type,
    contentLength: file.size,
    fileName: file.name,
  },
})
const { uploadId, url, cdnUrl } = issued.data

// 2. 업로드 — client가 아니라 fetch로 보냅니다 (아래 주의 참고)
await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })

// 3. 완료
await client.post('/space/v1/presigned-url/{uploadId}/complete', { path: { uploadId } })

// 4. 준비 확인 — exists가 true가 될 때까지 확인
const status = await client.get<{ exists: boolean; cdnUrl: string; exception?: string }>(
  '/space/v1/presigned-url/status',
  { params: { uploadId, url: cdnUrl } },
)
```

**주의 1 — 2번은 `client`로 보내지 마세요.** `BstageClient`는 게이트웨이용 앱 키 헤더와 인증 쿠키를 함께 붙입니다. presigned URL은 서명된 S3 주소라 그런 헤더가 붙으면 업로드가 거부됩니다. 이 한 단계만 평범한 `fetch`를 씁니다.

**주의 2 — CDN 경로를 손으로 만들지 마세요.** 최종 주소는 1번 응답의 `cdnUrl`입니다. 파일명이나 규칙을 보고 경로를 추측해 만들면 리소스 종류에 따라 어긋납니다.

**주의 3 — 업로드 직후에는 아직 못 씁니다.** 특히 동영상이나 리사이즈가 필요한 이미지는 CDN에서 준비되기까지 시간이 걸립니다. 3번까지 성공했는데 `cdnUrl`을 바로 화면에 넣으면 **404**가 납니다. 4번의 `exists`가 `true`가 된 뒤에 쓰세요. 아직이면 `exception`에 이유가 담깁니다(`NEED_IMAGE_RESIZE` 등).

### 6.7 환경(phase)별 도메인 — 링크 직접 만들기

API 호출은 base URL을 SDK가 알아서 해석하므로 환경을 신경 쓸 필요가 없습니다. 하지만 **화면에 다른 서비스로 가는 링크를 직접 만들 때**는 환경마다 도메인이 달라 구분이 필요합니다.

| phase   | 유저 서비스            | 어드민                   |
| ------- | ---------------------- | ------------------------ |
| real    | `{space}.bstage.in`    | `{space}.mybstage.in`    |
| sandbox | `{space}.sandstage.in` | `{space}.mysandstage.in` |

규칙은 하나입니다 — **어드민은 `my` 접두사**가 붙습니다.

> 사내 전용 phase(`dev`·`qa`)는 도메인이 다르고 이 문서에 적지 않습니다. 사내에서 개발한다면 사내 문서를 참고하세요. 아래 코드는 phase와 무관하게 동작합니다.

현재 환경은 두 곳에서 알 수 있습니다.

- **로컬 개발**: `.env`의 `VITE_BSTAGE_PHASE` → `import.meta.env.VITE_BSTAGE_PHASE`
- **배포 후**: 템플릿은 플랫폼 페이지 안에서 돌기 때문에 `location.hostname`이 곧 플랫폼 주소입니다

```ts
/** 유저 서비스 호스트에서 같은 환경의 어드민 호스트를 만든다 */
function toAdminHost(hostname = location.hostname): string {
  // my-space.bstage.in     → my-space.mybstage.in
  // my-space.sandstage.in  → my-space.mysandstage.in
  return hostname.replace(/([a-z]+stage\.in)$/, 'my$1')
}
```

phase 자체가 필요하면 호스트 조각으로 판정합니다 — 세 번째 조각이 `dev`·`qa`면 그 phase, `sandstage.in`으로 끝나면 sandbox, 그 밖은 real입니다.

> `BstageConfig.phase`는 예약 필드이고 **런타임에 쓰이지 않습니다.** 게이트웨이 주소는 이 값이 아니라 현재 origin으로 결정되므로, 링크를 만들 때 이 필드를 읽지 마세요.

---

## 7. 네비게이션 & 플랫폼 이벤트

### 7.1 usePlatformEvent

슬롯 템플릿에서 플랫폼이 보내는 이벤트를 구독할 때 사용합니다.

```tsx
import { usePlatformEvent } from '@bstage-sdk/react'

function MySlotWidget() {
  usePlatformEvent('slot.init', (payload) => {
    console.log('resourceId:', payload.resourceId)
  })

  return <div>슬롯 위젯</div>
}
```

마운트 시 자동 구독, 언마운트 시 자동 해제됩니다. BstageContext가 없는 환경(로컬 dev 등)에서는 아무 동작도 하지 않습니다. 수신 가능한 이벤트 목록과 슬롯별 상세 계약은 [SLOT_CATALOG.md](./SLOT_CATALOG.md)를 참고하세요.

### 7.2 useNavigation

`useNavigation` 훅을 사용하여 플랫폼에 네비게이션 이벤트를 전달할 수 있습니다. 플랫폼 임베드 환경에서는 PlatformBridge로 전달되고, 로컬 dev 환경에서는 브라우저 네이티브 API(`location.href`, `history.back`, `window.open`)로 fallback됩니다.

```tsx
import { useNavigation } from '@bstage-sdk/react'

function MyComponent() {
  const { navigate, goBack, openExternal } = useNavigation()

  return (
    <div>
      <button onClick={() => navigate('/profile', { userId: '123' })}>프로필로 이동</button>
      <button onClick={() => goBack()}>뒤로 가기</button>
      <button onClick={() => openExternal('https://example.com')}>외부 링크 열기</button>
    </div>
  )
}
```

| 메서드                    | 설명                               |
| ------------------------- | ---------------------------------- |
| `navigate(path, params?)` | 플랫폼 내 페이지 이동을 요청합니다 |
| `goBack()`                | 이전 페이지로 돌아갑니다           |
| `openExternal(url)`       | 외부 URL을 새 탭에서 엽니다        |

### 7.3 useBstageContext

PlatformBridge와 BstageClient에 직접 접근하려면 `useBstageContext`를 사용합니다.

```tsx
import { useBstageContext } from '@bstage-sdk/react'

function MyComponent() {
  const { bridge } = useBstageContext()

  return (
    <button onClick={() => bridge.emit('toast', { message: '완료!', variant: 'success' })}>
      토스트 표시
    </button>
  )
}
```

`useBstageContext`는 `createTemplate`으로 감싼 컴포넌트 내부에서만 호출할 수 있습니다.

---

## 8. 어드민 템플릿

b.stage 어드민(`{space}.mybstage.in`)에 올라가는 템플릿도 **같은 패키지·같은 명령·같은 스캐폴드**로 만듭니다. 별도 SDK가 없습니다.

프로젝트를 만들 때 `--target admin`을 주면 `package.json`에 아래가 기록되고, 그 뒤로는 CLI가 이 값을 보고 어드민 디자인 토큰·가이드를 안내합니다.

```json
{
  "bstage": { "target": "admin" }
}
```

```bash
npx @bstage-sdk/cli@latest init --target admin
```

### 한 레포는 유저 아니면 어드민 하나입니다

`target`이 **프로젝트 단위**인 이유는 페이지의 배포 경로가 `src/pages/` 폴더 구조이기 때문입니다. 유저 `/settings`와 어드민 `/settings`를 한 레포에 두려면 둘 다 `src/pages/settings/template.tsx`여야 하는데, 파일이 하나뿐이라 부딪힙니다. 그래서 유저 템플릿과 어드민 템플릿은 **레포를 나눠서** 개발합니다.

### `target`이 정하는 것

런타임 동작은 갈리지 않습니다 — 등록 경로도 어댑터도 하나입니다. `target`은 도구가 읽는 값입니다.

- 디자인 토큰: 어드민 프로젝트는 `@bstage-sdk/design/admin`(`--admin-*`), 유저는 `/user`(`--user-*`)를 씁니다. `bstage dev`가 해당 토큰의 fallback을 깝니다.
- 에이전트 가이드(AGENTS.md 관리 영역·`bstage-template` 스킬)가 어느 서브패스를 안내할지.

### 어드민 슬롯

어드민 위젯의 슬롯 id는 `admin.`으로 시작합니다(`admin.digital-ticket-detail.form:after`). 산출물 디렉토리도 그 id를 따라가므로 유저 위젯과 섞이지 않습니다. 목록은 [SLOT_CATALOG_V2.md](./SLOT_CATALOG_V2.md)를 참고하세요.

### 다국어

어드민 템플릿은 `<BstageLocaleProvider target="admin">` 하위에서 로케일 훅을 씁니다. 번역 코드젠도 `bstage i18n pull --target admin`입니다. 상세는 [I18N.md](./I18N.md).

### 아직 안 되는 것

**어드민 API 호출 경로는 없습니다.** `BstageClient`는 게이트웨이(유저단 API)만 지원하며, 어드민용 게이트웨이는 아직 열리지 않았습니다. 어드민 데이터가 필요한 템플릿은 그때까지 기다려야 합니다 — 경로를 임의로 만들어 호출하지 마세요.

---

## 9. 배포

배포는 관리도구가 이 레포의 GitHub Actions 워크플로우를 `workflow_dispatch`로 트리거하여 수행합니다. SDK는 워크플로우 파일을 생성·관리하지 않습니다 — 개발자는 코드 작성·push에만 집중하면 됩니다.

로컬에서 산출물을 확인하고 싶으면 `npx bstage build`를 실행합니다. 페이지는 `dist/{경로}/template.js`, 위젯은 `dist/{슬롯 id}/template.js`로 나옵니다.

### 9.1 인증 값은 빌드 시점에 번들로 들어갑니다

`.env`의 `VITE_BSTAGE_*` 값은 **빌드할 때 번들 안에 문자열로 박힙니다.** 배포한 뒤에 `.env`를 고쳐도 반영되지 않고, 값을 바꿨으면 반드시 다시 빌드해야 합니다.

`.env` 없이 빌드하면 번들에 `undefined`가 박혀 배포 후 모든 API 호출이 401로 실패합니다. `bstage build`는 BstageClient를 쓰면서 인증 값을 `.env`로 주입하는 템플릿에 한해 빌드 끝에 이걸 점검해 알려줍니다.

```
✗ 인증 값 점검 — 이대로 배포하면 API 호출이 실패합니다.
  ✗ VITE_BSTAGE_APP_ID  값이 없습니다 — 번들에 undefined가 박혀 배포 후 401이 납니다.
```

경고가 떠도 빌드는 성공합니다(산출물 자체는 정상). 배포 전에 로그 끝을 확인하세요.

### 9.2 배포 전 점검 — 증상으로 원인 되짚기

아래 항목은 **SDK가 감지할 수 없습니다.** 키 형식(`bsa_`/`bsp_`)은 ID·시크릿 구분일 뿐 어느 환경에서 발급했는지를 담지 않고, 나머지는 BE·콘솔 설정이라 코드에 흔적이 없습니다. 리얼 배포 후 아래 에러를 만나면 이 표로 되짚으세요.

| 증상                    | 원인                                     | 조치                                            | 소관         |
| ----------------------- | ---------------------------------------- | ----------------------------------------------- | ------------ |
| `401 Unauthorized`      | 다른 환경(QA 등)의 키로 배포 / 키 미발급 | 배포할 환경에서 발급한 appId·appSecret인지 확인 | 파트너 콘솔  |
| `403 Forbidden`         | Space ID가 프로젝트에 미등록             | BE에 Space ID 등록 요청                         | BE           |
| `400 MISSING_ORIGIN`    | 키의 Allowed Origins에 배포 도메인 없음  | 배포 도메인을 키 설정에 추가 요청               | BE (키 설정) |
| 템플릿이 화면에 안 뜸   | 콘솔 "커스텀 템플릿 사용" 토글이 꺼짐    | 콘솔에서 토글 확인                              | 콘솔         |
| 배포 자체가 안 됨       | 데브포털 접근·리얼 배포 권한 없음        | 권한 요청                                       | DevOps       |
| 임베드(iframe)가 차단됨 | CSP `frame-ancestors`에 도메인 없음      | 도메인 추가 요청                                | BE·보안      |

**QA에서 됐다고 리얼에서 되지 않습니다.** 위 항목은 전부 환경마다 따로 설정되고, 하나씩 막힐 때마다 요청·대기가 반복되면 며칠이 걸립니다. 처음 리얼로 나갈 때는 위 표의 BE·콘솔 항목을 **한 번에 모아서** 요청하세요.

### 9.3 보안성 검토 — 어떤 통제가 어디에 있나

보안성 검토에서 "API 남용을 막고 있나", "에러에 내부 정보가 노출되지 않나" 같은 질문을 받습니다. 통제 지점이 SDK 안이 아닌 것이 많아, 어디를 가리켜 답해야 하는지 정리했습니다.

| 요구                  | 통제 지점             | 답변 근거                                                                                                                                                                                   |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API 호출량 제한       | **게이트웨이**        | 서버에서 rate limiting을 적용합니다. 클라이언트 상한은 우회 가능해 통제로 보지 않습니다                                                                                                     |
| 에러의 내부 정보 노출 | **템플릿(직접 구현)** | SDK가 던지는 `HttpError.message`는 `HTTP {status}`뿐입니다. 상세는 `e.data`(서버 응답 원문)에 있으니 **화면에 그대로 띄우지 말고** `e.status`로 갈라 문구를 정하세요 ([6.5](#65-에러-처리)) |
| 인증 키 노출          | **템플릿(설정)**      | `.env`(gitignore) + `import.meta.env` 참조. 스캐폴드가 이 구조로 만들고, pre-commit 가드가 키 리터럴 커밋을 막습니다                                                                        |
| 키 유효 범위 제한     | **BE (키 설정)**      | Allowed Origins로 호출 출처를 제한합니다 ([9.2](#92-배포-전-점검--증상으로-원인-되짚기))                                                                                                    |
| 사용자 인증·세션      | **플랫폼**            | 플랫폼이 주입하는 인증 fetch를 `BstageClient`가 그대로 씁니다. 템플릿은 토큰을 다루지 않습니다                                                                                              |

즉 SDK가 대신 해주지 않는 것은 **에러 문구를 무엇으로 보여줄지** 하나입니다. 나머지는 게이트웨이·BE·플랫폼이 담당하거나 스캐폴드가 이미 갖추고 있습니다.

---

## 요구 사항 체크리스트

- [ ] `createTemplate()` 호출이 모듈 최상위 레벨에 있는지
- [ ] 컴포넌트가 `export default`로 내보내지는지
- [ ] 템플릿 파일이 `src/pages/{경로}/` 또는 `src/slots/{이름}/` 아래 `template.tsx`로 있는지
- [ ] CSS가 `?inline`으로 import되어 `<style>` 태그로 주입되는지
- [ ] `.env`의 `VITE_BSTAGE_PHASE`가 API 키 환경과 일치하는지
- [ ] 배포 전 `bstage build` 로그 끝의 인증 값 점검을 확인했는지 ([9.1](#91-인증-값은-빌드-시점에-번들로-들어갑니다))

---

## 다음 단계

- [SDK_ARCHITECTURE.md](./SDK_ARCHITECTURE.md) — SDK의 설계 원칙과 핵심 개념
- [API_REFERENCE.md](./API_REFERENCE.md) — 사용 가능한 API 전체 목록
- [DEV_SERVER.md](./DEV_SERVER.md) — 로컬 개발 서버의 인증 프록시 동작 방식
- [BUILD_SYSTEM.md](./BUILD_SYSTEM.md) — 빌드 파이프라인과 산출물 구조
- [INIT.md](./INIT.md) — `bstage init` 커맨드 상세
- [SLOT_SYSTEM.md](./SLOT_SYSTEM.md) — Extension Slot 시스템
- [SLOT_CATALOG.md](./SLOT_CATALOG.md) — 슬롯 목록, 이벤트 인터페이스, resourceId 의미
