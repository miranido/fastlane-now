import { setRequestLocale } from "next-intl/server";
import { PriceApp } from "@/components/PriceApp";
import type { Locale } from "@/i18n/routing";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <PriceApp locale={locale as Locale} />;
}
