# bstage SDK

b.stage 플랫폼용 템플릿 개발 SDK. Web Component 기반 템플릿을 빌드하고 게시합니다.

> 이 저장소는 비공개 개발 저장소의 **스냅샷**입니다. 릴리즈마다 정리된 소스가 옮겨오므로 커밋 이력이
> 얇고, 여기에 직접 올린 커밋은 다음 스냅샷에 덮입니다. 제보는 이슈로 남겨 주세요.

## 패키지

| 패키지                            | 설명                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `@bstage-sdk/core`       | 런타임 코어 (BstageClient, createWebComponent, PlatformBridge)                                     |
| `@bstage-sdk/react`      | React 바인딩 (createTemplate, BstageContext, hooks)                                                |
| `@bstage-sdk/cli`        | CLI (`bstage init`, `bstage build`, `bstage dev`, b.stage kit 콘솔 게시·업데이트 명령)              |
| `@bstage-sdk/host`       | 호스트 런타임 (loadTemplate, TemplateHandle)                                                       |
| `@bstage-sdk/ai-toolkit` | 에이전트용 스킬·AGENTS.md 콘텐츠 — `bstage ai`가 설치 ([docs/AI_TOOLKIT.md](./docs/AI_TOOLKIT.md)) |

## 빠른 시작

```bash
# 프로젝트 생성
npx @bstage-sdk/cli@latest init

# 개발 서버 실행
cd {space}-custom-templates-{phase}
npm run dev
```

### 주요 명령어

| 명령어                                    | 설명                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `bstage init`                             | 새 템플릿 프로젝트 생성 ([docs/INIT.md](./docs/INIT.md))                                    |
| `bstage init --kind liquid`               | liquid 템플릿 레포 생성 ([docs/LIQUID.md](./docs/LIQUID.md))                                |
| `bstage dev`                              | 인증 프록시 포함 개발 서버 ([docs/DEV_SERVER.md](./docs/DEV_SERVER.md))                     |
| `bstage build`                            | 템플릿을 IIFE Web Component로 빌드                                                          |
| `bstage docs`                             | 설치된 SDK 문서 목록 출력                                                                   |
| `bstage i18n pull`                        | 플랫폼 번역 키·타입·로컬 캐시 생성 ([docs/I18N.md](./docs/I18N.md))                         |
| `bstage doctor`                           | SDK 버전 어긋남·마이그레이션 항목 + 콘솔의 페이지별 진단 (`--json`, `--placement`)           |
| `bstage ai install` · `update` · `doctor` | 에이전트용 스킬·AGENTS.md 설치 · 최신화 · 진단 ([docs/AI_TOOLKIT.md](./docs/AI_TOOLKIT.md)) |

### 콘솔 게시·업데이트 명령

콘솔 화면(빌드 → 버전 변경 → 게시)에서 하던 일을 터미널에서 합니다. 콘솔이 발급한 개인 토큰으로 인증하고, 상세는 [docs/GETTING_STARTED.md §9](./docs/GETTING_STARTED.md#9-게시와-업데이트)를 참고하세요.

| 명령어                               | 설명                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `bstage login` / `logout` / `whoami` | 브라우저 승인 코드로 로그인 · 토큰 삭제 · 저장된 토큰(조직·등급·스코프·만료) 확인   |
| `bstage link`                        | 이 디렉터리를 콘솔 조직·스테이지·연결 레포에 연결 (`.bstage/project.json`)          |
| `bstage list`                        | 이 레포의 페이지 상태·라이브 커밋·최근 빌드                                         |
| `bstage logs [buildId] [-f]`         | 빌드 로그 (진행 중이면 따라가기)                                                    |
| `bstage deploy`                      | push된 커밋을 콘솔에서 빌드하고 페이지를 새 빌드로 업데이트 (`--yes`, `--json`, `--no-wait`) |
| `bstage rollback [buildId]`          | 이전 성공 빌드(또는 지정 빌드)로 페이지를 되돌림                                    |
| `bstage placement create --template` | 이 레포의 빌드 하나로 페이지 만들기 (성공한 빌드가 없으면 빌드부터)                 |
| `bstage publish on\|off`             | 게시 토글 (라이브 버전은 유지)                                                      |

CI에서는 콘솔 **설정 › CLI 토큰**에서 발급한 토큰을 `BSTAGE_TOKEN`으로 주고 `bstage deploy --yes --json`을 실행합니다. 위젯(슬롯)을 만드는 일과 페이지·위젯을 지우는 일은 콘솔 화면에서만 합니다.

liquid 레포도 같은 명령을 씁니다 — 다만 페이지(PAGE)로만 올릴 수 있습니다 ([docs/LIQUID.md](./docs/LIQUID.md)).

## 문서

| 문서                                                   | 설명                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md)   | 빠른 시작 및 개발 가이드 (프로젝트 생성, 템플릿 작성, 스타일링, API 호출, 게시) |
| [docs/SDK_ARCHITECTURE.md](./docs/SDK_ARCHITECTURE.md) | SDK 아키텍처                                                                    |
| [docs/API_REFERENCE.md](./docs/API_REFERENCE.md)       | API 레퍼런스                                                                    |
| [docs/BUILD_SYSTEM.md](./docs/BUILD_SYSTEM.md)         | 빌드 시스템                                                                     |
| [docs/DEV_SERVER.md](./docs/DEV_SERVER.md)             | 로컬 개발 서버                                                                  |
| [docs/INIT.md](./docs/INIT.md)                         | `bstage init` 커맨드 상세                                                       |
| [docs/LIQUID.md](./docs/LIQUID.md)                     | liquid 템플릿 레포 가이드 (생성·미리보기·검증·게시)                             |
| [docs/I18N.md](./docs/I18N.md)                         | 다국어 훅 + `bstage i18n pull` codegen                                          |
| [docs/AI_TOOLKIT.md](./docs/AI_TOOLKIT.md)             | 에이전트용 스킬·AGENTS.md와 `bstage ai` 명령                                    |
| [docs/SLOT_PROTOCOL.md](./docs/SLOT_PROTOCOL.md)       | 슬롯 시스템 v1 (현행)                                                           |
| [docs/SLOT_CATALOG_V2.md](./docs/SLOT_CATALOG_V2.md)   | 슬롯 카탈로그 v2 (현행) — 슬롯 id·context 계약·자리 도식                        |
| [docs/SLOT_SYSTEM.md](./docs/SLOT_SYSTEM.md)           | 옛 슬롯 시스템 (공존 기간 참조용)                                               |
| [docs/SLOT_CATALOG.md](./docs/SLOT_CATALOG.md)         | 옛 슬롯 목록·이벤트 (공존 기간 참조용)                                          |
| [docs/MIGRATION.md](./docs/MIGRATION.md)               | 버전 사이 소비자 마이그레이션 가이드                                            |

## SDK 개발

### 사전 준비

```bash
pnpm install
```

### 빌드

```bash
pnpm build
```

### 프로젝트 구조

```
bstage-sdk/
├── packages/
│   ├── core/           # @bstage-sdk/core
│   ├── react/          # @bstage-sdk/react
│   ├── host/           # @bstage-sdk/host
│   ├── cli/            # @bstage-sdk/cli
│   └── design/         # @bstage-sdk/design
└── scripts/            # 문서용 슬롯 배치 도식 생성기
```
