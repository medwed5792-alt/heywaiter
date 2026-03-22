'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

function GuestContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'idle' | 'calling' | 'success'>('idle');
  const [language, setLanguage] = useState('en');

  const venueId = (searchParams.get('v') ?? '').trim();
  const tableIdRaw = (searchParams.get('t') ?? '').trim();

  // Language Free: определяем язык гостя при входе
  useEffect(() => {
    const userLang = navigator.language.split('-')[0];
    setLanguage(userLang);
  }, []);

  const handleCallWaiter = async () => {
    if (!venueId || !tableIdRaw) {
      toast.error('Нет venueId или tableId в ссылке (?v=…&t=…)');
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
  const missingContext = !venueId || !tableIdRaw;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-100" style={{ zoom: '75%' }}>
      <div className="w-full max-w-sm p-8 bg-white rounded-[40px] shadow-2xl border-4 border-blue-600 text-center">
        <h1 className="text-3xl font-black mb-10 text-slate-800 tracking-tighter">HeyWaiter!</h1>

        {missingContext ? (
          <p className="mb-6 text-sm text-amber-700">
            Откройте страницу со ссылкой с параметрами v и t (QR стола).
          </p>
        ) : null}

        <button
          onClick={handleCallWaiter}
          disabled={status !== 'idle' || missingContext}
          className={`w-full py-12 rounded-[30px] text-2xl font-black transition-all active:scale-95 shadow-xl ${
            status === 'success'
              ? 'bg-green-500 text-white'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          } ${status === 'calling' ? 'opacity-70' : ''} ${missingContext ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {status === 'idle' && (t.btn || "ВЫЗВАТЬ ОФИЦИАНТА")}
          {status === 'calling' && "СВЯЗЬ..."}
          {status === 'success' && (t.ok || "ИДУТ К ВАМ!")}
        </button>

        <p className="mt-8 text-slate-500 font-bold uppercase tracking-widest text-xs">
          СТОЛ {tableLabel} • ЯЗЫК: {language.toUpperCase()}
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
