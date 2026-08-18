/**
 * The session cookie's name, and nothing else.
 *
 * Deliberately its own module with no imports. The middleware needs this name
 * and runs on the Edge runtime, where node:crypto does not exist - importing it
 * from session.ts would drag the crypto in transitively and fail the build with
 * "Reading from node:crypto is not handled by plugins".
 */
export const SESSION_COOKIE = "hvac_dashboard";
