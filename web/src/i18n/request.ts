import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE, locales, type Locale } from "./config";

async function detectLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const accept = (await headers()).get("accept-language") ?? "";
  for (const part of accept.split(",")) {
    const code = part.split(";")[0].trim().slice(0, 2).toLowerCase();
    if (locales.includes(code as Locale)) return code as Locale;
  }
  return defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await detectLocale();
  return {
    locale,
    timeZone: "Africa/Tunis",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
