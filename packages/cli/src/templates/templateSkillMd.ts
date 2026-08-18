import { designGuideSection, type DesignTarget } from './designGuide.js'

/**
 * `bstage init`이 새 프로젝트에 스캐폴딩하는 템플릿 작성 스킬.
 * `.claude/skills/bstage-template/SKILL.md`로 기록된다.
 *
 * 얇은 절차 가이드 + 함정 모음 + docs 포인터로 구성한다.
 * 장문 레퍼런스(시그니처 등)는 복붙하지 않고 `node_modules`의 docs/.d.ts를 SSOT로 둔다(drift 방지).
 *
 * @param target 디자인 토큰 타깃(user/admin) — 디자인 섹션의 import 경로·접두사를 분기한다.
 */
export function templateSkillMd(target: DesignTarget = 'user'): string {
  return `---
name: bstage-template
description: b.stage 서드파티 템플릿을 작성·수정한다. 새 템플릿을 만들거나, createTemplate·슬롯·플랫폼 이벤트·다국어·API 호출을 다루거나, "템플릿 추가/개발", "bstage 위젯 만들어줘" 같은 요청을 받을 때 사용한다.
---

# 역할

이 프로젝트에서 b.stage 템플릿을 작성한다. 작성한 React 컴포넌트는 SDK가 Web Component로 빌드해 플랫폼에 마운트한다. 이 스킬은 **목표지향 절차 + 함정**만 담는다. 정확한 시그니처는 항상 설치된 docs/타입을 SSOT로 본다.

# 권위 있는 출처 (먼저 읽기)

추측하지 말고 설치된 패키지를 본다. 외부 검색보다 신뢰할 수 있다.

- \`node_modules/@bstage-sdk/core/docs/\` — GETTING_STARTED, API_REFERENCE, SLOT_*, I18N, BUILD_SYSTEM, DEV_SERVER, DESIGN_TOKENS, SDK_ARCHITECTURE
- 타입: \`node_modules/@bstage-sdk/react/dist/*.d.ts\`, \`node_modules/@bstage-sdk/core/dist/*.d.ts\`
- 프로젝트 규칙: 레포 루트의 \`AGENTS.md\`
- 문서 목록: \`npx bstage docs\`

# 절차

## 1. 새 템플릿 추가

페이지는 \`src/pages/{경로}/template.tsx\`(폴더 구조가 곧 배포 경로), 위젯은 \`src/slots/{아무 이름}/template.tsx\` + \`slot\` 옵션으로 만든다. 파일명은 반드시 \`template.tsx\`(라우팅·빌드가 이 컨벤션으로 발견). \`name\`은 Custom Element 태그로 그대로 쓰이므로 **소문자 시작 + 하이픈 1개 이상 + 소문자·숫자·하이픈만**.

\`\`\`tsx
import { createTemplate } from '@bstage-sdk/react'

export default function MyWidget() {
  return <div>...</div>
}

createTemplate(MyWidget, { name: 'my-widget' }) // 폴더명과 동일, 하이픈 필수
\`\`\`

## 2. 기능별 훅 (시그니처는 API_REFERENCE.md / .d.ts 확인)

- **플랫폼 네비게이션**: \`useNavigation()\` — \`navigate\`/\`goBack\`/\`openExternal\`
- **플랫폼 이벤트**: \`useBstageContext()\`의 \`bridge\`로 \`emit\`(템플릿→플랫폼), 구독은 \`usePlatformEvent()\`(플랫폼→템플릿)
- **API 호출**: \`shared/client.ts\`의 \`client\` 인스턴스를 import해 직접 호출(\`client.get<T>(...)\`). \`BstageClient\`는 인증 fetch·게이트웨이 base URL을 스스로 해석하므로 별도 배선이 필요 없다. **경로·응답 모양은 SDK가 들고 있지 않다** — 게이트웨이 API Reference Doc이 출처이고, 응답 타입은 제네릭으로 명시한다(생략하면 \`unknown\`). **유저단 API만 지원.** **어드민용 API는 미지원 — 필요하면 경로를 추측하지 말고 반드시 사용자에게 먼저 확인할 것.**
- **슬롯 context**: \`useSlotContext<Id>()\` — 호스트가 마운트 시 1회 전달하는 read-only 값
- **다국어**: 로케일 훅(\`useLocale\`/\`useMessages\`/\`useBstageTranslations\`)은 **반드시 \`<BstageLocaleProvider>\` 하위에서** 호출한다(밖이면 throw). 유저 템플릿은 \`<BstageLocaleProvider>\`(target 생략), 어드민은 \`<BstageLocaleProvider target="admin">\`. 자체 문구는 \`useMessages\`(준비 불필요). 플랫폼 공용 문구를 쓰려면 **먼저 \`bstage i18n pull\`을 실행**해 번역 키·타입·로컬 캐시(\`.bstage/i18n\`)를 만든 뒤 \`useBstageTranslations\`를 쓴다 — 안 하면 로컬 dev에서 번역이 안 뜨고 키도 알 수 없다. **유저 슬롯 템플릿은 \`--target user\`(기본, Bxxxxx), 어드민 슬롯 템플릿은 \`--target admin\`(Axxxxx)** — Provider \`target\`과 같은 축. 현재 언어만 필요하면 \`useLocale\`. 상세 워크플로는 I18N.md
- **다국어 문구 배분 (작업 전 결정)**: "다국어 처리해줘" 류 요청을 받으면 전부 \`useMessages\`로 만들지 말고, **플랫폼 키 대조부터** 한다 — \`bstage i18n pull\` 실행 → 생성된 \`src/bstage-i18n.ts\`에서 대상 문구의 원문 검색 → 매칭되는 키가 있으면 공용 키(\`useBstageTranslations\`), 없는 문구만 \`useMessages\`에 추가. 저장·취소·적용하기 같은 공용 UI 라벨은 대부분 플랫폼 키가 이미 있다. 공용 키가 있는 문구를 \`useMessages\`에 복사해 덮어쓰면 플랫폼 번역 수정이 템플릿에 반영되지 않는다(혼용 패턴은 I18N.md).

## 3. 디자인 토큰 (색·타이포·그림자)

${designGuideSection(target)}

## 4. 로컬 실행 / 빌드

- \`npm run dev\` — 인증 프록시 포함 개발 서버. 로그인: http://localhost:5173/__bstage__/login
- 산출물 확인: \`npx bstage build\` → 페이지는 \`dist/{경로}/template.js\`, 위젯은 \`dist/{슬롯 id}/template.js\` (배포는 관리도구가 트리거)

# 함정 (SDK 설계 제약 — 어기면 런타임·빌드가 깨짐)

- **CSS는 Shadow DOM 안으로 넣어야 한다**: 템플릿은 Shadow DOM에 마운트된다. **\`import './style.css'\`는 배포 산출물에서 조용히 사라진다** — 로컬 개발 화면에서는 적용되므로 "로컬에선 되는데 배포하면 스타일이 없다"로 나타난다. 쓸 수 있는 건 둘뿐이다: ① \`createTemplate\`의 \`styles\` 옵션(\`import css from './x.css?inline'\`) ② 컴포넌트 안 \`<style>{cssText}</style>\`. inline \`style={{}}\`도 물론 된다. 전역 CSS(\`<link>\`)는 금지.
- **IIFE 단일 번들**: 번들은 항상 단일 IIFE. 코드 스플릿·동적 \`import()\` 불가.
- **\`__bstage_fetch__\` 계약**: 플랫폼이 인증 fetch를 전역으로 주입한다. \`BstageClient\`가 이를 우선 사용하므로, fetch 경로를 우회하지 말 것.
- **\`slot.context\`는 단방향·read-only**: 호스트→위젯 1회 전달. 위젯이 되돌려 쓰지 않는다.
- **\`createTemplate()\` 호출 형태 유지**: 빌드 파이프라인이 소스에서 \`createTemplate(\` 호출을 파싱해 메타데이터를 뽑는다. 인자 구조를 임의 변형하면 파싱 실패.

# 하지 말 것

- \`src/main.tsx\`·\`src/App.tsx\` 수정 (개발용 진입점·목록 화면, SDK가 관리)
- \`customElements.define()\` / \`attachShadow\` 직접 호출 (createTemplate이 처리)
- \`@bstage-sdk/core\`의 \`createWebComponent()\` 직접 사용 — react 패키지 API만
- UI 색·타이포·그림자를 hex/rgb로 하드코딩 — 디자인 토큰(위 3번) 사용
- 시그니처를 기억에 의존해 추측 — 위 docs/.d.ts에서 확인
`
}
