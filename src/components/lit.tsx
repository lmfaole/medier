import { TiltButton } from "@lmfaole/designsystem/components/tilt-button"

/**
 * What lets the light of a page follow the pointer and, on an iPhone, how it is held: an island with nothing to draw, except the one button that asks to let the light follow the phone (once; the answer is kept in the
 * browser). A page whose main picture is a `Picture size="hero"` mounts one (`<Lit client:idle />`), since its frame is only a shadow and a rim that read the light, and the detail components are not hydrated themselves.
 * The front page's card of what plays now is an island of its own and needs none.
 */
export function Lit() {
  return <TiltButton />
}
