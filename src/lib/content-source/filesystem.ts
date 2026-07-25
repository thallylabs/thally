/**
 * The default ContentSource: content embedded by the build.
 *
 * A thin async adapter over `@/lib/runtime-sources`, which already resolves
 * to direct filesystem reads in development and the generated source map in
 * production. Behavior is byte-for-byte identical to the pre-ContentSource
 * engine — OSS and self-host builds never notice this layer exists.
 */

import {
  listRuntimeSources,
  readRuntimeSource,
  runtimeSourceExists,
  runtimeSourceModifiedAt,
} from '@/lib/runtime-sources'
import type { ContentSource, ContentSourceFile } from './types'

export const filesystemContentSource: ContentSource = {
  kind: 'filesystem',

  async exists(projectPath: string): Promise<boolean> {
    return runtimeSourceExists(projectPath)
  },

  async read(projectPath: string): Promise<ContentSourceFile | null> {
    if (!runtimeSourceExists(projectPath)) return null
    return {
      content: readRuntimeSource(projectPath),
      modifiedAtMs: runtimeSourceModifiedAt(projectPath),
    }
  },

  async modifiedAt(projectPath: string): Promise<number> {
    return runtimeSourceModifiedAt(projectPath)
  },

  async list(prefix: string): Promise<Array<string>> {
    return listRuntimeSources(prefix)
  },
}
