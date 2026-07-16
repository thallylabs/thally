/**
 * OpenNext adapter configuration for the Cloudflare Workers runtime.
 *
 * Managed Thally Cloud releases use their own immutable release storage, so
 * the public template deliberately avoids coupling incremental cache state to
 * a bucket name owned by Thally. Self-hosters can add an R2 cache override
 * without changing the application runtime.
 */

import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";

export default defineCloudflareConfig();
