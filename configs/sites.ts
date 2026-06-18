export interface SiteConfig {
  name: string
  url: string
  /** Optional extended tests paths beyond the homepage */
  paths?: string[]
  /** Optional expected page title regex to validate */
  expectedTitle?: RegExp
  /** Optional required visible text on the page */
  requiredText?: RegExp
  /** Optional known issues to annotate in test output */
  knownIssues?: string
}

export const sites: SiteConfig[] = [
  {
    name: 'jimmyyao.com',
    url: 'https://jimmyyao.com',
    expectedTitle: /Jimmy Yao/,
  },
  {
    name: 'www.jimmyyao.com',
    url: 'https://www.jimmyyao.com',
    expectedTitle: /Jimmy Yao/,
  },
  {
    name: 'study.jimmyyao.com',
    url: 'https://study.jimmyyao.com',
    expectedTitle: /Minna Next/,
    paths: ['/login', '/admin/system', '/admin/visitors', '/admin/monitor'],
  },
  {
    name: 'next-app',
    url: 'https://next-app-kohl-one.vercel.app',
    expectedTitle: /Minna Next/,
  },
]
