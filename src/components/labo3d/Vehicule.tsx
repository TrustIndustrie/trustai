"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Html } from "@react-three/drei";
import type { Group } from "three";
import { positionDuVehicule } from "./geometrie";
import type { Vehicule as VehiculeModele } from "@/lib/labo3d/types";

/**
 * LABORATOIRE 3D — un camion.
 *
 * Cabine, remorque, roues, calandre, pare-brise, feux : une quinzaine de
 * volumes assemblés en code. Un camion crédible ne demande pas un modèle
 * importé, il demande les bonnes proportions — cabine courte et haute,
 * remorque longue et basse, roues enfoncées sous les flancs.
 */

const COULEURS: Record<VehiculeModele["role"], string> = {
  transfert: "#4a7fb5",
  livraison: "#3f9e5a",
  fournisseur: "#b08968",
};

interface Props {
  modele: VehiculeModele;
  selectionne: boolean;
  survole: boolean;
  /** Trafic continu : les camions roulent sans attendre le jour suivant. */
  circulation: boolean;
  onSurvol: (id: string | null) => void;
  onClick: (id: string) => void;
}

function Roue({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x, 0.42, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.42, 0.42, 0.26, 14]} />
      <meshStandardMaterial color="#2b2f34" roughness={0.95} />
    </mesh>
  );
}

export function Vehicule({
  modele,
  selectionne,
  survole,
  circulation,
  onSurvol,
  onClick,
}: Props) {
  const groupe = useRef<Group>(null);
  const teinte = COULEURS[modele.role];

  // Le camion avance le long de la route. Les camions de livraison et les
  // arrivages fournisseurs circulent au-delà des deux dépôts, pour qu'on
  // comprenne qu'ils viennent d'ailleurs ou s'en vont ailleurs.
  useFrame((state) => {
    if (!groupe.current) return;
    const [x, , z] = positionDuVehicule(modele, state.clock.elapsedTime, circulation);
    groupe.current.position.set(x, 0, z);
    // LA CABINE REGARDE DANS LE SENS DE LA MARCHE. Les tournées du Nord
    // remontent vers Lisses et Herblay : les laisser orientées vers le sud
    // les faisait rouler en marche arrière sur toute leur tournée.
    groupe.current.rotation.y =
      modele.role === "livraison" && modele.depart === "argenteuil" ? Math.PI : 0;
  });

  // En trafic continu, les SEMIS d'affrètement portent leur numéro en
  // permanence : c'est l'information que le patron veut suivre des yeux. Les
  // tournées et les arrivages, eux, restent muets — quatre étiquettes
  // permanentes sur la même route redeviendraient illisibles.
  const miseEnAvant = selectionne || survole;
  const numeroPermanent = circulation && modele.role === "transfert";

  return (
    <group
      ref={groupe}
      onClick={(e) => { e.stopPropagation(); onClick(modele.id); }}
      onPointerOver={(e) => { e.stopPropagation(); onSurvol(modele.id); }}
      onPointerOut={() => onSurvol(null)}
    >
      {/* Remorque */}
      <RoundedBox
        args={[2.2, 2.1, 6.4]}
        radius={0.12}
        smoothness={2}
        position={[0, 1.6, -0.6]}
        castShadow
      >
        <meshStandardMaterial
          color={miseEnAvant ? "#f3f1ec" : "#eceae4"}
          roughness={0.72}
          metalness={0.08}
        />
      </RoundedBox>
      {/* Bandeau de couleur sur le flanc : c'est lui qui dit le rôle. */}
      {[-1, 1].map((c) => (
        <mesh key={c} position={[c * 1.12, 1.6, -0.6]}>
          <boxGeometry args={[0.04, 0.9, 5.6]} />
          <meshStandardMaterial
            color={teinte}
            roughness={0.5}
            emissive={teinte}
            emissiveIntensity={miseEnAvant ? 0.45 : 0.12}
          />
        </mesh>
      ))}
      {/* Châssis */}
      <mesh position={[0, 0.62, -0.6]} castShadow>
        <boxGeometry args={[1.9, 0.3, 6.2]} />
        <meshStandardMaterial color="#3a3f45" roughness={0.9} />
      </mesh>

      {/* Cabine */}
      <RoundedBox
        args={[2.2, 2.0, 2.2]}
        radius={0.22}
        smoothness={3}
        position={[0, 1.5, 3.4]}
        castShadow
      >
        <meshStandardMaterial color={teinte} roughness={0.52} metalness={0.18} />
      </RoundedBox>
      {/* Pare-brise */}
      <mesh position={[0, 1.95, 4.46]}>
        <boxGeometry args={[1.74, 0.86, 0.1]} />
        <meshStandardMaterial
          color="#223040"
          roughness={0.12}
          metalness={0.6}
        />
      </mesh>
      {/* Calandre et feux */}
      <mesh position={[0, 0.95, 4.5]}>
        <boxGeometry args={[1.8, 0.5, 0.12]} />
        <meshStandardMaterial color="#2f343a" roughness={0.8} />
      </mesh>
      {[-0.72, 0.72].map((x) => (
        <mesh key={x} position={[x, 1.28, 4.52]}>
          <boxGeometry args={[0.34, 0.2, 0.08]} />
          <meshStandardMaterial
            color="#ffe9b0"
            emissive="#ffd978"
            emissiveIntensity={0.8}
            roughness={0.3}
          />
        </mesh>
      ))}

      <Roue x={-1.05} z={3.3} />
      <Roue x={1.05} z={3.3} />
      <Roue x={-1.05} z={-1.4} />
      <Roue x={1.05} z={-1.4} />
      <Roue x={-1.05} z={-2.5} />
      <Roue x={1.05} z={-2.5} />

      {/* L'étiquette n'apparaît qu'au survol ou à la sélection : cinq
          étiquettes permanentes sur une même route se chevauchent et
          masquent la scène. */}
      {(miseEnAvant || numeroPermanent) && (
        <Html position={[0, 3.8, 0]} center zIndexRange={[18, 0]}>
          <div className="pointer-events-none select-none whitespace-nowrap rounded border border-white/20 bg-slate-900/85 px-2 py-0.5 text-[11px] font-medium text-white shadow-lg">
            {modele.immatriculation} · {modele.caisses} caisse(s)
          </div>
        </Html>
      )}
    </group>
  );
}
