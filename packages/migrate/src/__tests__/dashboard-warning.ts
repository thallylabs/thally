import type { MigrationWarning } from '../index.js'

/** Every Mintlify migration carries one dashboard-access warning; drop it (by its exact opening) before asserting on the rest. */
export const withoutDashboardWarning = (warnings: Array<MigrationWarning>): Array<MigrationWarning> =>
  warnings.filter((warning) => !warning.message.includes('Access control set in the Mintlify dashboard is not visible'))
