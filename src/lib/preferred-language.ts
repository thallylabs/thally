import { create } from 'zustand'

/**
 * The language a reader last picked, shared by every code group and by the
 * API code panel, so choosing one switches them all.
 */
export const usePreferredLanguageStore = create<{
  preferredLanguages: Array<string>
  addPreferredLanguage: (language: string) => void
}>()((set) => ({
  preferredLanguages: [],
  addPreferredLanguage: (language) =>
    set((state) => ({
      preferredLanguages: [
        ...state.preferredLanguages.filter(
          (preferredLanguage) => preferredLanguage !== language,
        ),
        language,
      ],
    })),
}))

export function resolvePreferredLanguage(
  availableLanguages: Array<string>,
  preferredLanguages: Array<string>,
) {
  if (!availableLanguages.length) {
    return undefined
  }
  const languageSet = new Set(availableLanguages)
  for (let index = preferredLanguages.length - 1; index >= 0; index -= 1) {
    const candidate = preferredLanguages[index]
    if (languageSet.has(candidate)) {
      return candidate
    }
  }
  return availableLanguages[0]
}
