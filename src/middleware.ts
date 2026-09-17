import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Middleware Next.js :
 * - Mode démonstration (aucune variable Supabase) : ne fait rien, toutes
 *   les pages restent accessibles comme avant.
 * - Mode connecté : rafraîchit la session Supabase (cookies) et protège
 *   toutes les routes internes. L'identité est VÉRIFIÉE via `getUser()`
 *   (jamais uniquement via la session locale).
 */

const PUBLIC_PATHS = [
  "/connexion",
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe",
  "/robots.txt",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Les routes API gèrent leur propre sécurité et ne doivent JAMAIS être
 * redirigées vers /connexion : les webhooks Shopify vérifient la signature
 * HMAC, les routes internes vérifient la session et renvoient 401/403 en
 * JSON.
 */
function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Mode démonstration : aucune authentification requise.
  if (!url || !key) {
    return NextResponse.next();
  }

  // Routes API : sécurité gérée dans chaque route (HMAC ou session).
  if (isApiPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Identité vérifiée par le serveur Supabase (et rafraîchissement du token).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    // Non authentifié → redirection vers /connexion avec retour prévu.
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/connexion";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === "/connexion") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  // Tout sauf les assets statiques Next.js et le favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)"],
};
