/**
 * 차트 색.
 *
 * lightweight-charts 는 canvas 에 그리므로 CSS 변수를 그대로 못 쓴다.
 * 여기 값들은 `globals.css` 의 `@theme` 토큰(oklch)을 sRGB 로 옮긴 것이다.
 * 토큰을 바꾸면 이 파일도 같이 손봐야 한다.
 */
export const CHART_COLORS = {
  /** --color-bull */
  bull: '#3ad195',
  bullTransparent: 'rgba(58, 209, 149, 0.45)',
  /** --color-bear */
  bear: '#f0563f',
  bearTransparent: 'rgba(240, 86, 63, 0.45)',
  /** --color-fg-muted */
  text: '#b4b7bd',
  /** --color-fg-dim */
  textDim: '#85888f',
  /** --color-hairline */
  grid: '#2a2d34',
  /** --color-amber */
  accent: '#f0b25c',
} as const;

export const CHART_FONT_FAMILY =
  'ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace';
