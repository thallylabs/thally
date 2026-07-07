import { input, select } from '@inquirer/prompts'
import { basename } from 'node:path'
import { resolve } from 'node:path'

export interface ScaffoldAnswers {
  projectDir: string
  projectName: string
  description: string
  brandPreset: string
  repoUrl: string
  doInstall: boolean
  i18nLocales?: Array<{ code: string; label: string }>
}

export async function gatherAnswers(
  dirArg: string | undefined,
  useDefaults: boolean,
): Promise<ScaffoldAnswers> {
  // 1. Project directory
  let projectDir: string
  if (dirArg) {
    projectDir = resolve(dirArg)
  } else if (useDefaults) {
    projectDir = resolve('my-docs')
  } else {
    const dirName = await input({
      message: '  Project directory:',
      default: 'my-docs',
    })
    projectDir = resolve(dirName)
  }

  // 2. Project name
  const defaultName = basename(projectDir)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  const projectName = useDefaults
    ? defaultName
    : await input({
        message: '  Project name:',
        default: defaultName,
      })

  // 3. Description
  const defaultDesc = `Documentation for ${projectName}.`
  const description = useDefaults
    ? defaultDesc
    : await input({
        message: '  Description:',
        default: defaultDesc,
      })

  // 4. Brand preset
  const brandPreset = useDefaults
    ? 'primary'
    : await select({
        message: '  Brand preset:',
        choices: [
          { name: 'primary', value: 'primary' },
          { name: 'secondary', value: 'secondary' },
        ],
        default: 'primary',
      })

  // 5. GitHub repo (optional)
  const repoUrl = useDefaults
    ? ''
    : await input({
        message: '  GitHub repo URL (optional):',
        default: '',
      })

  // 6. Install deps?
  let doInstall = true
  if (!useDefaults) {
    const shouldInstall = await input({
      message: '  Install dependencies? (Y/n):',
      default: 'Y',
    })
    doInstall = shouldInstall.toLowerCase() !== 'n'
  }

  // 7. Multi-language support?
  let i18nLocales: Array<{ code: string; label: string }> | undefined
  if (!useDefaults) {
    const enableI18n = await input({
      message: '  Enable multi-language support? (y/N):',
      default: 'N',
    })
    if (enableI18n.toLowerCase() === 'y') {
      const localesInput = await input({
        message: '  Which locales? (comma-separated codes, e.g. es,fr,de):',
        default: 'es',
      })
      const LOCALE_LABELS: Record<string, string> = {
        en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch',
        it: 'Italiano', pt: 'Português', ja: '日本語', ko: '한국어',
        zh: '中文', ru: 'Русский', ar: 'العربية', nl: 'Nederlands',
      }
      const codes = localesInput.split(',').map((c) => c.trim()).filter(Boolean)
      i18nLocales = codes.map((code) => ({
        code,
        label: LOCALE_LABELS[code] ?? code.toUpperCase(),
      }))
    }
  }

  return { projectDir, projectName, description, brandPreset, repoUrl, doInstall, i18nLocales }
}
