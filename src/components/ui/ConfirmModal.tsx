"use client";

import { useEffect } from "react";

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary" | "neutral";
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Универсальное модальное окно подтверждения.
 * Лаконичное окно в центре экрана с анимацией появления/исчезновения (Tailwind).
 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "ПОДТВЕРДИТЬ",
  cancelLabel = "ОТМЕНА",
  variant = "primary",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === "danger"
      ? "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500"
      : variant === "primary"
        ? "bg-gray-900 text-white hover:bg-gray-800 focus:ring-gray-600"
        : "bg-gray-600 text-white hover:bg-gray-700 focus:ring-gray-500";

  const handleConfirm = async () => {
    await Promise.resolve(onConfirm());
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      {/* Backdrop: плавное появление */}
      <div
        className="absolute inset-0 bg-black/50"
        style={{ animation: "confirm-backdrop-in 0.2s ease-out" }}
        onClick={onCancel}
      />
      {/* Panel: масштаб + fade */}
      <div
        className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
        style={{ animation: "confirm-modal-in 0.2s ease-out" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-semibold text-gray-900">
          {title}
        </h2>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        <div className="mt-6 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
