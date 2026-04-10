interface PGliteRuntimeAssets {
    readonly extensions: Record<string, URL>;
    readonly fsBundle: Blob;
    readonly wasmModule: unknown;
}
interface PrismaDevRuntimeAsset {
    readonly fileName: string;
    readonly kind: "core" | "extension";
    readonly name: string;
    readonly sourcePath: string;
}
interface CopiedPrismaDevRuntimeAsset extends PrismaDevRuntimeAsset {
    readonly destinationPath: string;
}
declare function copyPrismaDevRuntimeAssets(destinationDir: string | URL): Promise<CopiedPrismaDevRuntimeAsset[]>;
declare function getPrismaDevRuntimeAssetManifest(): readonly PrismaDevRuntimeAsset[];
declare function getPGliteRuntimeAssets(): Promise<PGliteRuntimeAssets>;
declare function registerBundledPGliteRuntimeAssetSources(sources: {
    extensions: Record<string, string | URL>;
    fsBundle: string | URL;
    initdbWasm: string | URL;
    wasmModule: string | URL;
}): void;
declare function resolveBundledRuntimeAssetSource(source: string | URL, baseURL?: string): URL;

export { type CopiedPrismaDevRuntimeAsset, type PrismaDevRuntimeAsset, copyPrismaDevRuntimeAssets, getPGliteRuntimeAssets, getPrismaDevRuntimeAssetManifest, registerBundledPGliteRuntimeAssetSources, resolveBundledRuntimeAssetSource };
