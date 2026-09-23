# liquid 템플릿 가이드

`.liquid` 템플릿으로 b.stage 페이지를 만드는 방법입니다. React(sdk) 방식은 [GETTING_STARTED.md](./GETTING_STARTED.md)를 참고하세요.

## 1. liquid 방식이란

플랫폼(서버)이 데이터를 넣어 렌더하는 [liquidjs](https://liquidjs.com/) 템플릿입니다. 브라우저에서 번들을 실행하지 않으므로 **빌드 산출물이 없습니다** — 포털이 push된 커밋의 템플릿 파일을 그대로 패키징합니다.

| 항목        | sdk                                         | liquid                                    |
| ----------- | ------------------------------------------- | ----------------------------------------- |
| 작성 대상   | React 컴포넌트 (`template.tsx`)             | `.liquid` 템플릿 (`template.liquid`)      |
| 렌더 시점   | 브라우저 (Web Component)                    | 서버 (플랫폼이 데이터를 넣어 렌더)        |
| 배치 가능   | 페이지(PAGE) · 위젯(SLOT)                   | 페이지(PAGE)만                            |
| 로컬 산출물 | `dist/{경로}/template.js`                   | 없음 (검증만)                             |
| 의존성      | core · react · design + Vite · 타입스크립트 | 저작 도구 `@bstage-sdk/cli` 하나 |

- **페이지 단위로만** 배치합니다. 슬롯(위젯) 자리에는 쓸 수 없습니다 — `bstage deploy`가 위젯 배치를 발견하면 빌드를 만들기 전에 사전조건 오류(종료 코드 2)로 끊습니다.
- **한 레포에 sdk와 섞지 않습니다.** `src/**/template.tsx`와 liquid 템플릿이 함께 있으면 포털 빌더가 패키징하지 못합니다.

## 2. 시작

```bash
npx @bstage-sdk/cli@latest init --kind liquid
```

대화형에서는 첫 질문("어떤 방식으로 만들까요?")에서 `liquid`를 고릅니다. 비인터랙티브는 `--yes --kind liquid --space demo --target user` 형태입니다. 생성되는 파일 목록은 [INIT.md §4.2](./INIT.md#42-liquid-프로젝트---kind-liquid)에 있습니다.

```
public/
└── user/                    # 또는 admin — 첫 템플릿의 target
    └── hello/
        ├── template.liquid  # 템플릿 본문 (파일명 고정)
        └── data.json        # 로컬 미리보기용 샘플 값 (배포에 나가지 않음)
```

- **이름 규칙**: 소문자로 시작하고 소문자·숫자·하이픈만 씁니다(`^[a-z][a-z0-9-]*$`). CDN 경로 세그먼트가 되므로 대문자를 쓰면 대소문자를 구분하지 않는 파일시스템에서 로컬과 배포가 갈립니다.
- **한 세그먼트**여야 합니다. `public/user/events/summer/`처럼 한 단계 더 깊으면 포털이 조용히 무시합니다.
- `data.json`은 로컬 전용입니다. 실제 값은 플랫폼이 서버에서 넣습니다. **키 이름은 플랫폼 계약을 따라야 합니다** — 유저 화면 최상위는 `lounges`·`stories`·`contentSections`·`latestContents`·`shopCategories` 다섯 개입니다. 다른 이름을 쓰면 프리뷰에서만 그려지고 배포하면 빕니다. 각 항목의 필드는 계약이 아니라 모양을 보기 위한 예시이므로 실제 렌더 결과로 확인하세요. 어드민 화면이 받는 값은 확인되지 않았습니다.
- 스캐폴드는 Vite·TypeScript·ESLint·`.env`를 만들지 않습니다. 번들링도 타입 검사도 하지 않기 때문입니다.

## 3. 로컬 미리보기 — `bstage dev`

```bash
npm run dev            # = bstage dev
bstage dev -p 3000     # 포트 지정 (기본 5173)
```

레포 종류는 파일 구조로 자동 판정하므로 옵션을 따로 주지 않습니다. liquid 레포면 Vite 대신 Node `http` + liquidjs 프리뷰가 뜨고, 항상 루프백(`127.0.0.1`)에만 바인딩합니다.

| 경로                | 화면                                         |
| ------------------- | -------------------------------------------- |
| `/`                 | user · admin 템플릿 개수와 규약 밖 파일 목록 |
| `/user`             | user 템플릿 목록                             |
| `/admin`            | admin 템플릿 목록                            |
| `/{surface}/{이름}` | 같은 폴더의 `data.json`으로 렌더한 결과      |
| 그 밖의 경로        | `public/` 아래 정적 파일 (없으면 404)        |

- 파일을 고치면 **자동으로 새로고침**됩니다(프리뷰가 넣는 SSE 스크립트 — 배포물과 무관합니다).
- 렌더가 실패하면 파일·줄 번호·메시지를 보여 주는 **오류 페이지**가 200으로 뜹니다. 고치는 즉시 리로드로 복구됩니다.
- 규약을 벗어난 `template.liquid`도 목록에 보여 주되 "포털이 무시합니다"라고 표시합니다.

**프리뷰에 없는 것**: 인증 프록시 · API 프록시 · phase · 실데이터. `--phase`를 줘도 무시한다는 안내만 출력합니다. 상세는 [DEV_SERVER.md §7](./DEV_SERVER.md#7-liquid-프리뷰-liquid-레포)을 참고하세요.

## 4. 검증 — `bstage build` · `bstage doctor`

liquid 레포에는 빌드 단계가 없으므로 `bstage build`는 **검증만** 합니다. 오류가 하나라도 있으면 종료 코드 2입니다.

```bash
npm run build          # = bstage build
bstage build --json    # { "kind": "liquid", "issues": [...] } 한 덩어리
```

| 등급  | 검사                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| error | `template.liquid` 문법 오류(줄 번호 표시) · `data.json` JSON 파싱 실패 · 폴더 이름 규칙 위반 · sdk 템플릿과 혼재 · liquid 템플릿 0개 |
| warn  | 규약 밖 위치의 `template.liquid`(포털이 무시) · `layout.json` 존재(포털이 지움) · 폴더에 `template.liquid`가 아닌 파일만 있음        |

같은 결과를 `bstage doctor`가 "liquid 검증" 절에서 보여 줍니다(`--json`에서는 `liquid.issues`). doctor의 liquid 표는 sdk와 다릅니다 — 기대 파일은 템플릿 루트(`public/user` 또는 `public/admin`)와 `AGENTS.md`, 기대 스크립트는 `dev`·`build`이고, 권장 의존성 절은 나오지 않습니다. 버전 표도 `@bstage-sdk/cli` 한 줄뿐입니다.

## 5. 배포

포털이 push된 커밋의 `public/{user|admin}/{이름}/`을 **그대로 패키징합니다**(`data.json`·`layout.json`은 제외 — 배치는 관리도구가 소유합니다). 로컬 산출물은 올라가지 않으므로 커밋·push가 먼저입니다.

1. **첫 배포는 포털 화면에서** 합니다 — 레포 연결 → 빌드 → 페이지 배치 생성.
2. 이후에는 터미널에서 `bstage deploy`(빌드 → 라이브 적용) · `bstage rollback`(이전 성공 빌드로 되돌리기) · `bstage publish on|off`(게시 토글)를 씁니다. 로그인·링크·종료 코드 등 공통 절차는 sdk와 같습니다 — [GETTING_STARTED.md §9](./GETTING_STARTED.md#9-배포)를 참고하세요.
3. `bstage list`는 최근 빌드의 산출물 종류(`sdk`·`liquid`) 열을 함께 보여 줍니다. 옛 빌드에는 이 값이 없어 `-`로 나옵니다.

## 6. 이미지·영상 넣기

**포털 화면의 스테이지 > 미디어에 올리고, 받은 URL을 템플릿에 절대 주소로 넣습니다.** 이미지와 영상만 올릴 수 있고, 허용 형식·용량 한도는 업로드할 때 화면이 알려 줍니다.

레포에 파일을 두고 상대 경로로 참조하면 **배포 후 깨집니다.** 포털은 템플릿 폴더를 그대로 복사하지만, 렌더된 HTML이 스페이스 도메인 페이지 안으로 들어가므로 상대 경로는 그 도메인 기준으로 풀리고 산출물이 놓인 주소를 가리키지 않습니다.

로컬 프리뷰는 이 점에서 배포와 **반대로** 동작합니다. 프리뷰는 템플릿 폴더의 파일을 함께 서빙하므로 상대 경로 이미지가 잘 보입니다. 프리뷰에서 보였다는 것을 배포에서도 되리라는 근거로 삼지 마세요.

## 7. liquidjs 문법 요점

```liquid
{{ title }}                              변수 출력 (없는 값은 빈 문자열)
{{ title | default: '제목 없음' }}        기본값
{{ name | upcase }} · {{ price | plus: 1000 }}   필터
{% if items.size > 0 %} ... {% else %} ... {% endif %}
{% for item in items %}{{ item.name }}{% endfor %}
{% assign total = price | times: quantity %}
{% comment %} 렌더되지 않는 주석 {% endcomment %}
```

- 없는 값은 오류가 아니라 **빈 문자열**로 렌더됩니다(플랫폼과 같은 설정). 화면이 비어 보이면 값 이름을 먼저 의심하세요.
- `{% render %}`·`{% include %}`의 탐색 루트는 `public/`입니다. 그 밖의 파일은 불러올 수 없습니다.
- 전체 문법은 [liquidjs 공식 문서](https://liquidjs.com/)를 참고하세요.

## 8. 함정

- **sdk와 섞지 않습니다.** 섞이면 `bstage dev`·`build`·`deploy`가 종료 코드 2로 멈추고 포털 빌드도 실패합니다.
- **깊이가 규약입니다.** `public/{user|admin}/{이름}/template.liquid`, 정확히 이 자리만 인정됩니다. 어긋나면 빌드는 성공하는데 화면에 나오지 않습니다.
- **페이지(PAGE) 배치만** 됩니다. 위젯 자리에 붙이면 포털이 400을 냅니다.
- **`data.json`·`layout.json`은 로컬 전용입니다.** 포털이 패키징에서 지우므로 배포에 필요한 값을 여기에 담지 마세요.
- **파일명은 `template.liquid` 고정입니다.** `index.html`처럼 다른 이름이면 포털이 그 폴더를 템플릿으로 보지 않습니다.
- **에셋을 레포에 두고 상대 경로로 참조하지 않습니다.** 배포 후 깨집니다 — 6절을 참고하세요. 로컬 프리뷰에서는 보이므로 프리뷰 결과가 근거가 되지 않습니다.
- **플랫폼이 넣는 값의 이름을 지어내지 않습니다.** 유저 화면 최상위는 `lounges`·`stories`·`contentSections`·`latestContents`·`shopCategories` 다섯 개뿐이고, 그 밖의 이름은 빈 문자열이 됩니다(어드민 화면이 받는 값은 확인되지 않았습니다). `data.json` 샘플도 같은 이름을 써야 프리뷰가 배포와 같은 모양이 됩니다.
