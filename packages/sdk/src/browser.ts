import { installAnykpiBrowser } from "./browser-install";
import type { AnykpiBrowserScope } from "./browser-install";

const globalScope = globalThis as typeof globalThis & {
  window?: AnykpiBrowserScope;
} & AnykpiBrowserScope;

installAnykpiBrowser(globalScope.window ?? globalScope);
