/**
 * Distância em metros entre dois pontos (fórmula de haversine). Usada só
 * para a mensagem de aviso no cliente ANTES de tentar bater o ponto — a
 * validação que de fato vale é a mesma conta rodada no servidor, dentro de
 * `fa_register_ponto` (ver migration fa_kiosk_ponto_geofence_rpc), porque
 * um cálculo só no cliente seria trivial de forjar num registro de jornada
 * com valor legal (Portaria MTP 671/2021).
 */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}
