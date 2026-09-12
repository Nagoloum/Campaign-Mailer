import { statusLabel, type CampaignStatus } from '@/services/campaigns'

/**
 * Colour carries the meaning only as a second channel; the label always says
 * the state in words, so it survives a colour-blind reader and a greyscale
 * print alike.
 */
const TONE: Record<CampaignStatus, string> = {
  draft: 'border-border text-ink-muted',
  scheduled: 'border-accent/30 text-accent',
  running: 'border-accent/30 bg-accent/5 text-accent',
  paused: 'border-amber-300 text-amber-700',
  completed: 'border-emerald-300 text-emerald-700',
}

export function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[status]}`}
    >
      {statusLabel(status)}
    </span>
  )
}
