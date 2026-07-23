import { loadApiProviderConfig } from "./usage-client.mjs";

const configPath = process.argv[2];
if (!configPath) throw new Error("用法：node scripts/validate-provider.mjs <provider.json>");
const provider = loadApiProviderConfig(configPath);
console.log(JSON.stringify({ id: provider.id, label: provider.label, baseUrl: provider.baseUrl }, null, 2));
