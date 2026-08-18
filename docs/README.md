# bstage Template SDK 문서

b.stage 서드파티 템플릿 SDK의 기술 문서입니다. React 컴포넌트를 Web Component로 빌드하는 과정과, 빌드 산출물이 b.stage 플랫폼에서 로드·실행되는 방식을 다룹니다. (배포 파이프라인은 관리도구에서 다룹니다.)

## 문서 구성

| 문서                                         | 설명                                                                                | 대상                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [GETTING_STARTED.md](./GETTING_STARTED.md)   | 프로젝트 생성부터 로컬 실행까지                                                     | 처음 시작하는 개발자                                        |
| [SDK_ARCHITECTURE.md](./SDK_ARCHITECTURE.md) | 설계 원칙, 패키지 구조, 핵심 추상화                                                 | SDK 구조를 이해하고 싶은 개발자                             |
| [API_REFERENCE.md](./API_REFERENCE.md)       | Core, React, Host 패키지의 public API                                               | API 시그니처를 확인하고 싶은 개발자                         |
| [BUILD_SYSTEM.md](./BUILD_SYSTEM.md)         | 빌드 파이프라인, Vite 설정, 산출물 경로 규칙                                        | 빌드 산출물을 이해하고 싶은 개발자                          |
| [DEV_SERVER.md](./DEV_SERVER.md)             | 로컬 개발 서버의 인증 프록시와 요청 흐름                                            | 로컬 개발 환경을 이해하고 싶은 개발자                       |
| [INIT.md](./INIT.md)                         | `bstage init` 명령어의 프롬프트, 생성 파일, 옵션                                    | init 동작을 상세히 알고 싶은 개발자                         |
| [I18N.md](./I18N.md)                         | 다국어 훅(useLocale/useMessages/useBstageTranslations) + `bstage i18n pull` codegen | 템플릿에 다국어를 적용하려는 개발자                         |
| [MIGRATION.md](./MIGRATION.md)               | 버전 사이 소비자 마이그레이션 가이드                                                | 오래된 프로젝트를 최신 SDK로 올리려는 개발자                |
| [SLOT_PROTOCOL.md](./SLOT_PROTOCOL.md)       | **슬롯 시스템 v1**(현행). 3-part 키·context 단방향·위젯 독립                        | 슬롯 템플릿을 개발하거나 플랫폼 통합을 이해하고 싶은 개발자 |
| [SLOT_SYSTEM.md](./SLOT_SYSTEM.md)           | 옛 슬롯 시스템 아키텍처 (공존 기간 참조용)                                          | 레거시 슬롯을 이해해야 하는 개발자                          |
| [SLOT_CATALOG.md](./SLOT_CATALOG.md)         | 옛 슬롯 목록, 이벤트 인터페이스, resourceId 의미 (공존 기간 참조용)                 | 레거시 슬롯별 스펙을 확인해야 하는 개발자                   |

## 읽는 순서

1. **처음 시작한다면** — [GETTING_STARTED.md](./GETTING_STARTED.md)를 따라 프로젝트를 생성하고 로컬에서 실행해 보세요.
2. **SDK가 어떻게 동작하는지 궁금하다면** — [SDK_ARCHITECTURE.md](./SDK_ARCHITECTURE.md)에서 설계 원칙과 핵심 개념을 확인하세요.
3. **API를 찾고 싶다면** — [API_REFERENCE.md](./API_REFERENCE.md)에서 각 패키지의 public API를 확인하세요.
