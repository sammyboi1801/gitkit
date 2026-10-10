/** The npm packages bundled into dist/, as found by esbuild itself. */
export function bundledPackages(): Promise<[name: string, version: string, licence: string][]>;
