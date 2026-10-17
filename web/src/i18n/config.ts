export const locales = ["fr", "ar", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "fr";
export const LOCALE_COOKIE = "locale";
export const localeNames: Record<Locale, string> = { fr: "Français", ar: "العربية", en: "English" };
export const isRtl = (l: string) => l === "ar";
export const isLocale = (l: unknown): l is Locale => locales.includes(l as Locale);
