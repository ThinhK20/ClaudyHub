/**
 * Prints one element (the rendered note) through the system print dialog, where "Save as PDF" / "Microsoft Print to PDF"
 * exports it. The element is copied into a hidden frame with the app's stylesheets, so the rest of the window stays out
 * of the printout and the page always prints in the light theme.
 */
export function printElement(element: HTMLElement, title: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.append(frame)

  const frameDocument = frame.contentDocument
  const frameWindow = frame.contentWindow
  if (!frameDocument || !frameWindow) {
    frame.remove()
    throw new Error('Printing is not available')
  }
  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((node) => node.cloneNode(true))
  const page = frameDocument.createElement('style')
  page.textContent = '@page { margin: 16mm } body { background: #fff; margin: 0 } article { padding: 0 !important }'
  frameDocument.title = title
  frameDocument.head.append(...styles, page)
  frameDocument.body.append(frameDocument.importNode(element, true))

  frameWindow.addEventListener('afterprint', () => frame.remove(), {
    once: true
  })
  // Linked stylesheets load asynchronously; print once they have.
  const pending = [...frameDocument.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(
    (link) =>
      new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true })
        link.addEventListener('error', () => resolve(), { once: true })
      })
  )
  void Promise.all(pending).then(() => {
    frameWindow.focus()
    frameWindow.print()
  })
}
