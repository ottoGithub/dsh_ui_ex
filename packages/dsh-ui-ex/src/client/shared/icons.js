/**
 * Shared glyphs, so every feature draws the same marks the shipped UI draws.
 *
 * The pin geometry is the Fluent 16px pushpin the Session rows use; keeping one
 * copy here is what makes a workspace pin look exactly like a Session pin.
 *
 * @module ui-ex/client/shared/icons
 */

/** Fluent pushpin body, 16×16 viewBox. */
const UI_EX_PIN_BODY = 'M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z'

/** Fluent pushpin needle, 16×16 viewBox. */
const UI_EX_PIN_NEEDLE = 'M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z'

const uiExIcons = {
  /**
   * The pushpin, in the same two states the Session rows use.
   * @param options - `{ filled }`: filled marks a pinned target.
   * @param size - rendered edge length in pixels.
   * @returns the icon element.
   */
  pin(options, size = 16) {
    const filled = options !== undefined && options !== null && options.filled === true
    return React.createElement(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        strokeWidth: 1,
        'aria-hidden': true,
        style: { display: 'block' },
      },
      React.createElement('path', {
        d: UI_EX_PIN_BODY,
        fill: filled ? 'currentColor' : 'none',
        stroke: 'currentColor',
        strokeLinejoin: 'round',
      }),
      React.createElement('path', { d: UI_EX_PIN_NEEDLE, fill: 'currentColor' }),
    )
  },
}
