import { describeTime } from "@lmfaole/designsystem/lib/time"

/** A time as «19. nov. 2026, 14:05», in Oslo: the page is made at build time, so a relative time («for 2 timer siden») would go stale. */
export function when(iso: string): string {
  return describeTime(iso, new Date(iso), "datetime")?.text ?? ""
}
