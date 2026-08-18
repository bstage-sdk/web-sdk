# Slot Protocol v1 — bstage SDK 슬롯 약속

bstage SDK의 슬롯 시스템 v1. 외부 위젯이 호스트 플랫폼의 자리에 안전하게 마운트되고 호스트가 공급한 데이터로 자기 일을 하도록 약속하는 프로토콜.

옛 슬롯 시스템 설명은 [SLOT_SYSTEM.md](./SLOT_SYSTEM.md)·[SLOT_CATALOG.md](./SLOT_CATALOG.md)에 그대로 — 공존 기간 동안 옛 슬롯도 동일하게 작동.

## 0. 이 문서가 답하는 것

> **새 슬롯을 외부 개발자가 손쉽게 만들 수 있게, 우리는 한 번 정의하면 손이 안 가게 — 그러려면 무엇을 어디까지 약속해야 하는가.**

이 약속을 한 문장으로 압축한 책임 경계가 1절, 그 약속이 코드에 어떻게 나타나는지가 4~9절, 1차로 깔리는 자리가 10절.

---

## 1. 한 문장 (책임 경계)

> **SDK는 카탈로그가 선언한 자리·컨텍스트 약속이 코드에서 어긋나지 않도록 강제하고, 그 약속 위에서 외부 위젯이 안전하게 마운트되어 호스트가 공급한 데이터로 자기 일을 하도록 보장한다.**

자리·콘텐츠·매핑 자체는 책임지지 않는다. 그건 호스트 플랫폼·관리도구·외부 개발자의 몫. 사건(`events`)은 카탈로그에 없다. context는 **호스트 → 위젯 단방향 read-only** — 위젯은 호스트에 데이터·신호 안 보낸다 (결정-016).

---

## 2. 책임 분담

| 책임                                                                                     | 누가                                     |
| ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| 카탈로그 정의·유지 (`SLOT_CATALOG`)                                                      | **SDK**                                  |
| 카탈로그에서 TypeScript 타입 자동 추론 (TS 자연) · 외부 문서 페이지 빌드 (별도 스크립트) | **SDK**                                  |
| 자리 마운트·언마운트·`__bstage_fetch__` 주입                                             | **SDK** (`TemplateHandle` 인프라)        |
| 필수 context 빌드 강제                                                                   | **SDK** (타입 시스템)                    |
| 자리 컴포넌트를 페이지에 박기 + context 공급·조립                                        | **호스트** (유저 플랫폼 · 어드민 플랫폼) |
| 자리에 번들 URL 매핑 (한 자리에 N개 가능, 순서)                                          | **관리도구**                             |
| 위젯이 선언한 자리와 매핑한 자리가 맞는지 검증                                           | **관리도구**                             |
| 운영자가 라벨 보고 자리 고르기 (키 안 보임)                                              | **관리도구 picker UX**                   |
| 자리(`slot`) 약속에 맞춰 위젯 만들기                                                     | **외부 개발자**                          |
| 위젯 안에서 외부 API 호출·UI·트랜잭션 자기 처리                                          | **외부 개발자**                          |

---

## 3. 키 구조 — 3-part 평평

카탈로그의 자리는 한 식별자 `id`로 식별. 3 부분, 점(`.`)으로 구분.

```
{target}.{page-or-app}.{anchor}
```

| 부분          | 값                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `target`      | `user` · `admin`                                                                                       |
| `page-or-app` | 페이지 ID(예: `shop-home`·`digital-ticket-detail`) 또는 `app-{region}`(예: `app-topbar`·`app-sidebar`) |
| `anchor`      | `{영역}:{before                                                                                        | after}`패턴 (예:`hero:after`·`form:after`·`actions:before`) |

### 약속 두 줄

- 단어 잇기: 대시(`-`)
- 부분 구분: 점(`.`)
- 위치 modifier: 콜론(`:`) — `:before` · `:after`만 허용

### 앱 자리·페이지 자리 가르기

```ts
const [target, pageOrApp, anchor] = id.split('.')
const isAppSlot = pageOrApp.startsWith('app-')
```

### 앱 자리 region 어휘

| `app-{region}`  | 어디                                |
| --------------- | ----------------------------------- |
| `app-topbar`    | 화면 상단 (유저 TopBar, 어드민 Gnb) |
| `app-bottombar` | 유저 모바일 BottomBar               |
| `app-sidebar`   | 어드민 Sidebar                      |
| `app-footer`    | 유저 Footer (회사 정보·약관)        |

### anchor 영역 어휘 (자주)

`hero` · `banner` · `meta` · `content` · `details` · `actions` · `form` · `recommendations` · `related` · `comments` · `footer` · `right` · `left` · `center` · `tab`

페이지 특수 영역(`purchase`·`qr-area` 등)은 자유 허용, 표준 어휘 우선 권장.

### 옛 모양 → 새 모양 (예)

```
옛: page.section/admin.products.digital-ticket-detail/body.after
새: admin.digital-ticket-detail.form:after
```

7-10 토큰 → 3-5 토큰으로 축소.

### 카탈로그에 안 들어가는 것 (확장)

- **modal · toast · snackbar** — "공간"이 아니라 "이벤트"
- **후속 처리 통보** (옛 `ticket.create.after`) — SDK 책임 아예 아님 (결정-014). 위젯이 자기 안에서 외부 API 호출로 알아서 처리
- **메뉴 항목 등록** — 디자인 시스템과 어울려야 하므로 관리도구 별도 메커니즘 영역 (메뉴 데이터 등록 + 호스트가 자기 디자인으로 렌더)
- **DOM 선택자 기반 자리** — Shadow DOM 경계 충돌 (탈락)
- **template-side slot 선언** — "슬롯 배치 권한은 관리도구" 원칙과 충돌 (탈락)

---

## 4. 카탈로그 한 항목의 모양

```ts
{
  id: 'admin.digital-ticket-detail.form:after',
  description: '디지털 티켓 상세 본문 아래',
  context: {
    // 모두 호스트 → 위젯 단방향 read-only (결정-016)
    ticket: { type: 'DigitalTicket', required: true },
  },
}
```

이 모양이 SSOT가 되어 다음이 자동 처리된다:

- **TypeScript 타입** — `SLOT_CATALOG`를 `as const` + 조건부 타입으로 적으면 TS 컴파일러가 자동 추론
- **호스트·위젯 빌드 검증** — 위 타입을 import하면 `tsc`가 자연히 검증 (필수 context 누락 시 에러)
- **관리도구 자리 UI** — 관리도구가 `@bstage/sdk`를 import해 자기 컴포넌트로 카탈로그 메타 처리
- **외부 문서 페이지** — 카탈로그 객체 → HTML/Markdown 표. 별도 빌드 스크립트 (1차 PoC에는 손으로 적어도 됨)

### `description`은 일상어

`description`은 관리도구 picker가 운영자에게 보여주는 라벨. 키(`id`)는 안 보임.

### context는 단방향 read-only

모든 context 필드는 **호스트 → 위젯** 한 방향. 위젯은 받기만 하고 자기 컴포넌트 안에서 사용. 위젯이 호스트에 데이터를 돌려보내는 통로 없음 — 결정-016으로 `writable` 권한·`context.update()`·controlled form 패턴 모두 폐기.

---

## 5. 공통 context — 호스트가 직접 조립 (결정-022)

자주 쓰는 정보의 **컨벤션 셋**. SDK가 자동 주입하지 않고, 호스트가 자기 React Context·hook 인프라로 매 자리에 같이 넘긴다.

**모든 자리 공통(권장)**:

- `spaceId` · `screenId` · `isLoggedIn` · `memberTier`

**target=user 추가**:

- `userId` (로그인 시에만)

**target=admin 추가**:

- `operatorId` · `operatorAuth` · `plan`

호스트가 자기 인프라(이미 갖고 있는 `useSpaceContext`·`useAuth` 등)로 위 값들을 모아 `context` 객체에 합쳐 넘긴다. SDK는 호스트가 준 객체를 위젯에 그대로 dispatch — 가공 없음 (결정-022 "pass-through").

카탈로그의 `context` 필드는 페이지/자리 특수 정보 + 위 공통 필드 중 필요한 것을 명시. 호스트가 누락 시 TS 컴파일 에러.

---

## 6. 호스트 측 사용법

### 6.1 자리 마운트 — 호스트가 자기 컴포넌트로

SDK는 마운트 인프라(`TemplateHandle`·`loadTemplatesBySlots`)와 타입(`SlotIdV2`·`SlotContextOf`)을 제공한다. 자리를 박는 React 컴포넌트는 **호스트가 자기 사정에 맞게 구현** (SDK가 강제하는 컴포넌트 모양 없음 — 결정-022).

권장 모양:

```tsx
<SlotWidget
  slotId="admin.digital-ticket-detail.form:after"
  handle={handle}
  context={{ ticket, spaceId, userId /* ... */ }}
/>
```

호스트 측 `SlotWidget` 내부:

- `slotId`로 `SlotContextOf<Id>` 추론해 `context` 타입 검사
- 마운트 후 한 번 `handle.dispatch('slot.context', context)` 호출 (TemplateHandle 버퍼링이 위젯 ready까지 대기)
- 자리에 매핑된 위젯이 0개면 컴포넌트가 null 반환 — DOM 안 만듦
- DOM에 `data-bstage-slot={slotId}` 속성 렌더(권장 — 시각 편집기·data-\* 호환)

유저·어드민 플랫폼이 이 모양으로 운영(자체 `SlotWidget` 컴포넌트).

### 6.2 한 페이지 여러 자리 — 공통 context 조립

같은 페이지의 여러 자리가 공통 context를 공유한다면, 호스트가 객체 한 번 조립해 매 `SlotWidget`에 동일하게 전달:

```tsx
const common = {
  spaceId: space.id,
  isLoggedIn,
  memberTier: user?.tier,
  userId: user?.id,
  // ...
};

<SlotWidget slotId="user.contents-home.curation:after" handle={h1} context={common} />
<SlotWidget slotId="user.contents-home.contents-section:before" handle={h2} context={common} />
<SlotWidget slotId="user.contents-home.contents-section:after" handle={h3} context={common} />
```

자리마다 추가 context가 필요하면 spread로 합침: `context={{ ...common, ticket }}`.

**공통 context 자동 주입은 SDK가 하지 않음** — 호스트가 자기 React Context·hook 인프라로 직접 조립한다(결정-022). SDK는 호스트가 준 객체를 위젯에 그대로 dispatch.

---

## 7. 외부 개발자 측 사용법

### 7.1 `createTemplate` + `useSlotContext` — 위젯 정의

위젯은 `useSlotContext` hook으로 호스트가 마운트 시 dispatch한 context를 받는다. 한 번 받으면 위젯 lifecycle 내내 같은 값 — 호스트가 데이터 변경해도 위젯에 안 보내짐(결정-016·022 위젯 완전 독립).

```tsx
import { createTemplate, useSlotContext } from '@bstage-sdk/react'

const MyQrWidget = () => {
  const context = useSlotContext<'admin.digital-ticket-detail.form:after'>()

  if (!context) return null // ready 전(또는 호스트가 안 보낸 경우)

  return <QrPanel ticket={context.ticket} />
}

export default createTemplate(MyQrWidget, {
  name: 'my-qr-generator',
  slot: 'admin.digital-ticket-detail.form:after',
})

// QrPanel 컴포넌트(외부 개발자 자유 영역):
//   - "QR 생성" 버튼 → 모달 / 별도 폼 / 뭐든
//   - 자기 API로 QR 저장
//   - 에러 처리·재시도·UI 다 자기 안에서
//   - 호스트와 무관. context.ticket만 알면 됨
```

`useSlotContext<Id>()`의 반환 타입은 `SlotContextOf<Id>` — 카탈로그가 약속한 필드 모양으로 TS 추론.

### 7.2 자리 선언은 산출물 경로로 나간다

> 이 절은 원래 "빌드가 `contract`를 `manifest.json`에 자동 주입한다"(결정-015)로 적혀 있었다.
> 그 방식은 **구현되지 않았고**, 같은 의도를 다른 방법으로 이뤘다 — `manifest.json`은 없어졌고
> 자리는 **산출물 디렉토리 이름**이 나른다.

외부 개발자는 `createTemplate`의 `slot` 한 곳에만 적는다.

```
src/slots/qr-generator/template.tsx      slot: 'admin.digital-ticket-detail.form:after'
  → dist/admin.digital-ticket-detail.form--after/template.js
```

- 디렉토리 이름은 3-part 키에서 콜론만 `--`로 바꾼 것이다 — 콜론은 Windows에서 폴더 이름에 쓸 수 없다. 변환·역변환은 core의 `slotIdToDirName`·`dirNameToSlotId`가 소유한다
- `bstage build`가 카탈로그(`SLOT_CATALOG_V2`)와 대조해 오타를 막는다. `src/slots/` 아래인데 `slot`이 없거나, `src/pages/` 아래인데 `slot`이 있으면 빌드가 끊는다
- 관리도구은 디렉토리 이름을 자리 id로 되돌려 매핑 시 검증한다
- 자세한 내용은 [BUILD_SYSTEM.md](./BUILD_SYSTEM.md)

### 7.3 알아야 할 약속

- **context는 단방향 read-only**. 호스트가 한 번 공급. 위젯은 받아서 사용 (결정-016)
- **호스트와 통신 없음**. 위젯이 호스트에 데이터·신호 안 보냄. 자기 안에서 자기 일 (외부 API·모달·검증)
- **한 위젯은 한 자리**: 자리를 `createTemplate`의 `slot`으로 선언하므로 같은 위젯을 여러 자리에 재사용할 수 없다. 두 자리에 넣으려면 위젯을 둘로 만든다 (뒤집힌 결정 — 배포 편의와 맞바꿨다)

---

## 8. 관리도구 매핑 흐름

운영자가 자리에 위젯을 매핑하는 흐름. 운영자는 키(`id`)를 안 봐도 됨 — picker가 `description` 라벨로 보여줌.

1. 새 커스텀 페이지 생성, 타입: `SDK_SLOT`
2. **자리 선택** — 페이지 먼저 고르고, 그 페이지의 자리(라벨로 보임) 선택. 검색·그룹·필터 가능
3. **번들 URL 등록** (`.../{자리 id}/template.js`)
4. 관리도구가 산출물 디렉토리 이름을 자리 id로 되돌려 선택한 자리와 일치하는지 검증 — 안 맞으면 등록 막힘
5. 한 자리에 위젯 N개 매핑 가능 — 등록 순서대로 화면에 그려짐. 순서 조정 UI는 관리도구 자유

### picker UX 설계 원칙

운영자는 **키를 절대 안 본다**. 카탈로그의 `description` 라벨이 SSOT. 검색·페이지 그룹·target 필터로 자리 좁히기 빠르게.

2차 단계로 **시각 편집기**(iframe + 슬롯 outline + 클릭 매핑)가 자연 — 호스트 측 자리 컴포넌트가 이미 `data-bstage-slot` 속성을 렌더하고(권장), 편집 모드일 때 자기 위치를 부모 창에 `postMessage`로 알리도록 만들면 됨.

---

## 9. SDK 자동 동작

호스트·외부 개발자가 신경 안 써도 되는 일들:

### 9.1 빌드 단계 (TypeScript 컴파일러가 자연히 처리 — 결정-013)

- 카탈로그에 없는 자리 `id` → 에러
- `required: true` context 필드 누락 → 에러
- `slot`이 카탈로그에 없는 자리 → **`bstage build`가 막음** (타입 검사와 별개로 — 빌드는 `tsc`를 타지 않는다)
- 호스트 측 자리 컴포넌트의 `context` props 타입이 `SlotContextOf<Id>`와 불일치 → 에러

이 검증들은 `SLOT_CATALOG`를 `as const`로 적고 조건부 타입을 잘 쓰면 별도 codegen 없이 자연 작동.

### 9.2 실행 단계

- 자리 마운트·언마운트 라이프사이클 (`TemplateHandle`)
- `__bstage_fetch__`가 마운트 전에 주입되어 있음을 보장
- 자리 마운트는 한 번만 (`connectedCallback`)
- 언마운트 시 adapter/bridge cleanup
- context는 호스트가 마운트 시 한 번 dispatch — `TemplateHandle` 버퍼링이 위젯 ready까지 대기 (결정-022)
- 위젯 throw는 위젯이 자기 안에서 자기 처리 (결정-016 — SDK 차원 `SlotError` 전달 폐기)
- 자리에 매핑된 위젯이 0개면 호스트 측 자리 컴포넌트가 DOM 노드 안 만듦
- DOM에 `data-bstage-slot={id}` 속성 자동 렌더 (편집기·data-\* 호환) — 호스트 측 권장
- Shadow DOM 격리 (현행 그대로)
- PlatformBridge 이벤트 비대칭 (현행 그대로 — Template→Platform `composed:true`, 반대 `composed:false`)
- `ready` 이벤트 전 dispatch는 버퍼링되고 ready 시 자동 replay (현행 그대로)

### 9.3 SDK가 확인할 길 없는 것 (사람의 책임)

- 호스트가 공급한 context 값의 정확성 (타입만 강제)
- 위젯이 그리는 콘텐츠의 적절성
- 자리에 매핑된 위젯이 페이지 의도에 맞는지

---

## 10. 페이지·자리 매핑 (1차 우선순위)

### 1차 — 가장 가치 큼

| 자리                      | `id`                                                                                                                             | 비고                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 어드민 디지털 티켓 상세   | `admin.digital-ticket-detail.form:after`                                                                                         | PoC 한계가 알려진 영역. 결정-016으로 자리가 폼 안 → 상세 페이지로 옮겨감. 위젯이 완전 독립                                                 |
| 유저 콘텐츠 홈 (자리 3개) | `user.contents-home.curation:after` · `user.contents-home.contents-section:before` · `user.contents-home.contents-section:after` | 여러 자리 공존 패턴. 외부 노출 큼. anchor 이름은 실제 컴포넌트(`<Curation>`)와 일치. 푸터 직전 자리는 전역 `user.app-footer.*`와 겹쳐 제거 |
| 어드민 사이드바           | `admin.app-sidebar.contents:after` 등 카테고리별                                                                                 | 이미 `admin.nav.*` 사용 중. 새 키로 옮김. 메뉴 항목 자체는 별도 메커니즘                                                                   |

### 2차 — 다음 단계

- 유저 상품 상세 (`user.shop-product-detail.*`)
- 어드민 디지털 주문 목록·상세
- 유저 콘텐츠 상세
- 어드민 멤버십 폼

### 3차 — 필요해질 때

- 운영 관리·설정 페이지
- 마이페이지·계정 페이지
- 정적·인증 페이지는 1차 미적용

전체 매핑은 `design/site-slot-map.md` 참조.

---

## 11. 버전 정책

bstage-sdk 패키지의 semver.

| 변경                                                | 버전                                                    |
| --------------------------------------------------- | ------------------------------------------------------- |
| 카탈로그 자리 추가                                  | minor                                                   |
| 카탈로그 context 필드 추가 (옵셔널)                 | minor                                                   |
| 카탈로그 context 필드 추가 (필수)                   | **major**                                               |
| 카탈로그 항목 제거                                  | **major** (deprecated 표시 후 다음 major에서 제거 권장) |
| `SlotContextMap` 타입 매핑 변경                     | semver 따름 (대개 minor)                                |
| 키 형식 변경 (3-part 자체)                          | **major**                                               |
| `TemplateHandle`·`useSlotContext` 같은 SDK API 변경 | semver 따름                                             |

---

## 12. 옛 모델과 공존

옛 슬롯(`SLOT_CATALOG` 12개 + `<SlotWidget>` 마운트)과 새 모양은 다음 약속에 따라 공존한다 (재설계 끝날 때까지 기존 슬롯 추가 요청도 계속 받음 — 운영 정책).

- 옛 `SLOT_CATALOG` 항목은 옛 모양 그대로 유지
- 새 슬롯부터 새 카탈로그 모양 사용 (3-part `id` 키)
- 호스트 측 `SlotWidget`이 v1·v2 둘 다 처리 — `slotId` prop이 있으면 v2 모드(`SLOT_CATALOG_V2` lookup + `context` dispatch), 없으면 v1 모드
- 옛 슬롯을 새 모양으로 옮기는 작업은 운영 정책대로 조금씩 (한 슬롯씩 또는 한 페이지씩)

> **미해결**: 공존의 구체 모양(같은 카탈로그 안 공존인지 별도인지, 옮기는 단위 등). 부록 참조.

---

## 13. 카탈로그 밖 영역

다음은 카탈로그 안에 두지 않는다. 같은 통에 두면 개념이 섞임.

### 13.1 modal · toast · snackbar

"공간"이 아니라 "이벤트". 라이프사이클·트리거·z-index 규칙이 다름. 필요해지면 별도 메커니즘(`overlay-channel` 가칭).

### 13.2 후속 처리 통보 (옛 `ticket.create.after` 모양)

저장 끝난 뒤 외부 시스템에 알리는 일. **SDK 책임 아예 아님** (결정-014).

- 외부 위젯과 엮여야 한다면 자리에 위젯을 두고 위젯이 **자기 안에서 외부 API 호출로 알아서 처리** (결정-016 — 위젯 완전 독립. controlled form·writable 폐기)
- 그 외 (운영자 추가 입력 없이 자동 후속만 필요)는 호스트의 일반 비즈니스 코드 (fetch·내부 이벤트 등)로 알아서 처리
- SDK는 별도 메커니즘(이벤트 후크·webhook 등) 제공 안 함. F의 정신 "공간을 제공한다"와 일관

### 13.3 메뉴 항목 등록

메뉴는 디자인 시스템과 어울려야 하므로 관리도구가 구조화 데이터(label·icon·link)를 등록하고 호스트가 자기 디자인으로 렌더하는 별도 메커니즘 영역. 슬롯 카탈로그에는 메뉴 항목을 두지 않음.

`app-sidebar` 같은 앱 자리는 메뉴 영역이 아니라 "사이드바 안의 자유 UI 위젯 자리"(예: 사이드바 하단 광고·통계 카드).

> **미해결**: 메뉴 등록 메커니즘 구체 모양 (별도 결정 거리).

### 13.4 위젯 → 호스트 명령형 행동

화면 전환·toast 띄우기 등. 드물고, 필요해지면 별도 메커니즘.

### 13.5 탈락한 후보 모양

- DOM 선택자 기반 자리 (후보 E — Shadow DOM 경계 충돌)
- template-side slot 선언 (후보 C — 슬롯 배치 권한 원칙과 충돌)

---

## 부록 — 미해결·다음 결정 거리

본 문서가 약속하지만 **구체 메커니즘이 미정**인 항목들. 1차 슬롯 구현 또는 별도 결정에서 풀어야 함.

### A. ~~공통 context 자동 주입 메커니즘~~ (결정-022로 해결)

- **SDK는 자동 주입 안 함**. 호스트가 자기 React Context·hook 인프라로 직접 조립 (5절·6.2절)
- SDK 책임 경계 단순화 — pass-through

### B. 옛·새 공존 구체 메커니즘

- 옛 `SLOT_CATALOG`(4-part)와 새 `SLOT_CATALOG_V2`(3-part) 별도 export. v1·v2 키 한 객체에 섞어 `loadTemplatesBySlots` 호출 가능
- 호스트 측 `SlotWidget`이 v1·v2 둘 다 처리 (`slotId` prop 유무로 분기)
- 옮기는 단위는 호스트 운영 판단 (슬롯 개별 또는 페이지 개별)

### C. 메뉴 등록 별도 메커니즘

- 어디서 정의(코드·관리도구)·어떻게 저장·호스트가 어떻게 fetch·어떻게 렌더
- 옛 `admin.nav.*` 슬롯들이 이 메커니즘으로 어떻게 옮겨가는지

### D. 관리도구 picker UX

- 검색·그룹·필터 화면 구체 모양
- `description` i18n 지원
- 페이지 ID·anchor 어휘 운영자에게 어떻게 보여줄지

### E. 시각 편집기 (2차)

- iframe + outline + 클릭 매핑
- 호스트 측 자리 컴포넌트의 `postMessage` 자기 광고 protocol

### F. 외부 문서 자동 생성기 (결정-013으로 좁힘)

- 'codegen 파이프라인'이라 거창하게 부른 작업은 없음. 정정: 타입·빌드 검증·관리도구 UI는 TypeScript 자연 추론·import로 자동
- 진짜 별도 빌드 스크립트가 필요한 건 카탈로그 → 외부 문서 페이지(HTML/Markdown) 자동 생성 하나
- 1차 PoC는 카탈로그 1개라 손으로 문서 적어도 됨. 카탈로그 5~10개 쌓이면 짧게 만듦

---

## 부록 — 연결된 결정 (18개)

본 문서의 각 절을 만든 결정들.

| 결정         | 무엇을 정했나                                                         | 본 문서의 어디에 반영                                                                                     |
| ------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 결정-000     | 별도 작업공간 (운영)                                                  | (운영 결정 — 본 문서 외)                                                                                  |
| 결정-001     | 후보 C·E 탈락                                                         | 13.5절                                                                                                    |
| 결정-002     | 본선 F·D·B                                                            | (대체됨)                                                                                                  |
| 결정-003     | 본선 F·D, B 백업                                                      | (대체됨)                                                                                                  |
| 결정-004     | anchor 명시 등록                                                      | 3절                                                                                                       |
| 결정-005     | 자리 0개·여러 자리·동적 미지원·anchor 명명                            | 6·9절                                                                                                     |
| 결정-006     | 식별자·anchor·공통 context 명명 표준                                  | (부분 대체 — 5절은 유지, 식별자·anchor 정정)                                                              |
| 결정-007     | F 단독 채택                                                           | 본 문서 전체                                                                                              |
| 결정-008     | 식별자 표기 (계층=점·단어=대시)                                       | (부분 대체 — 정신 유지, "계층"이 "3-part"로 좁아짐)                                                       |
| 결정-009     | `context.changed`는 SDK 내장 reactivity                               | 9절                                                                                                       |
| 결정-010     | 후속 통보는 카탈로그 밖                                               | 13.2절 (결정-014·016으로 강화됨)                                                                          |
| 결정-011     | 폼 페이지 anchor 부여 규칙                                            | (부분 대체 — anchor 단일 토큰화로 자연 흡수)                                                              |
| 결정-012     | events 절 제거, 통신은 context로 (writable 부분은 결정-016으로 폐기)  | 1·4·6·7·9절                                                                                               |
| 결정-013     | 자동 생성 범위 정정 (TS 자연 추론 + 외부 문서 빌드 하나)              | 4·9.1·부록 F                                                                                              |
| 결정-014     | 후속 통보는 SDK 책임 아예 아님                                        | 13.2절 · 부록                                                                                             |
| 결정-015     | contract는 `createTemplate` 한 곳에만, manifest는 빌드 자동 주입      | 7.2절 (**부분 대체** — "한 곳에만"은 `slot` 옵션으로 유지, manifest 주입은 폐기하고 산출물 경로가 대신함) |
| 결정-016     | 위젯 완전 독립. writable·controlled form 폐기. PoC 자리 form → detail | 1·2·4·6·7·9·10·부록                                                                                       |
| **결정-017** | **키 구조 전면 정정 — 3-part 평평, 점 부분 구분·대시 단어 잇기**      | **3·4·5·6·7·10·12절 — 가장 큰 변화**                                                                      |
