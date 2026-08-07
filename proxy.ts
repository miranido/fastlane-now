import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals, and static files
  // (the service worker and manifest must stay un-prefixed).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
