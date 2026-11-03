'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

export interface UseScreenshotTrapOptions {
  enabled?: boolean;
  onTrigger?: (reason: 'keyboard' | 'blur' | 'print') => void;
  cooldownMs?: number;
}

export function useScreenshotTrap(options: UseScreenshotTrapOptions = {}) {
  const { enabled = true, onTrigger, cooldownMs = 2800 } = options;
  const [isTrapActive, setIsTrapActive] = useState(false);
  const [triggerReason, setTriggerReason] = useState<'keyboard' | 'blur' | 'print' | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isWindowBlurredRef = useRef(false);
  const lastToastTimeRef = useRef<number>(0);

  const activateTrap = useCallback((reason: 'keyboard' | 'blur' | 'print') => {
    if (!enabled) return;

    setIsTrapActive(true);
    setTriggerReason(reason);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Only notify on explicit user capture attempts (keyboard chords, print), not passive tab switching
    if (reason !== 'blur') {
      const now = Date.now();
      if (now - lastToastTimeRef.current > 4000) {
        lastToastTimeRef.current = now;
        onTrigger?.(reason);
      }

      timerRef.current = setTimeout(() => {
        if (!isWindowBlurredRef.current) {
          setIsTrapActive(false);
          setTriggerReason(null);
        }
      }, cooldownMs);
    }
  }, [enabled, onTrigger, cooldownMs]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    // 1. Keyboard interception: Capture phase to intercept before OS screenshot tools or browser print
    const handleKeyDown = (e: KeyboardEvent) => {
      // PrintScreen key (Windows / Linux)
      if (e.key === 'PrintScreen') {
        activateTrap('keyboard');
        return;
      }

      const isMetaOrCtrl = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      // macOS screenshot chords (Cmd+Shift+3, Cmd+Shift+4, Cmd+Shift+5, Cmd+Shift+6)
      // and Windows Snipping Tool (Win+Shift+S / Ctrl+Shift+S)
      if (isMetaOrCtrl && isShift) {
        const screenshotKeys = ['3', '4', '5', '6', 's', 'S', 'Meta', 'Shift', 'Control'];
        const screenshotCodes = ['Digit3', 'Digit4', 'Digit5', 'Digit6', 'KeyS'];

        if (
          screenshotKeys.includes(e.key) ||
          (e.code && screenshotCodes.includes(e.code))
        ) {
          activateTrap('keyboard');
        }
      }

      // Print shortcut (Cmd+P / Ctrl+P)
      if (isMetaOrCtrl && (e.key === 'p' || e.key === 'P' || e.code === 'KeyP')) {
        e.preventDefault();
        activateTrap('print');
      }
    };

    // 2. Window blur & focus
    // External capture utilities (macOS Cmd+Shift+4 crosshairs, Windows Snipping Tool, CleanShot, etc.)
    // immediately steal window focus, triggering window.blur.
    const handleBlur = () => {
      isWindowBlurredRef.current = true;
      activateTrap('blur');
    };

    const handleFocus = () => {
      isWindowBlurredRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      // Brief delay before restoring image so snipping tool completion finishes without leaking pixels
      timerRef.current = setTimeout(() => {
        setIsTrapActive(false);
        setTriggerReason(null);
      }, 700);
    };

    // 3. Print events
    const handleBeforePrint = () => {
      activateTrap('print');
    };

    const handleAfterPrint = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setIsTrapActive(false);
        setTriggerReason(null);
      }, 500);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, activateTrap]);

  return { isTrapActive, triggerReason };
}
