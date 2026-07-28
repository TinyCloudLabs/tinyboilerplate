// The app manifest lives at examples/tasks/manifest.json (the canonical capability
// contract, single source of truth). Vite resolves the JSON import at build time;
// this ambient declaration gives tsc its shape without duplicating the data.
declare module "*/manifest.json" {
  const manifest: {
    manifest_version: number;
    app_id: string;
    name: string;
    description?: string;
    defaults?: boolean;
    permissions: Array<{
      service: string;
      path: string;
      actions: string[];
      description?: string;
    }>;
  };
  export default manifest;
}
