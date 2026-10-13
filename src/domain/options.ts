/** Fuseaux proposés à la création d'une académie (liste courte ; le serveur accepte tout fuseau IANA valide). */
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "Europe/Paris", label: "Paris, Bruxelles (Europe/Paris)" },
  { value: "Europe/Brussels", label: "Bruxelles (Europe/Brussels)" },
  { value: "Europe/Zurich", label: "Zurich, Genève (Europe/Zurich)" },
  { value: "Europe/Luxembourg", label: "Luxembourg (Europe/Luxembourg)" },
  { value: "Europe/London", label: "Londres (Europe/London)" },
  { value: "Europe/Dublin", label: "Dublin (Europe/Dublin)" },
  { value: "Europe/Madrid", label: "Madrid (Europe/Madrid)" },
  { value: "Europe/Lisbon", label: "Lisbonne (Europe/Lisbon)" },
  { value: "Europe/Amsterdam", label: "Amsterdam (Europe/Amsterdam)" },
  { value: "Europe/Berlin", label: "Berlin (Europe/Berlin)" },
  { value: "Europe/Rome", label: "Rome (Europe/Rome)" },
  { value: "America/Toronto", label: "Montréal, Toronto (America/Toronto)" },
  { value: "America/New_York", label: "New York (America/New_York)" },
  { value: "America/Los_Angeles", label: "Los Angeles (America/Los_Angeles)" },
  { value: "Indian/Reunion", label: "La Réunion (Indian/Reunion)" },
  { value: "America/Martinique", label: "Antilles (America/Martinique)" },
  { value: "Pacific/Noumea", label: "Nouvelle-Calédonie (Pacific/Noumea)" },
  { value: "Australia/Sydney", label: "Sydney (Australia/Sydney)" },
];

export const CURRENCY_LABELS: Record<string, string> = {
  EUR: "Euro (EUR)",
  CHF: "Franc suisse (CHF)",
  GBP: "Livre sterling (GBP)",
  USD: "Dollar américain (USD)",
  CAD: "Dollar canadien (CAD)",
  AUD: "Dollar australien (AUD)",
};
