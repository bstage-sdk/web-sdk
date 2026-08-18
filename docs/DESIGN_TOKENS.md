# 디자인 토큰 (DESIGN_TOKENS)

bstage 커스텀 템플릿의 **색·타이포·그림자**를 bstage 디자인 시스템에 맞추기 위한 토큰 가이드. `@bstage-sdk/design` 패키지가 제공한다.

핵심 원칙은 **"이 토큰만 쓴다"** — UI 스타일을 hex/rgb로 하드코딩하지 않고 토큰으로만 표현하면, 플랫폼 디자인이 바뀌어도 템플릿이 자동으로 따라간다.

## 핵심 개념 — 값을 박지 않는다

토큰은 **이름(참조)만** 제공한다. `color.text.secondary`는 `'var(--user-mode-text-secondary)'` 문자열이다. 실제 색은 얹힌 환경의 `:root`가 결정한다.

- **배포 시**: 플랫폼이 `:root`에 깔아둔 실제 값을 상속한다. 템플릿 번들엔 값이 없다.
- **개발 시**(`bstage dev`): 플랫폼이 없으므로 SDK가 호스트 페이지 `:root`에 fallback CSS를 자동 주입한다 → 개발 중에도 기본 bstage 톤이 보인다. (상세 [DEV_SERVER.md](DEV_SERVER.md))

토큰 이름은 **FE 원본(SSOT)에서 생성**되어 프로덕션(`--user-mode-*` / `--admin-mode-*`)과 항상 일치한다.

## 타깃 선택 — 서브패스로 구분

대상 플랫폼에 맞는 서브패스를 import 한다. 두 서브패스는 API가 동일하고 접두사·테마만 다르다.

| 타깃                  | import                     | 접두사      | 테마                  |
| --------------------- | -------------------------- | ----------- | --------------------- |
| 유저(유저 플랫폼)     | `@bstage-sdk/design/user`  | `--user-*`  | 라이트/다크 자동 대응 |
| 어드민(어드민 플랫폼) | `@bstage-sdk/design/admin` | `--admin-*` | **라이트 전용**       |

`bstage init` 스캐폴드에는 `@bstage-sdk/design`가 이미 의존성에 포함된다. 기존 프로젝트라면 `npm i @bstage-sdk/design`로 추가한다. 타깃(user/admin)은 `package.json`의 `bstage.target`으로 정한다(`bstage init --target admin`이 적는다). 선언이 없으면 `user`.

## 사용

```tsx
import { color, shadow, cssVar, textStyle } from '@bstage-sdk/design/user'

function ProfileCard() {
  return (
    <div
      style={{
        background: color.surface.card,
        color: color.text.primary,
        boxShadow: shadow['default-large'],
      }}
    >
      <h3 style={textStyle('16/title/semibold')}>이름</h3>
      <p style={{ ...textStyle('14/body/reg'), color: color.text.secondary }}>소속</p>
    </div>
  )
}
```

### API

| 심볼               | 설명                                                                                               | 예시                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `color`            | 카테고리별 중첩 트리                                                                               | `color.text.secondary` → `'var(--user-mode-text-secondary)'` |
| `cssVar(slug)`     | 타입 안전한 slug 접근                                                                              | `cssVar('text/secondary')`                                   |
| `shadow`           | 그림자                                                                                             | `shadow['default-large']`                                    |
| `textStyle(token)` | 타이포그래피 인라인 스타일 객체                                                                    | `textStyle('16/title/semibold')` (admin은 `'16/title/med'`)  |
| 원자료             | `modeColors` / `flatColors` / `shadowTokens` / `typographyTokens` / `fontWeightMap` / `fontFamily` | 직접 순회가 필요할 때                                        |

`textStyle()`은 `{ fontSize, lineHeight, fontWeight, letterSpacing }`를 반환하므로 인라인 스타일에 spread 한다.

### 토큰 카테고리

색 토큰은 카테고리로 나뉜다: **bg / text / border / icon / surface / overlay / service**. **정확한 토큰 키 목록은 설치된 타입 정의를 SSOT로 본다** — 기억에 의존해 추측하지 않는다.

```
node_modules/@bstage-sdk/design/dist/user/index.d.ts    # 유저
node_modules/@bstage-sdk/design/dist/admin/index.d.ts   # 어드민
```

## 인터랙션 (hover / press)

hover·press 상태는 전용 색을 새로 만들지 말고 **overlay 토큰**을 기존 표면 위에 얹는다.

```tsx
import { color } from '@bstage-sdk/design/user'

// 예: hover 시 overlay를 배경 위에 합성
;<button style={{ background: color.bg.base }}>
  {/* hover 레이어: color.overlay['hover-a'], press 레이어: color.overlay['press-a'] */}
</button>
```

## 간격 · 라운드

간격(spacing)·모서리 반경(radius)은 **전용 토큰이 없다.** 임의 값을 남발하지 말고 **일관된 스케일**을 유지한다 — 간격은 4의 배수(4/8/12/16/24/32…)를 권장하고, radius도 프로젝트 안에서 일관된 값을 재사용한다.

## 테마 (라이트 / 다크)

- **유저**: 색 토큰이 라이트/다크에 자동 대응한다. 플랫폼 테마(`data-bspoke`)에 따라 `:root`가 값을 전환하므로 템플릿은 토큰만 쓰면 된다.
- **어드민**: 라이트 전용(다크모드 없음).

로컬 개발에서 fallback CSS를 직접 얹으려면(자동 주입은 `bstage dev`가 처리):

```css
@import '@bstage-sdk/design/css/user.css'; /* light + dark */
/* 어드민: '@bstage-sdk/design/css/admin.css' (light 전용) */
```

이 CSS는 `:root`-scoped **fallback**이며 프로덕션 번들에는 포함하지 않는다.

## 하지 말 것

- UI 색·타이포·그림자를 hex/rgb로 하드코딩하지 않는다 — 위 토큰을 쓴다.
- 토큰 값을 복사해 상수로 박지 않는다 — 값은 런타임에 `:root`가 결정한다(하드코딩 시 플랫폼 테마 변경이 반영되지 않는다).
- 토큰명을 기억에 의존해 추측하지 않는다 — 타입 정의(`.d.ts`)를 본다.

## 관련 문서

- [DEV_SERVER.md](DEV_SERVER.md) — `bstage dev`의 디자인 토큰 fallback 자동 주입
- 패키지 README: `node_modules/@bstage-sdk/design/README.md`
