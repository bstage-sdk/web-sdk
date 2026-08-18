# bstage SDK

b.stage 플랫폼용 템플릿 개발 SDK. Web Component 기반 템플릿을 빌드하고 배포합니다.

> 이 저장소는 비공개 개발 저장소의 **스냅샷**입니다. 릴리즈마다 정리된 소스가 옮겨오므로 커밋 이력이
> 얇고, 여기에 직접 올린 커밋은 다음 스냅샷에 덮입니다. 제보는 이슈로 남겨 주세요.

## 패키지

| 패키지              | 설명                                                           |
| ------------------- | -------------------------------------------------------------- |
| `@bstage-sdk/core`  | 런타임 코어 (BstageClient, createWebComponent, PlatformBridge) |
| `@bstage-sdk/react` | React 바인딩 (createTemplate, BstageContext, hooks)            |
| `@bstage-sdk/cli`   | CLI (`bstage init`, `bstage build`, `bstage dev`)              |
| `@bstage-sdk/host`  | 호스트 런타임 (loadTemplate, TemplateHandle)                   |

## 빠른 시작

```bash
# 프로젝트 생성
npx @bstage-sdk/cli@latest init

# 개발 서버 실행
cd {space}-custom-templates-{phase}
npm run dev
```

### 주요 명령어

| 명령어                  | 설명                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| `bstage init`           | 새 템플릿 프로젝트 생성 ([docs/INIT.md](./docs/INIT.md))                |
| `bstage dev`            | 인증 프록시 포함 개발 서버 ([docs/DEV_SERVER.md](./docs/DEV_SERVER.md)) |
| `bstage build`          | 템플릿을 IIFE Web Component로 빌드                                      |
| `bstage docs`           | 설치된 SDK 문서 목록 출력                                               |
| `bstage i18n pull`      | 플랫폼 번역 키·타입·로컬 캐시 생성 ([docs/I18N.md](./docs/I18N.md))     |
| `bstage doctor`         | SDK 버전 드리프트·마이그레이션 항목 진단 (read-only, `--json`)          |
| `bstage skills install` | 에이전트 스킬·AGENTS.md 관리 영역을 최신으로 동기화                     |

## 문서

| 문서                                                   | 설명                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md)   | 빠른 시작 및 개발 가이드 (프로젝트 생성, 템플릿 작성, 스타일링, API 호출, 배포) |
| [docs/SDK_ARCHITECTURE.md](./docs/SDK_ARCHITECTURE.md) | SDK 아키텍처                                                                    |
| [docs/API_REFERENCE.md](./docs/API_REFERENCE.md)       | API 레퍼런스                                                                    |
| [docs/BUILD_SYSTEM.md](./docs/BUILD_SYSTEM.md)         | 빌드 시스템                                                                     |
| [docs/DEV_SERVER.md](./docs/DEV_SERVER.md)             | 로컬 개발 서버                                                                  |
| [docs/INIT.md](./docs/INIT.md)                         | `bstage init` 커맨드 상세                                                       |
| [docs/I18N.md](./docs/I18N.md)                         | 다국어 훅 + `bstage i18n pull` codegen                                          |
| [docs/SLOT_PROTOCOL.md](./docs/SLOT_PROTOCOL.md)       | 슬롯 시스템 v1 (현행)                                                           |
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
