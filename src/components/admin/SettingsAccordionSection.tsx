"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  title: string;
  subtitle?: ReactNode;
  /** По умолчанию свёрнуто; для конструктора меню — true. */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * Сворачиваемая секция настроек — та же логика, что «Глобальная карточка» в StaffCabinetProfile:
 * кнопка-заголовок, ChevronDown с rotate-180, анимация через grid-rows.
 */
export function SettingsAccordionSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
  className,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-gray-50"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <span className="text-base font-medium text-gray-900">{title}</span>
          {subtitle ? <div className="mt-1 text-xs text-gray-500">{subtitle}</div> : null}
        </div>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-gray-500 transition-transform duration-300 ease-out ${
            open ? "rotate-180" : "rotate-0"
          }`}
          aria-hidden
        />
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-gray-100 px-4 pb-4 pt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}
