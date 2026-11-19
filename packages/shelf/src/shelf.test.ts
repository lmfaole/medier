import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { historyOf, libraryOf, loggedOf, overviewOf, pageOf, readingsOf, worksOf, type AchievementLine, type Line, type ShelfConfig } from './shelf.ts'

const GAMES: ShelfConfig = { kind: 'game', statuses: ['done', 'playing', 'dropped'], done: ['done'], library: { done: 'done', playing: 'doing', dropped: 'dropped', owned: 'owned', want: 'want' } }

function line(over: Partial<Line> & { id: number; title: string }): Line {
  return { on_date: null, year: null, status: 'done', rating: null, amount: null, format: null, ext_id: null, item_id: null, item_title: null, creator: null, item_year: null, summary: null, cover: null, banner: null, url: null, ...over }
}

const LINES: Line[] = [
  line({ id: 1, title: 'hades', year: 2020, on_date: '2026-03-01', rating: 4, amount: 10, item_id: '1', item_title: 'Hades', creator: 'Supergiant', item_year: 2020, cover: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg', banner: 'https://images.igdb.com/igdb/image/upload/t_1080p/sc1.jpg' }),
  line({ id: 2, title: 'Hades', year: 2020, on_date: '2026-04-01', rating: 5, amount: 20, item_id: '1', item_title: 'Hades', creator: 'Supergiant', item_year: 2020 }),
  line({ id: 3, title: 'Celeste', on_date: '2025-05-05', status: 'dropped', item_id: '2', item_title: 'Celeste', creator: 'Maddy, Noel', item_year: 2018 }),
  line({ id: 5, title: 'Tunic', status: 'playing', amount: 2 }),
]
const GENRES = [{ ext_id: '1', genre: 'Roguelike' }, { ext_id: '2', genre: 'Platform' }, { ext_id: '1', genre: 'Action' }]

test('lines of one title are one work, whose status is the furthest along and whose rating is the last one given', () => {
  const works = worksOf(LINES, GENRES, GAMES)
  assert.equal(works.length, 3)
  const hades = pageOf(works, GAMES, works[0]?.slug ?? '')
  assert.equal(hades?.entries.length, 2)
  assert.equal(hades?.status, 'done')
  assert.deepEqual(hades?.genres, ['Roguelike', 'Action'])
  // A title with no register match is kept by what the log says, and its two lines are still one work.
  assert.equal(pageOf(works, GAMES, works[2]?.slug ?? '')?.status, 'playing')
  assert.equal(pageOf(works, GAMES, 'no-such-slug'), null)
})

test('a cover is a path the app serves, and only an address on a register host gets one', () => {
  const [hades] = worksOf(LINES, GENRES, GAMES)
  assert.match(hades?.cover ?? '', /^\/covers\/[a-z0-9-]+\.jpg$/)
  assert.equal(hades?.coverSource, 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg')
  assert.equal(hades?.bannerSource, 'https://images.igdb.com/igdb/image/upload/t_1080p/sc1.jpg')
  assert.match(hades?.banner ?? '', /^\/banners\/[a-z0-9-]+\.jpg$/)
  const [foreign] = worksOf([line({ id: 9, title: 'X', item_id: '9', cover: 'https://evil.test/a.jpg' })], [], GAMES)
  assert.deepEqual([foreign?.cover, foreign?.coverSource], [null, null])
})

test('the overview counts works, not lines, and the years only the done works with a day', () => {
  const overview = overviewOf(worksOf(LINES, GENRES, GAMES), GAMES)
  assert.deepEqual(overview.totals, { works: 3, done: 1, rated: 1, averageRating: 5, amount: 32, firstOn: '2025-05-05' })
  assert.deepEqual(overview.years, [{ year: 2026, works: 1 }])
  assert.deepEqual(overview.statuses, [{ status: 'done', works: 1 }, { status: 'playing', works: 1 }, { status: 'dropped', works: 1 }])
  assert.deepEqual(overview.creators.map((group) => group.name), ['Maddy', 'Noel', 'Supergiant'])
  assert.deepEqual(overview.decades, [{ name: '2010-tallet', works: 1 }, { name: '2020-tallet', works: 1 }])
  assert.deepEqual(overview.recent.map((listing) => listing.title), ['Hades', 'Celeste'])
})

test('the library is newest first with the works that have no day last', () => {
  assert.deepEqual(libraryOf(worksOf(LINES, GENRES, GAMES), GAMES).works.map((work) => [work.title, work.status, work.plays]), [['Hades', 'done', 2], ['Celeste', 'dropped', 1], ['Tunic', 'doing', 1]])
})

test('the history is one year of lines, the newest day first, and a year is asked for by number', () => {
  const works = worksOf(LINES, GENRES, GAMES)
  const { entries, year, years } = historyOf(works, null)
  assert.deepEqual([year, years], ['2026', ['2026', '2025']])
  assert.deepEqual(entries.map((entry) => [entry.title, entry.on]), [['Hades', '2026-04-01'], ['Hades', '2026-03-01']])
  assert.deepEqual(historyOf(works, '2025').entries.map((entry) => entry.title), ['Celeste'])
  assert.equal(historyOf(works, '1999').year, '2026')
  assert.equal(historyOf(works, '2026-03').year, '2026')
})
test('a log with nothing in it counts nothing', () => {
  const overview = overviewOf([], GAMES)
  assert.deepEqual([overview.totals.works, overview.totals.averageRating, overview.totals.firstOn, overview.years], [0, null, null, []])
})

test('achievements follow the log line of their game, are counted over the works, and a work with all of its own is completed', () => {
  const achievement = (entry_id: number, title: string, unlocked_at: number | null): AchievementLine => ({ entry_id, item_id: null, service: 'steam', title, description: null, icon: null, points: null, rarity: null, unlocked_at, progress: null, target: null, tier: null, tiers: null })
  // Hades has two lines and both lines' achievements land on the one work; Celeste has one locked.
  const works = worksOf(LINES, GENRES, GAMES, [achievement(1, 'A', 100), achievement(2, 'B', 200), achievement(3, 'C', 300), achievement(3, 'D', null)])
  assert.deepEqual(pageOf(works, GAMES, works[0]?.slug ?? '')?.achievements.map((entry) => entry.title), ['A', 'B'])
  assert.deepEqual(pageOf(works, GAMES, works[1]?.slug ?? '')?.achievements.map((entry) => entry.unlockedAt), [300, null])
  assert.deepEqual(overviewOf(works, GAMES).achievements, { total: 4, unlocked: 3, completed: 1 })
  assert.deepEqual(overviewOf(worksOf(LINES, GENRES, GAMES), GAMES).achievements, { total: 0, unlocked: 0, completed: 0 })
  // A game only a ROM names has its list on the work of the register's number, though the log has no line of it.
  const owned = line({ id: 9, title: 'Celeste', status: 'owned', item_id: '2', item_title: 'Celeste' })
  const byRom = worksOf(LINES, GENRES, GAMES, [{ ...achievement(1, 'R', null), entry_id: null, item_id: '2', service: 'ra' }], [owned])
  assert.deepEqual(byRom.find((work) => work.key === '2')?.achievements.map((entry) => entry.title), ['R'])
  // Only an unlocked achievement keeps a picture, and only from a service's own host; Xbox's is asked for small.
  const xbox = 'https://images-eds-ssl.xboxlive.com/image?url=abc'
  const [won, locked, foreign] = worksOf(LINES, GENRES, GAMES, [{ ...achievement(1, 'A', 100), icon: xbox }, { ...achievement(1, 'B', null), icon: xbox }, { ...achievement(1, 'C', 100), icon: 'https://example.com/a.png' }])[0]?.achievements ?? []
  assert.deepEqual([won?.icon?.startsWith('/icons/'), won?.iconSource, locked?.icon, foreign?.icon], [true, `${xbox}&format=jpg&w=128&h=128`, null, null])
  // An Xbox list with no rarity is the export's, only the unlocked, so it has no total and is left out of the counts.
  const partial = worksOf(LINES, GENRES, GAMES, [{ ...achievement(1, 'A', 100), service: 'xbox' }])
  assert.deepEqual(overviewOf(partial, GAMES).achievements, { total: 0, unlocked: 0, completed: 0 })
  // Game Center's list is the export's too: only what has progress, so it is left out of the counts as well.
  const gameCenter = worksOf(LINES, GENRES, GAMES, [{ ...achievement(1, 'A', 100), service: 'applegc' }])
  assert.deepEqual(overviewOf(gameCenter, GAMES).achievements, { total: 0, unlocked: 0, completed: 0 })
})

test('a work links to its ROM by the register number, and a work with none has no link', () => {
  const works = worksOf(LINES, GENRES, GAMES, [], [], [{ item_id: '2', romm_id: 7 }])
  assert.equal(pageOf(works, GAMES, works[1]?.slug ?? '')?.rommId, 7)
  assert.equal(pageOf(works, GAMES, works[0]?.slug ?? '')?.rommId, null)
  assert.equal(pageOf(worksOf(LINES, GENRES, GAMES), GAMES, works[1]?.slug ?? '')?.rommId, null)
})

test('a work is owned when the collection says so or a line tells a format, and its formats are told once each', () => {
  const works = worksOf(
    [line({ id: 1, title: 'Tunic', status: 'done', format: 'switch' }), line({ id: 2, title: 'Tunic', status: 'done', format: 'switch, fysisk' }), line({ id: 3, title: 'Celeste' })],
    [],
    GAMES,
    [],
    [line({ id: 1, title: 'Hades', status: 'owned' }), line({ id: 2, title: 'Tunic', status: 'owned', format: 'steam' })],
  )
  const library = libraryOf(works, GAMES).works
  const [tunic, celeste, hades] = ['Tunic', 'Celeste', 'Hades'].map((title) => library.find((work) => work.title === title))
  assert.deepEqual([tunic?.owned, tunic?.format], [true, 'switch, fysisk, steam'])
  assert.deepEqual([celeste?.owned, celeste?.format], [false, null])
  assert.deepEqual([hades?.owned, hades?.format], [true, null])
})

test('a work of the collection alone is in the library and has a page, but is no play, no history and no count of the log', () => {
  const works = worksOf(LINES, GENRES, GAMES, [], [line({ id: 1, title: 'Outer Wilds', status: 'want', rating: 4 }), line({ id: 2, title: 'Hades', year: 2020, status: 'owned', item_id: '1', item_title: 'Hades', format: 'steam' })])
  assert.equal(works.length, 4)
  const library = libraryOf(works, GAMES).works
  const wanted = library.find((work) => work.title === 'Outer Wilds')
  assert.deepEqual([wanted?.status, wanted?.plays, wanted?.owned, wanted?.rating, wanted?.firstOn], ['want', 0, false, 4, null])
  // A game in both is one work: played twice, and owned.
  const hades = library.find((work) => work.title === 'Hades')
  assert.deepEqual([hades?.status, hades?.plays, hades?.owned, hades?.format], ['done', 2, true, 'steam'])
  const page = pageOf(works, GAMES, wanted?.slug ?? '')
  assert.deepEqual([page?.status, page?.entries.length], ['want', 0])
  const logged = loggedOf(works)
  assert.equal(logged.length, 3)
  assert.equal(overviewOf(logged, GAMES).totals.works, 3)
  assert.deepEqual(historyOf(logged, null).entries.map((entry) => entry.title), ['Hades', 'Hades'])
})

test('a line the register did not match is the same work as a matched line of the same title, unless their years differ', () => {
  const works = worksOf([
    line({ id: 1, title: 'TEKKEN 7' }),
    line({ id: 2, title: 'Tekken 7', year: 2015, item_id: '394038', item_title: 'Tekken 7', item_year: 2017 }),
    line({ id: 3, title: 'Prey', year: 1995 }),
    line({ id: 4, title: 'Prey', year: 2017 }),
  ], [], GAMES)
  assert.deepEqual(works.map((work) => [work.title, work.entries.length]), [['Tekken 7', 2], ['Prey', 1], ['Prey', 1]])
})

test('roman numerals and a few years of difference do not make a second work, but a decade does', () => {
  const works = worksOf([
    line({ id: 1, title: "Baldur's Gate 3" }),
    line({ id: 2, title: "Baldur's Gate 3", item_id: '119171', item_title: "Baldur's Gate III", item_year: 2023 }),
    line({ id: 3, title: 'Fortnite', year: 2017 }),
    line({ id: 4, title: 'Fortnite', item_id: '1905', item_title: 'Fortnite', item_year: 2020 }),
  ], [], GAMES)
  assert.deepEqual(works.map((work) => [work.title, work.entries.length]), [["Baldur's Gate III", 2], ['Fortnite', 2]])
})

test('a number read on several days has its newest as the value and the days before as its history, and one read once has none', () => {
  const rows = [
    { source: 'steam', key: 'level', day: '2026-10-28', label: 'Nivå', value: 5, max: null },
    { source: 'steam', key: 'level', day: '2026-09-01', label: 'Nivå', value: 4, max: null },
    { source: 'ra', key: 'rank', day: '2026-10-28', label: 'Rangering', value: 9, max: 170000 },
  ]
  const readings = readingsOf(rows)
  const steam = readings.find((reading) => reading.service === 'steam')
  assert.deepEqual([steam?.value, steam?.history.map((point) => point.value)], [5, [4, 5]])
  assert.deepEqual(readings.find((reading) => reading.service === 'ra')?.history, [])
})
