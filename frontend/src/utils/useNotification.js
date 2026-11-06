import { useEffect, useRef, useCallback } from 'react';

const ORIGINAL_TITLE = 'MailGuard Proxy';

/**
 * useNotification — tab title flash + page background pulse
 *
 * flashTitle(message):
 *   Alternates the browser tab title between `message` and the original title
 *   until the user focuses the tab.
 *
 * flashPage(color):
 *   Briefly flashes the page background with a given color to signal activity
 *   on non-mail-log pages. Default color is orange (#f97316).
 */
export default function useNotification() {
  const flashInterval = useRef(null);
  const overlayRef    = useRef(null);

  // Stop flashing when user focuses the tab
  useEffect(() => {
    const onFocus = () => {
      if (flashInterval.current) {
        clearInterval(flashInterval.current);
        flashInterval.current = null;
        document.title = ORIGINAL_TITLE;
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clearInterval(flashInterval.current);
      document.title = ORIGINAL_TITLE;
      overlayRef.current?.remove();
    };
  }, []);

  const flashTitle = useCallback((message = '● New activity') => {
    // Don't start a new flash if tab is already focused
    if (document.hasFocus()) return;

    if (flashInterval.current) clearInterval(flashInterval.current);

    let showing = true;
    document.title = message;
    flashInterval.current = setInterval(() => {
      document.title = showing ? ORIGINAL_TITLE : message;
      showing = !showing;
    }, 1200);
  }, []);

  const flashPage = useCallback((color = '#f97316', durationMs = 600) => {
    // Create overlay if it doesn't exist
    if (!overlayRef.current) {
      const el = document.createElement('div');
      el.style.cssText = `
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 9999;
        opacity: 0;
        transition: opacity 150ms ease-in-out;
      `;
      document.body.appendChild(el);
      overlayRef.current = el;
    }

    const el = overlayRef.current;
    el.style.background = color;

    // Fade in
    requestAnimationFrame(() => {
      el.style.opacity = '0.18';
      setTimeout(() => {
        // Fade out
        el.style.opacity = '0';
      }, durationMs * 0.4);
    });
  }, []);

  const stopFlash = useCallback(() => {
    if (flashInterval.current) {
      clearInterval(flashInterval.current);
      flashInterval.current = null;
      document.title = ORIGINAL_TITLE;
    }
  }, []);

  return { flashTitle, flashPage, stopFlash };
}