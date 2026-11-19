import type { ReactNode } from "react"

import { visibleFacts, type Fact } from "../lib/entity-model"
import { ValueView } from "./entity-sections"

/** The facts that have something to say, as the pairs the design system's lists take. */
export const factPairs = (facts: readonly Fact[] | undefined): (readonly [string, ReactNode])[] => visibleFacts(facts).map(([label, value]) => [label, <ValueView key={label} value={value} />] as const)
