import type { ReactNode } from "react";

import { appUrl } from "../lib/base-url";
import { cn } from "cn";
import { ImageLightbox } from "@lmfaole/designsystem/components/image-lightbox";
import { Reveal } from "@lmfaole/designsystem/components/reveal";

/**
 * The head of the page of a thing whose picture is a cover too small to fill the page's width (an album, a game, a book): the
 * cover at its own size beside the thing's name and its facts, side by side on a phone as well, over the same cover blurred
 * as the background (a tall poster is drawn narrower than a square one, so the head is about as high as the square one), or a wide picture of it (`backdrop`: a screenshot) dimmed where it has one. Like `EntityHero` it stands in the page's column, with no gradient. What else there is to say
 * of the thing is `EntityAbout`, at the foot of the page.
 */
export function EntityCoverHero({
  name,
  cover,
  backdrop,
  ratio = "square",
  facts,
}: {
  name: string;
  cover: string | null | undefined;
  backdrop?: string | null | undefined;
  ratio?: "poster" | "square";
  facts: readonly (readonly [string, ReactNode])[];
}) {
  const shown = facts.filter((fact) => fact[1] !== null && fact[1] !== undefined && fact[1] !== "");
  const picture = cover;
  return (
    // In the page's column with the same edges as what is under it: a rounded box, the cover blurred (or the backdrop, dimmed) behind it, tinted flat, no gradient.
    <header
      className={cn(
        "relative isolate overflow-clip rounded-xl p-5 sm:p-8",
        !(backdrop || picture) && "bg-muted",
      )}
    >
      {backdrop ? (
        <img
          className="pointer-events-none absolute inset-0 -z-20 size-full object-cover blur-[3px]"
          src={appUrl(backdrop)}
          alt=""
          aria-hidden="true"
        />
      ) : picture ? (
        <img
          className="pointer-events-none absolute -inset-[15%] -z-20 size-[130%] max-w-none object-cover blur-[2.5rem] saturate-[1.6]"
          src={appUrl(picture)}
          alt=""
          aria-hidden="true"
        />
      ) : null}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-background/70"
      />
      <Reveal>
        <div className="grid gap-5">
          <h1 className="text-3xl leading-tight font-bold [overflow-wrap:anywhere] sm:text-4xl">
            {name}
          </h1>
          <div className={cn("grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-4 sm:gap-8", ratio === "square" ? "sm:grid-cols-[16rem_minmax(0,1fr)] 2xl:grid-cols-[20rem_minmax(0,1fr)]" : "sm:grid-cols-[11rem_minmax(0,1fr)] 2xl:grid-cols-[13rem_minmax(0,1fr)]")}>
            {picture ? (
              <ImageLightbox src={appUrl(picture)} name={name}>
                <img
                  src={appUrl(picture)}
                  alt=""
                  className={cn(
                    "w-full rounded-lg object-cover shadow-lg",
                    ratio === "square" ? "aspect-square" : "aspect-[2/3]",
                  )}
                />
              </ImageLightbox>
            ) : (
              <div
                aria-hidden="true"
                className={cn(
                  "w-full rounded-lg bg-muted",
                  ratio === "square" ? "aspect-square" : "aspect-[2/3]",
                )}
              />
            )}
            {shown.length === 0 ? null : (
              // Label over value: beside a cover on a phone there is no room for two columns.
              <dl className="grid content-start gap-x-6 gap-y-3 text-sm lg:grid-cols-[repeat(auto-fill,minmax(11rem,16rem))] lg:gap-x-10">
                {shown.map(([label, value]) => (
                  <div key={label} className="grid min-w-0 gap-0.5">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="[overflow-wrap:anywhere]">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </Reveal>
    </header>
  );
}
