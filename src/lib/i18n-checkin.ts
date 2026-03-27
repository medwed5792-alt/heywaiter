/**
 * Language Free: тексты Landing Hub check-in по языку браузера.
 */
import type { LocaleCode } from "./types";

export const checkInCopy: Record<
  string,
  { title: string; subtitle: string; choose: string; openIn: string }
> = {
  ru: {
    title: "HeyWaiter",
    subtitle: "Вы за столом. Выберите мессенджер для связи с персоналом.",
    choose: "Открыть в",
    openIn: "Открыть в",
  },
  en: {
    title: "HeyWaiter",
    subtitle: "You're at the table. Choose a messenger to contact your waiter.",
    choose: "Open in",
    openIn: "Open in",
  },
  zh: {
    title: "HeyWaiter",
    subtitle: "您已入座。选择即时通讯工具联系服务员。",
    choose: "在以下应用中打开",
    openIn: "打开",
  },
  it: {
    title: "HeyWaiter",
    subtitle: "Siete al tavolo. Scegliete un messenger per contattare il cameriere.",
    choose: "Apri in",
    openIn: "Apri in",
  },
  tr: {
    title: "HeyWaiter",
    subtitle: "Masada oturdunuz. Garsonla iletişim için bir mesajlaşma uygulaması seçin.",
    choose: "Şununla aç",
    openIn: "Aç",
  },
  de: {
    title: "HeyWaiter",
    subtitle: "Sie sitzen am Tisch. Wählen Sie einen Messenger für die Kontaktaufnahme.",
    choose: "Öffnen in",
    openIn: "Öffnen in",
  },
  fr: {
    title: "HeyWaiter",
    subtitle: "Vous êtes à table. Choisissez une messagerie pour contacter le serveur.",
    choose: "Ouvrir dans",
    openIn: "Ouvrir dans",
  },
  es: {
    title: "HeyWaiter",
    subtitle: "Está en la mesa. Elija un mensajero para contactar al camarero.",
    choose: "Abrir en",
    openIn: "Abrir en",
  },
  ar: {
    title: "HeyWaiter",
    subtitle: "أنت في الطاولة. اختر تطبيق مراسلة للاتصال بالنادل.",
    choose: "فتح في",
    openIn: "فتح في",
  },
};

const defaultCopy = checkInCopy.en;

export function getCheckInCopy(locale: LocaleCode) {
  const code = String(locale).split("-")[0].toLowerCase();
  return checkInCopy[code] ?? defaultCopy;
}
