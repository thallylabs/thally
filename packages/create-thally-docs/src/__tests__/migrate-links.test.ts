/** Internal link diagnostics must recognise copied files whose names need URL encoding. */
import { describe, expect, it } from 'vitest'
import type { MigrationBundle } from '@thallylabs/migrate'

import { reportUnresolvedMigrationLinks } from '../migrate/links.js'

describe('reportUnresolvedMigrationLinks', () => {
  it('does not report a link to a copied asset whose path contains a space', () => {
    const bundle = {
      pages: [{ id: 'guide', navigationId: 'guide', title: 'Guide', body: '![one](/Folder%20One/pic/1.png) ![gone](/Folder%20One/pic/2.png)' }],
      assets: [{ path: 'Folder One/pic/1.png', content: Buffer.from('one') }],
      docsConfig: { tabs: [] },
      warnings: [],
    } as unknown as MigrationBundle
    reportUnresolvedMigrationLinks(bundle)
    expect(bundle.warnings).toHaveLength(1)
    expect(bundle.warnings[0].message).toContain('/Folder%20One/pic/2.png')
    expect(bundle.warnings[0].message).not.toContain('1.png')
  })
})
