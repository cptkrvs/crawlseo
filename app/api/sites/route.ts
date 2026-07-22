import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncGSCDataForSite } from "@/lib/workers/gsc-sync";
import { ensureDefaultAlerts } from "@/lib/alerts/evaluate";
import { assertUrlAllowed } from "@/lib/net/ssrf-guard";

/** Turn a user-supplied domain/property into the URL the crawler will fetch. */
function domainToUrl(domain: string): string {
  const cleaned = domain.trim().replace(/^sc-domain:/, "");
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
}

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sites = await db.site.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        domain: true,
        gscProperty: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            keywords: true,
            crawls: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(sites);
  } catch (error) {
    console.error("Error fetching sites:", error);

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch sites",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { domain, gscProperty } = (await req.json()) as {
      domain: string;
      gscProperty: string;
    };

    if (!domain || !gscProperty) {
      return Response.json(
        { error: "Missing domain or gscProperty" },
        { status: 400 }
      );
    }

    // SSRF: reject domains that point at internal/private hosts before we ever
    // store them or hand them to the crawler.
    try {
      await assertUrlAllowed(domainToUrl(domain));
    } catch {
      return Response.json(
        { error: "Domain must be a public, resolvable http(s) host" },
        { status: 400 }
      );
    }

    // Check if site already exists
    const existing = await db.site.findUnique({
      where: {
        userId_domain: {
          userId: session.user.id,
          domain,
        },
      },
    });

    if (existing) {
      return Response.json(
        { error: "Site already exists" },
        { status: 409 }
      );
    }

    // Create the site
    const site = await db.site.create({
      data: {
        userId: session.user.id,
        domain,
        gscProperty,
      },
      select: {
        id: true,
        domain: true,
        gscProperty: true,
        createdAt: true,
      },
    });

    await ensureDefaultAlerts(session.user.id, site.id);

    // Kick off initial GSC sync (don't block the response)
    void syncGSCDataForSite(session.user.id, site.id, 28).catch((err) =>
      console.error("Initial GSC sync failed:", err)
    );

    return Response.json(site, { status: 201 });
  } catch (error) {
    console.error("Error creating site:", error);

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to create site",
      },
      { status: 500 }
    );
  }
}
