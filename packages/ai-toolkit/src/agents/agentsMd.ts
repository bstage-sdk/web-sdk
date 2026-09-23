import { wrapManaged, freeRegionScaffold } from './agentsMdRegion.js'
import { designRulesBrief } from './designGuide.js'
import type { DesignTarget, ProjectKind } from '../skills/registry.js'

interface AgentsMdOptions {
  space: string
  projectName: string
  /** 디자인 토큰 타깃(user/admin). 미지정 시 user. */
  target?: DesignTarget
  /** 프로젝트 종류(sdk/liquid). 미지정 시 sdk. */
  kind?: ProjectKind
}

/**
 * 공통 "배포" 절. 두 kind가 같은 경로로 배포되므로 한 곳에서 관리한다.
 * 상세(실패 갈래·롤백·CI)는 `bstage-deploy` 스킬이 소유한다 — 여기에 옮겨 적지 않는다.
 */
function deploySection(): string {
  return `## 배포

- 포털은 **원격 저장소 기본 브랜치에 push된 커밋**을 빌드한다. 로컬 산출물을 올리는 것이 아니므로, 커밋·push하지 않은 변경은 반영되지 않는다.
- 배포는 \`bstage deploy\` — 빌드 트리거 → 완료 대기 → 이 레포의 배치에 적용까지 한 번에 한다.
- 배치(페이지) 생성과 레포 연결은 **포털 화면에서만** 가능하다. \`bstage list\`에 배치가 0건이면 화면에서 먼저 만든다.
- 롤백(\`bstage rollback\`)·게시 끄기(\`bstage publish off\`)·실패 대응·CI 사용은 \`bstage-deploy\` 스킬을 따른다.`
}

/**
 * SDK가 관리하는 AGENTS.md 본문(마커 미포함).
 * 이 본문이 바뀌면 `agentsMdRegion.ts`의 `AGENTS_MANAGED_VERSION`을 올린다(doctor가 갱신 필요를 감지).
 *
 * `kind`로 프로젝트 종류를 가른다 — 기본은 `sdk`라 기존 호출부는 바뀌지 않는다.
 */
export function agentsManagedBody({
  space,
  projectName,
  target = 'user',
  kind = 'sdk',
}: AgentsMdOptions): string {
  assertSingleLine({ space, projectName })
  if (kind === 'liquid') return liquidManagedBody(space, projectName)
  return sdkManagedBody(space, projectName, target)
}

/**
 * 정체성 값은 cli가 정제해 넘기는 것이 계약이다. 그래도 개행이 들어오면 관리 영역 마커가
 * 깨져 다음 설치가 자유 영역을 잃는다 — 여기서 멈춘다(호출부를 믿고 넘기지 않는다).
 */
function assertSingleLine(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error(`AGENTS.md 정체성 값에 개행이 있습니다: ${key}`)
  }
}

/** React 템플릿(sdk) 프로젝트용 관리 영역 본문. */
function sdkManagedBody(space: string, projectName: string, target: DesignTarget): string {
  // 스캐폴드 구조·명령은 유저·어드민이 같다. 갈리는 건 디자인 토큰 서브패스뿐이다.
  const structureBlock = `src/
  main.tsx                  — App 마운트만 (수정 불필요)
  App.tsx                   — import.meta.glob 기반 개발용 목록·라우팅 (수정 불필요)
  shared/
    client.ts               — BstageClient 인스턴스 (API 키는 .env에서 주입). 유저단 API만 지원
  pages/
    {경로}/
      template.tsx          — 페이지 (폴더 구조가 곧 배포 경로)
  slots/
    {아무 이름}/
      template.tsx          — 위젯 (createTemplate의 slot 옵션이 자리를 정함)
.env                        — VITE_BSTAGE_PHASE + API 키 (커밋 안 됨, .gitignore)
.env.example                — 위 항목 placeholder (커밋됨 — 복사해서 .env 생성)
vite.config.ts              — Vite + bstageDevPlugin (phase는 .env에서 읽음)`

  const envSection = `\`.env\`(커밋 안 됨)는 phase와 API 키를, \`.env.example\`(커밋됨)은 그 placeholder를 담는다. \`client.ts\`는 \`import.meta.env.VITE_BSTAGE_APP_*\`를, \`vite.config.ts\`는 \`.env\`의 phase를 참조한다.

\`\`\`
VITE_BSTAGE_PHASE=dev   # dev | qa | real | sandbox
\`\`\``

  const commandsSection = `- \`npm run dev\` — 개발 서버 실행 (인증 프록시 포함)
- 로그인 페이지: http://localhost:5173/__bstage__/login`

  const apiForbidBullet = `- 경로·응답 모양을 추측해 호출하지 않는다 — SDK는 API 경로 목록을 들고 있지 않다(자동완성 없음). 출처는 게이트웨이 API Reference Doc이고, 응답 타입은 \`client.get<T>(...)\`처럼 제네릭으로 명시한다.
- 어드민용 API를 추측해 호출하지 않는다 — BstageClient는 **유저단 API만 지원**한다. 어드민 API가 필요하면 경로를 임의로 만들지 말고 **반드시 사용자에게 먼저 확인**한다.`

  return `# AGENTS.md

## 프로젝트 개요

b.stage 서드파티 템플릿 프로젝트. React 컴포넌트를 작성하면 SDK가 Web Component로 빌드하고, 빌드 산출물이 b.stage 플랫폼에서 로드되어 실행된다.

- **Space**: ${space}
- **레포**: \`${projectName}\`

## SDK 문서

SDK의 API, hooks, 슬롯 시스템, 빌드 파이프라인 등 **SDK와 관련된 모든 내용**은 설치된 패키지의 문서를 참조한다. 이 문서들이 항상 최신이며 외부 검색 결과보다 신뢰할 수 있다.

\`\`\`
node_modules/@bstage-sdk/core/docs/
  ├── GETTING_STARTED.md   — 빠른 시작 가이드
  ├── API_REFERENCE.md     — createTemplate, hooks, BstageClient, PlatformBridge API
  ├── I18N.md              — 다국어 훅 + bstage i18n pull (번역 코드젠) 워크플로
  ├── DESIGN_TOKENS.md     — 디자인 토큰 (색·타이포·그림자) 사용 가이드
  ├── SLOT_PROTOCOL.md     — 슬롯 시스템 v1 프로토콜 (3-part 키·context 단방향)
  ├── SLOT_CATALOG.md      — 슬롯 목록, 이벤트 인터페이스, resourceId 의미
  ├── SLOT_SYSTEM.md       — 슬롯 시스템 설계, 런타임 흐름
  ├── BUILD_SYSTEM.md      — 빌드 파이프라인, 산출물 경로 규칙
  ├── DEV_SERVER.md        — 로컬 개발 서버, 인증 프록시
  ├── MIGRATION.md         — 버전 사이 마이그레이션 가이드 (bstage doctor 연계)
  └── SDK_ARCHITECTURE.md  — 패키지 구조, 설계 결정
\`\`\`

문서 목록은 \`npx bstage docs\`로도 볼 수 있다. 타입 정의(.d.ts)와 런타임 소스(.js)는 \`node_modules/@bstage-sdk/react/dist/\`, \`node_modules/@bstage-sdk/core/dist/\`에서 직접 확인할 수 있다.

## 프로젝트 구조

\`\`\`
${structureBlock}
\`\`\`

## 템플릿 개발 규칙

### 새 템플릿 추가

페이지냐 위젯이냐에 따라 두는 곳이 다르다. 파일명은 반드시 \`template.tsx\`여야 하며, \`src/pages/\`·\`src/slots/\` 밖에 두면 빌드가 인식하지 않는다.

- **페이지** — \`src/pages/{경로}/template.tsx\`. **폴더 구조가 곧 배포 경로**다(\`src/pages/settings/custom/\` → \`/settings/custom\`). 동적 경로(\`[id]\`)는 아직 지원하지 않는다.
- **위젯** — \`src/slots/{아무 이름}/template.tsx\` + \`createTemplate\`에 \`slot\` 옵션. 폴더 이름은 배치에 쓰이지 않고, 어느 자리에 붙을지는 \`slot\`만 정한다.

\`name\`은 Custom Element 태그로 그대로 사용된다. Custom Element 스펙상 **소문자로 시작 + 하이픈 1개 이상 + 소문자·숫자·하이픈만** 허용. 위반 시 런타임·빌드가 거부한다.

\`\`\`
src/pages/welcome/template.tsx              → /welcome
src/pages/settings/custom/template.tsx      → /settings/custom
src/slots/curation-banner/template.tsx      → slot 옵션이 자리를 정함
\`\`\`

### template.tsx 필수 구조

\`\`\`tsx
import { createTemplate } from '@bstage-sdk/react'

// 컴포넌트는 반드시 export default
export default function MyWidget() {
  return <div>...</div>
}

// createTemplate 호출 필수 — 빌드 파이프라인이 이 호출을 파싱하여 메타데이터 추출
createTemplate(MyWidget, {
  name: '${space}-my-widget',   // 폴더명과 동일해야 함. 하이픈 필수.
})
\`\`\`

- \`name\`은 필수 — 템플릿 폴더명과 일치, 하이픈 포함
- 컴포넌트 함수명은 자유이나 \`export default\` 필수
- \`type\` 등 선택 필드 추가 가능

${designRulesBrief(target)}

## 환경 설정

${envSection}

## 명령어

${commandsSection}

## SDK 업데이트 / 마이그레이션

이 프로젝트는 생성 시점의 SDK 버전을 \`package.json\`에 고정한다. SDK가 업데이트돼도 자동으로 따라오지 않으므로, 최신으로 올리려면:

- \`npx @bstage-sdk/cli@latest doctor\` — 버전 드리프트·누락 파일·적용 가능한 마이그레이션 항목을 진단한다(파일 수정 없음, \`--json\` 지원).
- 실제 적용은 \`bstage-migrate\` 스킬에게 맡긴다 — 에이전트에게 "bstage 최신 버전으로 마이그레이션 해줘"라고 요청하면, doctor 결과와 SDK의 \`MIGRATION.md\`를 읽고 이 프로젝트에 맞춰 변환한다(사용자 코드는 덮어쓰지 않고 reconcile).

마이그레이션 절차의 단일 소스는 SDK의 \`node_modules/@bstage-sdk/core/docs/MIGRATION.md\`다.

이 프로젝트의 \`.claude/skills/\`에는 에이전트용 스킬(\`bstage-template\` 작성, \`bstage-deploy\` 배포, \`bstage-onboarding\` 처음부터 끝까지, \`bstage-migrate\` 마이그레이션)이 들어 있다. SDK 버전업 후 \`npx @bstage-sdk/cli@latest ai update\`로 최신 스킬을 동기화할 수 있으며, 이때 **이 AGENTS.md의 SDK 관리 영역(마커로 감싼 부분)도 함께 최신화**된다. 프로젝트 고유 규칙은 관리 영역 아래 **자유 영역**에 적으면 갱신 시 보존된다.

## 빌드

- 로컬에서 산출물 확인이 필요하면 \`npx bstage build\`로 \`dist/\` 를 생성할 수 있다(배포 산출물은 포털이 다시 만든다).

${deploySection()}

## 금지 사항

- \`src/main.tsx\`·\`src/App.tsx\`를 수정하지 않는다 — 개발용 진입점·목록 화면으로 SDK가 관리
- \`customElements.define()\`을 직접 호출하지 않는다 — \`createTemplate()\`이 자동 처리
- Shadow DOM을 직접 조작하지 않는다 (\`attachShadow\`, \`shadowRoot\` 등) — SDK가 관리
- \`createTemplate()\` 호출의 인자 구조를 임의로 변경하지 않는다 — 빌드 파이프라인이 파싱에 실패할 수 있다
- \`@bstage-sdk/core\`를 직접 import하여 \`createWebComponent()\`를 호출하지 않는다 — \`@bstage-sdk/react\`의 API만 사용
- 전역 CSS 파일(\`<link>\`, 외부 스타일시트)을 사용하지 않는다 — Shadow DOM 내부에 적용되지 않는다.
- **\`import './style.css'\`로 스타일을 넣지 않는다 — 배포 산출물에서 사라진다.** 로컬 개발 화면에서는 적용되어 눈치채기 어렵다. CSS 파일을 쓰려면 \`import css from './style.css?inline'\`으로 문자열을 가져와 \`createTemplate(..., { styles: css })\`에 넘기거나 컴포넌트 안 \`<style>{css}</style>\`로 렌더한다. inline \`style={{}}\`도 된다
- UI 색·타이포·그림자를 hex/rgb로 하드코딩하지 않는다 — 위 '디자인' 섹션의 디자인 토큰을 사용
- 앱키(APP-ID \`bsa_…\`·APP KEY \`bsp_…\`, 어드민 게이트웨이 \`bsm_…\`)를 소스 코드에 리터럴로 넣지 않는다 — 인증 값은 \`.env\`(커밋 안 됨)에서 \`import.meta.env.VITE_BSTAGE_*\`로만 주입한다. pre-commit 훅이 커밋 전 검출·차단하며 \`--no-verify\`로 우회하지 않는다
${apiForbidBullet}
`
}

/**
 * liquid 테마 프로젝트용 관리 영역 본문.
 *
 * sdk 본문과 공유하지 않는다 — 구조·명령·함정이 전부 다르고, 섞어 쓰면 "이 프로젝트에 없는 규칙"이
 * 절반씩 섞여 에이전트가 존재하지 않는 파일을 만들게 된다. 공통은 "배포" 절뿐이다.
 */
function liquidManagedBody(space: string, projectName: string): string {
  const structureBlock = `public/
  user/                      — 유저 플랫폼용 템플릿
    {name}/
      template.liquid        — 템플릿 본문 (필수, 파일명 고정)
      data.json              — 로컬 미리보기용 샘플 데이터 (배포에는 나가지 않음)
  admin/                     — 어드민용 템플릿 (같은 규칙)
package.json
AGENTS.md                    — 이 파일`

  return `# AGENTS.md

## 프로젝트 개요

b.stage liquid 테마 프로젝트. \`.liquid\` 템플릿을 작성하면 포털이 그대로 패키징해 플랫폼이 서버에서 데이터를 넣어 렌더한다.

- **Space**: ${space}
- **레포**: \`${projectName}\`

## SDK 문서

규약·데이터 계약은 아래 절과 \`bstage-liquid\` 스킬이 직접 들고 있다 — **이것을 1차 근거로 삼는다.** SDK 문서가 함께 설치된 레포라면 \`bstage docs\`로 목록을 볼 수 있지만, \`.liquid\` 파일만 둔 레포에는 설치되지 않아 그 명령이 종료 코드 2로 끝난다.

- 명령·옵션: \`bstage --help\`, \`bstage <명령> --help\`
- 작성 규약·데이터·에셋: \`.claude/skills/bstage-liquid/SKILL.md\`
- 문법(태그·필터): liquidjs 공식 문서

## 플랫폼이 넣는 데이터 (유저 화면)

최상위 값은 다섯 개다 — \`lounges\` · \`stories\` · \`contentSections\` · \`latestContents\` · \`shopCategories\`. 이 이름 외의 변수는 빈 문자열이 된다. 각 항목의 필드는 실제 렌더 결과로 확인한다. \`data.json\` 샘플도 같은 이름을 써야 프리뷰가 배포와 같은 모양이 된다. 어드민 화면이 받는 값은 확인되지 않았다.

## 프로젝트 구조

\`\`\`
${structureBlock}
\`\`\`

## 템플릿 작성 규칙

- 경로 깊이가 고정이다 — \`public/{user|admin}/{name}/template.liquid\`(예: \`public/user/welcome/template.liquid\`) 자리에 있는 파일만 인식한다. 다른 위치의 파일은 **조용히 무시된다**(빌드는 성공하는데 화면에 나오지 않는다).
- \`{name}\`은 **소문자·숫자·하이픈**만 쓴다. 폴더 하나가 페이지 하나다.
- 파일명은 반드시 \`template.liquid\`다.
- \`data.json\`은 로컬 미리보기용 샘플일 뿐이다. 실제 값은 플랫폼이 넣으므로, 값이 비어 있어도 화면이 깨지지 않게 기본값·빈 목록 분기를 함께 넣는다.
- 작성·수정 절차와 문법 요점은 \`bstage-liquid\` 스킬을 따른다.

## 명령어

- \`bstage dev\` — 로컬 미리보기(목록에서 템플릿을 골라 확인)
- \`bstage build\` — 검증(구조·문법 확인, 번들을 만들지 않는다)
- \`bstage deploy\` — 포털 배포 (아래 "배포" 절)

**설치된 cli가 liquid를 모르는 옛 버전이면** 위 두 명령이 이 레포를 알아보지 못한다 — 증상이 분명하다: \`bstage build\`가 liquid 검증 대신 \`src/\` 아래에서 없는 소스 파일을 찾는다고 끝난다. 그때는 cli를 최신으로 올린다. 올릴 수 없으면 로컬 미리보기는 이 레포가 가진 수단을 쓴다.

## SDK 업데이트

이 프로젝트의 \`.claude/skills/\`에는 에이전트용 스킬(\`bstage-liquid\` 작성, \`bstage-deploy\` 배포, \`bstage-onboarding\` 처음부터 끝까지, \`bstage-migrate\` 마이그레이션)이 들어 있다. \`npx @bstage-sdk/cli@latest ai update\`로 최신 스킬을 동기화할 수 있으며, 이때 **이 AGENTS.md의 SDK 관리 영역(마커로 감싼 부분)도 함께 최신화**된다. 프로젝트 고유 규칙은 관리 영역 아래 **자유 영역**에 적으면 갱신 시 보존된다.

${deploySection()}

## 금지 사항

- 한 레포에 liquid와 sdk 방식(React 컴포넌트) 템플릿을 섞지 않는다 — 포털이 빌드하지 못한다
- liquid 템플릿을 슬롯(위젯 자리)에 넣으려 하지 않는다 — **PAGE 배치만 가능**하다
- \`data.json\`·\`layout.json\`에 배포에 필요한 설정을 담지 않는다 — 포털이 패키징할 때 지운다(레이아웃은 배치 설정이 소유)
- 규약 밖 경로에 템플릿을 두지 않는다 — 깊이가 다르면 무시된다
- 에셋(이미지·영상)을 레포에 두고 상대 경로로 참조하지 않는다 — 배포 후 깨진다. 포털 화면의 스테이지 > 미디어에 올려 받은 URL을 절대 주소로 넣는다(이미지·영상만 올릴 수 있고 허용 형식·용량 한도는 업로드할 때 화면이 알려 준다). 로컬 프리뷰에서는 상대 경로도 보이므로 프리뷰 결과를 근거로 삼지 않는다
- 플랫폼이 넣어 주는 데이터의 이름·구조를 추측하지 않는다 — 최상위 이름은 위 '플랫폼이 넣는 데이터' 절이 전부이고, 그 안의 필드는 실제 렌더 결과로 확인한다
`
}

/** SDK 관리 영역(마커 포함) 블록만 렌더링한다. ai install|update/migrate의 결정론적 치환에 쓴다. */
export function renderManagedBlock(opts: AgentsMdOptions): string {
  return wrapManaged(agentsManagedBody(opts))
}

/**
 * init이 생성하는 전체 AGENTS.md = 관리 영역(마커 포함) + 자유 영역 스캐폴드.
 * 시그니처는 기존과 동일하므로 init.ts는 변경 불필요.
 */
export function agentsMd(opts: AgentsMdOptions): string {
  assertSingleLine({ space: opts.space, projectName: opts.projectName })
  return `${renderManagedBlock(opts)}\n\n${freeRegionScaffold()}`
}
