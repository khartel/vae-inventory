/** Use a connected native download link for CSV and PDF exports alike. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.hidden = true
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    // Let the browser start consuming the blob before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}
