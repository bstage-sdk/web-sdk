/**
 * 로드한 템플릿에 대해 호스트가 아는 것.
 *
 * `bstage build`가 manifest.json을 만들던 시절에는 sdkVersion·framework·entry도 함께 실렸지만,
 * 호스트가 실제로 쓰는 값은 태그명 하나뿐이었다. 지금은 번들이 로드되면서 스스로 알린다.
 */
export interface TemplateInfo {
  /**
   * Custom Element 태그명. 템플릿이 `createTemplate({ name })`에 넣은 값 그대로.
   * `customElements.define`과 `document.createElement`가 사용하는 load-bearing 식별자.
   */
  elementName: string
}

export interface LoadTemplateOptions {
  /** 스크립트 로드 타임아웃 (밀리초 단위, 기본값: 10,000) */
  timeout?: number
}
