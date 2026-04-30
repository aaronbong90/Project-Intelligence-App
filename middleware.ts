import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

function clearSupabaseCookies(response: NextResponse, cookieNames: string[]) {
  cookieNames
    .filter((name) => name.startsWith("sb-"))
    .forEach((name) => {
      response.cookies.set(name, "", {
        expires: new Date(0),
        maxAge: 0,
        path: "/"
      });
    });
}

export async function middleware(request: NextRequest) {
  const hasSupabaseEnv = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  if (!hasSupabaseEnv) {
    return NextResponse.next();
  }

  const response = NextResponse.next({
    request: {
      headers: request.headers
    }
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  let session = null;
  try {
    const sessionResponse = await supabase.auth.getSession();
    session = sessionResponse.data.session;
  } catch {
    clearSupabaseCookies(
      response,
      request.cookies.getAll().map((cookie) => cookie.name)
    );
  }

  const pathname = request.nextUrl.pathname;
  const isAuthRoot = pathname === "/auth";
  const needsAuth = pathname.startsWith("/dashboard") || pathname.startsWith("/admin") || pathname.startsWith("/settings");

  if (needsAuth && !session) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth";
    redirectUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (isAuthRoot && session) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    return NextResponse.redirect(redirectUrl);
  }

  if (isAuthRoot && !session && !request.nextUrl.searchParams.get("redirectTo")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/auth/:path*", "/dashboard/:path*", "/admin/:path*", "/settings/:path*"]
};
