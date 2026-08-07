/** Browser-side helpers for the Web Push handshake. */

export type PushCapability =
  | "checking"
  /** Everything needed is available. */
  | "ready"
  /** iPhone/iPad Safari that hasn't been added to the home screen yet. */
  | "ios-needs-install"
  /** No Web Push at all. */
  | "unsupported";

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac, so touch points are the giveaway.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own non-standard flag.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function detectCapability(): PushCapability {
  if (typeof window === "undefined") return "checking";

  const hasApis =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  // On iOS the APIs exist in plain Safari but push only works once installed.
  if (isIosDevice() && !isStandalone()) return "ios-needs-install";
  if (!hasApis) return "unsupported";
  return "ready";
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
  });
  // A freshly registered worker isn't necessarily active yet.
  await navigator.serviceWorker.ready;
  return registration;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalised);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Reuses an existing push subscription when there is one; the browser only
 * hands out fresh keys if none exists or the VAPID key changed.
 */
export async function subscribeToPush(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string,
): Promise<PushSubscriptionJSON> {
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  const existing = await registration.pushManager.getSubscription();

  if (existing) {
    const currentKey = existing.options?.applicationServerKey;
    const sameKey =
      currentKey &&
      new Uint8Array(currentKey).every((b, i) => b === applicationServerKey[i]);
    if (sameKey) return existing.toJSON();
    await existing.unsubscribe();
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  return subscription.toJSON();
}
