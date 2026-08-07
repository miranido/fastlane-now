import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["he", "en"],
  defaultLocale: "he",
  // Hebrew lives at "/", English at "/en".
  localePrefix: "as-needed",
  // Without this, an English-language phone browsing to "/" gets redirected to
  // "/en". Hebrew is the default for everyone; English is an explicit choice.
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];

export const localeDirection: Record<Locale, "rtl" | "ltr"> = {
  he: "rtl",
  en: "ltr",
};

export const localeLabel: Record<Locale, string> = {
  he: "עברית",
  en: "English",
};
