import fs from "node:fs";
import path from "node:path";
import { ensureCertificatesAreInstalled } from "office-addin-dev-certs";

const root = path.resolve(import.meta.dirname, "..");
const config = path.join(root, "config.json");
if (!fs.existsSync(config)) fs.copyFileSync(path.join(root, "config.example.json"), config);
fs.mkdirSync(path.join(root, "data"), { recursive: true });

console.log("Preparing a trusted current-user certificate for https://localhost...");
console.log("Windows may show a Security Warning. Choose Yes only if you want to trust this localhost development certificate.");
await ensureCertificatesAreInstalled(365, ["localhost"]);
console.log("\nSetup complete.");
console.log("1. Edit config.json and add a real SEC contact User-Agent if you use the optional SEC lookup.");
console.log("2. Run npm start and keep that terminal open.");
console.log("3. Sideload manifest-local.xml in Excel once on this PC.");
