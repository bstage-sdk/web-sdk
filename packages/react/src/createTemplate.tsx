import { createElement, type ComponentType } from 'react'
import type { SlotIdV2, TemplateOptions } from '@bstage-sdk/core'

/** createTemplate이 생성하는 메타데이터. 빌드 파이프라인이 산출물 경로를 정하는 데 사용한다. */
export interface BstageMeta {
  name: string
  /** Custom Element 태그명. `name`과 동일. `customElements.define`이 사용하는 식별자. */
  elementName: string
  framework: string
  /** 위젯이 들어갈 슬롯 id. 페이지에는 없다. */
  slot?: SlotIdV2
  type?: string
}

/** {@link createTemplate} 옵션. name 필수. */
export interface CreateTemplateOptions extends Omit<TemplateOptions, 'slot'> {
  /**
   * 이 위젯이 들어갈 슬롯 id. `src/slots/` 아래 템플릿만 지정한다.
   *
   * 카탈로그(`SLOT_CATALOG_V2`)의 id로 좁혀 두어 편집기에서 자동완성이 뜬다.
   * 페이지(`src/pages/`)는 폴더 구조가 배포 경로를 정하므로 이 옵션을 쓰지 않는다.
   */
  slot?: SlotIdV2
  /** Shadow DOM에 주입할 inline CSS 문자열. `index.css?inline` import 값을 전달한다. */
  styles?: string
}

/** bstage 메타데이터가 첨부된 React 컴포넌트. `<Template />` 형태로 직접 렌더링 가능. */
export type BstageTemplateComponent<P = any> = ComponentType<P> & {
  __bstage_meta__: BstageMeta
  __bstage_options__: CreateTemplateOptions
  __bstage_inner__: ComponentType<P>
}

/**
 * @internal 빌드 파이프라인 전용. 직접 사용하지 마세요.
 */
export const __bstage_registry__ = new Set<BstageTemplateComponent>()

/**
 * React 컴포넌트로부터 bstage 템플릿 컴포넌트를 생성한다.
 *
 * bstage 메타데이터가 첨부된 React 컴포넌트를 반환.
 * WC 등록은 빌드 파이프라인에서 별도로 처리.
 */
export function createTemplate(
  Component: ComponentType<any>,
  options: CreateTemplateOptions,
): BstageTemplateComponent {
  const { name } = options
  validateElementName(name)
  const meta: BstageMeta = {
    name,
    elementName: name,
    framework: 'react',
    ...(options.slot && { slot: options.slot }),
    ...(options.type && { type: options.type }),
  }

  // 래퍼 컴포넌트 — 원본 컴포넌트를 그대로 렌더링
  function TemplateWrapper(props: any) {
    return createElement(Component, props)
  }

  TemplateWrapper.displayName = `BstageTemplate(${name})`
  TemplateWrapper.__bstage_meta__ = meta
  TemplateWrapper.__bstage_options__ = options
  TemplateWrapper.__bstage_inner__ = Component

  const wrapper = TemplateWrapper as BstageTemplateComponent
  __bstage_registry__.add(wrapper)

  return wrapper
}

/** Custom Element 스펙: 소문자로 시작 + 최소 1개 하이픈 + 소문자·숫자·하이픈만 허용. */
const ELEMENT_NAME_RE = /^[a-z][a-z0-9-]*-[a-z0-9-]*$/

function validateElementName(name: string): void {
  if (!ELEMENT_NAME_RE.test(name)) {
    throw new Error(
      `createTemplate: 잘못된 name "${name}". Custom Element 스펙상 소문자로 시작하고 하이픈을 1개 이상 포함해야 하며, 소문자·숫자·하이픈만 사용할 수 있습니다. 예: "bmf-hello"`,
    )
  }
}
