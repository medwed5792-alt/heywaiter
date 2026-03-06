"use client";

import { useState, useCallback } from "react";

const STORAGE_KEY = "heywaiter_debug_simulateOutOfZone";
const CLICKS_NEEDED = 5;

export function getSimulateOutOfZone(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function setSimulateOutOfZone(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
}

interface DebugPanelTriggerProps {
  /** Элемент (например заголовок/логотип), по которому кликают 5 раз */
  children: (props: { onClick: () => void }) => React.ReactNode;
}

export function DebugPanelTrigger({ children }: DebugPanelTriggerProps) {
  const [showPanel, setShowPanel] = useState(false);
  const [simulate, setSimulate] = useState(false);

  const [clickCount, setClickCount] = useState(0);
  const handleClick = useCallback(() => {
    setClickCount((c) => {
      const next = c + 1;
      if (next >= CLICKS_NEEDED) {
        setShowPanel(true);
        setSimulate(getSimulateOutOfZone());
        return 0;
      }
      return next;
    });
  }, []);

  const handleToggleSimulate = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.checked;
    setSimulate(v);
    setSimulateOutOfZone(v);
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
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={simulate}
              onChange={handleToggleSimulate}
              className="rounded border-gray-300"
            />
            Имитировать выход из зоны (+500 м)
          </label>
          <p className="mt-2 text-xs text-gray-500">
            Подменяет координаты в useGeoFencing на +500 м для проверки Escape Alert.
          </p>
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
