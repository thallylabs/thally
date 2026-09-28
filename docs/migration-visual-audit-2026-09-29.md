# Migration visual audit — 29 September 2026

The local CLI was run against six public documentation repositories, then the generated Next.js sites were opened alongside their live counterparts in Chrome. Production builds and `thally check` were recorded, but the visual comparison below is the acceptance evidence. The generated sites use Thally's theme, so exact typography and spacing are outside the scope of content and navigation fidelity.

| Source | Live page used for comparison | Imported pages / assets | `thally check` | Visual result |
| --- | --- | ---: | ---: | --- |
| pnpm (Docusaurus) | [Feature Comparison](https://pnpm.io/feature-comparison), [pnpr configuration](https://pnpm.io/pnpr/configuration) | 383 / 205 | 0 errors, 0 warnings | Table renders once with emoji; footer, logo, pnpr landing route, and one active sidebar page were verified in browser. |
| Mintlify docs | [Spanish quickstart](https://www.mintlify.com/docs/es/quickstart), [English quickstart](https://www.mintlify.com/docs/quickstart) | 1,121 / 123 | 0 errors, 404 warnings | Translated content, navigation labels, branding, and footer appear. Interactive custom widgets and math still degrade; some UI labels remain English. |
| Docusaurus | [Configuration API](https://docusaurus.io/docs/api/docusaurus-config) | 1,168 / 65 | 0 errors, 15 warnings | Source logo, header/footer links, content, code blocks, and collapsed sidebar categories appear. Many custom React examples remain unsupported. |
| Magic (Mintlify) | [Welcome](https://docs.magic.link/home/welcome) | 158 / 118 | 0 errors, 18 warnings | Logo, footer links/socials, content cards, and distinct heading anchors appear. Remaining diagnostics include 11 broken anchors. |
| NeMo Gym (Fern) | [About](https://docs.nvidia.com/nemo/gym/main/about/) | 121 / 5 | 0 errors, 1 warning | Product diagram and Next Steps cards render. NVIDIA's global visual shell is not portable from the docs repository. |
| Cohere (Fern) | [Welcome](https://docs.cohere.com/docs/welcome), [Release Notes](https://docs.cohere.com/v2/changelog) | 322 / 754 | 0 errors, 36 warnings | Banner, logo, navigation, and individual pages render. Full release bodies now populate the changelog feed, with individual releases kept at their routes. |

## Gaps fixed after comparing the pages

- pnpm's GFM table was displayed twice because description extraction consumed raw table syntax as prose. The table now renders once; Docusaurus `:shortcode:` emoji become Unicode outside code blocks.
- The pnpm footer was absent because Docusaurus site configuration was read for theme colors but not for navbar and footer content. Static config projection now includes copyright, footer columns, navbar links, title, logo, and favicon without executing source JavaScript.
- Sidebar rows could both look active when a parent and child resolved to the same route. The runtime now applies the active state to the exact page route, and migration removes sibling links that collapse to the same final slug.
- Docusaurus sidebar categories were projected as permanently expanded groups. They are now collapsible nodes in source order.
- Fern changelog tabs could lead to an empty `overview.mdx`; they now materialize a dated feed with full article bodies, including when no overview file exists. Entries remain routable but do not flood the sidebar. The feed closes source fences that run to end of file and retains dated section fragments.
- Fern hidden pages stay routable while leaving the navigation. Source announcement text, navbar labels, external tabs, logo right text, and relative image assets are carried into Thally.
- Locale navigation now uses source-authored labels and ordering. The route/API lookup keeps the language prefix; translated files are copied into their locale paths.
- Imported headings keep distinct IDs and linked explicit fragments. The checker recognizes those IDs and encoded fragments without misreporting duplicates.
- The CLI prints the generated path and a copyable `npm run dev` command after migration.

## Remaining visual and functional differences

- Thally's header, sidebar spacing, search, feedback controls, typography, and footer layout differ from each source platform. Migration carries content and portable configuration; it does not clone third-party themes.
- Mintlify custom interactive components such as its assistant playground have no automatic Thally equivalent. Math is preserved in a fenced block until a math renderer exists. The 404 Mintlify check warnings include 185 broken-anchor diagnostics. One sampled `#param-icons` fragment is absent on the live source page too; the remaining diagnostics need source-by-source review.
- Docusaurus migration emits 678 compatibility warnings, largely for custom React components and imports across archived versions. The configuration page looked correct, but those widgets can lose behavior even when the production build passes.
- Cohere's Fern release feed now includes full text, but its RSS control, pagination, date/section presentation, version selector, and Ask AI control still differ. Individual release URLs continue to work.
- Magic retains 18 check warnings, including 11 anchor warnings. NeMo's NVIDIA wrapper/theme cannot be reconstructed solely from its Fern docs source.

No universal near-zero visual fidelity claim is warranted from these six examples. A migration with source-specific React components or platform-owned global chrome still requires review of those parts before publication.
