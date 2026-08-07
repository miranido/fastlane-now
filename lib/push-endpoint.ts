/**
 * A push endpoint is a URL our server will POST to, repeatedly, on a schedule.
 * Accepting arbitrary URLs from clients would turn this service into a request
 * amplifier, so only the real browser push services are allowed through.
 *
 * Between them these four cover Chrome/Android, Firefox, Safari/iOS and Edge —
 * i.e. every browser that can subscribe in the first place.
 */
const ALLOWED_HOST_SUFFIXES = [
  "push.services.mozilla.com", // Firefox
  "fcm.googleapis.com", // Chrome, Edge (current)
  "android.googleapis.com", // Chrome (legacy GCM endpoints)
  "push.apple.com", // Safari, iOS
  "notify.windows.com", // Edge (WNS)
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;

  const host = url.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}
