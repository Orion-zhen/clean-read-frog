import { createEnv } from "@t3-oss/env-core"
import {
  createExtensionClientEnvSchema,
  getExtensionDistribution,
  resolveExtensionEnv,
} from "./shared"

const shouldSkipRequiredProductionEnv = import.meta.env.WXT_SKIP_ENV_VALIDATION === "true"
const distribution = getExtensionDistribution(import.meta.env)
const extensionClientEnvSchema = createExtensionClientEnvSchema(
  import.meta.env.PROD,
  shouldSkipRequiredProductionEnv,
  distribution,
)

export const env = createEnv({
  clientPrefix: "WXT_",
  client: extensionClientEnvSchema,
  runtimeEnv: resolveExtensionEnv(import.meta.env),
  emptyStringAsUndefined: true,
})
