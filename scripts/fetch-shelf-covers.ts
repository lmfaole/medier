/**
 * `npm run snapshot` in a shelf app (`apps/games`, `apps/books`, `apps/boardgames`), after the snapshot: lands every
 * cover (and every unlocked achievement's picture) the snapshot names, so the app serves them itself. A work's file says both the path the page shows
 * (`cover`, and the wide `banner`) and the address it comes from (`coverSource`); only an address on a register's own host is asked for.
 */

import { existsSync, readFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

import * as v from "valibot"

import { BANNER_PATH, COVER_PATH, ICON_PATH, isBannerSource, isCoverSource, isIconSource, LOGO_PATH } from "@designsystem/shelf/covers"

import { httpFetcher, imagesNamedIn, landImages } from "./images.ts"

const appDirectory = process.cwd()
const app = basename(appDirectory)

/** The address each cover path and each banner path the work files name comes from. */
const sources = new Map<string, string>()
const bannerSources = new Map<string, string>()

/** The path a work file names in `field` (`cover`, `banner`), noting the address it comes from in `sourceField`; a file that is no work, or names an address that is no register's, names none. */
function pictureIn(text: string, field: string, pattern: RegExp, allowed: (address: string) => boolean, known: Map<string, string>): string[] {
  const work: unknown = JSON.parse(text)
  if (typeof work !== "object" || work === null) return []
  const path: unknown = Reflect.get(work, field)
  const source: unknown = Reflect.get(work, `${field}Source`)
  if (typeof path !== "string" || typeof source !== "string" || !pattern.test(path) || !allowed(source)) return []
  known.set(path, source)
  return [path]
}

const coverIn = (text: string) => pictureIn(text, "cover", COVER_PATH, isCoverSource, sources)
const bannerIn = (text: string) => pictureIn(text, "banner", BANNER_PATH, isBannerSource, bannerSources)

/** The address each achievement picture path the work files name comes from. */
const iconSources = new Map<string, string>()

/** The achievement picture paths a work file names (an unlocked achievement's `icon` and `iconSource`), noting where each comes from. */
function iconsIn(text: string): string[] {
  const work: unknown = JSON.parse(text)
  if (typeof work !== "object" || work === null || !("achievements" in work) || !Array.isArray(work.achievements)) return []
  const paths: string[] = []
  const list: unknown[] = work.achievements
  for (const achievement of list) {
    if (typeof achievement !== "object" || achievement === null || !("icon" in achievement) || !("iconSource" in achievement)) continue
    const { icon, iconSource } = achievement
    if (typeof icon !== "string" || typeof iconSource !== "string" || !ICON_PATH.test(icon) || !isIconSource(iconSource)) continue
    iconSources.set(icon, iconSource)
    paths.push(icon)
  }
  return paths
}

const named = imagesNamedIn(join(appDirectory, "web", "public", "api"), coverIn)
const result = await landImages({
  named,
  prefix: "/covers/",
  store: join(resolve(appDirectory, "..", ".."), ".data", "raw", "shelf-covers", app),
  target: join(appDirectory, "web", "public", "covers"),
  upstream: (path) => {
    const url = sources.get(path)
    return url === undefined ? null : { url, headers: { "User-Agent": `${app}-covers/0.1 (+https://sky.lmfaole.party/apps/${app})` } }
  },
  fetcher: httpFetcher,
})
console.log(`covers: ${named.length} named, ${result.kept} already here, ${result.landed} landed, ${result.missing.length} the register did not give (tried again next time)`)

const banners = imagesNamedIn(join(appDirectory, "web", "public", "api"), bannerIn)
const bannerResult = await landImages({
  named: banners,
  prefix: "/banners/",
  store: join(resolve(appDirectory, "..", ".."), ".data", "raw", "shelf-banners", app),
  target: join(appDirectory, "web", "public", "banners"),
  upstream: (path) => {
    const url = bannerSources.get(path)
    return url === undefined ? null : { url, headers: { "User-Agent": `${app}-banners/0.1 (+https://sky.lmfaole.party/apps/${app})` } }
  },
  fetcher: httpFetcher,
})
console.log(`banners: ${banners.length} named, ${bannerResult.kept} already here, ${bannerResult.landed} landed, ${bannerResult.missing.length} the register did not give (tried again next time)`)

const icons = imagesNamedIn(join(appDirectory, "web", "public", "api"), iconsIn)
const landed = await landImages({
  named: icons,
  prefix: "/icons/",
  store: join(resolve(appDirectory, "..", ".."), ".data", "raw", "achievement-icons", app),
  target: join(appDirectory, "web", "public", "icons"),
  upstream: (path) => {
    const url = iconSources.get(path)
    return url === undefined ? null : { url, headers: { "User-Agent": `${app}-icons/0.1 (+https://sky.lmfaole.party/apps/${app})` } }
  },
  fetcher: httpFetcher,
})
console.log(`icons: ${icons.length} named, ${landed.kept} already here, ${landed.landed} landed, ${landed.missing.length} the service did not give (tried again next time)`)

/** The developers' logos `companies.json` lists (games only): each path with the register's address it comes from. */
const Companies = v.array(v.object({ logo: v.string(), logoSource: v.string() }))
const companiesFile = join(appDirectory, "web", "public", "api", "companies.json")
const companies = existsSync(companiesFile) ? v.parse(Companies, JSON.parse(readFileSync(companiesFile, "utf8"))) : []
const logoSources = new Map(companies.filter((company) => LOGO_PATH.test(company.logo) && isCoverSource(company.logoSource)).map((company) => [company.logo, company.logoSource]))
const logos = [...logoSources.keys()].toSorted()
const logoResult = await landImages({
  named: logos,
  prefix: "/logos/",
  store: join(resolve(appDirectory, "..", ".."), ".data", "raw", "company-logos", app),
  target: join(appDirectory, "web", "public", "logos"),
  upstream: (path) => {
    const url = logoSources.get(path)
    return url === undefined ? null : { url, headers: { "User-Agent": `${app}-logos/0.1 (+https://sky.lmfaole.party/apps/${app})` } }
  },
  fetcher: httpFetcher,
})
console.log(`logos: ${logos.length} named, ${logoResult.kept} already here, ${logoResult.landed} landed, ${logoResult.missing.length} the register did not give (tried again next time)`)
