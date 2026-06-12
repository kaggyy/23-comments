const publicVapidKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

async function subscribe(registration: ServiceWorkerRegistration) {
  const existingSubscription = await registration.pushManager.getSubscription();

  if (existingSubscription) {
    return existingSubscription;
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
  });
}

export async function syncWebPushSubscription(accessToken: string) {
  if (
    !publicVapidKey ||
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return;
  }

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;

  if (permission !== "granted") {
    return;
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  let pushSubscription: PushSubscription;

  try {
    pushSubscription = await subscribe(registration);
  } catch {
    const existingSubscription = await registration.pushManager.getSubscription();
    await existingSubscription?.unsubscribe();
    pushSubscription = await subscribe(registration);
  }

  await fetch("/api/push-subscriptions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      subscription: pushSubscription.toJSON()
    })
  });
}
