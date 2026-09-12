/**
 * R4, primera media hora: listar las tools vivas del workspace y pasarle la
 * lista a R1 y R2. Nadie escribe una tool de Ambiguous sin esta salida.
 *
 *   npm run tools:list -w loop-core            # nombres
 *   npm run tools:list -w loop-core -- --full  # nombres + schema
 */
import { listWorkplaceTools } from "../src/boundary/workplace-mcp";

const full = process.argv.includes("--full");

const tools = await listWorkplaceTools();
console.log(`${tools.length} tools en el workspace:\n`);
for (const tool of tools.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`- ${tool.name}${tool.description ? `: ${tool.description.split("\n")[0]}` : ""}`);
  if (full) console.log(`  schema: ${JSON.stringify(tool.inputSchema)}`);
}
