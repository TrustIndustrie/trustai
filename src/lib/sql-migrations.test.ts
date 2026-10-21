import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Vérifications statiques des migrations Supabase et de l'hygiène des
 * secrets. Les tests dynamiques (application réelle des migrations +
 * policies RLS avec utilisateurs simulés) vivent dans
 * supabase/tests/rls_policies.test.sql.
 */

const migrationsDir = path.join(process.cwd(), "supabase/migrations");
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
const allSql = migrationFiles
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), "utf8"))
  .join("\n");

describe("Migrations SQL", () => {
  it("des migrations versionnées existent", () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("chaque table métier du schéma public a la RLS activée", () => {
    // Les tables sont créées soit directement, soit avec « if not exists »
    // (migrations rejouables) : les deux formes doivent être couvertes.
    const created = [
      ...allSql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g),
    ].map((m) => m[1]);
    expect(created.length).toBeGreaterThanOrEqual(18);

    // Certaines migrations activent la RLS par une boucle sur un tableau de
    // noms : ces tables-là sont tout aussi couvertes qu'avec un ordre
    // littéral. On collecte donc les deux formes.
    const loopCovered = new Set<string>();
    for (const block of allSql.matchAll(
      /foreach\s+\w+\s+in\s+array\s+array\[([\s\S]*?)\]([\s\S]*?)end\s*\$\$/g,
    )) {
      if (!block[2].includes("enable row level security")) continue;
      for (const name of block[1].matchAll(/'([a-z_]+)'/g)) {
        loopCovered.add(name[1]);
      }
    }

    for (const table of created) {
      const covered =
        allSql.includes(`alter table public.${table} enable row level security`) ||
        loopCovered.has(table);
      expect(covered, `RLS manquante pour public.${table}`).toBe(true);
    }
  });

  it("les 13 tables du socle logistique existent et n'accordent aucun droit direct", () => {
    const logistiques = [
      "recap_sources", "recap_reads", "logistics_lines", "logistics_line_events",
      "delivery_jobs", "delivery_allocations", "skara_documents",
      "skara_document_extractions", "skara_document_corrections",
      "match_candidates", "logistics_anomalies", "sync_events",
      "sensitive_access_logs",
    ];
    expect(logistiques).toHaveLength(13);

    // Le tableau de révocation doit couvrir EXACTEMENT ces 13 tables. On
    // découpe tous les blocs de boucle, puis on retient celui qui révoque.
    const revokeBlock = [
      ...allSql.matchAll(
        /foreach\s+\w+\s+in\s+array\s+array\[([\s\S]*?)\]([\s\S]*?)end\s*\$\$/g,
      ),
    ].find((block) => block[2].includes("revoke all on public"));
    expect(revokeBlock, "bloc de révocation des droits directs introuvable").toBeDefined();
    const revoked = [...revokeBlock![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const table of logistiques) {
      expect(allSql.includes(`create table if not exists public.${table}`), table).toBe(true);
      expect(revoked.includes(table), `droits directs non révoqués : ${table}`).toBe(true);
    }
    expect(revoked.sort()).toEqual([...logistiques].sort());
  });

  it("chaque RPC logistique retire EXECUTE à public et anon", () => {
    for (const fn of [
      "logistics_summary",
      "set_variant_logistics",
      "allocate_to_delivery_job",
      "get_delivery_job",
    ]) {
      expect(allSql.includes(`public.${fn}`), `RPC ${fn} absente`).toBe(true);
    }
    // Révocation générique par boucle sur les signatures.
    expect(allSql.includes("revoke all on function %s from public")).toBe(true);
    expect(allSql.includes("revoke all on function %s from anon")).toBe(true);
    expect(allSql.includes("grant execute on function %s to authenticated")).toBe(true);
  });

  it("les fonctions du socle logistique verrouillent leur search_path", () => {
    const migration = fs.readFileSync(
      path.join(migrationsDir, "20260819000900_socle_logistique.sql"),
      "utf8",
    );
    // Uniquement les DÉCLARATIONS (en début de ligne) : les mentions en
    // commentaire ne doivent pas fausser le comptage.
    const definers = migration.match(/^security definer$/gm) ?? [];
    const searchPaths = migration.match(/^set search_path = ''$/gm) ?? [];
    expect(definers.length).toBeGreaterThanOrEqual(4);
    expect(searchPaths.length).toBeGreaterThanOrEqual(definers.length);
  });

  it("les entités demandées existent toutes", () => {
    for (const table of [
      "organizations", "stores", "warehouses", "profiles", "user_store_access",
      "customers", "orders", "order_lines", "products", "product_variants",
      "suppliers", "product_suppliers", "supplier_orders", "supplier_order_lines",
      "shipments", "shipment_legs", "payments", "acquisition_journeys",
      "approval_requests", "activity_logs",
    ]) {
      expect(allSql.includes(`create table public.${table}`), table).toBe(true);
    }
  });

  it("les champs Shopify futurs sont préparés avec unicité", () => {
    for (const col of [
      "shopify_product_id", "shopify_variant_id", "shopify_order_id",
      "shopify_customer_id", "shopify_updated_at",
    ]) {
      expect(allSql.includes(col), col).toBe(true);
    }
    expect(allSql.includes("products_shopify_id_key")).toBe(true);
    expect(allSql.includes("orders_shopify_id_key")).toBe(true);
  });

  it("les fonctions security definer épinglent le search_path", () => {
    // On ne compte que les clauses réelles (ligne entière), pas les commentaires.
    const definerCount = (allSql.match(/^security definer$/gm) ?? []).length;
    const pinned = (allSql.match(/^security definer\nset search_path = ''$/gm) ?? []).length;
    expect(definerCount).toBeGreaterThan(0);
    expect(pinned).toBe(definerCount);
  });

  it("Herblay reste un magasin et Argenteuil un dépôt dans le seed distant", () => {
    const seed = fs.readFileSync(path.join(process.cwd(), "supabase/seed.sql"), "utf8");
    expect(seed).toMatch(/insert into public\.stores[\s\S]*'HER', 'Trust Herblay', 'Herblay'/);
    expect(seed).toMatch(/insert into public\.warehouses[\s\S]*'Dépôt d''Argenteuil', 'Argenteuil'/);
    // Jamais un dépôt « Herblay » ni un magasin « Argenteuil ».
    expect(seed).not.toMatch(/warehouses[\s\S]{0,400}Herblay'/);
    expect(seed.includes("'ARG'")).toBe(false);
  });
});

describe("Hygiène des secrets", () => {
  it(".env.example ne contient aucune valeur", () => {
    const env = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    for (const line of env.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) {
        expect(match[2], `valeur non vide pour ${match[1]}`).toBe("");
      }
    }
  });

  it("aucune clé secrète en dur ni URL Postgres dans le code applicatif", () => {
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
          const content = fs.readFileSync(full, "utf8");
          // Valeur de clé secrète en dur (sb_secret_ suivi de matière de clé)
          // ou URL Postgres directe : interdit partout.
          if (/sb_secret_[a-z0-9]/i.test(content) || /postgres(ql)?:\/\//i.test(content)) {
            offenders.push(full);
          }
          // Les noms de variables secrètes ne doivent JAMAIS être exposés
          // au navigateur via un préfixe NEXT_PUBLIC_.
          if (/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE)/.test(content)) {
            offenders.push(`${full} (secret exposé en NEXT_PUBLIC_)`);
          }
          // Aucun secret serveur assigné en littéral (NAME = "valeur").
          for (const name of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SHOPIFY_ADMIN_ACCESS_TOKEN", "SHOPIFY_WEBHOOK_SECRET", "GOOGLE_PRIVATE_KEY"]) {
            if (new RegExp(`${name}\\s*[:=]\\s*["'\`][^"'\`]`).test(content)) {
              offenders.push(`${full} (${name} assigné en littéral)`);
            }
          }
        }
      }
    };
    scan(path.join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });

  it("la clé Google ne sort jamais du serveur", () => {
    // GOOGLE_PRIVATE_KEY / GOOGLE_SERVICE_ACCOUNT_EMAIL ne doivent être lus
    // que par le module serveur dédié — jamais par un composant client, un
    // fichier de types partagés ou une page.
    const autorises = new Set([
      path.join("src", "lib", "recap", "google-sheets.ts"),
      // La route serveur cite les NOMS des variables dans un message d'aide,
      // jamais leurs valeurs.
      path.join("src", "app", "api", "recap", "sync", "route.ts"),
    ]);
    const fautifs: string[] = [];
    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full);
          continue;
        }
        // Les fichiers de test citent forcément les noms qu'ils contrôlent.
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
          continue;
        }
        const relatif = path.relative(process.cwd(), full);
        if (autorises.has(relatif)) continue;
        const contenu = fs.readFileSync(full, "utf8");
        if (/GOOGLE_(PRIVATE_KEY|SERVICE_ACCOUNT_EMAIL)/.test(contenu)) {
          fautifs.push(relatif);
        }
      }
    };
    scan(path.join(process.cwd(), "src"));
    expect(fautifs).toEqual([]);
  });

  it("le module Google Sheets ne demande que la LECTURE", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/recap/google-sheets.ts"),
      "utf8",
    );
    expect(source).toContain("spreadsheets.readonly");
    // Aucune portée d'écriture, sous aucune forme.
    expect(source).not.toMatch(/auth\/spreadsheets(?!\.readonly)/);
    expect(source).not.toMatch(/drive\.file|auth\/drive(?!\.readonly)/);
  });

  it("le seed distant ne contient aucun mot de passe ni compte auth", () => {
    const seed = fs.readFileSync(path.join(process.cwd(), "supabase/seed.sql"), "utf8");
    expect(seed).not.toMatch(/password|mot de passe :|crypt\(/i);
    expect(seed).not.toMatch(/insert into auth\./);
    // Aucune donnée personnelle des tests locaux (clients de la démo).
    expect(seed).not.toMatch(/Camille Estève|Thomas Vernet|06 00 00 00/);
  });
});
