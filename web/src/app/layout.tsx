import type { Metadata } from "next";
import { Geist_Mono, IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Providers } from "@/components/app/providers";
import { brand } from "@/config/brand";
import { isRtl } from "@/i18n/config";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const arabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.tagline.fr,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const rtl = isRtl(locale);
  return (
    <html lang={locale} dir={rtl ? "rtl" : "ltr"} className={cn("h-full antialiased", rtl ? arabic.variable : inter.variable, geistMono.variable)}>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <Providers>
            <div className="isolate flex min-h-full flex-1 flex-col">{children}</div>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
