self.addEventListener("push", (event) => {
  if (!event.data) {
    return
  }

  const payload = event.data.json()
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: {
        href: payload.href || "/",
      },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const href = event.notification.data?.href || "/"
  event.waitUntil(self.clients.openWindow(href))
})
