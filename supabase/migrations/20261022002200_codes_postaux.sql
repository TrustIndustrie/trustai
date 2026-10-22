-- ============================================================================
-- TRUST AI — Migration 22 : RÉFÉRENTIEL DES CODES POSTAUX
-- ----------------------------------------------------------------------------
-- POURQUOI CETTE TABLE EXISTE.
--
-- `customers` porte la ville et le code postal de 152 clients sur 152 — la
-- donnée est là, et complète. Ce qui manque pour la placer sur une carte, ce
-- sont les COORDONNÉES : un code postal n'est pas un point, c'est une
-- référence qu'il faut traduire.
--
-- Sans ce référentiel, toute carte serait dessinée de mémoire. Avec lui, elle
-- est calculée. C'est la différence entre une illustration et une donnée.
--
-- CE QUE CETTE TABLE N'EST PAS
--
--   * Ce ne sont PAS des données de Trust Industrie. C'est un référentiel
--     public, publié par La Poste sous licence ouverte. Il ne contient aucune
--     information client, aucun chiffre d'affaires, rien de sensible.
--   * Elle n'est donc PAS cloisonnée par organisation : un code postal
--     appartient à tout le monde. La RLS reste activée en défense en
--     profondeur, avec une politique de LECTURE SEULE pour les utilisateurs
--     authentifiés, et aucune écriture depuis le navigateur.
--
-- COMMENT LA REMPLIR — voir `docs/CODES_POSTAUX.md`.
--
-- MIGRATION REJOUABLE : `create table if not exists`, `create or replace
-- function`, politique recréée. La coller deux fois est sans effet de bord.
-- ============================================================================

begin;

create table if not exists public.postal_codes (
  -- Un même code postal couvre parfois plusieurs communes (et une commune
  -- peut avoir plusieurs codes) : la clé est donc le COUPLE, pas le code seul.
  code_postal text not null check (code_postal ~ '^[0-9]{5}$'),
  commune text not null,
  -- Code INSEE : la vraie clé stable d'une commune, là où le nom change.
  code_insee text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  primary key (code_postal, commune)
);

create index if not exists postal_codes_cp_idx on public.postal_codes (code_postal);
create index if not exists postal_codes_insee_idx on public.postal_codes (code_insee);

-- ===========================================================================
-- Droits : lecture seule, et rien d'autre
-- ===========================================================================
--
-- Supabase accorde tous les droits sur toute NOUVELLE table : on révoque, puis
-- on n'accorde que le SELECT. Aucune écriture depuis le navigateur, jamais —
-- un référentiel public n'a pas à être modifiable par l'application.

alter table public.postal_codes enable row level security;
revoke all on public.postal_codes from anon;
revoke all on public.postal_codes from authenticated;
grant select on public.postal_codes to authenticated;

drop policy if exists postal_codes_lecture on public.postal_codes;
create policy postal_codes_lecture on public.postal_codes
  for select to authenticated
  using (true);

-- Un dépliage d'accents volontairement minimal : l'extension `unaccent` n'est
-- pas garantie partout, et on n'a besoin que des lettres du français.
create or replace function public.unaccent_simple(p_texte text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
    coalesce(p_texte, ''),
    'àâäáãåçèéêëìíîïñòóôöõùúûüýÿÀÂÄÁÃÅÇÈÉÊËÌÍÎÏÑÒÓÔÖÕÙÚÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')
$$;

-- ===========================================================================
-- Traduire un code postal en coordonnées
-- ===========================================================================
--
-- Deux niveaux de repli, du plus précis au plus grossier, parce qu'un
-- référentiel incomplet ne doit pas faire disparaître un client de la carte :
--
--   1. le couple code postal + commune, quand les deux concordent ;
--   2. le code postal seul — on prend alors le barycentre de ses communes ;
--   3. rien : la fonction rend NULL, et l'appelant décide quoi en faire.
--      Elle n'invente JAMAIS un point « à peu près » pour faire joli.

create or replace function public.resolve_postal_point(
  p_code_postal text,
  p_commune text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with exact as (
    select 1 as rang, latitude, longitude, 'commune' as precision
    from public.postal_codes
    where code_postal = p_code_postal
      and p_commune is not null
      and lower(public.unaccent_simple(commune)) = lower(public.unaccent_simple(p_commune))
    limit 1
  ), par_code as (
    select 2 as rang, avg(latitude) as latitude, avg(longitude) as longitude,
           'code_postal' as precision
    from public.postal_codes
    where code_postal = p_code_postal
    having count(*) > 0
  )
  select jsonb_build_object(
           'latitude', latitude, 'longitude', longitude, 'precision', precision)
  from (select * from exact union all select * from par_code) t
  order by rang
  limit 1
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.resolve_postal_point(text, text)',
    'public.unaccent_simple(text)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
