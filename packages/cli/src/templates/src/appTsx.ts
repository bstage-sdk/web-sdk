/**
 * 유저 dev 진입점의 화면(`src/App.tsx`).
 *
 * `main.tsx`에서 갈라져 나온 이유: 한 파일에 컴포넌트를 두면서 export가 하나도 없으면
 * `react-refresh/only-export-components`가 "Fast refresh only works when a file has exports"로
 * 막는다. 스캐폴드가 만든 프로젝트가 첫 `npm run lint`부터 실패하던 원인이었다.
 * Vite React 기본 템플릿과 같은 모양(main은 마운트만, App이 화면)으로 맞췄다.
 */
interface AppTsxOptions {
  hasApiKey: boolean
}

export function appTsx({ hasApiKey }: AppTsxOptions): string {
  const apiKeyGuide = hasApiKey
    ? ''
    : `
            <li><code>src/shared/client.ts</code>에 API 키를 설정하면 b.stage API를 사용할 수 있습니다.</li>
            <li>API 키가 허용된 환경에 맞춰 <code>.env</code>의 <code>VITE_BSTAGE_PHASE</code>를 설정해야 합니다.</li>`

  return `import { useState, useEffect, type ComponentType } from 'react'

/* import.meta.glob으로 모든 템플릿을 자동 감지 */
/* 페이지는 중첩 폴더가 그대로 배포 경로가 되므로 \`**\`로 훑는다. */
const modules = import.meta.glob<{ default?: ComponentType; [key: string]: unknown }>([
  './pages/**/template.tsx',
  './slots/**/template.tsx',
])

/**
 * glob 경로에서 미리보기 주소를 뽑는다.
 * ./pages/settings/custom/template.tsx → pages/settings/custom
 * ./slots/curation-banner/template.tsx → slots/curation-banner
 *
 * src/ 아래 경로를 그대로 쓰는 이유: 페이지와 위젯이 같은 이름을 써도 겹치지 않고,
 * 목록 화면(/)과도 부딪히지 않는다.
 */
function parseName(path: string): string {
  const match = path.match(/\\.\\/((?:pages|slots)(?:\\/.+)?)\\/template\\.tsx$/)
  return match?.[1] ?? path
}

const templateEntries = Object.entries(modules)
  .map(([path, loader]) => ({ name: parseName(path), loader }))
  .sort((a, b) => a.name.localeCompare(b.name))

/** 템플릿 목록 + 시작 안내 */
function TemplatePicker() {
  return (
    <div style={{ maxWidth: 520, margin: '60px auto', padding: '0 24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>b.stage Templates</h1>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>템플릿 목록</h2>
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {templateEntries.map(({ name }) => (
            <li key={name}>
              <a
                href={\`/\${name}\`}
                style={{
                  display: 'block',
                  padding: '12px 16px',
                  border: '1px solid #e2e2e2',
                  borderRadius: 8,
                  textDecoration: 'none',
                  color: '#111',
                  fontWeight: 500,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {name}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>시작하기</h2>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, color: '#444', fontSize: 14 }}>
          <li>위 템플릿을 클릭하여 렌더링 결과를 확인하세요.</li>
          <li>페이지는 <code>src/pages/{'{경로}'}/template.tsx</code> — 폴더 구조가 곧 배포 경로입니다.</li>
          <li>위젯은 <code>src/slots/{'{아무이름}'}/template.tsx</code> — 자리는 <code>slot</code> 옵션이 정합니다.</li>${apiKeyGuide}
        </ol>
      </section>

      <p style={{ fontSize: 13, color: '#999' }}>
        인증이 필요한 API를 테스트하려면{' '}
        <a href="/__bstage__/login" style={{ color: '#999' }}>로그인</a>
        하세요.
      </p>
    </div>
  )
}

export default function App() {
  const [Component, setComponent] = useState<ComponentType | null>(null)
  const pathname = location.pathname.replace(/^\\//, '')

  useEffect(() => {
    if (!pathname) return
    const entry = templateEntries.find((e) => e.name === pathname)
    if (!entry) return
    entry.loader().then((mod) => {
      /* createTemplate은 default export 또는 첫 번째 export된 컴포넌트 */
      const Comp = mod.default ?? (Object.values(mod).find((v) => typeof v === 'function') as ComponentType)
      if (Comp) setComponent(() => Comp)
    })
  }, [pathname])

  if (!pathname) return <TemplatePicker />
  if (!Component) return <p style={{ padding: 24 }}>Loading...</p>
  return <Component />
}
`
}
