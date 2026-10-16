/**
 * Libellé grossier d'un appareil à partir de son en-tête User-Agent (« Chrome sur Android »). Seuls le navigateur et le
 * système sont retenus : jamais de version, de modèle ni d'autre détail qui rendrait l'appareil plus identifiable.
 */

export type DeviceKind = "phone" | "tablet" | "computer" | "unknown";

export interface DeviceLabel {
  kind: DeviceKind;
  /** Ex. « Chrome sur Android », « Safari sur iPhone », « Appareil inconnu ». */
  label: string;
}

// L'ordre compte : Edge, Opera et Samsung Internet s'annoncent aussi comme « Chrome » ; Chrome et Firefox sur iOS comme « Safari ».
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\b(OPR|Opera|OPiOS)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: [RegExp, string, DeviceKind][] = [
  [/\biPhone\b/, "iPhone", "phone"],
  [/\biPad\b/, "iPad", "tablet"],
  [/\bAndroid\b.*\bMobile\b/, "Android", "phone"],
  [/\bAndroid\b/, "Android", "tablet"],
  [/\bCrOS\b/, "ChromeOS", "computer"],
  [/\bWindows\b/, "Windows", "computer"],
  [/\bMac OS X\b|\bMacintosh\b/, "Mac", "computer"],
  [/\bLinux\b/, "Linux", "computer"],
];

export function describeUserAgent(userAgent: string | null | undefined): DeviceLabel {
  const ua = (userAgent ?? "").slice(0, 512);
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua));
  if (!browser && !system) return { kind: "unknown", label: "Appareil inconnu" };
  if (!system) return { kind: "unknown", label: browser! };
  if (!browser) return { kind: system[2], label: system[1] };
  return { kind: system[2], label: `${browser} sur ${system[1]}` };
}
