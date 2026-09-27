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
