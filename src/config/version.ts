/**
 * Software version configuration
 *
 * This version is tracked with each extraction run to enable:
 * - Re-running extractions when the software improves
 * - Comparing results between different software versions
 * - Preventing duplicate extractions with same model+version+set
 *
 * The version is read from package.json. To update:
 *   npm version patch   # 0.1.0 -> 0.1.1 (bug fixes)
 *   npm version minor   # 0.1.0 -> 0.2.0 (new features)
 *   npm version major   # 0.1.0 -> 1.0.0 (breaking changes)
 *
 * Increment the version when making changes to:
 * - AI prompts or extraction schemas
 * - Transaction parsing logic
 * - Account detection/linking logic
 * - Any other changes that would affect extraction output
 */

import packageJson from "../../package.json";

export const SOFTWARE_VERSION = packageJson.version;
