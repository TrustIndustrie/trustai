-- ============================================================================
-- RETOUR ARRIÈRE — Migration 15 : IMPORT DES EXPORTS SKARA
-- ----------------------------------------------------------------------------
-- À exécuter AVANT les retours arrière des migrations 13 et antérieures :
-- les retours arrière se déroulent dans l'ordre inverse des migrations.
--
-- AVERTISSEMENT : tout ce qui a été importé depuis Skara est perdu. Ce n'est
-- pas grave en soi, puisque Skara reste la source officielle et que les
-- fichiers sont retéléchargeables depuis son historique. En revanche, les
-- natures de ligne confirmées par un humain (produit, remise, service, éco)
-- ne sont PAS reconstituables : les exporter avant d'exécuter ce script.
-- ============================================================================

begin;

-- 1. RPC publiques.
drop function if exists public.get_skara_import(uuid);
drop function if exists public.list_skara_imports(integer);
drop function if exists public.import_skara_file(jsonb);

-- 2. Fonctions internes d'écriture.
drop function if exists app.skara_write_journal(uuid, uuid, jsonb);
drop function if exists app.skara_write_articles(uuid, uuid, jsonb);
drop function if exists app.skara_write_invoice_lines(uuid, uuid, uuid, jsonb);
drop function if exists app.skara_write_invoices(uuid, uuid, uuid, jsonb);

-- 3. Tables : celles qui référencent les imports d'abord.
drop trigger if exists same_org_guard on public.skara_invoice_lines;
drop trigger if exists same_org_guard on public.skara_invoices;
drop trigger if exists same_org_guard on public.skara_imports;
drop trigger if exists append_only_guard on public.skara_import_anomalies;

drop table if exists public.skara_import_anomalies;
drop table if exists public.skara_journal_entries;
drop table if exists public.skara_articles;
drop table if exists public.skara_invoice_lines;
drop table if exists public.skara_invoices;
drop table if exists public.skara_imports;

-- 4. Préfixe de numérotation sur les magasins.
drop index if exists public.stores_skara_prefix_key;
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'stores_skara_prefix_check') then
    alter table public.stores drop constraint stores_skara_prefix_check;
  end if;
end $$;
alter table public.stores drop column if exists skara_invoice_prefix;

commit;
