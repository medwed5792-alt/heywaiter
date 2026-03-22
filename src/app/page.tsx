'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { AdSpace } from '@/components/ads/AdSpace';
import { Bell, QrCode, MapPin } from 'lucide-react';

function GuestContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'idle' | 'calling' | 'success'>('idle');
  const [language, setLanguage] = useState('en');

  const venueId = (searchParams.get('v') ?? '').trim();
  const tableIdRaw = (searchParams.get('t') ?? '').trim();

  useEffect(() => {
    const userLang = navigator.language.split('-')[0];
    setLanguage(userLang);
  }, []);

  const handleCallWaiter = async () => {
    if (!venueId || !tableIdRaw) {
      return;
    }
    setStatus('calling');
    try {
      await addDoc(collection(db, 'serviceCalls'), {
        venueId,
        tableId: tableIdRaw,
        type: 'waiter',
        status: 'pending',
        guestLanguage: language,
        createdAt: serverTimestamp(),
      });
      setStatus('success');
      if (navigator.vibrate) navigator.vibrate(200);

      setTimeout(() => setStatus('idle'), 3000);
    } catch (error) {
      console.error("Ошибка Firebase:", error);
      toast.error("Ошибка связи с базой данных");
      setStatus('idle');
    }
  };

  const labels: Record<string, { btn: string, ok: string }> = {
    ru: { btn: "ВЫЗВАТЬ ОФИЦИАНТА", ok: "ИДУТ К ВАМ!" },
    en: { btn: "CALL WAITER", ok: "COMING SOON!" },
    zh: { btn: "呼叫服务员", ok: "马上就来！" }
  };

  const t = labels[language] || labels['en'];

  const tableLabel = tableIdRaw || '—';
  const hasTableLink = Boolean(venueId && tableIdRaw);
  const callEnabled = hasTableLink;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-100" style={{ zoom: '75%' }}>
      <div className="w-full max-w-sm p-6 md:p-8 bg-white rounded-[40px] shadow-2xl border-4 border-blue-600 text-center">
        <h1 className="text-2xl md:text-3xl font-black mb-4 text-slate-800 tracking-tighter">
          {hasTableLink ? 'За столом' : 'Личный кабинет'}
        </h1>

        <AdSpace
          id="main-gate"
          placement="main_gate"
          venueId={venueId || undefined}
          className="mb-6 w-full text-left"
        />

        {hasTableLink ? (
          <>
            <p className="mb-6 text-sm text-slate-600">
              Стол {tableLabel}. Язык: {language.toUpperCase()}
            </p>
            <button
              onClick={handleCallWaiter}
              disabled={status !== 'idle' || !callEnabled}
              className={`w-full py-10 md:py-12 rounded-[30px] text-xl md:text-2xl font-black transition-all active:scale-95 shadow-xl ${
                status === 'success'
                  ? 'bg-green-500 text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              } ${status === 'calling' ? 'opacity-70' : ''} ${!callEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {status === 'idle' && (t.btn || "ВЫЗВАТЬ ОФИЦИАНТА")}
              {status === 'calling' && "СВЯЗЬ..."}
              {status === 'success' && (t.ok || "ИДУТ К ВАМ!")}
            </button>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-600">
              Отсканируйте QR стола или откройте ссылку из бота с параметрами заведения и стола.
            </p>
            <div className="mb-4 flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 py-4 text-sm text-slate-600">
              <QrCode className="h-5 w-5 shrink-0" />
              Сканер доступен в Telegram Mini App
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <MapPin className="h-4 w-4 shrink-0" />
                Мои места
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Сохранённые заведения и история визитов — в следующих версиях.
              </p>
            </div>
          </>
        )}

        <p className="mt-6 text-slate-400 font-bold uppercase tracking-widest text-[10px]">
          HeyWaiter
        </p>
      </div>
    </main>
  );
}

export default function GuestPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100">
          <p className="text-slate-500">Загрузка…</p>
        </main>
      }
    >
      <GuestContent />
    </Suspense>
  );
}
