import {useSyncExternalStore} from "react";

const standalone = window.matchMedia?.("(display-mode: standalone)");
const fullscreen = window.matchMedia?.("(display-mode: fullscreen)");
const isStandalone = () => Boolean(standalone?.matches || fullscreen?.matches || navigator.standalone);
let installEvent = null;
let state = {available: false, installed: isStandalone(), busy: false};
const subscribers = new Set();

function publish(update) {
  state = {...state, ...update};
  subscribers.forEach(notify => notify());
}

// Capture the event as soon as the bundle loads, including before React mounts.
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  if (state.installed) return;
  installEvent = event;
  publish({available: true});
});
window.addEventListener("appinstalled", () => {
  installEvent = null;
  publish({available: false, installed: true, busy: false});
});
const displayChanged = () => {
  if (isStandalone()) {
    installEvent = null;
    publish({available: false, installed: true, busy: false});
  }
};
standalone?.addEventListener?.("change", displayChanged);
fullscreen?.addEventListener?.("change", displayChanged);

function subscribe(notify) {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}
const getSnapshot = () => state;

export function usePwaInstall() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export async function promptInstallation() {
  if (!installEvent || state.busy || state.installed) return "unavailable";
  const event = installEvent;
  installEvent = null;
  publish({available: false, busy: true});
  try {
    // The browser requires prompt() to run directly in response to a user's click.
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === "accepted") publish({installed: true});
    return choice.outcome;
  } finally {
    publish({busy: false});
  }
}

export const isAppleMobile = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function installationPlatform() {
  if (isAppleMobile()) return "ios";
  const platform = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
  if (/android/i.test(navigator.userAgent) || platform.includes("android")) return "android";
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  if (platform.includes("linux")) return "linux";
  return "other";
}
