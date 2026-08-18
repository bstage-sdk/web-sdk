/**
 * 유저 dev 진입점(`src/main.tsx`) — 마운트만 한다.
 *
 * 화면은 `src/App.tsx`에 있다. 한 파일에 두면 export 없는 컴포넌트 파일이 되어
 * `react-refresh/only-export-components`가 lint를 막는다 (`appTsx.ts` 주석 참조).
 */
export function mainTsx(): string {
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`
}
