"use client";

import { useState, useCallback } from "react";

const CLICKS_NEEDED = 5;

interface DebugPanelTriggerProps {
  /** Элемент (например заголовок/логотип), по которому кликают 5 раз */
  children: (props: { onClick: () => void }) => React.ReactNode;
}

export function DebugPanelTrigger({ children }: DebugPanelTriggerProps) {
  const [showPanel, setShowPanel] = useState(false);

  const [clickCount, setClickCount] = useState(0);
  const handleClick = useCallback(() => {
    setClickCount((c) => {
      const next = c + 1;
      if (next >= CLICKS_NEEDED) {
        setShowPanel(true);
        return 0;
      }
      return next;
    });
  }, []);

  return (
    <>
      {children({ onClick: handleClick })}
      {showPanel && (
        <div
          className="fixed right-4 top-4 z-50 w-72 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-lg"
          role="dialog"
          aria-label="Панель разработчика"
        >
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Панель разработчика</h3>
          <p className="text-xs text-gray-600">Зарезервировано под отладочные переключатели.</p>
          <button
            type="button"
            onClick={() => setShowPanel(false)}
            className="mt-3 w-full rounded border border-gray-300 bg-white py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Закрыть
          </button>
        </div>
      )}
    </>
  );
}
