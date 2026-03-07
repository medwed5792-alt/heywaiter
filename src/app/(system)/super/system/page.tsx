/**
 * Супер-админ: Система — подписки, аналитика, реклама.
 * Раньше: /admin/system.
 */
export default function SuperSystemPage() {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Система</h2>
      <p className="mt-2 text-sm text-gray-600">
        Управление подписками (Free/Pro), глобальная аналитика, реклама. Доступ только для SuperAdmin.
      </p>
    </div>
  );
}
