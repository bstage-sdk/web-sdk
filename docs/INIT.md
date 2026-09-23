# bstage init — 프로젝트 스캐폴딩

## 1. 개요

`bstage init`은 보일러플레이트를 생성하는 CLI 명령어입니다. 서드파티 개발자는 이 명령어로 b.stage 템플릿 프로젝트를 즉시 시작할 수 있습니다.

```bash
npx @bstage-sdk/cli@latest init
```

---

## 2. 사전 요구사항

Node.js v20 이상과 npm(또는 pnpm)만 있으면 됩니다. SDK 패키지는 npm 공개 레지스트리에 있어
별도 설정이나 인증이 필요 없습니다.

> CI 배포는 관리도구가 GitHub Actions 워크플로우를 구성·트리거합니다. 개발자가 직접 CI 워크플로우를 작성·관리할 필요는 없습니다.

---

## 3. 인터랙티브 프롬프트

`@clack/prompts` 기반의 인터랙티브 UI를 제공합니다.

| 순서 | 질문                       | 필수 | 비고                                                                                                                                                    |
| ---- | -------------------------- | :--: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 첫 템플릿의 플랫폼(target) |  O   | `user` / `admin` — 아래 [§4.1](#41-첫-템플릿의-target---target)                                                                                         |
| 2    | 방식(kind)                 |  O   | `sdk`(React 컴포넌트) / `liquid`(liquid 템플릿) — 아래 [§4.2](#42-liquid-프로젝트---kind-liquid)                                                        |
| 3    | 템플릿을 적용할 Space ID   |  O   | 레포명 `{space}-custom-templates-{phase}`, BstageClient의 `tenantId`로 사용                                                                             |
| 4    | 배포 환경(Phase)           |  O   | `dev` / `qa` / `real` / `sandbox` — 레포명에 포함되며 `.env`의 `VITE_BSTAGE_PHASE`로 주입                                                               |
| 5    | 첫 번째 템플릿 이름        |  O   | sdk는 `src/pages/{name}/template.tsx`(Custom Element 스펙상 하이픈 필수), liquid는 `public/{target}/{name}/template.liquid`(소문자·숫자·하이픈 한 단어) |
| 6    | 패키지 매니저              |  O   | `npm` 또는 `pnpm`                                                                                                                                       |
| 7    | API 키 설정 여부           |  -   | sdk에서만 질문합니다 — "없어도 시작할 수 있어요"                                                                                                        |
| 8    | APP-ID                     |  -   | API 키가 있는 경우만                                                                                                                                    |
| 9    | APP KEY                    |  -   | API 키가 있는 경우만                                                                                                                                    |

### 레포명 결정 로직

`{space}-custom-templates-{phase}`을 레포명으로 씁니다. 같은 이름의 디렉토리가 로컬 `cwd`에 이미 있으면 init이 중단됩니다.

### 비인터랙티브 모드

```bash
npx @bstage-sdk/cli@latest init --yes --space bmf --phase dev
```

`--yes` 플래그를 사용하면 프롬프트 없이 실행됩니다. `--space`는 필수입니다.

| 옵션         | 기본값                               |
| ------------ | ------------------------------------ |
| `--space`    | (필수)                               |
| `--target`   | `user`                               |
| `--kind`     | `sdk`                                |
| `--phase`    | `sandbox`                            |
| `--template` | sdk `{space}-hello` / liquid `hello` |
| `--pm`       | `npm`                                |

liquid 프로젝트를 만들려면 `--kind liquid`를 붙입니다.

```bash
npx @bstage-sdk/cli@latest init --yes --kind liquid --space demo --target user
```

`--target`은 **첫 템플릿**이 유저용인지 어드민용인지만 정합니다(대화형에서는 첫 질문). 자세한 내용은 아래 [§4.1](#41-첫-템플릿의-target---target)을 참고하세요. `--kind`는 프로젝트 전체를 가릅니다 — [§4.2](#42-liquid-프로젝트---kind-liquid)를 참고하세요.

---

## 4. 생성되는 파일 구조

`--kind sdk`(기본)일 때의 구조입니다. liquid 프로젝트는 [§4.2](#42-liquid-프로젝트---kind-liquid)를 참고하세요.

```
{space}-custom-templates-{phase}/
├── CLAUDE.md                               # AGENTS.md를 가리키는 포인터 (파일이 없을 때만 생성)
├── AGENTS.md                               # 프로젝트 규칙·SDK 규약 (관리 영역은 bstage ai가 갱신)
├── README.md
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts                          # bstageDevPlugin (phase는 .env에서 읽음)
├── .env                                    # phase + API 키 (gitignore — 커밋 안 됨)
├── .env.example                            # placeholder (커밋됨 — 복사해서 .env 생성)
├── index.html
├── .gitignore
├── eslint.config.js
├── .claude/
│   └── skills/                             # 에이전트용 스킬 (SDK 소유 — bstage ai가 갱신)
│       ├── bstage-onboarding/SKILL.md      # 처음부터 첫 배포까지 안내
│       ├── bstage-template/SKILL.md        # 템플릿 작성 가이드
│       ├── bstage-deploy/SKILL.md          # 배포·롤백·게시
│       └── bstage-migrate/SKILL.md         # SDK 버전업 마이그레이션
└── src/
    ├── main.tsx                            # App 마운트만
    ├── App.tsx                             # import.meta.glob 기반 라우팅 + picker UI
    ├── index.css
    ├── vite-env.d.ts
    ├── shared/
    │   └── client.ts                       # BstageClient 인스턴스 (API 키는 .env에서 주입)
    ├── pages/
    │   └── {template-name}/
    │       └── template.tsx                # createTemplate 보일러플레이트
    └── slots/
        └── README.md                       # 위젯을 두는 곳
```

> init은 `.github/workflows/` 파일을 생성하지 않습니다. CI 워크플로우 구성은 관리도구의 책임입니다.

`AGENTS.md`·`CLAUDE.md`·`.claude/skills/`는 init이 한 번 깔고, 이후에는 `bstage ai install|update|doctor`가 관리합니다. 자세한 내용은 [AI_TOOLKIT.md](./AI_TOOLKIT.md)를 참고하세요.

---

## 4.1 첫 템플릿의 target (`--target`)

`--target admin`은 생성되는 `template.tsx`가 `target: 'admin'`을 선언하게 합니다. **그 외에는 유저 스캐폴드와 완전히 동일합니다** — 의존성·`vite.config.ts`·env·`.npmrc`·`main.tsx`가 모두 같습니다.

한 레포에 유저 템플릿과 어드민 템플릿을 섞어 둘 수 있으므로, 이 옵션은 프로젝트 전체를 가르지 않고 **첫 템플릿 하나**만 정합니다. 이후 추가하는 템플릿은 각자 `target`을 적거나(페이지), 슬롯 id에서 추론되게 둡니다(위젯).

```bash
npx @bstage-sdk/cli@latest init --yes --space my-space --phase dev --target admin
```

어드민 템플릿 작성법은 [GETTING_STARTED.md](./GETTING_STARTED.md)의 "어드민 템플릿" 절을 참고하세요.

---

## 4.2 liquid 프로젝트 (`--kind liquid`)

`--kind liquid`는 React 대신 **liquid 템플릿**을 작성하는 프로젝트를 만듭니다. 템플릿을 번들링하지 않고 플랫폼이 서버에서 데이터를 넣어 렌더하므로, 스캐폴드에 Vite·TypeScript·ESLint·`.env`가 들어가지 않습니다. 의존성은 저작 도구인 `@bstage-sdk/cli` 하나뿐입니다.

작성·미리보기·검증·배포까지의 전체 흐름은 [LIQUID.md](./LIQUID.md)에 있습니다. 이 절은 init이 만드는 파일만 다룹니다.

```
{space}-custom-templates-{phase}/
├── CLAUDE.md                               # AGENTS.md를 가리키는 포인터
├── AGENTS.md                               # liquid 규약 (관리 영역은 bstage ai가 갱신)
├── README.md
├── package.json                            # bstage.kind = "liquid", 의존성은 cli 하나
├── .gitignore
├── .husky/
│   ├── pre-commit                          # 시크릿 가드
│   └── check-secrets.mjs
├── .claude/
│   └── skills/                             # 에이전트용 스킬 (SDK 소유 — bstage ai가 갱신)
│       ├── bstage-onboarding/SKILL.md
│       ├── bstage-liquid/SKILL.md          # liquid 작성 가이드
│       ├── bstage-deploy/SKILL.md
│       └── bstage-migrate/SKILL.md
└── public/
    └── {user|admin}/
        └── {name}/
            ├── template.liquid             # 템플릿 본문 (파일명 고정)
            └── data.json                   # 로컬 미리보기용 샘플 (배포에는 나가지 않음)
```

- **경로 깊이가 규약입니다** — `public/{user|admin}/{name}/template.liquid` 자리에 있는 파일만 인식됩니다. 깊이가 다르거나 `user`/`admin` 밖에 있으면 **조용히 무시됩니다**(빌드는 성공하는데 화면에 나오지 않습니다).
- `{name}`은 소문자로 시작하고 소문자·숫자·하이픈만 쓰는 **한 단어**입니다(`hello`, `landing-v1`). 폴더 하나가 페이지 하나입니다.
- `data.json`은 로컬 미리보기용 샘플일 뿐이고 배포 패키징에서 제외됩니다. 배포에 필요한 설정을 여기에 담지 마세요.
- 한 레포에 liquid와 React 템플릿(`src/**/template.tsx`)을 **섞지 마세요** — 빌드되지 않습니다.
- liquid 템플릿은 **페이지 배치만** 가능합니다(슬롯 위젯은 sdk 방식만 지원).

---

## 5. Phase 관리

init에서 선택한 Phase 값이 두 위치에 기록됩니다:

1. **레포명**: `{space}-custom-templates-{phase}` — 같은 space라도 환경(dev/qa/real/sandbox)별로 레포가 분리됩니다.
2. **`.env`의 `VITE_BSTAGE_PHASE`**: 로컬 개발 서버가 참조하는 phase.

```
VITE_BSTAGE_PHASE=dev
```

- **vite.config.ts** — `loadEnv()`로 읽어 `bstageDevPlugin({ phase })`에 전달

`.env`는 인증 정보를 담아 **커밋되지 않습니다**(`.gitignore`). clone 후 `.env.example`을 `.env`로 복사해 phase·API 키를 채우세요.

`VITE_BSTAGE_PHASE`는 **로컬 dev 서버 전용**입니다. devVitePlugin이 이 값으로 프록시 대상·게이트웨이 호스트를 결정합니다(`bstage dev --phase`로도 지정 가능).

런타임 `BstageClient`는 phase를 받지 않습니다. 게이트웨이 base URL은 임베드된 페이지의 **origin**(`location.origin + /gw`)으로 자동 결정되므로, 프로덕션 환경 타게팅은 **배포 위치(origin)**가 정합니다 — 환경별 재빌드가 필요 없습니다. 특정 게이트웨이를 직접 지정해야 하면 `BstageClient`의 `baseUrl`을 사용합니다.

---

## 6. 파일시스템 기반 템플릿 라우팅

`App.tsx`가 `import.meta.glob(['./pages/**/template.tsx', './slots/**/template.tsx'])`로 모든 템플릿을 동적 감지합니다.

```
localhost:5173/                              → 템플릿 목록 (picker UI)
localhost:5173/pages/{space}-hello           → pages/{space}-hello/template.tsx
localhost:5173/pages/settings/custom         → pages/settings/custom/template.tsx
localhost:5173/slots/curation-banner         → slots/curation-banner/template.tsx
```

- 파일명은 반드시 `template.tsx`여야 합니다
- **페이지**(`src/pages/`)는 폴더 구조가 곧 배포 경로입니다. **위젯**(`src/slots/`)은 폴더 이름이 자유이고 `createTemplate`의 `slot` 옵션이 자리를 정합니다
- 미리보기 주소는 `src/` 아래 경로를 그대로 씁니다 — 페이지와 위젯이 같은 이름을 써도 겹치지 않습니다
- 템플릿 추가 시 폴더만 만들면 자동 인식 (설정 변경 없음)

---

## 7. 생성 후 자동 실행

init 완료 시 다음이 자동으로 실행됩니다:

1. `git init` + 첫 커밋 (`init: bstage 템플릿 프로젝트 초기화`)
2. 선택한 패키지 매니저로 의존성 설치

---

## 8. 배포

배포는 관리도구가 이 레포의 GitHub Actions 워크플로우를 `workflow_dispatch`로 트리거해서 수행합니다. SDK는 워크플로우 파일을 생성·관리하지 않습니다. 워크플로우의 구성·권한 세팅·CDN 업로드 경로 결정은 모두 관리도구가 맡습니다.

---

## 관련 문서

- [GETTING_STARTED.md](./GETTING_STARTED.md) — 빠른 시작 가이드
- [DEV_SERVER.md](./DEV_SERVER.md) — 생성된 프로젝트의 로컬 개발 서버 동작 방식
- [BUILD_SYSTEM.md](./BUILD_SYSTEM.md) — 빌드 파이프라인과 산출물 경로 규칙
- [LIQUID.md](./LIQUID.md) — liquid 템플릿 레포 가이드 (`--kind liquid`로 만든 프로젝트)
