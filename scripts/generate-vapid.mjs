#!/usr/bin/env node
/**
 * Prints a fresh VAPID key pair for .env.local / Vercel.
 *
 *   node scripts/generate-vapid.mjs
 *
 * Only needed once per deployment. Rotating the keys invalidates every push
 * subscription users have already granted, so they'd all have to opt in again.
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
