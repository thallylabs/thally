# Update an existing site to Tailwind CSS 4

Keep your content and site settings when you update the framework. Review your
own utility classes after the update to preserve their appearance.

## Before you start

- Use Node.js 20.9 or later, as required by Next.js 16.
- Commit your current site on a branch. Keep a separate branch for the update.
- Check your browser requirements. Tailwind CSS 4 requires Safari 16.4+,
  Chrome 111+, or Firefox 128+. Keep your current Tailwind 3 release if you need
  older browsers.
- Wait for a promoted Tailwind 4 scaffold and its published CLI. A runtime
  commit, a starter sync, and a package release are separate steps. A local
  dependency update does not change the archive that `create-thally-docs`
  downloads. Use a CLI release that includes the promoted scaffold record.

## Update the framework first

1. Run `npx thally starter update` to review the proposed changes.
2. Resolve any conflicts in framework files, `package.json`, or
   `postcss.config.mjs`. An edited `tailwind.config.ts` also needs review.
   The updater stops before writing files when conflicts remain.
3. Run `npx thally starter update --apply` after the plan has no conflicts.
4. Run `npm ci` to install the updated lockfile.
5. Review utility classes in `src/content/`, `src/mdx/custom-components.tsx`,
   `snippets/`, and any other code you own. The framework updater preserves
   those files. It does not migrate the utility classes inside them.

Change these classes only where they are CSS utilities, including their
variants such as `focus:` and `hover:`:

- `shadow-sm` becomes `shadow-xs`; `shadow` becomes `shadow-sm`.
- `drop-shadow-sm` becomes `drop-shadow-xs`; `drop-shadow` becomes `drop-shadow-sm`.
- `blur-sm` becomes `blur-xs`; `blur` becomes `blur-sm`.
- `backdrop-blur-sm` becomes `backdrop-blur-xs`; `backdrop-blur` becomes `backdrop-blur-sm`.
- `rounded-sm` becomes `rounded-xs`; `rounded` becomes `rounded-sm`.
- `outline-none` becomes `outline-hidden` to keep the accessible invisible outline.
- `ring` becomes `ring-3` to keep the three-pixel width. Set a ring color when
  you previously relied on the default blue color.

Do not rename component props or values such as `variant="outline"` or
`shape="rounded"`. Review the
[Tailwind upgrade guide](https://tailwindcss.com/docs/upgrade-guide) for other
changes, including variant order, borders, gradients, hover behavior, and
arbitrary values.

## Check the result

1. Run `npx thally check --ci .`.
2. Run `npm test`, `npm run lint`, and `npm run build`.
3. Start the site with `npm run dev`.
4. Check prose, code blocks, navigation, buttons, focus outlines, and custom
   components in light and dark themes. Repeat at a mobile width.
5. Commit the reviewed update. Publish through your normal release process.

The runtime retains `tailwind.config.ts` through an explicit `@config` in
`src/app/globals.css`. PostCSS uses `@tailwindcss/postcss`; the separate
`autoprefixer` dependency is no longer needed. Keep the PostCSS optimization
setting: it removes invalid prose candidates in development as well as in
production. Development CSS stays readable. Keep the generated runtime files
together with the matching package and PostCSS changes.

## Limits of the Tailwind upgrade tool

Do not use `npx @tailwindcss/upgrade` as an automatic Thally update step.
With the original Tailwind 3 configuration, version 4.3.3 fails while reading a
custom typography font size. After the framework update, the tool can rewrite
framework files while leaving MDX content classes unchanged. Its broad string
migration can also change component variant names.

If you use the tool for a separate custom project, use Node.js 20 or later and
a clean Git branch. `--force` skips its clean-tree check; it does not resolve
migration errors. Review every changed file and test the site before keeping
the result.

## Keep an existing Tailwind 3 site

You can keep the current site and its lockfile without running the framework
update. The `--tailwind-version 3` creation flag also selects a frozen Tailwind 3
starter. It does not apply to `starter update`. Retained scaffold records let the
updater identify that site's original base when you update later. Do not edit `starter-release.json` to change its
release identity. Maintainers must retain previous scaffold records during
promotion; replacing only a manifest is not an upgrade or a rollback.
