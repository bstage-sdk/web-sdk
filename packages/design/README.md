# @bstage-sdk/design

bstage 커스텀 템플릿을 bstage 디자인 시스템에 맞추기 위한 **디자인 토큰**을 제공한다.

- 토큰 **이름**만 제공한다(값은 복붙하지 않는다). 배포 시엔 플랫폼이 `:root`에 깔아둔 실제 값을 상속하고, 개발 중엔 이 패키지의 fallback CSS가 기본 bstage 톤을 보여준다.
- 토큰 이름은 **FE 원본(SSOT)에서 생성**되어 프로덕션과 항상 일치한다 (`--user-mode-*` / `--admin-mode-*`).

> 값 배선(`bstage dev` 주입·프로덕션 제외)과 디자인 가이드(`AGENTS.md`) 통합은 별도 문서에서 다룬다.

## 타깃 선택 — 서브패스로 구분

유저 / 어드민 중 대상에 맞는 서브패스를 import 한다.

```ts
import { color, shadow, textStyle, cssVar } from '@bstage-sdk/design/user'
// 어드민: '@bstage-sdk/design/admin'
```

## 사용

```tsx
import { color, textStyle } from '@bstage-sdk/design/user'

function ProfileCard() {
  return (
    <div style={{ background: color.surface.card, color: color.text.primary }}>
      <h3 style={textStyle('16/title/semibold')}>이름</h3>
      <p style={{ ...textStyle('14/body/reg'), color: color.text.secondary }}>소속</p>
    </div>
  )
}
```

- **`color`** — 카테고리별 중첩. `color.text.secondary` → `'var(--user-mode-text-secondary)'`
- **`shadow`** — `shadow['default-large']` → `'var(--user-mode-shadow-default-large)'`
- **`cssVar(slug)`** — 타입 안전 접근. `cssVar('text/secondary')`
- **`textStyle(token)`** — 타이포그래피 인라인 스타일. user는 `'16/title/semibold'`, admin은 `'16/title/med'`
- **원자료**: `modeColors` / `flatColors` / `shadowTokens` / `typographyTokens` / `fontWeightMap` / `fontFamily`

값은 `var(--...)` 참조라, 실제 색은 얹힌 환경의 `:root`가 결정한다(배포=플랫폼, 개발=fallback CSS).

## CSS fallback

개발/미리보기에서 bstage 톤을 보려면 fallback CSS를 호스트 `:root`에 깐다(자세한 자동 주입은 `bstage dev`):

```css
@import '@bstage-sdk/design/css/user.css'; /* light + dark */
/* 어드민: '@bstage-sdk/design/css/admin.css' (light 전용) */
```

이 CSS는 `:root`-scoped **fallback** 이다(`:host` 하드 주입 없음). 프로덕션 번들에는 포함하지 않는다.

## 토큰 갱신 (유지보수자용)

토큰은 손으로 관리하지 않는다. b.stage 디자인 시스템 원본(SSOT)에서 생성해
`src/{user,admin}/tokens.generated.ts`로 커밋한다. 원본이 이 저장소에 없으므로 생성 자체는
빌드에 포함하지 않고, 산출물만 두어 값이 프로덕션과 어긋나지 않게 한다.
