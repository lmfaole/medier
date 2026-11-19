import { Button } from "@lmfaole/designsystem/components/button"
import { Stack } from "@lmfaole/designsystem/components/layout"
import { Text } from "@lmfaole/designsystem/components/text"
import { Upload } from "lucide-react"
import { useRef, useState, type DragEvent } from "react"

/**
 * Where files are dropped, or chosen with the button (the native picker; a phone offers its own). It only hands the chosen files on: what is done with
 * them is the caller's. The frame is dashed and takes the app's colour while something is dragged over it.
 */
export function FileDrop({ onFiles, children }: { onFiles: (files: File[]) => void; children: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const dragOver = (event: DragEvent, on: boolean) => {
    event.preventDefault()
    setOver(on)
  }
  return (
    <div
      className={`grid justify-items-start gap-3 rounded-lg border-2 border-dashed p-6 ${over ? "border-(--app-color) bg-(--app-color)/10" : "border-border"}`}
      onDragOver={(event) => dragOver(event, true)}
      onDragLeave={(event) => dragOver(event, false)}
      onDrop={(event) => {
        dragOver(event, false)
        onFiles([...event.dataTransfer.files])
      }}
    >
      <Stack gap="sm">
        <div>
          <Button type="button" variant="outline" onClick={() => input.current?.click()}>
            <Upload aria-hidden="true" />
            Velg filer
          </Button>
        </div>
        <Text tone="muted">{children}</Text>
      </Stack>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Velg filer"
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])])
          event.target.value = ""
        }}
      />
    </div>
  )
}
