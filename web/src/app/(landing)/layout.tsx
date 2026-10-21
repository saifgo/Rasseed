import localFont from "next/font/local";
import "./landing.css";

// Roundo carries the Latin text of the landing page. Arabic glyphs fall back to the
// app's Arabic face (--font-sans), which the root layout sets for the "ar" locale.
const roundo = localFont({
  src: [
    { path: "../fonts/roundo-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/roundo-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/roundo-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-roundo",
  display: "swap",
});

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`landing ${roundo.variable}`}>{children}</div>;
}
