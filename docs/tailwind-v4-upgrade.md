# Update an existing site to Tailwind CSS 4

Keep your content and site settings when you update the framework. Review your
own utility classes after the update to preserve their appearance.

## Before you start

- Use Node.js 20.9 or later, as required by Next.js 16.
- Commit your current site on a branch. Keep a separate branch for the update.
- Check your browser requirements. Tailwind CSS 4 requires Safari 16.4+,
  Chrome 111+, or Firefox 128+. Keep your current Tailwind 3 release if you need
  older browsers.
- Run these commands from your project root. Use `@thallylabs/cli@latest`
  to get the current update command, even if your project has an older CLI.

## Update your site

1. Run `npx @thallylabs/cli@latest starter update` to review the proposed changes.
   This command is a dry run. Check that the plan includes the Tailwind 4
   dependencies and configuration before you apply it.
2. Resolve any conflicts in framework files, `package.json`, or
   `postcss.config.mjs`. An edited `tailwind.config.ts` also needs review.
   The updater stops before writing files when conflicts remain.
3. Run `npx @thallylabs/cli@latest starter update --apply` after the plan has no conflicts.
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

## Configuration changes

The update keeps `tailwind.config.ts` and loads it through `@config` in
`src/app/globals.css`. PostCSS uses `@tailwindcss/postcss`, which handles vendor
prefixes without the separate `autoprefixer` package.

Keep the PostCSS optimization setting. It prevents invalid CSS candidates from
prose examples from reaching the development server. Development CSS remains
readable because minification is disabled there.

Use the Thally updater for the framework files and dependencies. If you also use
`@tailwindcss/upgrade` on custom code, run it on a separate branch and review
every change. Check MDX classes and component props by hand before you keep the
result.

## Keep an existing Tailwind 3 site

Keep your current site and lockfile if you still need Tailwind 3. You do not
need to run the framework update.

To create another Tailwind 3 site, run:

```bash
npx create-thally-docs@latest my-docs --tailwind-version 3
```

This flag applies to creation. It does not downgrade an existing site. Keep
`starter-release.json` unchanged so the updater can identify your current
framework when you choose to update later.
