import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'

export interface VitePresetOptions {
  /** Entry file path (default: 'src/index.tsx') */
  entry?: string
  /** Output directory (default: 'dist') */
  outDir?: string
}

export { bstageDevPlugin, type BstageDevPluginOptions } from '../dev/devVitePlugin.js'

/**
 * bstage 템플릿 빌드용 Vite 설정 프리셋을 생성한다.
 *
 * `<script>` 태그로 로드 가능한 IIFE 번들(`template.js`)을 출력.
 * React를 번들에 포함(외부화하지 않음). CSS는 Shadow DOM 주입을 위해 JS에 인라인.
 */
export function createViteConfig(options: VitePresetOptions = {}): UserConfig {
  return defineConfig({
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    resolve: {
      dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
    },
    build: {
      lib: {
        entry: options.entry ?? 'src/index.tsx',
        formats: ['iife'],
        name: 'BstageTemplate',
        fileName: () => 'template.js',
      },
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
      outDir: options.outDir ?? 'dist',
      copyPublicDir: false,
    },
  })
}
