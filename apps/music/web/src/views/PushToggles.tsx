// The two switches on `/tilbakeblikk`: to be told at the end of each week and at the end of each month. What is on is this device's own
// (`lib/push-client.ts`); the page asks the browser, not the server.

import { useEffect, useState } from 'react'

import { SwitchList } from '@designsystem/ui/components/switch-list'
import { Text } from '@lmfaole/designsystem/components/text'

import { TOPICS, type Topic } from '@/lib/digest'
import { canPush, currentTopics, setTopics } from '@/lib/push-client'

const NOTES: Record<Topic, { label: string; note: string }> = {
  week: { label: 'Hver uke', note: 'søndag kveld' },
  month: { label: 'Hver måned', note: 'siste dag i måneden' },
}

export function PushToggles() {
  const [topics, setOn] = useState<readonly Topic[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    void currentTopics().then(setOn, () => setOn([]))
  }, [])

  // Nothing is drawn before the browser has been asked what it can do, so the server's page and the first one in the browser agree.
  if (!mounted) return null
  if (!canPush()) return <Text size="sm" tone="muted">Varsler er ikke tilgjengelige i denne nettleseren. På iPhone må appen ligge på hjemskjermen.</Text>

  const change = async (id: string, wanted: boolean) => {
    const next = TOPICS.filter((topic) => (topic === id ? wanted : (topics ?? []).includes(topic)))
    setBusy(true)
    setProblem(null)
    try {
      await setTopics(next)
      setOn(next)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Noe gikk galt.')
    } finally {
      setBusy(false)
    }
  }

  return <SwitchList title="Varsle meg" choices={TOPICS.map((topic) => ({ id: topic, ...NOTES[topic], on: (topics ?? []).includes(topic) }))} disabled={busy || topics === null} problem={problem} onChange={(id, on) => void change(id, on)} />
}
