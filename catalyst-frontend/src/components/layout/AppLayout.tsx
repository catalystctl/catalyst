import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import FleetHeartbeat from './FleetHeartbeat';
import DataFreshness from './DataFreshness';
import { useServerStateUpdates } from '../../hooks/useServerStateUpdates';
import { useSseAdminEvents } from '../../hooks/useSseAdminEvents';
import { useProfileSync } from '../../hooks/useProfileSync';
import { usePanelBranding } from '../../hooks/usePanelBranding';
import { useCmdK } from '../../hooks/useKeyboardShortcut';
import { Menu, X, Search } from 'lucide-react';
import SearchPalette from '../search/SearchPalette';
import { cn } from '@/lib/utils';
import UpdateNotification from '../shared/UpdateNotification';
import EnvRestartNotice from './EnvRestartNotice';
import UploadProgressIndicator from '../files/UploadProgressIndicator';
import DownloadProgressIndicator from '../files/DownloadProgressIndicator';
import { showsDemoChrome } from '../../demo/isDemo';

function AppLayout() {
  useServerStateUpdates();
  useSseAdminEvents();
  useProfileSync();
  const { t } = useTranslation('layout');
  const { panelName } = usePanelBranding();
  const { pathname } = useLocation();
  const isServerWorkspace = /^\/servers\/[^/]+/.test(pathname);

  const shortcut = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl+K';
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const wasDrawerOpen = useRef(false);

  useCmdK(() => setIsSearchOpen(true));

  useEffect(() => setIsMobileSidebarOpen(false), [pathname]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => {
      setIsMobile(media.matches);
      if (!media.matches) setIsMobileSidebarOpen(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!isMobile || !isMobileSidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileSidebarOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobile, isMobileSidebarOpen]);

  // Announce client-side route changes to keyboard and screen-reader users.
  const initialPath = useRef(pathname);
  useEffect(() => {
    if (pathname === initialPath.current) return;
    initialPath.current = pathname;
    const frame = requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>('#main-content h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  // The sections dialog and the drawer share z-50: the sidebar closes the
  // drawer before opening the dialog so the two never stack on mobile.
  // (Only the drawer-close half lives here; the dialog overlay/content is
  // owned by the dialog component.)
  useEffect(() => {
    const close = () => setIsMobileSidebarOpen(false);
    window.addEventListener('catalyst:close-mobile-nav', close);
    return () => window.removeEventListener('catalyst:close-mobile-nav', close);
  }, []);

  // Move focus into the drawer on open; return it to the menu button on
  // close when focus was inside the drawer.
  useEffect(() => {
    if (isMobileSidebarOpen && !wasDrawerOpen.current) {
      drawerCloseRef.current?.focus();
    } else if (!isMobileSidebarOpen && wasDrawerOpen.current) {
      const drawer = document.getElementById('mobile-sidebar');
      if (drawer?.contains(document.activeElement)) menuButtonRef.current?.focus();
    }
    wasDrawerOpen.current = isMobileSidebarOpen;
  }, [isMobileSidebarOpen]);

  // The cabinet rail's search button lives in a different subtree to the
  // palette, so it signals through a window event.
  useEffect(() => {
    const open = () => setIsSearchOpen(true);
    window.addEventListener('catalyst:open-search', open);
    return () => window.removeEventListener('catalyst:open-search', open);
  }, []);

  return (
    // Demo builds render a fixed h-8 banner above everything: shift the shell
    // below it and shrink to fit so nothing overlaps and no page scroll appears.
    <div className={cn('app-shell flex font-sans', showsDemoChrome ? 'mt-8 h-[calc(100dvh-2rem)]' : 'h-[100dvh]')}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:m-2 focus:rounded-sm focus:bg-card focus:px-3 focus:py-2 focus:text-foreground">{t('shell.skipToContent')}</a>
      {/* Mobile overlay */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-surface-0/60 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
          role="presentation"
          aria-hidden="true"
        />
      )}

      {/* Mobile header */}
      <div inert={isMobile && isMobileSidebarOpen} className={cn('fixed left-0 right-0 z-30 flex h-12 items-center justify-between border-b border-border/70 bg-card px-3 lg:hidden', showsDemoChrome ? 'top-8' : 'top-0')}>
        <button
          type="button"
          ref={menuButtonRef}
          onClick={() => setIsMobileSidebarOpen(true)}
          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={t('shell.openMenu')}
          aria-expanded={isMobileSidebarOpen}
          aria-controls="mobile-sidebar"
        >
          <Menu className="h-4 w-4" />
        </button>
        <span className="flex items-center gap-2">
          <span className="deck-hatch h-[3px] w-5" aria-hidden />
          <span className="font-display text-mini font-semibold uppercase tracking-[0.18em] text-foreground">
            {panelName}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setIsSearchOpen(true)}
          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={t('common:actions.search')}
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* Cabinet rail (desktop) / drawer (mobile) */}
      <div
        ref={sidebarRef}
        id="mobile-sidebar"
        role={isMobile && isMobileSidebarOpen ? 'dialog' : undefined}
        aria-modal={isMobile && isMobileSidebarOpen ? true : undefined}
        aria-label={isMobile && isMobileSidebarOpen ? panelName : undefined}
        inert={isMobile && !isMobileSidebarOpen}
        className={cn(
          'fixed left-0 z-50 shrink-0 transform transition-transform duration-200 ease-standard lg:static lg:transform-none',
          showsDemoChrome ? 'top-8 bottom-0 z-[70]' : 'inset-y-0',
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <button
          type="button"
          ref={drawerCloseRef}
          onClick={() => setIsMobileSidebarOpen(false)}
          className="absolute right-2 top-3 z-50 flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:hidden"
          aria-label={t('shell.closeMenu')}
        >
          <X className="h-4 w-4" />
        </button>
        <Sidebar hideCollapseOnMobile />
      </div>

      <main
        inert={isMobile && isMobileSidebarOpen}
        id="main-content"
        className={cn(
          'relative flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-[calc(3rem+env(safe-area-inset-top))] lg:px-6',
          isServerWorkspace ? 'pb-3 lg:pb-3 lg:pt-3' : 'lg:pb-6 lg:pt-4',
        )}
      >
        <div
          className={cn(
            'mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col',
            isServerWorkspace ? 'gap-2' : 'gap-3',
          )}
        >
          {/* Marquee — the cabinet gesture: wayfinding, fleet health, search */}
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 pb-2">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="deck-hatch hidden h-4 w-1 shrink-0 lg:block" aria-hidden />
              <Breadcrumbs />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <DataFreshness />
              <FleetHeartbeat />
              <button
                type="button"
                onClick={() => setIsSearchOpen(true)}
                className="hidden h-7 min-w-48 shrink-0 items-center gap-2 rounded-sm border border-border/70 bg-card px-3 text-mini text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:flex"
                aria-label={t('shell.openSearch', { shortcut })}
              >
                <Search className="h-3.5 w-3.5" />
                <span className="flex-1 text-left">{t('shell.searchButton')}</span>
                <kbd className="hidden rounded-sm border border-border/70 bg-surface-2/80 px-1.5 py-0.5 font-mono text-micro text-muted-foreground sm:inline-block">
                  {shortcut}
                </kbd>
              </button>
            </div>
          </header>
          {/* In the shell flow, directly under the marquee: a fixed flyout here
              overlapped the marquee/search and clipped page primary actions. */}
          <UpdateNotification />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </main>

      <SearchPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <EnvRestartNotice />
      <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col gap-2 lg:bottom-6 lg:right-6">
        <UploadProgressIndicator />
        <DownloadProgressIndicator />
      </div>
    </div>
  );
}

export default AppLayout;
