/**
 * Composer visibility vs menu overlay — pure deterministic rule.
 *
 * Source of truth lives in AppContent:
 * - userCollapsed  = existing `isFooterCollapsed` (chevron toggle)
 * - mobileMenuOpen = existing `showSidebar` on mobile (menu/settings overlay)
 *
 * Overlay open => composer collapsed. Closing the overlay never forces an
 * expand: the user's own collapsed state is preserved as-is.
 */
export function resolveComposerCollapsed(
  userCollapsed: boolean,
  mobileMenuOpen: boolean,
): boolean {
  return userCollapsed || mobileMenuOpen;
}

export type ComposerMode = 'compact' | 'expanded';

/**
 * Composer layout mode — pure derivation from the draft text only.
 *
 * - compact:  single logical line → one horizontal row.
 * - expanded: explicit newlines → text occupies the upper area and the
 *   control row anchors at the bottom of the same container.
 *
 * Logical lines (not visual wraps) drive the mode so the condition is
 * layout-independent: switching modes can never oscillate, and wrapped
 * long text keeps the stable compact row while growing vertically.
 */
export function getComposerMode(value: string): ComposerMode {
  return value.split('\n').length > 1 ? 'expanded' : 'compact';
}
