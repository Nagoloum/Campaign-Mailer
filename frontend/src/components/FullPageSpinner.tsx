/**
 * Shown while the application does not yet know whether anyone is signed in.
 *
 * The label is read out to assistive technology and hidden visually: a bare
 * spinner says "wait" to a sighted user and nothing at all to a screen reader.
 */
export function FullPageSpinner({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh items-center justify-center"
    >
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className="size-6 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
      />
    </div>
  )
}
