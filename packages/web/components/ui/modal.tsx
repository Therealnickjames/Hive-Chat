"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "default" | "wide";
}

export function Modal({ isOpen, onClose, title, children, size = "default" }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className={`w-full ${size === "wide" ? "max-w-2xl" : "max-w-md"} rounded-lg bg-background-floating p-6 shadow-xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-text-muted transition hover:bg-background-primary hover:text-text-primary"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.3 4.3a1 1 0 00-1.4-1.4L8 5.6 5.1 2.9a1 1 0 00-1.4 1.4L6.6 7 3.7 9.9a1 1 0 101.4 1.4L8 8.4l2.9 2.9a1 1 0 001.4-1.4L9.4 7l2.9-2.7z" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
