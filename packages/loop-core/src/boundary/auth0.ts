/**
 * Invariante 2 del core: toda escritura verifica un token M2M de Auth0 con el
 * scope correspondiente antes de tocar nada.
 *
 * Setup (15 min, lo hace quien tenga la cuenta): API RS256 con identifier
 * AUTH0_AUDIENCE y permisos write:workspace, send:channel, schedule:job; una
 * app M2M autorizada con esos tres permisos.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function keySet() {
  if (!process.env.AUTH0_DOMAIN) throw new Error("AUTH0_DOMAIN no configurado");
  jwks ??= createRemoteJWKSet(
    new URL(`https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`),
  );
  return jwks;
}

export class AuthorizationError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

export function isAuth0Configured(): boolean {
  return Boolean(process.env.AUTH0_DOMAIN && process.env.AUTH0_AUDIENCE);
}

/** Verifica firma, issuer, audience y la presencia del scope pedido. */
export async function verifyScope(
  token: string | undefined,
  required: string,
): Promise<JWTPayload> {
  if (!isAuth0Configured()) {
    // Antes de que Auth0 exista, el boundary sigue siendo el unico camino de
    // escritura, pero hay que pedir el bypass a mano. Nunca por defecto.
    if (process.env.ALLOW_UNVERIFIED_WRITES === "1") {
      return { scope: required, sub: "dev-bypass" } as JWTPayload;
    }
    throw new AuthorizationError(
      "Auth0 no configurado. Cargar AUTH0_DOMAIN/AUTH0_AUDIENCE o correr con ALLOW_UNVERIFIED_WRITES=1 (solo en desarrollo).",
      500,
    );
  }
  if (!token) throw new AuthorizationError("falta el token de servicio", 401);

  const { payload } = await jwtVerify(token, keySet(), {
    issuer: `https://${process.env.AUTH0_DOMAIN}/`,
    audience: process.env.AUTH0_AUDIENCE,
  });
  const scopes = String(payload.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.includes(required)) {
    throw new AuthorizationError(`missing scope ${required}`, 403);
  }
  return payload;
}

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | undefined;

/** Client credentials. Cachea hasta 60s antes del vencimiento. */
export async function getServiceToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_CLIENT_ID;
  const clientSecret = process.env.AUTH0_CLIENT_SECRET;
  const audience = process.env.AUTH0_AUDIENCE;
  if (!domain || !clientId || !clientSecret || !audience) {
    throw new AuthorizationError("faltan credenciales M2M de Auth0 en el entorno", 500);
  }

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience,
    }),
  });
  if (!res.ok) {
    throw new AuthorizationError(`Auth0 token endpoint: ${res.status} ${await res.text()}`, 500);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, body.expires_in - 60) * 1000,
  };
  return cached.token;
}
