import { ErrorPage } from "@lmfaole/designsystem/components/error-page"
import { LinkButton } from "@lmfaole/designsystem/components/link-button"

/** The design system's NotFoundPage links to "/", which on GitHub Pages is not this site: the same page, with the way back to the site's own front page. */
export function NotFound({ base }: { base: string }) {
  return (
    <ErrorPage
      status={404}
      title="Siden finnes ikke"
      description="Det er ingenting på denne adressen. Siden kan ha flyttet, eller lenken har en skrivefeil."
      actions={<LinkButton href={base}>Gå til Medier</LinkButton>}
    />
  )
}
