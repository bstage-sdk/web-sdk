interface TemplateOptions {
  name: string
}

export function templateTsx({ name }: TemplateOptions): string {
  const componentName =
    name.charAt(0).toUpperCase() + name.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())

  return `import { createTemplate } from '@bstage-sdk/react'
// import { useNavigation, useBstageContext } from '@bstage-sdk/react'
// import { client } from '../../shared/client'
// CSS 파일을 쓰려면 ?inline으로 문자열을 가져와 아래 styles에 넘긴다.
// 부수효과 import(\`import './x.css'\`)는 배포 산출물에서 사라진다.
// import css from '../../index.css?inline'

export default function ${componentName}Template() {
  // ── 플랫폼 네비게이션 ──
  // const { navigate, goBack, openExternal } = useNavigation()
  // navigate('/profile', { userId: '123' })

  // ── PlatformBridge 직접 접근 ──
  // const { bridge } = useBstageContext()
  // bridge.emit('toast', { message: '저장 완료', variant: 'success' })

  // ── API 호출 (shared/client.ts의 인스턴스를 직접 import해 사용) ──
  // useEffect(() => {
  //   client.get('/content/v1/boards').then(res => console.log(res.data))
  // }, [])

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Hello, ${name}!</h1>
    </div>
  )
}

createTemplate(${componentName}Template, {
  name: '${name}',
  // styles: css,   // Shadow DOM에 주입 (위 ?inline import와 함께 사용)
})
`
}
