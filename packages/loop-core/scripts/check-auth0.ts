/**
 * Verifica el Auth0 del write boundary de punta a punta, sin escribir nada.
 *
 * Pide un token M2M real y confirma que trae los TRES scopes que
 * boundary/write.ts exige. Un token valido con scope vacio es el estado en el
 * que la API existe pero nadie le dio permisos: la escritura falla con 403 y en
 * el video no se puede decir que Auth0 verifica el scope.
 *
 *   npm run auth0:check -w loop-core
 */
import { SCOPE } from "../src/boundary/write";
import { getServiceToken, isAuth0Configured } from "../src/boundary/auth0";

const REQUIRED = Object.values(SCOPE);

function claimsOf(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("el access_token no parece un JWT");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

if (!isAuth0Configured()) {
  console.log("Auth0 NO configurado: faltan AUTH0_DOMAIN y/o AUTH0_AUDIENCE en .env.");
  console.log("El boundary sigue siendo el unico camino de escritura, pero exige");
  console.log("ALLOW_UNVERIFIED_WRITES=1 explicito. En ese estado el video NO puede");
  console.log("afirmar que Auth0 verifica el scope.");
  process.exit(1);
}

console.log(`dominio  : ${process.env.AUTH0_DOMAIN}`);
console.log(`audience : ${process.env.AUTH0_AUDIENCE}`);

const token = await getServiceToken();
const claims = claimsOf(token);
const granted = String(claims.scope ?? "").split(" ").filter(Boolean);

console.log(`iss      : ${claims.iss}`);
console.log(`aud      : ${JSON.stringify(claims.aud)}`);
console.log(`sub      : ${claims.sub}`);
console.log(`scope    : ${granted.length ? granted.join(" ") : "(vacio)"}`);

const missing = REQUIRED.filter((s) => !granted.includes(s));
console.log("\nscopes que exige el boundary:");
for (const scope of REQUIRED) {
  console.log(`  ${granted.includes(scope) ? "OK   " : "FALTA"} ${scope}`);
}

if (missing.length === 0) {
  console.log("\nListo: cada escritura aprobada va a verificar su scope contra Auth0.");
  process.exit(0);
}

console.log(`\nFaltan ${missing.length} scope(s). En el dashboard de Auth0:`);
console.log(`  1. APIs -> ${process.env.AUTH0_AUDIENCE} -> pestania Permissions:`);
for (const scope of missing) console.log(`       agregar  ${scope}`);
console.log("  2. Applications -> tu app M2M -> pestania APIs -> desplegar");
console.log(`     ${process.env.AUTH0_AUDIENCE} -> tildar esos permisos -> Update.`);
console.log("  3. Volver a correr este comando.");
process.exit(1);
