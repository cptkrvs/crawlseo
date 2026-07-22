import { PrismaClient } from "@prisma/client";

// Some managed platforms expose the database URL under a provider-specific
// name (Scalingo: SCALINGO_POSTGRESQL_URL). Map it to DATABASE_URL so Prisma
// picks it up with no manual env configuration.
if (!process.env.DATABASE_URL && process.env.SCALINGO_POSTGRESQL_URL) {
  process.env.DATABASE_URL = process.env.SCALINGO_POSTGRESQL_URL;
}

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const db =
  globalForPrisma.prisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
