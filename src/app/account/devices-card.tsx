import { InlineAction } from "@/components/ui/confirm";
import { buttonClasses } from "@/components/ui/button-classes";
import { Alert, Badge, Card } from "@/components/ui/ui";
import { relativeDay } from "@/domain/dates";
import type { ConnectedDevice } from "@/server/auth/devices";
import { revokeDeviceAction, revokeOtherDevicesAction, signOutAction } from "@/server/actions/auth";

// Les dates de session ne sont rattachées à aucun club : fuseau de la plateforme (comme l'administration).
const TIME_ZONE = "Europe/Paris";

/**
 * Les sessions ouvertes du compte (une par appareil ou navigateur) : l'appareil courant se déconnecte normalement, les autres
 * à distance (téléphone perdu, ordinateur partagé). Seuls un libellé grossier (navigateur, système) et des dates sont affichés.
 */
export function DevicesCard({ devices, notice, now = new Date() }: { devices: ConnectedDevice[]; notice?: string; now?: Date }) {
  const others = devices.filter((d) => !d.current).length;
  return (
    <Card
      flush
      id="appareils"
      title="Mes appareils connectés"
      description="Votre compte reste ouvert un an sur chaque appareil. Déconnectez ceux que vous ne reconnaissez pas, perdus ou partagés."
    >
      {notice && (
        <div className="px-4 pt-4 sm:px-5">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <ul className="divide-y divide-line">
        {devices.map((d) => {
          const activity = `Dernière activité ${relativeDay(d.lastActiveAt, now, TIME_ZONE)}`;
          return (
            <li
              key={d.id}
              data-device={d.current ? "current" : "other"}
              className="flex flex-col items-start gap-2 px-4 py-3 sm:px-5 min-[30rem]:flex-row min-[30rem]:items-center min-[30rem]:justify-between"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                  {d.label}
                  {d.current && <Badge tone="ink">Cet appareil</Badge>}
                </p>
                <p className="text-sm text-ink-soft">
                  {activity} · connecté {relativeDay(d.signedInAt, now, TIME_ZONE)}
                </p>
              </div>
              {d.current ? (
                <form action={signOutAction} className="shrink-0">
                  <button type="submit" className={buttonClasses({ variant: "secondary" })}>
                    Se déconnecter
                  </button>
                </form>
              ) : (
                <InlineAction
                  action={revokeDeviceAction.bind(null, d.id)}
                  label={
                    <>
                      Déconnecter<span className="sr-only"> : {d.label}, {activity.toLowerCase()}</span>
                    </>
                  }
                  pendingLabel="Déconnexion…"
                  variant="secondary"
                  className="shrink-0"
                />
              )}
            </li>
          );
        })}
      </ul>
      {others > 0 && (
        <div className="border-t border-line px-4 py-3.5 sm:px-5">
          <InlineAction action={revokeOtherDevicesAction} label="Déconnecter tous les autres appareils" pendingLabel="Déconnexion…" variant="secondary" />
        </div>
      )}
    </Card>
  );
}
