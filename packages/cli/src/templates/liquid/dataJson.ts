interface LiquidDataJsonOptions {
  /** `public/{target}/{name}/` 의 name */
  name: string
  /** 유저 화면인지 어드민인지 — 계약이 확인된 쪽만 샘플을 채운다. */
  target: 'user' | 'admin'
}

/**
 * 로컬 미리보기용 샘플 데이터. **배포에는 나가지 않는다** — 포털이 패키징할 때 지우므로
 * 배포에 필요한 설정을 여기에 담지 않는다. 실제 값은 플랫폼이 서버에서 넣는다.
 *
 * **키 이름은 플랫폼 계약을 따른다.** 유저 화면은 `lounges`·`stories`·`contentSections`·
 * `latestContents`·`shopCategories` 다섯 개만 받는다(그 외 이름은 빈 문자열이 된다). 샘플이
 * 다른 이름을 쓰면 프리뷰에서만 그려지고 배포하면 비는데, 그 차이가 화면에 드러나지 않아
 * 찾기 어렵다 — 그래서 샘플을 계약과 같은 이름으로 둔다. 항목 안의 필드는 계약이 아니라
 * 모양을 보기 위한 예시다.
 */
export function liquidDataJson({ name, target }: LiquidDataJsonOptions): string {
  // 어드민이 무엇을 받는지는 확인되지 않았다. 유저 계약을 그대로 넣으면 **확인되지 않은 모양을
  // 사실처럼 가르치게 된다** — 빈 객체로 두고, 템플릿 주석이 첫 배포에서 확인하라고 안내한다.
  if (target === 'admin') return `${JSON.stringify({}, null, 2)}\n`

  return `${JSON.stringify(
    {
      // 플랫폼이 유저 화면에 넣는 최상위 값은 이 다섯 개다. 샘플도 같은 이름을 써야
      // 프리뷰가 배포와 같은 모양이 된다 — 다른 이름을 쓰면 로컬에서만 보인다.
      lounges: [{ handle: 'sample-lounge', name: `${name} 라운지` }],
      stories: [{ id: 'sample-story', title: '샘플 스토리' }],
      contentSections: [
        { title: '샘플 섹션', contents: [{ id: 'sample-content', title: '샘플 콘텐츠' }] },
      ],
      latestContents: [{ id: 'sample-content', title: '샘플 콘텐츠' }],
      shopCategories: [{ name: '샘플 카테고리', products: [] }],
    },
    null,
    2,
  )}\n`
}
