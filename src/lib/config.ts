// Panel-side view of the core: same API, but marked server-only so it can never
// be bundled for the browser (the config names keychain accounts and paths).
import "server-only";
export * from "@/core/config";
