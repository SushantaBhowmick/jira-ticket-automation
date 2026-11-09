"use client";

import { useCallback, useEffect, useState } from "react";

export type ToastTone = "ok" | "bad";

export type ToastItem = {
  id: number;
  text: string;
  tone: ToastTone;
};

const FLASH_KEY = "pactap.flash";

export function stashFlash(text: string, tone: ToastTone) {
  sessionStorage.setItem(FLASH_KEY, JSON.stringify({ text, tone }));
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (text: string, tone: ToastTone) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((current) => [...current.slice(-2), { id, text, tone }]);
      window.setTimeout(() => dismiss(id), 5200);
    },
    [dismiss],
  );

  useEffect(() => {
    const raw = sessionStorage.getItem(FLASH_KEY);
    if (!raw) return;
    sessionStorage.removeItem(FLASH_KEY);
    try {
      const flash = JSON.parse(raw) as { text?: string; tone?: ToastTone };
      if (flash.text && (flash.tone === "ok" || flash.tone === "bad")) notify(flash.text, flash.tone);
    } catch {
      sessionStorage.removeItem(FLASH_KEY);
    }
  }, [notify]);

  return { toasts, notify, dismiss };
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => onDismiss(toast.id)}
          className={`pointer-events-auto w-full max-w-md rounded-2xl px-4 py-3 text-left text-sm font-medium shadow-xl ${
            toast.tone === "ok" ? "bg-[#0f5f5a] text-white" : "bg-[#9a3412] text-[#fff7ed]"
          }`}
        >
          <span className="block text-[11px] tracking-wide uppercase opacity-80">
            {toast.tone === "ok" ? "Success" : "Needs attention"}
          </span>
          <span className="mt-0.5 block">{toast.text}</span>
        </button>
      ))}
    </div>
  );
}
