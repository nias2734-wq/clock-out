// Turns the common cron shapes into words for the job cards: '3 21 * * *' → '매일 21:03'.
// Anything it does not recognise comes back unchanged, so the card still shows the cron.
// Kept apart from cron.ts because that file is a copy of the plugin's hooks/cron.ts.

type Lang = 'ko' | 'en'

const DOW = { ko: ['일', '월', '화', '수', '목', '금', '토'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }
const isNum = (x: string) => /^\d+$/.test(x)
const pad = (n: number) => String(n).padStart(2, '0')

export function describeCron(cron: string, lang: Lang): string {
  const f = cron.trim().split(/\s+/)
  if (f.length !== 5) return cron
  const [mi = '', ho = '', dom = '', mon = '', dow = ''] = f
  const ko = lang === 'ko'

  // */n * * * *  → every n minutes
  const everyMin = /^\*\/(\d+)$/.exec(mi)
  if (everyMin !== null && ho === '*' && dom === '*' && mon === '*' && dow === '*') return ko ? `${everyMin[1]}분마다` : `every ${everyMin[1]} min`
  // m */n * * *  → every n hours at :m
  const everyHour = /^\*\/(\d+)$/.exec(ho)
  if (isNum(mi) && (everyHour !== null || ho === '*') && dom === '*' && mon === '*' && dow === '*') {
    const n = everyHour?.[1] ?? '1'
    return ko ? `${n === '1' ? '매시' : `${n}시간마다`} ${pad(Number(mi))}분` : `every ${n === '1' ? '' : `${n} `}hour${n === '1' ? '' : 's'} at :${pad(Number(mi))}`
  }
  if (!isNum(mi) || !isNum(ho)) return cron
  const at = `${pad(Number(ho))}:${pad(Number(mi))}`

  // m h D M *  → one date
  if (isNum(dom) && isNum(mon) && dow === '*') return `${pad(Number(mon))}-${pad(Number(dom))} ${at}`
  if (dom !== '*' || mon !== '*') return cron
  if (dow === '*') return ko ? `매일 ${at}` : `daily ${at}`
  if (dow === '1-5') return ko ? `평일 ${at}` : `weekdays ${at}`
  if (dow === '0,6' || dow === '6,0') return ko ? `주말 ${at}` : `weekends ${at}`
  // m h * * 1,3,5  → named days
  if (/^[0-7](,[0-7])*$/.test(dow)) {
    const days = dow.split(',').map(d => DOW[lang][Number(d) % 7]).join(ko ? '·' : ', ')
    return ko ? `매주 ${days} ${at}` : `${days} ${at}`
  }
  return cron
}
