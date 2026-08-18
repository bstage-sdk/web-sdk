# 슬롯 카탈로그

슬롯 목록, 네이밍 규칙, 이벤트 인터페이스, 슬롯별 `resourceId` 의미를 정리한 문서.
슬롯 시스템의 설계와 런타임 흐름은 [SLOT_SYSTEM.md](./SLOT_SYSTEM.md)를 참고한다.

---

## 슬롯 목록 (SSOT)

슬롯 목록은 SDK(`@bstage-sdk/core`)의 `SLOT_CATALOG` 배열이 단일 진실 원천이다.
`TemplateSlot` 유니온 타입은 목록에서 자동 파생된다.

```typescript
import { SLOT_CATALOG, type TemplateSlot, getSlotsByTarget } from '@bstage-sdk/core'

const userSlots = getSlotsByTarget('user') // 유저 플랫폼용 슬롯만 필터
const adminSlots = getSlotsByTarget('admin') // 어드민 플랫폼용 슬롯만 필터
```

### 유저 슬롯 (`target: 'user'`)

유저 유저 플랫폼 페이지 내 특정 위치에 Web Component 템플릿을 렌더한다.

| 슬롯 키                         | 페이지            | 섹션       | 위치     | 설명                                     |
| ------------------------------- | ----------------- | ---------- | -------- | ---------------------------------------- |
| `contents.home.contents.before` | `contents.home`   | `contents` | `before` | 콘텐츠 섹션 위 (Curation/Tags/Show 아래) |
| `contents.home.contents.after`  | `contents.home`   | `contents` | `after`  | 콘텐츠 섹션 아래 (Footer 위)             |
| `shop.order-item.ticket.after`  | `shop.order-item` | `ticket`   | `after`  | 주문 아이템 — 디지털 티켓 정보 아래      |

### 어드민 위젯 슬롯 (`target: 'admin'`)

어드민 어드민 플랫폼 페이지 내 특정 위치에 Web Component 템플릿을 렌더한다.

| 슬롯 키                                         | 페이지                    | 섹션              | 위치    | 설명                                        |
| ----------------------------------------------- | ------------------------- | ----------------- | ------- | ------------------------------------------- |
| `products.digital-ticket.form-additional.after` | `products.digital-ticket` | `form-additional` | `after` | 디지털 티켓 생성/수정 — 추가 설정 스텝 아래 |

### 어드민 메뉴 슬롯 (`target: 'admin'`)

어드민 GNB 내비게이션에 커스텀 메뉴 항목을 추가한다.
위젯 슬롯과 동일하게 Web Component 템플릿을 해당 위치에 렌더한다.

**서브메뉴 슬롯** — 기존 대메뉴 하위 서브메뉴 목록 하단에 항목 추가:

| 슬롯 키                           | 페이지      | 섹션         | 위치    | 설명                      |
| --------------------------------- | ----------- | ------------ | ------- | ------------------------- |
| `admin.nav.my-stage.menu.after`   | `admin.nav` | `my-stage`   | `after` | 내 홈페이지 서브메뉴 하단 |
| `admin.nav.contents.menu.after`   | `admin.nav` | `contents`   | `after` | 콘텐츠 서브메뉴 하단      |
| `admin.nav.products.menu.after`   | `admin.nav` | `products`   | `after` | 상품 서브메뉴 하단        |
| `admin.nav.orders.menu.after`     | `admin.nav` | `orders`     | `after` | 주문 서브메뉴 하단        |
| `admin.nav.settlement.menu.after` | `admin.nav` | `settlement` | `after` | 정산 서브메뉴 하단        |
| `admin.nav.operation.menu.after`  | `admin.nav` | `operation`  | `after` | 회원 서브메뉴 하단        |
| `admin.nav.settings.menu.after`   | `admin.nav` | `settings`   | `after` | 설정 서브메뉴 하단        |

**대메뉴 슬롯** — 대메뉴 목록 하단에 새로운 메뉴 그룹 추가:

| 슬롯 키                | 페이지      | 섹션   | 위치    | 설명                            |
| ---------------------- | ----------- | ------ | ------- | ------------------------------- |
| `admin.nav.menu.after` | `admin.nav` | `menu` | `after` | 대메뉴 목록 하단 (새 메뉴 그룹) |

### `target` 필드

- `'user'`: 유저 유저 플랫폼에 렌더되는 슬롯. `config-latest.json`이 소스.
- `'admin'`: 어드민 어드민 플랫폼에 렌더되는 슬롯. `admin-config-latest.json`이 소스.
- 관리도구는 `getSlotsByTarget()`으로 필터하여 각 플랫폼의 배치 UI를 구성한다.

---

## 네이밍 규칙

**위젯 슬롯**: `{area}.{page}.{section}.{position}`

- **`area`**: 최상위 메뉴 — `contents`, `shop`, `my`, `home`, `community` …
- **`page`**: 페이지 역할명 — `home`(메뉴 랜딩), `detail`(상세), `curation`(큐레이션 리스트) 등
  - 유저 플랫폼의 `components/pages/{area}/{page}/` 디렉토리 관례와 일치
  - 라우트와는 1:1이 아님. `/contents` → `contents.home`, `/contents/[id]` → `contents.detail`
- **`section`**: 페이지 내 섹션. 유저 플랫폼 컴포넌트명에서 소문자 축약으로 파생
  - `ContentsSection` → `contents`, `ShowSection` → `show`, `Tags` → `tags`, `Curation` → `curation`
  - area와 section이 같을 수 있음 (메뉴의 주 섹션이 메뉴 이름을 그대로 가지는 경우)
- **`position`**: `before`(영역 앞에 삽입) / `after`(영역 뒤에 삽입)

**메뉴 슬롯**: `admin.nav.{category}.menu.after` / `admin.nav.menu.after`

- **`admin.nav`**: 어드민 내비게이션 영역임을 표시 (`page` 필드에 대응)
- **`category`**: 어드민 플랫폼 `useMenuList` 훅의 카테고리 키 — `my-stage`, `contents`, `products`, `orders`, `settlement`, `operation`, `settings`
  - 생략 시(`admin.nav.menu.after`) 대메뉴 목록 자체에 새 그룹을 추가하는 슬롯
- **`menu`**: 내비게이션 메뉴 항목임을 표시 (`section` 필드에 대응)
- **`after`**: 기존 항목 뒤에 삽입 (`position` 필드에 대응)

---

## 이벤트 인터페이스

슬롯 템플릿은 `usePlatformEvent` hook으로 플랫폼이 보내는 이벤트를 구독한다. 모든 슬롯이 모든 이벤트를 받는 것은 아니며, 슬롯이 배치된 페이지의 맥락에 따라 수신 가능한 이벤트가 다르다.

### 공통 이벤트

| 이벤트      | 페이로드          | 설명                                                                                                |
| ----------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `slot.init` | `{ resourceId? }` | 슬롯 마운트 시 플랫폼이 전달. `resourceId`가 있으면 특정 리소스 컨텍스트, 없으면 목록/생성 컨텍스트 |

### 어드민 도메인 이벤트

어드민(어드민 플랫폼) 페이지에서 특정 도메인 동작이 완료된 뒤 발행된다. 해당 페이지에 배치된 슬롯만 수신한다.

| 이벤트                | 페이로드                  | 발행 시점                | 관련 슬롯                                       |
| --------------------- | ------------------------- | ------------------------ | ----------------------------------------------- |
| `ticket.create.after` | `{ ticketId, productId }` | 디지털 티켓 생성 완료 후 | `products.digital-ticket.form-additional.after` |

어드민 도메인 이벤트는 `adminEvents.ts`의 `ADMIN_EVENT_CATALOG`에서 관리된다. 네이밍 컨벤션은 `{domain}.{verb}.{when}` 형식이며, `PlatformEventMap`이 `AdminDomainEventMap`을 extends하므로 Bridge/Handle 타입에 자동 반영된다.

---

## 슬롯별 `resourceId` 의미

`slot.init`의 `resourceId`는 슬롯이 배치된 페이지의 리소스를 가리킨다. 슬롯별로 의미가 다르므로 아래 표를 참고한다.

| 슬롯 키                                         | `resourceId`       | 설명                                             |
| ----------------------------------------------- | ------------------ | ------------------------------------------------ |
| `contents.home.contents.before`                 | 없음               | 콘텐츠 홈은 목록 페이지이므로 특정 리소스가 없다 |
| `contents.home.contents.after`                  | 없음               | 위와 동일                                        |
| `products.digital-ticket.form-additional.after` | `productId` / 없음 | 수정 모드에서는 상품 ID, 생성 모드에서는 없음    |
| `shop.order-item.ticket.after`                  | `productId`        | 주문 아이템의 상품 ID. fork 시 항목별로 전달     |
| `admin.nav.*.menu.after`                        | 없음               | 내비게이션 메뉴는 리소스 컨텍스트가 없다         |

---

## 템플릿 코드 예시

```tsx
import { createTemplate, usePlatformEvent } from '@bstage-sdk/react'
import { BstageClient } from '@bstage-sdk/core'
import { useState } from 'react'

const client = new BstageClient({ appId: '...', appSecret: '...', tenantId: '...' })

function TicketCustomField() {
  const [resourceId, setResourceId] = useState<string>()

  usePlatformEvent('slot.init', (payload) => {
    setResourceId(payload.resourceId)
  })

  usePlatformEvent('ticket.create.after', ({ ticketId, productId }) => {
    // 티켓 생성 완료 후 커스텀 필드 저장
    client.post('/content/v1/...', { body: { ticketId, productId } })
  })

  return <div>{resourceId ? '수정 모드' : '생성 모드'}</div>
}

export default createTemplate(TicketCustomField, {
  name: 'my-space-ticket-custom-field',
})
```

---

## 관련 문서

- [SLOT_SYSTEM.md](./SLOT_SYSTEM.md) — 슬롯 시스템 설계, 런타임 흐름, 확장 가이드
- [API_REFERENCE.md](./API_REFERENCE.md) — `usePlatformEvent`, `PlatformBridge` API 시그니처
